// Venta de mostrador por HTTP, de punta a punta.
//
// Va en su propio archivo y no junto a las pruebas de servicio: mezclar en un
// mismo archivo las bases en memoria con un servidor HTTP levantado hace que
// el proceso truene al salir con --test-force-exit. El resto de las pruebas
// del proyecto ya mantiene esa separacion.

import test from 'node:test';
import assert from 'node:assert/strict';

import { levantarServidor, pedir, idPlatillo, uuid } from './ayudas.js';

test('por HTTP: la caja cobra sin comanda y la cuenta queda cerrada', async (t) => {
  const srv = await levantarServidor();
  t.after(() => srv.cerrar());

  const pastor = idPlatillo(srv.db, 'Taco de pastor');
  const client_id = uuid();
  const cuerpo = {
    client_id,
    items: [{ client_id: uuid(), platillo_id: pastor, cantidad: 2 }],
    metodo: 'transferencia',
  };

  const creada = await pedir(srv.url, '/api/ventas-mostrador', { method: 'POST', body: cuerpo });
  assert.equal(creada.status, 201);
  assert.equal(creada.cuerpo.comanda.estado, 'cerrada');
  assert.equal(creada.cuerpo.comanda.mostrador, true);
  assert.equal(creada.cuerpo.pago.monto_centavos, 4400);

  // Reintento del mismo envio: 200 y sin cobrar de nuevo.
  const repetida = await pedir(srv.url, '/api/ventas-mostrador', { method: 'POST', body: cuerpo });
  assert.equal(repetida.status, 200);
  assert.equal(repetida.cuerpo.duplicada, true);
  assert.equal(repetida.cuerpo.comanda.id, creada.cuerpo.comanda.id);

  // No aparece en las cuentas abiertas de la caja: ya se cobro.
  const abiertas = await pedir(srv.url, '/api/comandas?estado=abierta');
  assert.equal(abiertas.cuerpo.length, 0);
});

test('una venta de mostrador sin platillos se rechaza con 400, no con 500', async (t) => {
  const srv = await levantarServidor();
  t.after(() => srv.cerrar());

  const { status, cuerpo } = await pedir(srv.url, '/api/ventas-mostrador', {
    method: 'POST',
    body: { client_id: uuid(), items: [] },
  });

  assert.equal(status, 400);
  assert.equal(cuerpo.error, 'sin_items');
});

test('la venta de mostrador entra al corte del dia por HTTP', async (t) => {
  const srv = await levantarServidor();
  t.after(() => srv.cerrar());
  const pastor = idPlatillo(srv.db, 'Taco de pastor');

  await pedir(srv.url, '/api/ventas-mostrador', {
    method: 'POST',
    body: {
      client_id: uuid(),
      items: [{ client_id: uuid(), platillo_id: pastor, cantidad: 3 }],
      metodo: 'efectivo',
    },
  });

  const { cuerpo: corte } = await srv.pedir('/api/reportes/corte');
  assert.equal(corte.cobrado_centavos, 6600);
  assert.equal(corte.mostrador.cuentas, 1);
  assert.equal(corte.mostrador.total_centavos, 6600);
});
