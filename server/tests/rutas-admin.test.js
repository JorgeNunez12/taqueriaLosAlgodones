// Las rutas nuevas por HTTP, como las llama la tablet del encargado.
//
// Las reglas de negocio ya se prueban en admin.test.js y reportes.test.js
// contra el servicio directo. Lo que se verifica aqui es lo que solo se puede
// romper en la capa HTTP: que el codigo de estado sea el correcto, que los
// errores de negocio no salgan como 500, y que la query de fecha llegue bien.

import test from 'node:test';
import assert from 'node:assert/strict';

import { levantarServidor, pedir, idPlatillo, uuid } from './ayudas.js';

test('el corte se sirve por HTTP y cuadra con lo cobrado', async (t) => {
  const s = await levantarServidor();
  t.after(() => s.cerrar());

  const pastor = idPlatillo(s.db, 'Taco de pastor');
  const { cuerpo: comanda } = await pedir(s.url, '/api/comandas', {
    method: 'POST',
    body: { client_id: uuid(), mesa_id: 1 },
  });
  await pedir(s.url, `/api/comandas/${comanda.id}/items`, {
    method: 'POST',
    body: { items: [{ client_id: uuid(), platillo_id: pastor, cantidad: 2 }] },
  });
  await pedir(s.url, `/api/comandas/${comanda.id}/cerrar`, {
    method: 'POST',
    body: { metodo_pago: 'efectivo', client_id: uuid() },
  });

  const { status, cuerpo } = await pedir(s.url, '/api/reportes/corte');
  assert.equal(status, 200);
  assert.equal(cuerpo.cobrado_centavos, 4400);
  assert.equal(cuerpo.cuentas.cerradas, 1);

  const historial = await pedir(s.url, '/api/reportes/historial');
  assert.equal(historial.cuerpo.length, 1);
  assert.equal(historial.cuerpo[0].id, comanda.id);
});

test('una fecha invalida en la query no truena: cae en hoy', async (t) => {
  const s = await levantarServidor();
  t.after(() => s.cerrar());

  const basura = await pedir(s.url, '/api/reportes/corte?fecha=no-es-fecha');
  assert.equal(basura.status, 200);

  // Y un intento de inyeccion tampoco pasa de ahi.
  const inyeccion = await pedir(
    s.url,
    `/api/reportes/corte?fecha=${encodeURIComponent("2026-01-01'; DROP TABLE pagos;--")}`
  );
  assert.equal(inyeccion.status, 200);

  // La tabla sigue viva: si el DROP hubiera pasado, esto tronaria.
  const despues = await pedir(s.url, '/api/reportes/corte');
  assert.equal(despues.status, 200);

  const pasado = await pedir(s.url, '/api/reportes/corte?fecha=2020-01-01');
  assert.equal(pasado.cuerpo.fecha, '2020-01-01');
  assert.equal(pasado.cuerpo.cobrado_centavos, 0);
});

test('alta, edicion y agotado de un platillo por HTTP', async (t) => {
  const s = await levantarServidor();
  t.after(() => s.cerrar());

  const alta = await pedir(s.url, '/api/admin/platillos', {
    method: 'POST',
    body: { nombre: 'Volcan', precio: '45.00', categoria: 'especialidades' },
  });
  assert.equal(alta.status, 201);
  assert.equal(alta.cuerpo.precio_centavos, 4500);

  const edicion = await pedir(s.url, `/api/admin/platillos/${alta.cuerpo.id}`, {
    method: 'PATCH',
    body: { precio: '48.50' },
  });
  assert.equal(edicion.status, 200);
  assert.equal(edicion.cuerpo.precio_centavos, 4850);
  assert.equal(edicion.cuerpo.nombre, 'Volcan', 'lo que no se manda no se pierde');

  const agotar = await pedir(s.url, `/api/admin/platillos/${alta.cuerpo.id}/disponible`, {
    method: 'PATCH',
    body: { disponible: false },
  });
  assert.equal(agotar.cuerpo.disponible, 0);

  // El menu de la mesera ya no lo trae.
  const menu = await pedir(s.url, '/api/platillos?disponibles=1');
  assert.ok(!menu.cuerpo.some((p) => p.id === alta.cuerpo.id));

  const borrado = await pedir(s.url, `/api/admin/platillos/${alta.cuerpo.id}`, {
    method: 'DELETE',
  });
  assert.equal(borrado.status, 200);
  assert.equal(borrado.cuerpo.eliminado, true);
});

test('los errores de negocio salen con su codigo, no como 500', async (t) => {
  const s = await levantarServidor();
  t.after(() => s.cerrar());

  // Precio invalido -> 400 con codigo, no un stack trace.
  const malPrecio = await pedir(s.url, '/api/admin/platillos', {
    method: 'POST',
    body: { nombre: 'X', precio: 'gratis', categoria: 'tacos' },
  });
  assert.equal(malPrecio.status, 400);
  assert.equal(malPrecio.cuerpo.error, 'precio_invalido');

  // Borrar un platillo con historial -> 409 explicando que se marque agotado.
  const pastor = idPlatillo(s.db, 'Taco de pastor');
  const { cuerpo: comanda } = await pedir(s.url, '/api/comandas', {
    method: 'POST',
    body: { client_id: uuid(), mesa_id: 1 },
  });
  await pedir(s.url, `/api/comandas/${comanda.id}/items`, {
    method: 'POST',
    body: { items: [{ client_id: uuid(), platillo_id: pastor, cantidad: 1 }] },
  });

  const conHistorial = await pedir(s.url, `/api/admin/platillos/${pastor}`, { method: 'DELETE' });
  assert.equal(conHistorial.status, 409);
  assert.equal(conHistorial.cuerpo.error, 'platillo_con_historial');

  const noExiste = await pedir(s.url, '/api/admin/platillos/9999', {
    method: 'PATCH',
    body: { nombre: 'X' },
  });
  assert.equal(noExiste.status, 404);
});

test('alta y baja de personal por HTTP', async (t) => {
  const s = await levantarServidor();
  t.after(() => s.cerrar());

  const alta = await pedir(s.url, '/api/admin/meseros', {
    method: 'POST',
    body: { nombre: 'Chuy' },
  });
  assert.equal(alta.status, 201);
  assert.equal(alta.cuerpo.activo, 1);

  // Ya puede iniciar sesion en una tablet.
  const paraLogin = await pedir(s.url, '/api/meseros');
  assert.ok(paraLogin.cuerpo.some((m) => m.nombre === 'Chuy'));

  const duplicado = await pedir(s.url, '/api/admin/meseros', {
    method: 'POST',
    body: { nombre: 'Chuy' },
  });
  assert.equal(duplicado.status, 409);
  assert.equal(duplicado.cuerpo.error, 'mesero_duplicado');

  await pedir(s.url, `/api/admin/meseros/${alta.cuerpo.id}`, {
    method: 'PATCH',
    body: { activo: false },
  });
  const despues = await pedir(s.url, '/api/meseros');
  assert.ok(!despues.cuerpo.some((m) => m.nombre === 'Chuy'), 'ya no aparece para iniciar sesion');

  // Pero el encargado sigue viendolo, para poder reactivarlo.
  const todos = await pedir(s.url, '/api/admin/meseros');
  assert.ok(todos.cuerpo.some((m) => m.nombre === 'Chuy'));
});
