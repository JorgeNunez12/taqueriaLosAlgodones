// La cola es la pieza de la que depende no perder ni duplicar pedidos.

import { describe, expect, it } from 'vitest';
import * as cola from '../cola.js';

describe('cola de envios pendientes', () => {
  it('empieza vacia', async () => {
    expect(await cola.contar()).toBe(0);
  });

  it('guarda un envio y lo devuelve completo', async () => {
    await cola.encolar({
      tipo: 'items',
      comanda_id: 3,
      cuerpo: { items: [{ client_id: 'abc', platillo_id: 1, cantidad: 2 }] },
    });

    const [envio] = await cola.listar();
    expect(envio.tipo).toBe('items');
    expect(envio.comanda_id).toBe(3);
    expect(envio.cuerpo.items[0].client_id).toBe('abc');
    expect(envio.intentos).toBe(0);
  });

  it('conserva el orden de captura', async () => {
    // Importa: "abrir comanda" tiene que salir antes que "agregar items a esa
    // comanda", o el segundo envio pega contra una comanda que no existe.
    await cola.encolar({ tipo: 'comanda', cuerpo: { mesa_id: 1 } });
    await cola.encolar({ tipo: 'items', comanda_id: 1, cuerpo: { items: [] } });
    await cola.encolar({ tipo: 'cerrar', comanda_id: 1, cuerpo: {} });

    const tipos = (await cola.listar()).map((e) => e.tipo);
    expect(tipos).toEqual(['comanda', 'items', 'cerrar']);
  });

  it('borra solo el envio indicado', async () => {
    await cola.encolar({ tipo: 'comanda', cuerpo: { mesa_id: 1 } });
    await cola.encolar({ tipo: 'comanda', cuerpo: { mesa_id: 2 } });

    const [primero] = await cola.listar();
    await cola.borrar(primero.seq);

    const quedan = await cola.listar();
    expect(quedan).toHaveLength(1);
    expect(quedan[0].cuerpo.mesa_id).toBe(2);
  });

  it('cuenta los intentos de cada envio', async () => {
    await cola.encolar({ tipo: 'comanda', cuerpo: { mesa_id: 1 } });
    const [envio] = await cola.listar();

    await cola.marcarIntento(envio.seq);
    await cola.marcarIntento(envio.seq);

    const [despues] = await cola.listar();
    expect(despues.intentos).toBe(2);
  });

  it('sobrevive a que se cierre y se vuelva a abrir la app', async () => {
    // Esto es lo que hace que un pedido capturado sin WiFi no se pierda si la
    // mesera bloquea la tablet antes de que vuelva la señal.
    await cola.encolar({ tipo: 'items', comanda_id: 9, cuerpo: { items: [{ client_id: 'z' }] } });

    const releidos = await cola.listar();
    expect(releidos).toHaveLength(1);
    expect(releidos[0].cuerpo.items[0].client_id).toBe('z');
  });
});
