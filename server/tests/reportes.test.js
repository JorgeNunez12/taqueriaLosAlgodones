// Reportes y corte de caja.
//
// Lo que se prueba aqui es que el corte CUADRE. Un reporte que se equivoca por
// unos pesos es peor que no tenerlo: el encargado cuadra la caja contra el, y si
// no coincide con el efectivo del cajon, no hay forma de saber cual de los dos
// esta mal.

import test from 'node:test';
import assert from 'node:assert/strict';

import { crearServicio } from '../src/servicio.js';
import { crearReportes, normalizarFecha, hoyLocal } from '../src/reportes.js';
import { crearAdmin } from '../src/admin.js';
import { baseDePrueba, idPlatillo, uuid } from './ayudas.js';

/** Base con servicio y reportes ya montados sobre la misma conexion. */
function conReportes() {
  const db = baseDePrueba();
  return { db, servicio: crearServicio(db), reportes: crearReportes(db), admin: crearAdmin(db) };
}

/** Abre una cuenta y le mete platillos, devolviendo la comanda. */
function cuentaCon(servicio, db, mesa, platillos, mesero_id = null) {
  const { comanda } = servicio.crearComanda({ client_id: uuid(), mesa_id: mesa, mesero_id });
  servicio.agregarItems(
    comanda.id,
    platillos.map(([nombre, cantidad]) => ({
      client_id: uuid(),
      platillo_id: idPlatillo(db, nombre),
      cantidad,
    }))
  );
  return servicio.obtenerComanda(comanda.id);
}

test('el corte cuadra: lo cobrado es exactamente la suma de los pagos', () => {
  const { db, servicio, reportes } = conReportes();

  // 2 pastor (22) + 1 refresco (30) = 74
  const a = cuentaCon(servicio, db, 1, [['Taco de pastor', 2], ['Refresco 600ml', 1]]);
  // 1 gringa (65) = 65
  const b = cuentaCon(servicio, db, 2, [['Gringa', 1]]);

  assert.equal(a.total_centavos, 7400);
  assert.equal(b.total_centavos, 6500);

  servicio.cerrarComanda(a.id, 'efectivo', uuid());
  servicio.cerrarComanda(b.id, 'tarjeta', uuid());

  const corte = reportes.corteDelDia();
  assert.equal(corte.cobrado_centavos, 13900);
  assert.equal(corte.cobrado_formateado, '$139.00');
  assert.equal(corte.cuentas.cerradas, 2);
  assert.equal(corte.cuentas.abiertas, 0);

  // La suma por metodo tiene que dar el mismo total que el global.
  const porMetodo = corte.metodos.reduce((s, m) => s + m.total_centavos, 0);
  assert.equal(porMetodo, corte.cobrado_centavos);
});

test('separa efectivo de tarjeta: es lo que se cuadra contra el cajon', () => {
  const { db, servicio, reportes } = conReportes();

  const a = cuentaCon(servicio, db, 1, [['Taco de pastor', 1]]); // 22
  const b = cuentaCon(servicio, db, 2, [['Taco de pastor', 1]]); // 22
  const c = cuentaCon(servicio, db, 3, [['Gringa', 1]]); // 65

  servicio.cerrarComanda(a.id, 'efectivo', uuid());
  servicio.cerrarComanda(b.id, 'efectivo', uuid());
  servicio.cerrarComanda(c.id, 'tarjeta', uuid());

  const corte = reportes.corteDelDia();
  const metodos = Object.fromEntries(corte.metodos.map((m) => [m.metodo, m]));

  assert.equal(metodos.efectivo.total_centavos, 4400);
  assert.equal(metodos.efectivo.cobros, 2);
  assert.equal(metodos.tarjeta.total_centavos, 6500);
  assert.equal(metodos.tarjeta.cobros, 1);
});

