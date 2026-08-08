// Cobro repartido: la misma cuenta pagada por varias personas.
//
// El caso real: una familia comparte mesa, pide todo junto, y a la hora de
// pagar cada quien saca su dinero. Antes habia que abrir cuentas separadas
// desde el principio, y eso solo se sabe al final.
//
// Lo que se prueba aqui es que el dinero cuadre al centavo en todos los
// caminos: por platillos, dividido en partes iguales, y mezclando los dos.

import test from 'node:test';
import assert from 'node:assert/strict';

import { servicioDePrueba, idPlatillo, uuid } from './ayudas.js';

function cuentaDePrueba() {
  const { db, servicio } = servicioDePrueba();
  const pastor = idPlatillo(db, 'Taco de pastor'); // $22
  const refresco = idPlatillo(db, 'Refresco 600ml'); // $30
  const gringa = idPlatillo(db, 'Gringa'); // $65

  const { comanda } = servicio.crearComanda({ mesa_id: 1, etiqueta: 'Familia' });
  const { comanda: conItems } = servicio.agregarItems(comanda.id, [
    { platillo_id: pastor, cantidad: 3 }, // $66
    { platillo_id: refresco, cantidad: 2 }, // $60
    { platillo_id: gringa, cantidad: 1 }, // $65
  ]);

  return { db, servicio, comanda: conItems, pastor, refresco, gringa };
}

test('una cuenta se paga por partes y solo se cierra cuando el saldo llega a cero', () => {
  const { servicio, comanda } = cuentaDePrueba();
  assert.equal(comanda.total_centavos, 19100); // $191
  assert.equal(comanda.saldo_centavos, 19100);

  const [tacos, refrescos, gringa] = comanda.items;

  // Primero paga quien se comio los tacos.
  const uno = servicio.registrarPago({
    comanda_id: comanda.id,
    tipo: 'items',
    item_ids: [tacos.id],
    metodo: 'efectivo',
  });
  assert.equal(uno.pago.monto_centavos, 6600);
  assert.equal(uno.comanda.saldo_centavos, 12500);
  assert.equal(uno.cerrada, false, 'todavia falta dinero; la cuenta sigue abierta');
  assert.equal(uno.comanda.estado, 'abierta');
  assert.equal(uno.comanda.items.find((i) => i.id === tacos.id).pagado, true);
  assert.equal(uno.comanda.items.find((i) => i.id === gringa.id).pagado, false);

  // La mesa sigue ocupada mientras quede saldo.
  assert.equal(servicio.listarMesas().find((m) => m.id === 1).estado, 'ocupada');

  // Luego el de la gringa, con tarjeta.
  const dos = servicio.registrarPago({
    comanda_id: comanda.id,
    tipo: 'items',
    item_ids: [gringa.id],
    metodo: 'tarjeta',
  });
  assert.equal(dos.comanda.saldo_centavos, 6000);
  assert.equal(dos.cerrada, false);

  // El ultimo liquida lo que queda.
  const tres = servicio.registrarPago({
    comanda_id: comanda.id,
    tipo: 'items',
    item_ids: [refrescos.id],
    metodo: 'efectivo',
  });
  assert.equal(tres.comanda.saldo_centavos, 0);
  assert.equal(tres.cerrada, true, 'sin saldo, la cuenta se cierra sola');
  assert.equal(tres.comanda.estado, 'cerrada');

  // Y la mesa se libera.
  assert.equal(servicio.listarMesas().find((m) => m.id === 1).estado, 'libre');

  // Los tres pagos suman exactamente el total: la caja cuadra.
  const suma = tres.comanda.pagos.reduce((t, p) => t + p.monto_centavos, 0);
  assert.equal(suma, 19100);
  assert.equal(tres.comanda.pagos.length, 3);
});

