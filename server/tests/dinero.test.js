import test from 'node:test';
import assert from 'node:assert/strict';

import {
  centavosAPesos,
  formatoMoneda,
  pesosACentavos,
  subtotalItem,
  totalComanda,
} from '../src/dinero.js';

test('pesosACentavos convierte sin error de punto flotante', () => {
  assert.equal(pesosACentavos(18.5), 1850);
  assert.equal(pesosACentavos('22'), 2200);
  assert.equal(pesosACentavos('$1,250.75'), 125075);
  assert.equal(pesosACentavos(0), 0);
  // El caso clasico: 18.5 * 100 en punto flotante da 1849.9999999999998.
  assert.equal(pesosACentavos(1.005), 101);
});

test('pesosACentavos rechaza montos invalidos en vez de devolver NaN', () => {
  assert.throws(() => pesosACentavos('gratis'), /invalido/);
  assert.throws(() => pesosACentavos(-5), /negativo/);
  assert.throws(() => pesosACentavos(undefined), /invalido/);
});

test('formatoMoneda siempre imprime dos decimales', () => {
  assert.equal(formatoMoneda(1850), '$18.50');
  assert.equal(formatoMoneda(2200), '$22.00');
  assert.equal(formatoMoneda(5), '$0.05');
  assert.equal(formatoMoneda(0), '$0.00');
  assert.equal(formatoMoneda(125075), '$1250.75');
});

test('centavosAPesos es la vuelta de pesosACentavos', () => {
  for (const pesos of [0, 22, 18.5, 1250.75, 0.05]) {
    assert.equal(centavosAPesos(pesosACentavos(pesos)), pesos);
  }
});

test('subtotalItem multiplica precio por cantidad', () => {
  assert.equal(subtotalItem({ precio_unitario_centavos: 2200, cantidad: 3 }), 6600);
});

test('totalComanda suma exacto donde los flotantes fallarian', () => {
  // 18.90 + 25.50 + 12.30 = 56.70, que en flotante da 56.699999999999996.
  const items = [
    { precio_unitario_centavos: 1890, cantidad: 1, estado: 'recibido' },
    { precio_unitario_centavos: 2550, cantidad: 1, estado: 'listo' },
    { precio_unitario_centavos: 1230, cantidad: 1, estado: 'entregado' },
  ];
  assert.equal(totalComanda(items), 5670);
  assert.equal(formatoMoneda(totalComanda(items)), '$56.70');
});

test('totalComanda no cobra los platillos cancelados', () => {
  const items = [
    { precio_unitario_centavos: 2200, cantidad: 2, estado: 'entregado' },
    { precio_unitario_centavos: 6500, cantidad: 1, estado: 'cancelado' },
  ];
  assert.equal(totalComanda(items), 4400);
});

test('totalComanda de una comanda vacia es cero', () => {
  assert.equal(totalComanda([]), 0);
});

test('una cuenta grande de hora pico suma al centavo', () => {
  // 40 tacos de $22.50 + 15 refrescos de $30.50
  const items = [
    { precio_unitario_centavos: 2250, cantidad: 40, estado: 'entregado' },
    { precio_unitario_centavos: 3050, cantidad: 15, estado: 'entregado' },
  ];
  assert.equal(totalComanda(items), 90000 + 45750);
  assert.equal(formatoMoneda(totalComanda(items)), '$1357.50');
});
