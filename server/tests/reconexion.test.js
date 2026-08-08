// La tablet pierde WiFi a media comanda, guarda el pedido en IndexedDB y lo
// reenvia cuando vuelve la senal. Estas pruebas fijan el contrato del servidor
// que hace seguro ese reenvio.

import test from 'node:test';
import assert from 'node:assert/strict';

import { levantarServidor, pedir, idPlatillo, uuid } from './ayudas.js';

test('reenviar el mismo pedido completo no duplica nada', async (t) => {
  const srv = await levantarServidor();
  t.after(() => srv.cerrar());
  const pastor = idPlatillo(srv.db, 'Taco de pastor');
  const refresco = idPlatillo(srv.db, 'Refresco 600ml');

  const { cuerpo: comanda } = await pedir(srv.url, '/api/comandas', {
    method: 'POST',
    body: { client_id: uuid(), mesa_id: 1, mesera: 'Rosa' },
  });

  // La tablet genera los client_id ANTES de mandar, y los conserva en IndexedDB.
  const lote = [
    { client_id: uuid(), platillo_id: pastor, cantidad: 4, notas: 'sin cebolla' },
    { client_id: uuid(), platillo_id: refresco, cantidad: 2 },
  ];

  const primera = await pedir(srv.url, `/api/comandas/${comanda.id}/items`, {
    method: 'POST',
    body: { items: lote },
  });
  assert.equal(primera.cuerpo.agregados, 2);

  // Se cayo el WiFi justo antes de recibir la respuesta: la tablet reenvia igual.
  const reintento = await pedir(srv.url, `/api/comandas/${comanda.id}/items`, {
    method: 'POST',
    body: { items: lote },
  });
  assert.equal(reintento.cuerpo.agregados, 0);
  assert.equal(reintento.cuerpo.duplicados.length, 2);

  const { cuerpo: final } = await pedir(srv.url, `/api/comandas/${comanda.id}`);
  assert.equal(final.items.length, 2);
  assert.equal(final.total, 22 * 4 + 30 * 2);
});

test('reenvio parcial: entra solo lo que falta', async (t) => {
  const srv = await levantarServidor();
  t.after(() => srv.cerrar());
  const pastor = idPlatillo(srv.db, 'Taco de pastor');

  const { cuerpo: comanda } = await pedir(srv.url, '/api/comandas', {
    method: 'POST',
    body: { mesa_id: 1 },
  });

  const yaEnviado = { client_id: uuid(), platillo_id: pastor, cantidad: 2 };
  await pedir(srv.url, `/api/comandas/${comanda.id}/items`, {
    method: 'POST',
    body: { items: [yaEnviado] },
  });

  // La mesera agrego un taco mas estando sin senal; al volver se manda la cola completa.
  const nuevo = { client_id: uuid(), platillo_id: pastor, cantidad: 1 };
  const { cuerpo } = await pedir(srv.url, `/api/comandas/${comanda.id}/items`, {
    method: 'POST',
    body: { items: [yaEnviado, nuevo] },
  });

  assert.equal(cuerpo.agregados, 1);
  assert.deepEqual(cuerpo.duplicados, [yaEnviado.client_id]);
  assert.equal(cuerpo.comanda.total, 22 * 3);
});

test('dos pedidos identicos legitimos SI se registran por separado', async (t) => {
  const srv = await levantarServidor();
  t.after(() => srv.cerrar());
  const pastor = idPlatillo(srv.db, 'Taco de pastor');

  const { cuerpo: comanda } = await pedir(srv.url, '/api/comandas', {
    method: 'POST',
    body: { mesa_id: 1 },
  });

  // El cliente pidio 2 tacos y a los 5 minutos pidio otros 2. Mismo contenido,
  // distinto client_id: son dos pedidos reales, no un reenvio.
  for (let i = 0; i < 2; i++) {
    const { cuerpo } = await pedir(srv.url, `/api/comandas/${comanda.id}/items`, {
      method: 'POST',
      body: { items: [{ client_id: uuid(), platillo_id: pastor, cantidad: 2 }] },
    });
    assert.equal(cuerpo.agregados, 1);
  }

  const { cuerpo: final } = await pedir(srv.url, `/api/comandas/${comanda.id}`);
  assert.equal(final.items.length, 2);
  assert.equal(final.total, 22 * 4);
});

test('reintentar crear la comanda devuelve la misma, no una segunda cuenta', async (t) => {
  const srv = await levantarServidor();
  t.after(() => srv.cerrar());

  const clientId = uuid();
  const cuerpo = { client_id: clientId, mesa_id: 4, etiqueta: 'Familia 2', mesera: 'Lupita' };

  const primera = await pedir(srv.url, '/api/comandas', { method: 'POST', body: cuerpo });
  const segunda = await pedir(srv.url, '/api/comandas', { method: 'POST', body: cuerpo });

  assert.equal(primera.status, 201);
  assert.equal(segunda.status, 200, 'el reintento no crea nada nuevo');
  assert.equal(primera.cuerpo.id, segunda.cuerpo.id);

  const { cuerpo: mesas } = await pedir(srv.url, '/api/mesas');
  assert.equal(mesas.find((m) => m.id === 4).comandas.length, 1);
});

test('cobrar dos veces la misma cuenta no la cobra doble', async (t) => {
  const srv = await levantarServidor();
  t.after(() => srv.cerrar());
  const pastor = idPlatillo(srv.db, 'Taco de pastor');

  const { cuerpo: comanda } = await pedir(srv.url, '/api/comandas', {
    method: 'POST',
    body: { mesa_id: 1 },
  });
  await pedir(srv.url, `/api/comandas/${comanda.id}/items`, {
    method: 'POST',
    body: { items: [{ platillo_id: pastor, cantidad: 3 }] },
  });

  const a = await pedir(srv.url, `/api/comandas/${comanda.id}/cerrar`, {
    method: 'POST',
    body: { metodo_pago: 'efectivo' },
  });
  const b = await pedir(srv.url, `/api/comandas/${comanda.id}/cerrar`, {
    method: 'POST',
    body: { metodo_pago: 'efectivo' },
  });

  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(a.cuerpo.total, 66);
  assert.equal(b.cuerpo.total, 66);
  assert.equal(a.cuerpo.cerrado_en, b.cuerpo.cerrado_en, 'no se re-timbra el cierre');
});

test('el servidor rechaza pedidos mal formados sin tumbarse', async (t) => {
  const srv = await levantarServidor();
  t.after(() => srv.cerrar());

  const { cuerpo: comanda } = await pedir(srv.url, '/api/comandas', {
    method: 'POST',
    body: { mesa_id: 1 },
  });

  const malos = [
    { items: [] },
    { items: null },
    {},
    { items: [{ platillo_id: null, cantidad: 1 }] },
  ];
  for (const body of malos) {
    const { status } = await pedir(srv.url, `/api/comandas/${comanda.id}/items`, {
      method: 'POST',
      body,
    });
    assert.ok(status >= 400 && status < 500, `esperaba 4xx para ${JSON.stringify(body)}`);
  }

  // Y sigue vivo despues de todo eso.
  const { status } = await pedir(srv.url, '/api/salud');
  assert.equal(status, 200);
});
