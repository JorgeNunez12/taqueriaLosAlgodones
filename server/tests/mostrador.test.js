// Ventas de mostrador: el cliente que llega, pide para llevar y paga en la
// caja sin sentarse. Lo que se prueba aqui es que esa venta se comporte como
// cualquier otra venta del dia (entra al corte, va a cocina, no se cobra dos
// veces) SIN inventar una mesa que no existe.

import test from 'node:test';
import assert from 'node:assert/strict';

import { servicioDePrueba, idPlatillo, uuid } from './ayudas.js';
import { crearReportes } from '../src/reportes.js';

test('una venta de mostrador cobra y cierra en un solo paso', () => {
  const { db, servicio } = servicioDePrueba();
  const pastor = idPlatillo(db, 'Taco de pastor');

  const { comanda, pago } = servicio.ventaMostrador({
    client_id: uuid(),
    items: [{ client_id: uuid(), platillo_id: pastor, cantidad: 3 }],
    metodo: 'efectivo',
  });

  assert.equal(comanda.estado, 'cerrada');
  assert.equal(comanda.mesa_id, null);
  assert.equal(comanda.mostrador, true);
  assert.equal(comanda.mesa_numero, null);
  assert.equal(comanda.total_centavos, 6600);
  assert.equal(comanda.saldo_centavos, 0);
  assert.equal(pago.monto_centavos, 6600);
  assert.equal(pago.metodo, 'efectivo');
});

test('la venta de mostrador no ocupa ninguna mesa', () => {
  const { db, servicio } = servicioDePrueba();
  const pastor = idPlatillo(db, 'Taco de pastor');

  servicio.ventaMostrador({
    client_id: uuid(),
    items: [{ client_id: uuid(), platillo_id: pastor, cantidad: 2 }],
  });

  // Todas las mesas siguen libres: nadie se sento.
  assert.ok(servicio.listarMesas().every((m) => m.estado === 'libre'));
  assert.ok(servicio.listarMesas().every((m) => m.comandas.length === 0));
});

test('sus platillos SI llegan a cocina', () => {
  const { db, servicio } = servicioDePrueba();
  const gringa = idPlatillo(db, 'Gringa');

  servicio.ventaMostrador({
    client_id: uuid(),
    items: [{ client_id: uuid(), platillo_id: gringa, cantidad: 1 }],
  });

  const cocina = servicio.pendientesCocina();
  assert.equal(cocina.length, 1);
  assert.equal(cocina[0].mostrador, true);
  assert.equal(cocina[0].mesa_numero, null);
  assert.equal(cocina[0].items[0].nombre_snapshot, 'Gringa');
});

test('reintentar la misma venta no la cobra dos veces', () => {
  const { db, servicio } = servicioDePrueba();
  const pastor = idPlatillo(db, 'Taco de pastor');
  const client_id = uuid();
  const items = [{ client_id: uuid(), platillo_id: pastor, cantidad: 2 }];

  const primera = servicio.ventaMostrador({ client_id, items });
  const reintento = servicio.ventaMostrador({ client_id, items });

  assert.equal(reintento.duplicada, true);
  assert.equal(reintento.comanda.id, primera.comanda.id);

  const { n } = db.prepare('SELECT COUNT(*) AS n FROM pagos').get();
  assert.equal(n, 1, 'el reintento no debe dejar un segundo pago');
  const total = db.prepare('SELECT SUM(monto_centavos) AS t FROM pagos').get().t;
  assert.equal(total, 4400);
});

test('una venta sin platillos se rechaza y no deja cuenta colgando', () => {
  const { db, servicio } = servicioDePrueba();

  assert.throws(() => servicio.ventaMostrador({ client_id: uuid(), items: [] }), /sin_items|ningun platillo/i);

  const { n } = db.prepare('SELECT COUNT(*) AS n FROM comandas').get();
  assert.equal(n, 0, 'no debe quedar una comanda sin mesa a medio hacer');
});

test('si un platillo esta agotado, la venta entera se deshace', () => {
  const { db, servicio } = servicioDePrueba();
  const pastor = idPlatillo(db, 'Taco de pastor');
  const refresco = idPlatillo(db, 'Refresco 600ml');
  db.prepare('UPDATE platillos SET disponible = 0 WHERE id = ?').run(refresco);

  assert.throws(() =>
    servicio.ventaMostrador({
      client_id: uuid(),
      items: [
        { client_id: uuid(), platillo_id: pastor, cantidad: 1 },
        { client_id: uuid(), platillo_id: refresco, cantidad: 1 },
      ],
    })
  );

  // Lo importante: ni comanda, ni items, ni pago. La transaccion se deshizo
  // completa, no a medias.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comandas').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comanda_items').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pagos').get().n, 0);
});

test('el corte del dia cuenta el mostrador y lo separa de los meseros', () => {
  const { db, servicio } = servicioDePrueba();
  const reportes = crearReportes(db);
  const pastor = idPlatillo(db, 'Taco de pastor');

  // Una venta de mesa, a nombre de una mesera.
  const mesera = db.prepare('SELECT id FROM meseros ORDER BY id').get().id;
  const { comanda } = servicio.crearComanda({ client_id: uuid(), mesa_id: 1, mesero_id: mesera });
  servicio.agregarItems(comanda.id, [{ client_id: uuid(), platillo_id: pastor, cantidad: 1 }]);
  servicio.registrarPago({ client_id: uuid(), comanda_id: comanda.id, tipo: 'total' });

  // Y una de mostrador.
  servicio.ventaMostrador({
    client_id: uuid(),
    items: [{ client_id: uuid(), platillo_id: pastor, cantidad: 4 }],
    metodo: 'tarjeta',
  });

  const corte = reportes.corteDelDia();

  // El dinero de las dos entra al cobrado del dia.
  assert.equal(corte.cobrado_centavos, 2200 + 8800);
  // Y el mostrador se puede mirar aparte.
  assert.equal(corte.mostrador.cuentas, 1);
  assert.equal(corte.mostrador.total_centavos, 8800);
  // No se disfraza de "sin asignar" ni se le cuelga a una mesera.
  const nombres = corte.meseros.map((m) => m.mesero);
  assert.ok(nombres.includes('mostrador'));
  assert.ok(!nombres.includes('sin asignar'));
  // Los platillos vendidos suman los de las dos vias.
  const vendidos = corte.platillos.find((p) => p.nombre === 'Taco de pastor');
  assert.equal(vendidos.unidades, 5);
});
