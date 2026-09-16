import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { abrirDb } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearServicio } from '../src/servicio.js';
import { pesosACentavos } from '../src/dinero.js';

export const MENU_PRUEBA = [
  ['Taco de pastor', 22, 'tacos'],
  ['Taco de suadero', 24, 'tacos'],
  ['Refresco 600ml', 30, 'bebidas'],
  ['Gringa', 65, 'especialidades'],
];

/** Base lista para probar: 4 mesas, meseros y un menu chico de precios conocidos. */
export function baseDePrueba(ruta = ':memory:') {
  const db = abrirDb(ruta);
  const hayMesas = db.prepare('SELECT COUNT(*) AS n FROM mesas').get().n > 0;
  if (!hayMesas) {
    const mesa = db.prepare('INSERT INTO mesas (numero) VALUES (?)');
    for (let n = 1; n <= 4; n++) mesa.run(n);
    const mesero = db.prepare('INSERT INTO meseros (nombre, orden) VALUES (?, ?)');
    ['Maria', 'Lupe'].forEach((nombre, i) => mesero.run(nombre, i));
    const platillo = db.prepare(
      'INSERT INTO platillos (nombre, precio_centavos, categoria, orden) VALUES (?, ?, ?, ?)'
    );
    MENU_PRUEBA.forEach(([nombre, precio, categoria], i) =>
      platillo.run(nombre, pesosACentavos(precio), categoria, i)
    );
  }
  return db;
}

export function servicioDePrueba(ruta = ':memory:') {
  const db = baseDePrueba(ruta);
  return { db, servicio: crearServicio(db) };
}

/** Busca el id de un platillo por nombre, para que las pruebas no dependan del orden. */
export const idPlatillo = (db, nombre) =>
  db.prepare('SELECT id FROM platillos WHERE nombre = ?').get(nombre).id;

/**
 * Ruta a un archivo .db temporal, para probar reinicios reales.
 * `limpiar` debe registrarse DESPUES de los cierres de base: Windows no deja
 * borrar el archivo mientras SQLite lo tiene abierto. Aun asi reintenta y
 * traga el error, porque una limpieza fallida no es una prueba fallida.
 */
export function rutaDbTemporal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taqueria-test-'));
  return {
    ruta: path.join(dir, 'taqueria.db'),
    limpiar: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // El sistema operativo se encarga de la carpeta temporal.
      }
    },
  };
}

/** Levanta el servidor HTTP en un puerto libre y devuelve su URL base. */
export async function levantarServidor(ruta = ':memory:') {
  const db = baseDePrueba(ruta);
  const { server, io, servicio } = crearApp({ db });
  await new Promise((listo) => server.listen(0, '127.0.0.1', listo));
  const url = `http://127.0.0.1:${server.address().port}`;
  const token = await tokenEncargado(url);

  return {
    url,
    db,
    servicio,
    token,
    /** pedir() con el token de encargado ya puesto. */
    pedir: (ruta, opciones = {}) => pedir(url, ruta, { token, ...opciones }),
    async cerrar() {
      // socket.io tiene que terminar de cerrar ANTES de que se muera el
      // proceso. io.close() acepta callback y cierra tambien el servidor HTTP
      // que tiene montado; sin esperarlo, --test-force-exit mata el proceso a
      // media limpieza y libuv truena cerrando un handle que ya venia
      // cerrandose (UV_HANDLE_CLOSING, en Windows). Se nota sobre todo en los
      // archivos con una sola prueba, donde no hay nada mas que alcance a
      // correr en lo que la limpieza termina.
      //
      // closeAllConnections va primero porque fetch deja la conexion abierta
      // por keep-alive y si no se corta, el cierre se queda esperandola.
      server.closeAllConnections?.();
      await new Promise((listo) => io.close(listo));
      db.close();
    },
  };
}

/**
 * Token de encargado, para las rutas de /api/reportes y /api/admin.
 *
 * Las pruebas lo piden de verdad al servidor en vez de saltarse la revision:
 * asi el gate queda cubierto por el mismo camino que usa la tablet, y una
 * prueba que pega a /api/admin sin token sigue siendo capaz de ver el 401.
 */
export async function tokenEncargado(url, usuario = 'algodones', clave = 'clave-de-prueba') {
  const res = await fetch(url + '/api/acceso', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usuario, clave }),
  });
  if (!res.ok) throw new Error(`No se pudo iniciar sesion de encargado: ${res.status}`);
  return (await res.json()).token;
}

/**
 * fetch con JSON en ambos sentidos. Devuelve {status, cuerpo}.
 *
 * `opciones.token` manda el header de encargado. `levantarServidor` deja uno
 * listo en `sesion.token`, asi que la mayoria de las pruebas usan
 * `sesion.pedir(...)`, que lo pone solo.
 */
export async function pedir(url, ruta, opciones = {}) {
  const headers = { 'content-type': 'application/json' };
  if (opciones.token) headers.authorization = `Bearer ${opciones.token}`;
  const res = await fetch(url + ruta, {
    method: opciones.method ?? 'GET',
    headers,
    body: opciones.body === undefined ? undefined : JSON.stringify(opciones.body),
  });
  return { status: res.status, cuerpo: await res.json() };
}

export const uuid = randomUUID;
