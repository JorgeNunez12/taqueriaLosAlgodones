// Los client_id son lo que evita cobrar o pedir dos veces tras una caida de
// red. Si esto falla, falla todo el sistema anti-duplicados.
//
// El caso que motivo estas pruebas: `crypto.randomUUID` NO existe cuando la
// pagina se sirve por http simple, que es justo como entran las tablets
// (http://192.168.1.x). En la maquina del local no se notaba porque ahi se
// abre por localhost, donde si existe.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { nuevoId } from '../identificador.js';

const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('nuevoId', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('genera un UUID v4 valido', () => {
    expect(nuevoId()).toMatch(FORMA_UUID);
  });

  it('no repite ids', () => {
    const ids = new Set(Array.from({ length: 2000 }, nuevoId));
    expect(ids.size).toBe(2000);
  });

  it('funciona sin crypto.randomUUID (tablet por http simple)', () => {
    // Exactamente lo que pasa en el iPad: getRandomValues si, randomUUID no.
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });

    const id = nuevoId();
    expect(id).toMatch(FORMA_UUID);

    const ids = new Set(Array.from({ length: 500 }, nuevoId));
    expect(ids.size).toBe(500);
  });

  it('funciona sin crypto del todo, como ultimo recurso', () => {
    vi.stubGlobal('crypto', undefined);

    const id = nuevoId();
    expect(id).toMatch(FORMA_UUID);

    const ids = new Set(Array.from({ length: 500 }, nuevoId));
    expect(ids.size).toBe(500);
  });

  it('nunca truena, sea cual sea el navegador', () => {
    // Lo que de verdad se prueba: que abrir una cuenta no se quede colgado en
    // "Abriendo…" porque el navegador no traia la funcion esperada.
    for (const falso of [undefined, {}, { randomUUID: undefined }]) {
      vi.stubGlobal('crypto', falso);
      expect(() => nuevoId()).not.toThrow();
      expect(nuevoId()).toMatch(FORMA_UUID);
    }
  });
});
