// Preparacion del entorno de pruebas (lo carga vite.config.js).

import '@testing-library/react';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// crypto.randomUUID no existe en algunas versiones de jsdom.
if (!globalThis.crypto?.randomUUID) {
  globalThis.crypto = {
    ...globalThis.crypto,
    randomUUID: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    }),
  };
}

// Cada prueba arranca con la cola vacia: una cola que sobrevive de una prueba
// a otra hace que fallen en un orden y pasen en otro.
//
// Se vacia via cola.vaciar() y no reemplazando globalThis.indexedDB, porque
// cola.js memoiza la conexion abierta: cambiar la fabrica por debajo no le
// quita la que ya tiene y las pruebas seguirian compartiendo datos.
beforeEach(async () => {
  const cola = await import('../cola.js');
  await cola.vaciar();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});