test('dividir en partes iguales reparte hasta el ultimo centavo', () => {
  const { servicio, comanda } = cuentaDePrueba();
  // $191 entre 3 no da exacto: 6366.66... El sobrante tiene que quedar en
  // algun pago, no evaporarse.
  const entre = 3;
  const base = Math.floor(comanda.total_centavos / entre); // 6366
  const sobrante = comanda.total_centavos - base * entre; // 2

  const primero = servicio.registrarPago({
    comanda_id: comanda.id,
    tipo: 'division',
    monto_centavos: base + sobrante,
  });
  assert.equal(primero.pago.monto_centavos, 6368);
  assert.equal(primero.comanda.saldo_centavos, 12732);

  servicio.registrarPago({ comanda_id: comanda.id, tipo: 'division', monto_centavos: base });
  const ultimo = servicio.registrarPago({
    comanda_id: comanda.id,
    tipo: 'division',
    monto_centavos: base,
  });

  assert.equal(ultimo.comanda.saldo_centavos, 0);
  assert.equal(ultimo.cerrada, true);
  const suma = ultimo.comanda.pagos.reduce((t, p) => t + p.monto_centavos, 0);
  assert.equal(suma, 19100, 'no se perdio ni se invento un centavo');
});

test('se puede mezclar: unos pagan sus platillos y el resto se divide', () => {
  const { servicio, comanda } = cuentaDePrueba();
  const gringa = comanda.items[2];

  // El de la gringa paga lo suyo aparte.
  const uno = servicio.registrarPago({
    comanda_id: comanda.id,
    tipo: 'items',
    item_ids: [gringa.id],
  });
  assert.equal(uno.comanda.saldo_centavos, 12600); // $126

  // Los otros dos se reparten lo que queda.
  servicio.registrarPago({ comanda_id: comanda.id, tipo: 'division', monto_centavos: 6300 });
  const fin = servicio.registrarPago({
    comanda_id: comanda.id,
    tipo: 'division',
    monto_centavos: 6300,
  });

  assert.equal(fin.cerrada, true);
  assert.equal(fin.comanda.saldo_centavos, 0);
});

test('no se puede cobrar dos veces el mismo platillo', () => {
  const { servicio, comanda } = cuentaDePrueba();
  const tacos = comanda.items[0];

  servicio.registrarPago({ comanda_id: comanda.id, tipo: 'items', item_ids: [tacos.id] });

  assert.throws(
    () => servicio.registrarPago({ comanda_id: comanda.id, tipo: 'items', item_ids: [tacos.id] }),
    (err) => err.codigo === 'item_ya_pagado'
  );
});

test('un pago no puede pasarse del saldo', () => {
  const { servicio, comanda } = cuentaDePrueba();

  assert.throws(
    () =>
      servicio.registrarPago({
        comanda_id: comanda.id,
        tipo: 'division',
        monto_centavos: 19101,
      }),
    (err) => err.codigo === 'monto_excede_saldo'
  );

  // Y tampoco despues de un pago parcial.
  servicio.registrarPago({ comanda_id: comanda.id, tipo: 'division', monto_centavos: 19000 });
  assert.throws(
    () =>
      servicio.registrarPago({ comanda_id: comanda.id, tipo: 'division', monto_centavos: 200 }),
    (err) => err.codigo === 'monto_excede_saldo'
  );
});

test('reintentar un pago con el mismo client_id no cobra dos veces', () => {
  const { servicio, comanda } = cuentaDePrueba();
  const clientId = uuid();
  const tacos = comanda.items[0];

  const primero = servicio.registrarPago({
    client_id: clientId,
    comanda_id: comanda.id,
    tipo: 'items',
    item_ids: [tacos.id],
  });
  // La caja perdio la respuesta y la tablet reenvia el mismo pago.
  const reintento = servicio.registrarPago({
    client_id: clientId,
    comanda_id: comanda.id,
    tipo: 'items',
    item_ids: [tacos.id],
  });

  assert.equal(reintento.duplicado, true);
  assert.equal(reintento.pago.id, primero.pago.id);
  assert.equal(reintento.comanda.pagos.length, 1, 'solo entro un pago');
  assert.equal(reintento.comanda.saldo_centavos, 12500);
});

test('no se puede cancelar un platillo que alguien ya pago', () => {
  const { servicio, comanda } = cuentaDePrueba();
  const tacos = comanda.items[0];

  servicio.registrarPago({ comanda_id: comanda.id, tipo: 'items', item_ids: [tacos.id] });

  // Dejarlo pasar bajaria el total por debajo de lo cobrado: saldo negativo.
  assert.throws(
    () => servicio.cambiarEstadoItem(tacos.id, 'cancelado'),
    (err) => err.codigo === 'item_ya_pagado'
  );
});

