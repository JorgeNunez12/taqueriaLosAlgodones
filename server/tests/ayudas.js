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

  return {
    url,
    db,
    servicio,
    async cerrar() {
      io.close();
      await new Promise((listo) => server.close(listo));
      db.close();
    },
  };
}

/** fetch con JSON en ambos sentidos. Devuelve {status, cuerpo}. */
export async function pedir(url, ruta, opciones = {}) {
  const res = await fetch(url + ruta, {
    method: opciones.method ?? 'GET',
    headers: { 'content-type': 'application/json' },
    body: opciones.body === undefined ? undefined : JSON.stringify(opciones.body),
  });
  return { status: res.status, cuerpo: await res.json() };
}

export const uuid = randomUUID;
