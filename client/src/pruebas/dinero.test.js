// El dinero se pinta desde centavos enteros. Si esto se rompe, la cuenta que
// ve el cliente no coincide con la que cobra la caja.

import { describe, expect, it } from 'vitest';
import { formatoMoneda, repartirEnPartes, subtotalItem, totalCarrito } from '../dinero.js';

describe('formatoMoneda', () => {
  it('pone siempre dos decimales', () => {
    expect(formatoMoneda(2200)).toBe('$22.00');
    expect(formatoMoneda(2250)).toBe('$22.50');
    expect(formatoMoneda(2205)).toBe('$22.05');
  });

  it('maneja cero y montos chicos', () => {
    expect(formatoMoneda(0)).toBe('$0.00');
    expect(formatoMoneda(5)).toBe('$0.05');
  });

  it('no se rompe con valores faltantes', () => {
    expect(formatoMoneda(undefined)).toBe('$0.00');
    expect(formatoMoneda(null)).toBe('$0.00');
  });
});

describe('totales del carrito', () => {
  it('multiplica cantidad por precio unitario', () => {
    expect(subtotalItem({ precio_unitario_centavos: 2200, cantidad: 3 })).toBe(6600);
  });

  it('acepta platillos del menu, que traen precio_centavos', () => {
    expect(subtotalItem({ precio_centavos: 6500, cantidad: 2 })).toBe(13000);
  });

  it('suma sin arrastrar error de punto flotante', () => {
    // El caso clasico: 0.1 + 0.2 en pesos da 0.30000000000000004. En centavos
    // enteros son 10 + 20 = 30, exacto.
    const carrito = [
      { precio_unitario_centavos: 10, cantidad: 1 },
      { precio_unitario_centavos: 20, cantidad: 1 },
    ];
    expect(totalCarrito(carrito)).toBe(30);
    expect(formatoMoneda(totalCarrito(carrito))).toBe('$0.30');
  });

  it('cuadra una cuenta realista al centavo', () => {
    const carrito = [
      { precio_unitario_centavos: 2200, cantidad: 5 }, // 5 pastor  = 110.00
      { precio_unitario_centavos: 3500, cantidad: 2 }, // 2 aguas   =  70.00
      { precio_unitario_centavos: 6500, cantidad: 1 }, // 1 gringa  =  65.00
    ];
    expect(formatoMoneda(totalCarrito(carrito))).toBe('$245.00');
  });

  it('un carrito vacio vale cero', () => {
    expect(totalCarrito([])).toBe(0);
  });
});

describe('repartir una cuenta en partes iguales', () => {
  it('reparte parejo cuando la division es exacta', () => {
    expect(repartirEnPartes(6000, 3)).toEqual([2000, 2000, 2000]);
  });

  it('le carga el sobrante a la primera parte', () => {
    // $191 entre 3: 63.66 no cabe tres veces exactas, sobran 2 centavos.
    expect(repartirEnPartes(19100, 3)).toEqual([6368, 6366, 6366]);
  });

  it('la suma de las partes siempre da el saldo exacto', () => {
    // Esto es lo unico que no se puede romper: si la suma no da el saldo, la
    // caja termina el dia con una diferencia que nadie puede explicar.
    for (const saldo of [1, 7, 99, 2200, 19100, 33333, 100001]) {
      for (const partes of [2, 3, 4, 5, 6]) {
        const suma = repartirEnPartes(saldo, partes).reduce((t, n) => t + n, 0);
        expect(suma).toBe(saldo);
      }
    }
  });

  it('devuelve enteros, nunca fracciones de centavo', () => {
    for (const monto of repartirEnPartes(10000, 3)) {
      expect(Number.isInteger(monto)).toBe(true);
    }
  });

  it('entre uno es la cuenta completa', () => {
    expect(repartirEnPartes(19100, 1)).toEqual([19100]);
  });
});