test('un platillo cancelado no se puede cobrar', () => {
  const { servicio, comanda } = cuentaDePrueba();
  const refrescos = comanda.items[1];

  servicio.cambiarEstadoItem(refrescos.id, 'cancelado');

  assert.throws(
    () =>
      servicio.registrarPago({ comanda_id: comanda.id, tipo: 'items', item_ids: [refrescos.id] }),
    (err) => err.codigo === 'item_cancelado'
  );
});

test('cobrar todo de un jalon sigue funcionando y deja el pago registrado', () => {
  const { servicio, comanda } = cuentaDePrueba();

  const { comanda: cerrada } = servicio.cerrarComanda(comanda.id, 'tarjeta');
  assert.equal(cerrada.estado, 'cerrada');
  assert.equal(cerrada.saldo_centavos, 0);
  assert.equal(cerrada.pagos.length, 1);
  assert.equal(cerrada.pagos[0].monto_centavos, 19100);
  assert.equal(cerrada.pagos[0].tipo, 'total');
  assert.equal(cerrada.pagos[0].metodo, 'tarjeta');
});

test('despues de pagos parciales, "cobrar el resto" liquida solo lo que falta', () => {
  const { servicio, comanda } = cuentaDePrueba();
  const tacos = comanda.items[0];

  servicio.registrarPago({ comanda_id: comanda.id, tipo: 'items', item_ids: [tacos.id] });
  // La caja aprieta "cobrar" normal: debe cobrar $125, no $191.
  const { comanda: cerrada } = servicio.cerrarComanda(comanda.id, 'efectivo');

  assert.equal(cerrada.estado, 'cerrada');
  assert.equal(cerrada.saldo_centavos, 0);
  const suma = cerrada.pagos.reduce((t, p) => t + p.monto_centavos, 0);
  assert.equal(suma, 19100);
  assert.equal(cerrada.pagos[1].monto_centavos, 12500);
});

test('no se le puede cobrar a una cuenta ya cerrada', () => {
  const { servicio, comanda } = cuentaDePrueba();
  servicio.cerrarComanda(comanda.id, 'efectivo');

  assert.throws(
    () => servicio.registrarPago({ comanda_id: comanda.id, tipo: 'division', monto_centavos: 100 }),
    (err) => err.codigo === 'comanda_no_abierta'
  );
});

test('agregar platillos despues de un pago parcial sube el saldo, no lo revuelve', () => {
  const { servicio, comanda, pastor } = cuentaDePrueba();
  const tacos = comanda.items[0];

  servicio.registrarPago({ comanda_id: comanda.id, tipo: 'items', item_ids: [tacos.id] });
  // Piden otra ronda cuando uno ya pago lo suyo.
  const { comanda: conMas } = servicio.agregarItems(comanda.id, [
    { platillo_id: pastor, cantidad: 2 },
  ]);

  assert.equal(conMas.total_centavos, 19100 + 4400);
  assert.equal(conMas.saldo_centavos, 12500 + 4400);
  assert.equal(conMas.pagado_centavos, 6600);
});

test('los meseros se listan para iniciar sesion y la cuenta guarda quien la abrio', () => {
  const { db, servicio } = servicioDePrueba();
  const meseros = servicio.listarMeseros();
  assert.ok(meseros.length >= 2);

  const maria = meseros.find((m) => m.nombre === 'Maria');
  const { comanda } = servicio.crearComanda({ mesa_id: 1, mesero_id: maria.id });

  // El nombre lo pone el servidor a partir de la sesion, no la tablet.
  assert.equal(comanda.mesera, 'Maria');
  assert.equal(comanda.mesero_id, maria.id);
});

test('no se puede abrir una cuenta a nombre de un mesero que no existe', () => {
  const { servicio } = servicioDePrueba();
  assert.throws(
    () => servicio.crearComanda({ mesa_id: 1, mesero_id: 9999 }),
    (err) => err.codigo === 'no_encontrado'
  );
});