test('una cuenta pagada en partes cuenta como UN ticket, no como tres', () => {
  const { db, servicio, reportes } = conReportes();

  // 3 gringas = 195, que se reparte entre tres personas.
  const comanda = cuentaCon(servicio, db, 1, [['Gringa', 3]]);
  assert.equal(comanda.total_centavos, 19500);

  servicio.registrarPago({
    client_id: uuid(),
    comanda_id: comanda.id,
    tipo: 'division',
    monto_centavos: 6500,
    metodo: 'efectivo',
  });
  servicio.registrarPago({
    client_id: uuid(),
    comanda_id: comanda.id,
    tipo: 'division',
    monto_centavos: 6500,
    metodo: 'tarjeta',
  });
  servicio.registrarPago({
    client_id: uuid(),
    comanda_id: comanda.id,
    tipo: 'total',
    metodo: 'efectivo',
  });

  const corte = reportes.corteDelDia();
  assert.equal(corte.cobrado_centavos, 19500);
  assert.equal(corte.cobros, 3, 'fueron tres movimientos de dinero');
  assert.equal(corte.cuentas.cerradas, 1, 'pero una sola cuenta');
  // Ticket promedio por cuenta cerrada: 195, no 65. Dividir entre pagos haria
  // ver el ticket artificialmente chico los dias que muchos pagan por separado.
  assert.equal(corte.ticket_promedio_centavos, 19500);
});

test('lo vendido no cuenta los platillos cancelados', () => {
  const { db, servicio, reportes } = conReportes();

  const comanda = cuentaCon(servicio, db, 1, [['Taco de pastor', 4], ['Gringa', 1]]);
  const gringa = comanda.items.find((i) => i.nombre_snapshot === 'Gringa');
  servicio.cambiarEstadoItem(gringa.id, 'cancelado');

  const corte = reportes.corteDelDia();

  // Vendido = 4 pastor (88), sin la gringa cancelada.
  assert.equal(corte.vendido_centavos, 8800);
  assert.equal(corte.cancelado.unidades, 1);
  assert.equal(corte.cancelado.total_centavos, 6500);
  // La gringa cancelada no aparece entre lo vendido.
  assert.ok(!corte.platillos.some((p) => p.nombre === 'Gringa'));
});

test('el saldo pendiente explica por que vendido y cobrado no cuadran', () => {
  const { db, servicio, reportes } = conReportes();

  const cerrada = cuentaCon(servicio, db, 1, [['Taco de pastor', 1]]); // 22
  servicio.cerrarComanda(cerrada.id, 'efectivo', uuid());

  // Esta se queda abierta a medio pagar: 65 de total, 20 cobrados.
  const abierta = cuentaCon(servicio, db, 2, [['Gringa', 1]]);
  servicio.registrarPago({
    client_id: uuid(),
    comanda_id: abierta.id,
    tipo: 'division',
    monto_centavos: 2000,
    metodo: 'efectivo',
  });

  const corte = reportes.corteDelDia();

  assert.equal(corte.vendido_centavos, 8700, '22 + 65 se pidieron');
  assert.equal(corte.cobrado_centavos, 4200, '22 + 20 entraron a la caja');
  assert.equal(corte.por_cobrar.cuentas, 1);
  assert.equal(corte.por_cobrar.saldo_centavos, 4500, 'faltan 45 de la gringa');
  // La cuenta es exacta: lo vendido es lo cobrado mas lo que falta por cobrar.
  assert.equal(
    corte.cobrado_centavos + corte.por_cobrar.saldo_centavos,
    corte.vendido_centavos
  );
});

test('agrupa las ventas por platillo y por categoria', () => {
  const { db, servicio, reportes } = conReportes();

  cuentaCon(servicio, db, 1, [['Taco de pastor', 3], ['Refresco 600ml', 2]]);
  cuentaCon(servicio, db, 2, [['Taco de pastor', 2], ['Taco de suadero', 1]]);

  const corte = reportes.corteDelDia();
  const porNombre = Object.fromEntries(corte.platillos.map((p) => [p.nombre, p]));

  // Los pastores de las dos cuentas se suman en un solo renglon.
  assert.equal(porNombre['Taco de pastor'].unidades, 5);
  assert.equal(porNombre['Taco de pastor'].total_centavos, 11000);
  // Y vienen ordenados por unidades: el mas vendido primero.
  assert.equal(corte.platillos[0].nombre, 'Taco de pastor');

  const porCategoria = Object.fromEntries(corte.categorias.map((c) => [c.categoria, c]));
  assert.equal(porCategoria.tacos.unidades, 6, '5 pastor + 1 suadero');
  assert.equal(porCategoria.tacos.total_centavos, 13400, '110 + 24');
  assert.equal(porCategoria.bebidas.total_centavos, 6000);
});

