// Varias tablets pegandole al mismo servidor al mismo tiempo.
// Todo pasa por HTTP real para ejercitar el camino completo.

import test from 'node:test';
import assert from 'node:assert/strict';

import { levantarServidor, pedir, idPlatillo, uuid } from './ayudas.js';

test('8 tablets agregan a la misma comanda a la vez y el total cuadra', async (t) => {
  const srv = await levantarServidor();
  t.after(() => srv.cerrar());
  const pastor = idPlatillo(srv.db, 'Taco de pastor'); // $22

  const { cuerpo: comanda } = await pedir(srv.url, '/api/comandas', {
    method: 'POST',
    body: { mesa_id: 1, etiqueta: 'Familia 1' },
  });

  const TABLETS = 8;
  const TACOS_POR_TABLET = 3;
  const respuestas = await Promise.all(
    Array.from({ length: TABLETS }, () =>
      pedir(srv.url, `/api/comandas/${comanda.id}/items`, {
        method: 'POST',
        body: { items: [{ client_id: uuid(), platillo_id: pastor, cantidad: TACOS_POR_TABLET }] },
      })
    )
  );

  assert.ok(respuestas.every((r) => r.status === 201), 'ninguna tablet debio fallar');

  const { cuerpo: final } = await pedir(srv.url, `/api/comandas/${comanda.id}`);
  assert.equal(final.items.length, TABLETS, 'no se perdio ni se duplico ningun renglon');
  assert.equal(final.total, 22 * TACOS_POR_TABLET * TABLETS);
});

test('dos tablets creando la misma comanda a la vez crean solo una', async (t) => {
  const srv = await levantarServidor();
  t.after(() => srv.cerrar());

  // Mismo client_id = la mesera toco "nueva comanda" y la respuesta se perdio,
  // la tablet reintento. No son dos familias.
  const clientId = uuid();
  const respuestas = await Promise.all(
    Array.from({ length: 5 }, () =>
      pedir(srv.url, '/api/comandas', {
        method: 'POST',
        body: { client_id: clientId, mesa_id: 2, etiqueta: 'Familia 1' },
      })
    )
  );

  const ids = new Set(respuestas.map((r) => r.cuerpo.id));
  assert.equal(ids.size, 1, 'todas las respuestas apuntan a la misma comanda');
  assert.equal(respuestas.filter((r) => r.status === 201).length, 1, 'solo una fue creacion');

  const { cuerpo: abiertas } = await pedir(srv.url, '/api/comandas?estado=abierta');
  assert.equal(abiertas.length, 1);
});

test('dos meseras marcando el mismo platillo "listo" no se pisan', async (t) => {
  const srv = await levantarServidor();
  t.after(() => srv.cerrar());
  const pastor = idPlatillo(srv.db, 'Taco de pastor');

  const { cuerpo: comanda } = await pedir(srv.url, '/api/comandas', {
    method: 'POST',
    body: { mesa_id: 1 },
  });
  const { cuerpo: conItems } = await pedir(srv.url, `/api/comandas/${comanda.id}/items`, {
    method: 'POST',
    body: { items: [{ platillo_id: pastor, cantidad: 1 }] },
  });
  const itemId = conItems.comanda.items[0].id;

  await pedir(srv.url, `/api/items/${itemId}/estado`, {
    method: 'PATCH',
    body: { estado: 'preparando' },
  });

  // Dos pantallas de cocina tocan "listo" al mismo tiempo.
  const dobles = await Promise.all([
    pedir(srv.url, `/api/items/${itemId}/estado`, { method: 'PATCH', body: { estado: 'listo' } }),
    pedir(srv.url, `/api/items/${itemId}/estado`, { method: 'PATCH', body: { estado: 'listo' } }),
  ]);

  assert.ok(dobles.every((r) => r.status === 200), 'el doble toque no debe dar error a cocina');
  assert.ok(dobles.every((r) => r.cuerpo.item.estado === 'listo'));
});

test('el total de la mesa nunca se desfasa aunque todo pase revuelto', async (t) => {
  const srv = await levantarServidor();
  t.after(() => srv.cerrar());
  const pastor = idPlatillo(srv.db, 'Taco de pastor'); // $22
  const refresco = idPlatillo(srv.db, 'Refresco 600ml'); // $30

  const { cuerpo: comanda } = await pedir(srv.url, '/api/comandas', {
    method: 'POST',
    body: { mesa_id: 4 },
  });

  // Pedidos entrando mientras cocina mueve estados de lo ya pedido.
  const { cuerpo: primero } = await pedir(srv.url, `/api/comandas/${comanda.id}/items`, {
    method: 'POST',
    body: { items: [{ platillo_id: pastor, cantidad: 2 }] },
  });
  const itemInicial = primero.comanda.items[0].id;

  await Promise.all([
    pedir(srv.url, `/api/comandas/${comanda.id}/items`, {
      method: 'POST',
      body: { items: [{ platillo_id: refresco, cantidad: 4 }] },
    }),
    pedir(srv.url, `/api/items/${itemInicial}/estado`, {
      method: 'PATCH',
      body: { estado: 'preparando' },
    }),
    pedir(srv.url, `/api/comandas/${comanda.id}/items`, {
      method: 'POST',
      body: { items: [{ platillo_id: pastor, cantidad: 1 }] },
    }),
  ]);

  const { cuerpo: final } = await pedir(srv.url, `/api/comandas/${comanda.id}`);
  assert.equal(final.total, 22 * 2 + 30 * 4 + 22 * 1);

  // El total cacheado coincide con la suma real de los renglones.
  const suma = final.items.reduce((t, i) => t + i.subtotal_centavos, 0);
  assert.equal(final.total_centavos, suma);
});

test('carga de hora pico: 4 mesas llenas, 200 pedidos seguidos', async (t) => {
  const srv = await levantarServidor();
  t.after(() => srv.cerrar());
  const pastor = idPlatillo(srv.db, 'Taco de pastor');

  // 8 cuentas en 4 mesas: el local lleno, con dos cuentas por mesa, que es el
  // escenario real ahora que las mesas se comparten.
  const comandas = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      pedir(srv.url, '/api/comandas', {
        method: 'POST',
        body: { mesa_id: (i % 4) + 1, etiqueta: `Cuenta ${i}` },
      }).then((r) => r.cuerpo)
    )
  );

  const PEDIDOS = 200;
  const inicio = Date.now();
  const respuestas = await Promise.all(
    Array.from({ length: PEDIDOS }, (_, i) =>
      pedir(srv.url, `/api/comandas/${comandas[i % comandas.length].id}/items`, {
        method: 'POST',
        body: { items: [{ client_id: uuid(), platillo_id: pastor, cantidad: 1 }] },
      })
    )
  );
  const ms = Date.now() - inicio;

  assert.ok(respuestas.every((r) => r.status === 201), 'ningun pedido se rechazo bajo carga');

  let renglones = 0;
  let total = 0;
  for (const c of comandas) {
    const { cuerpo } = await pedir(srv.url, `/api/comandas/${c.id}`);
    renglones += cuerpo.items.length;
    total += cuerpo.total_centavos;
  }
  assert.equal(renglones, PEDIDOS);
  assert.equal(total, 2200 * PEDIDOS);

  console.log(`      ${PEDIDOS} pedidos en ${ms}ms (${Math.round(PEDIDOS / (ms / 1000))}/s)`);
});
