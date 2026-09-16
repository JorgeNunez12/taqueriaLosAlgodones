// Cobro de cantidad libre: la caja escribe un monto y cobra, sin picar
// platillos. Para el pedido por telefono, el encargo especial, lo que se
// acordo de palabra.
//
// El riesgo que cubren estas pruebas es que una venta sin items se comporte
// como una cuenta vacia. El sistema entero asume que el total sale de sumar
// platillos: recalcularTotal lo hace, y registrarPago se niega a cobrar una
// comanda sin nada. Una venta libre rompe las dos suposiciones a proposito, y
// si alguna se cuela el monto cobrado se vuelve cero.

import test from 'node:test';
import assert from 'node:assert/strict';

import { servicioDePrueba, idPlatillo, uuid } from './ayudas.js';
import { crearReportes } from '../src/reportes.js';

test('cobra el monto que se escribio y cierra la cuenta', () => {
  const { servicio } = servicioDePrueba();

  const { comanda, pago } = servicio.ventaLibre({
    client_id: uuid(),
    monto_centavos: 12000,
    concepto: 'Pedido por telefono',
    metodo: 'efectivo',
  });

  assert.equal(comanda.estado, 'cerrada');
  assert.equal(comanda.venta_libre, 1);
  assert.equal(comanda.concepto, 'Pedido por telefono');
  assert.equal(comanda.mesa_id, null);
  // Lo que de verdad importa: el total es el monto escrito y NO cero.
  assert.equal(comanda.total_centavos, 12000);
  assert.equal(comanda.saldo_centavos, 0);
  assert.equal(comanda.items.length, 0);
  assert.equal(pago.monto_centavos, 12000);
});

test('el total sobrevive a que se vuelva a leer la comanda', () => {
  // obtenerComanda pasa por armarComanda, y cobrar pasa por recalcularTotal.
  // Si alguno recalculara desde items, el monto se caeria a cero DESPUES de
  // haber cobrado, que es la forma mas silenciosa de perder dinero: el pago
  // sigue ahi y la cuenta dice que no valia nada.
  const { servicio } = servicioDePrueba();

  const { comanda } = servicio.ventaLibre({
    client_id: uuid(),
    monto_centavos: 45050,
    concepto: 'Encargo especial',
  });

  const releida = servicio.obtenerComanda(comanda.id);
  assert.equal(releida.total_centavos, 45050);
  assert.equal(releida.total_formateado, '$450.50');
  assert.equal(releida.saldo_centavos, 0);
});

test('no se cobra dos veces si la tablet reintenta', () => {
  const { servicio } = servicioDePrueba();
  const client_id = uuid();

  const primera = servicio.ventaLibre({ client_id, monto_centavos: 8000 });
  const segunda = servicio.ventaLibre({ client_id, monto_centavos: 8000 });

  assert.equal(primera.duplicada, false);
  assert.equal(segunda.duplicada, true);
  assert.equal(segunda.comanda.id, primera.comanda.id);

  // Un solo pago y un solo cobro en el dia, no dos.
  const reportes = crearReportes(servicio.db);
  const corte = reportes.corteDelDia();
  assert.equal(corte.cobros, 1);
  assert.equal(corte.cobrado_centavos, 8000);
});

test('rechaza montos que no son dinero', () => {
  const { servicio } = servicioDePrueba();

  for (const monto of [0, -500, 1.5, 'mucho', null, undefined, NaN]) {
    assert.throws(
      () => servicio.ventaLibre({ client_id: uuid(), monto_centavos: monto }),
      (err) => err.codigo === 'monto_invalido',
      `deberia rechazar ${JSON.stringify(monto)}`
    );
  }
});

test('el concepto es opcional', () => {
  const { servicio } = servicioDePrueba();

  const { comanda } = servicio.ventaLibre({ client_id: uuid(), monto_centavos: 5000 });
  assert.equal(comanda.concepto, null);
  assert.equal(comanda.total_centavos, 5000);
});

test('entra al corte separada de las ventas de mostrador', () => {
  const { db, servicio } = servicioDePrueba();
  const pastor = idPlatillo(db, 'Taco de pastor');

  // Una de mostrador de verdad (con platillos) y dos libres.
  servicio.ventaMostrador({
    client_id: uuid(),
    items: [{ client_id: uuid(), platillo_id: pastor, cantidad: 2 }],
    metodo: 'efectivo',
  });
  servicio.ventaLibre({ client_id: uuid(), monto_centavos: 10000, concepto: 'Telefono' });
  servicio.ventaLibre({ client_id: uuid(), monto_centavos: 5000 });

  const corte = crearReportes(db).corteDelDia();

  // Las libres van en su propio renglon...
  assert.equal(corte.ventas_libres.cuentas, 2);
  assert.equal(corte.ventas_libres.total_centavos, 15000);
  assert.equal(corte.ventas_libres.detalle.length, 2);
  assert.equal(corte.ventas_libres.detalle[0].concepto, null);
  assert.equal(corte.ventas_libres.detalle[1].concepto, 'Telefono');

  // ...y NO se cuelan en el de mostrador, que cuenta lo que se vendio para
  // llevar con platillos de por medio.
  assert.equal(corte.mostrador.cuentas, 1);
  assert.equal(corte.mostrador.total_centavos, 4400);

  // Pero si suman al total cobrado del dia: es dinero que entro.
  assert.equal(corte.cobrado_centavos, 19400);
  assert.equal(corte.cobros, 3);
});

test('aparece en el historial marcada como venta libre', () => {
  const { db, servicio } = servicioDePrueba();

  servicio.ventaLibre({ client_id: uuid(), monto_centavos: 7500, concepto: 'Catering' });

  const historial = crearReportes(db).historial();
  assert.equal(historial.length, 1);
  assert.equal(historial[0].venta_libre, true);
  // No es una venta de mostrador aunque tampoco tenga mesa: la pantalla las
  // pinta distinto y confundirlas diria "Mostrador" donde no hubo platillos.
  assert.equal(historial[0].mostrador, false);
  assert.equal(historial[0].concepto, 'Catering');
  assert.equal(historial[0].total_formateado, '$75.00');
});

test('una cuenta normal sin platillos sigue sin poder cobrarse', () => {
  // La puerta que se abrio para las ventas libres no debe dejar pasar una
  // cuenta de mesa vacia: esa hay que cancelarla, no cobrarla en cero.
  const { db, servicio } = servicioDePrueba();
  const mesa = db.prepare('SELECT id FROM mesas LIMIT 1').get().id;

  const { comanda } = servicio.crearComanda({ client_id: uuid(), mesa_id: mesa });

  assert.throws(
    () => servicio.registrarPago({ client_id: uuid(), comanda_id: comanda.id, tipo: 'total' }),
    (err) => err.codigo === 'comanda_vacia'
  );
});