test('reparte las ventas por mesero, conservando el nombre de quien atendio', () => {
  const { db, servicio, reportes } = conReportes();
  const maria = db.prepare("SELECT id FROM meseros WHERE nombre = 'Maria'").get().id;
  const lupe = db.prepare("SELECT id FROM meseros WHERE nombre = 'Lupe'").get().id;

  const a = cuentaCon(servicio, db, 1, [['Gringa', 1]], maria); // 65
  const b = cuentaCon(servicio, db, 2, [['Taco de pastor', 1]], lupe); // 22
  const c = cuentaCon(servicio, db, 3, [['Taco de pastor', 1]], maria); // 22

  [a, b, c].forEach((comanda) => servicio.cerrarComanda(comanda.id, 'efectivo', uuid()));

  const corte = reportes.corteDelDia();
  const porMesero = Object.fromEntries(corte.meseros.map((m) => [m.mesero, m]));

  assert.equal(porMesero.Maria.total_centavos, 8700);
  assert.equal(porMesero.Maria.cuentas, 2);
  assert.equal(porMesero.Lupe.total_centavos, 2200);
  assert.equal(porMesero.Lupe.cuentas, 1);
});

test('el historial trae las cuentas ya cobradas y no las abiertas', () => {
  const { db, servicio, reportes } = conReportes();

  const cobrada = cuentaCon(servicio, db, 1, [['Gringa', 1]]);
  servicio.cerrarComanda(cobrada.id, 'tarjeta', uuid());
  cuentaCon(servicio, db, 2, [['Taco de pastor', 1]]); // se queda abierta

  const historial = reportes.historial();
  assert.equal(historial.length, 1);
  assert.equal(historial[0].id, cobrada.id);
  assert.equal(historial[0].metodo_pago, 'tarjeta');
  assert.equal(historial[0].total_formateado, '$65.00');
  assert.equal(historial[0].mesa_numero, 1);
});

test('un dia sin ventas devuelve ceros, no explota', () => {
  const { reportes } = conReportes();
  const corte = reportes.corteDelDia('2020-01-01');

  assert.equal(corte.cobrado_centavos, 0);
  assert.equal(corte.cobrado_formateado, '$0.00');
  assert.equal(corte.ticket_promedio_centavos, 0, 'no se divide entre cero');
  assert.equal(corte.cuentas.cerradas, 0);
  assert.deepEqual(corte.metodos, []);
  assert.deepEqual(corte.platillos, []);
  assert.deepEqual(reportes.historial('2020-01-01'), []);
});

test('el corte de un dia pasado no incluye las ventas de hoy', () => {
  const { db, servicio, reportes } = conReportes();
  const comanda = cuentaCon(servicio, db, 1, [['Gringa', 1]]);
  servicio.cerrarComanda(comanda.id, 'efectivo', uuid());

  assert.equal(reportes.corteDelDia().cobrado_centavos, 6500);
  assert.equal(reportes.corteDelDia('2020-01-01').cobrado_centavos, 0);
});

test('normalizarFecha se defiende de basura en la query', () => {
  assert.equal(normalizarFecha('2026-03-15'), '2026-03-15');
  // Cualquier cosa que no sea una fecha valida cae en hoy, en vez de romper la
  // consulta o dejar pasar texto crudo hacia SQL.
  assert.equal(normalizarFecha(undefined), hoyLocal());
  assert.equal(normalizarFecha(''), hoyLocal());
  assert.equal(normalizarFecha('ayer'), hoyLocal());
  assert.equal(normalizarFecha("2026-01-01'; DROP TABLE pagos;--"), hoyLocal());
  assert.equal(normalizarFecha(['2026-01-01']), hoyLocal());
});

test('los dias con ventas se listan del mas reciente al mas viejo', () => {
  const { db, servicio, reportes } = conReportes();
  const comanda = cuentaCon(servicio, db, 1, [['Gringa', 1]]);
  servicio.cerrarComanda(comanda.id, 'efectivo', uuid());

  const dias = reportes.diasConVentas();
  assert.equal(dias.length, 1);
  assert.equal(dias[0].dia, hoyLocal());
  assert.equal(dias[0].total_centavos, 6500);
});
