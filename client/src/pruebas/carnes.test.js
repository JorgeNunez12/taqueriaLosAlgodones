// Que platillos preguntan la carne.
//
// El riesgo que cubren estas pruebas es de los dos lados: que una planchada se
// cuele sin preguntar (cocina se queda sin saber que poner, que es justo lo que
// se vino a arreglar) y que un taco pregunte de mas (seis toques extra por
// pedido en la hora pico).

import { describe, expect, it } from 'vitest';
import { CARNES, notaConCarne, pideCarne } from '../carnes.js';

describe('pideCarne', () => {
  it('pregunta en planchada y pellizcada', () => {
    expect(pideCarne('Planchada')).toBe(true);
    expect(pideCarne('Pellizcada')).toBe(true);
  });

  it('no pregunta en lo demas del menu', () => {
    for (const nombre of [
      'Taco de panza',
      'Taco de tripa',
      'Coca Cola 600 ml',
      'Agua fresca 1 litro',
      'Topo Chico',
    ]) {
      expect(pideCarne(nombre), nombre).toBe(false);
    }
  });

  it('aguanta como este escrito el nombre', () => {
    // El encargado puede recrear el platillo desde su tablet y escribirlo de
    // otra forma; la pregunta tiene que seguir saliendo.
    for (const nombre of ['PLANCHADA', 'planchada', 'Planchada de la casa', 'Pellízcada']) {
      expect(pideCarne(nombre), nombre).toBe(true);
    }
  });

  it('no truena con un nombre vacio o ausente', () => {
    expect(pideCarne('')).toBe(false);
    expect(pideCarne(null)).toBe(false);
    expect(pideCarne(undefined)).toBe(false);
  });
});

describe('notaConCarne', () => {
  it('pone la carne sola cuando no habia nota', () => {
    expect(notaConCarne('Buche', '')).toBe('Buche');
    expect(notaConCarne('Buche', null)).toBe('Buche');
  });

  it('conserva lo que el cliente ya habia pedido', () => {
    expect(notaConCarne('Buche', 'sin cebolla')).toBe('Buche, sin cebolla');
  });

  it('sin carne devuelve solo la nota', () => {
    expect(notaConCarne('', 'sin cebolla')).toBe('sin cebolla');
  });
});

describe('CARNES', () => {
  it('son las seis del menu de tacos, sin repetidos', () => {
    expect(CARNES).toHaveLength(6);
    expect(new Set(CARNES).size).toBe(6);
  });
});
