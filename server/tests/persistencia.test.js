// Se va la luz a media hora pico. Al volver, ningun pedido debe faltar.

import test from 'node:test';
import assert from 'node:assert/strict';

import { levantarServidor, pedir, baseDePrueba, rutaDbTemporal, idPlatillo, uuid } from './ayudas.js';
import { crearServicio } from '../src/servicio.js';

test('los pedidos sobreviven al reinicio del servidor', async (t) => {
  const { ruta, limpiar } = rutaDbTemporal();

  // --- Antes del apagon ---
  const antes = await levantarServidor(ruta);
  const pastor = idPlatillo(antes.db, 'Taco de pastor');
  const refresco = idPlatillo(antes.db, 'Refresco 600ml');

  const { cuerpo: comanda } = await pedir(antes.url, '/api/comandas', {
    method: 'POST',
    body: { client_id: uuid(), mesa_id: 3, etiqueta: 'Familia 1', mesera: 'Rosa' },
  });
  const { cuerpo: pedido } = await pedir(antes.url, `/api/comandas/${comanda.id}/items`, {
    method: 'POST',
    body: {
      items: [
        { client_id: uuid(), platillo_id: pastor, cantidad: 6, notas: 'sin cebolla' },
        { client_id: uuid(), platillo_id: refresco, cantidad: 3 },
      ],
    },
  });
  await pedir(antes.url, `/api/items/${pedido.comanda.items[0].id}/estado`, {
    method: 'PATCH',
    body: { estado: 'preparando' },
  });
  await antes.cerrar();

  // --- Despues de reiniciar ---
  const despues = await levantarServidor(ruta);
  // Los hooks corren en orden de registro: primero cerrar, luego borrar.
  t.after(() => despues.cerrar());
  t.after(limpiar);

  const { cuerpo: recuperada } = await pedir(despues.url, `/api/comandas/${comanda.id}`);
  assert.equal(recuperada.estado, 'abierta');
  assert.equal(recuperada.etiqueta, 'Familia 1');
  assert.equal(recuperada.mesera, 'Rosa');
  assert.equal(recuperada.items.length, 2);
  assert.equal(recuperada.total, 22 * 6 + 30 * 3);
  assert.equal(recuperada.items[0].notas, 'sin cebolla');
  assert.equal(recuperada.items[0].estado, 'preparando', 'cocina no pierde su avance');

  // La mesa sigue ocupada y la cocina recupera su cola.
  const { cuerpo: mesas } = await pedir(despues.url, '/api/mesas');
  assert.equal(mesas.find((m) => m.id === 3).estado, 'ocupada');
  assert.equal((await pedir(despues.url, '/api/cocina/pendientes')).cuerpo.length, 1);
});

test('un corte de corriente sin cierre limpio no pierde el ultimo pedido', async (t) => {
  const { ruta, limpiar } = rutaDbTemporal();

  const srv = await levantarServidor(ruta);
  const pastor = idPlatillo(srv.db, 'Taco de pastor');
  const { cuerpo: comanda } = await pedir(srv.url, '/api/comandas', {
    method: 'POST',
    body: { mesa_id: 2 },
  });
  await pedir(srv.url, `/api/comandas/${comanda.id}/items`, {
    method: 'POST',
    body: { items: [{ platillo_id: pastor, cantidad: 5 }] },
  });

  // Simula el jalon de cable: se abre otra conexion al archivo sin haber
  // cerrado la anterior. Con synchronous=FULL el commit ya toco el disco.
  const dbTestigo = baseDePrueba(ruta);
  t.after(async () => {
    dbTestigo.close();
    await srv.cerrar();
  });
  t.after(limpiar);

  const recuperada = crearServicio(dbTestigo).obtenerComanda(comanda.id);
  assert.equal(recuperada.items.length, 1);
  assert.equal(recuperada.total, 110);
});

test('el esquema se puede aplicar dos veces sin romper datos existentes', async (t) => {
  const { ruta, limpiar } = rutaDbTemporal();

  const primera = baseDePrueba(ruta);
  primera.prepare('INSERT INTO comandas (mesa_id, etiqueta) VALUES (1, ?)').run('Prueba');
  primera.close();

  // abrirDb corre schema.sql en cada arranque; los CREATE TABLE IF NOT EXISTS
  // deben ser inofensivos sobre una base ya poblada.
  const segunda = baseDePrueba(ruta);
  t.after(() => segunda.close());
  t.after(limpiar);
  assert.equal(segunda.prepare('SELECT COUNT(*) AS n FROM comandas').get().n, 1);
  assert.equal(segunda.prepare('SELECT COUNT(*) AS n FROM mesas').get().n, 4);
});
