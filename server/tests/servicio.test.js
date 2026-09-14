import test from 'node:test';
import assert from 'node:assert/strict';

import { servicioDePrueba, idPlatillo, uuid } from './ayudas.js';

function escenario() {
  const { db, servicio } = servicioDePrueba();
  return {
    db,
    servicio,
    pastor: idPlatillo(db, 'Taco de pastor'),
    refresco: idPlatillo(db, 'Refresco 600ml'),
    gringa: idPlatillo(db, 'Gringa'),
  };
}

test('flujo completo: mesa -> comanda -> pedido -> cocina -> cobro', () => {
  const { servicio, pastor, refresco } = escenario();

  const { comanda } = servicio.crearComanda({
    mesa_id: 1,
    etiqueta: 'Familia 1',
    mesera: 'Rosa',
  });
  assert.equal(comanda.estado, 'abierta');
  assert.equal(comanda.total, 0);

  // La mesa queda ocupada en cuanto se le abre una comanda.
  assert.equal(servicio.listarMesas().find((m) => m.id === 1).estado, 'ocupada');

  const { comanda: conItems } = servicio.agregarItems(comanda.id, [
    { platillo_id: pastor, cantidad: 5, notas: 'sin cebolla' },
    { platillo_id: refresco, cantidad: 2 },
  ]);
  assert.equal(conItems.total, 22 * 5 + 30 * 2);
  assert.equal(conItems.total_formateado, '$170.00');
  assert.equal(conItems.items[0].notas, 'sin cebolla');
  assert.equal(conItems.items[0].estado, 'recibido');

  // Cocina toma y termina el primer platillo.
  const itemId = conItems.items[0].id;
  servicio.cambiarEstadoItem(itemId, 'preparando');
  const { item } = servicio.cambiarEstadoItem(itemId, 'listo');
  assert.equal(item.estado, 'listo');
  servicio.cambiarEstadoItem(itemId, 'entregado');

  const { comanda: cobrada } = servicio.cerrarComanda(comanda.id, 'efectivo');
  assert.equal(cobrada.estado, 'cerrada');
  assert.equal(cobrada.metodo_pago, 'efectivo');
  assert.equal(cobrada.total, 170);
  assert.ok(cobrada.cerrado_en);

  // Sin comandas abiertas, la mesa se libera sola.
  assert.equal(servicio.listarMesas().find((m) => m.id === 1).estado, 'libre');
});

test('una mesa sostiene varias comandas con cuentas independientes', () => {
  const { servicio, pastor, gringa } = escenario();

  const a = servicio.crearComanda({ mesa_id: 3, etiqueta: 'Familia 1' }).comanda;
  const b = servicio.crearComanda({ mesa_id: 3, etiqueta: 'Familia 2' }).comanda;

  servicio.agregarItems(a.id, [{ platillo_id: pastor, cantidad: 3 }]); // 66
  servicio.agregarItems(b.id, [{ platillo_id: gringa, cantidad: 1 }]); // 65

  assert.equal(servicio.obtenerComanda(a.id).total, 66);
  assert.equal(servicio.obtenerComanda(b.id).total, 65);

  const mesa = servicio.listarMesas().find((m) => m.id === 3);
  assert.equal(mesa.comandas.length, 2);
  assert.deepEqual(
    mesa.comandas.map((c) => c.etiqueta),
    ['Familia 1', 'Familia 2']
  );

  // Cobrar una NO libera la mesa ni toca la otra cuenta.
  servicio.cerrarComanda(a.id);
  assert.equal(servicio.listarMesas().find((m) => m.id === 3).estado, 'ocupada');
  assert.equal(servicio.obtenerComanda(b.id).total, 65);
});

test('el precio se congela al pedir: subirlo despues no mueve cuentas abiertas', () => {
  const { db, servicio, pastor } = escenario();

  const { comanda } = servicio.crearComanda({ mesa_id: 1 });
  servicio.agregarItems(comanda.id, [{ platillo_id: pastor, cantidad: 4 }]);
  assert.equal(servicio.obtenerComanda(comanda.id).total, 88);

  db.prepare('UPDATE platillos SET precio_centavos = ? WHERE id = ?').run(3000, pastor);

  assert.equal(servicio.obtenerComanda(comanda.id).total, 88, 'la cuenta abierta no cambia');

  // Pero un pedido nuevo si toma el precio nuevo.
  servicio.agregarItems(comanda.id, [{ platillo_id: pastor, cantidad: 1 }]);
  assert.equal(servicio.obtenerComanda(comanda.id).total, 88 + 30);
});

test('cancelar un platillo lo descuenta del total', () => {
  const { servicio, pastor, gringa } = escenario();
  const { comanda } = servicio.crearComanda({ mesa_id: 2 });
  const { comanda: conItems } = servicio.agregarItems(comanda.id, [
    { platillo_id: pastor, cantidad: 2 }, // 44
    { platillo_id: gringa, cantidad: 1 }, // 65
  ]);
  assert.equal(conItems.total, 109);

  servicio.cambiarEstadoItem(conItems.items[1].id, 'cancelado');
  assert.equal(servicio.obtenerComanda(comanda.id).total, 44);
});

test('no se agregan platillos a una comanda ya cobrada', () => {
  const { servicio, pastor } = escenario();
  const { comanda } = servicio.crearComanda({ mesa_id: 1 });
  servicio.agregarItems(comanda.id, [{ platillo_id: pastor, cantidad: 1 }]);
  servicio.cerrarComanda(comanda.id);

  assert.throws(
    () => servicio.agregarItems(comanda.id, [{ platillo_id: pastor, cantidad: 1 }]),
    (err) => err.codigo === 'comanda_no_abierta' && err.status === 409
  );
});

test('un pedido con un platillo invalido no entra a medias', () => {
  const { servicio, pastor } = escenario();
  const { comanda } = servicio.crearComanda({ mesa_id: 1 });

  assert.throws(
    () =>
      servicio.agregarItems(comanda.id, [
        { platillo_id: pastor, cantidad: 2 },
        { platillo_id: 99999, cantidad: 1 }, // no existe
      ]),
    (err) => err.codigo === 'no_encontrado'
  );

  // La transaccion se revirtio completa: ni el taco valido quedo registrado.
  const despues = servicio.obtenerComanda(comanda.id);
  assert.equal(despues.items.length, 0);
  assert.equal(despues.total, 0);
});

test('se rechazan cantidades absurdas', () => {
  const { servicio, pastor } = escenario();
  const { comanda } = servicio.crearComanda({ mesa_id: 1 });

  for (const cantidad of [0, -3, 1.5, 'dos', null]) {
    assert.throws(
      () => servicio.agregarItems(comanda.id, [{ platillo_id: pastor, cantidad }]),
      (err) => err.codigo === 'cantidad_invalida',
      `deberia rechazar cantidad ${cantidad}`
    );
  }
});

test('no se puede pedir un platillo marcado como agotado', () => {
  const { db, servicio, pastor } = escenario();
  db.prepare('UPDATE platillos SET disponible = 0 WHERE id = ?').run(pastor);
  const { comanda } = servicio.crearComanda({ mesa_id: 1 });

  assert.throws(
    () => servicio.agregarItems(comanda.id, [{ platillo_id: pastor, cantidad: 1 }]),
    (err) => err.codigo === 'platillo_agotado'
  );
});

test('la maquina de estados no deja saltos ni regresos invalidos', () => {
  const { servicio, pastor } = escenario();
  const { comanda } = servicio.crearComanda({ mesa_id: 1 });
  const { agregados } = servicio.agregarItems(comanda.id, [
    { platillo_id: pastor, cantidad: 1 },
  ]);
  const id = agregados[0].id;

  // No se puede entregar algo que la cocina nunca preparo.
  assert.throws(
    () => servicio.cambiarEstadoItem(id, 'entregado'),
    (err) => err.codigo === 'transicion_invalida'
  );

  servicio.cambiarEstadoItem(id, 'preparando');
  servicio.cambiarEstadoItem(id, 'listo');
  servicio.cambiarEstadoItem(id, 'entregado');

  // Un platillo entregado ya no se mueve, ni se cancela.
  assert.throws(
    () => servicio.cambiarEstadoItem(id, 'cancelado'),
    (err) => err.codigo === 'transicion_invalida'
  );
  assert.throws(
    () => servicio.cambiarEstadoItem(id, 'estado_inventado'),
    (err) => err.codigo === 'estado_invalido'
  );
});

test('marcar dos veces el mismo estado no es error (doble tap en cocina)', () => {
  const { servicio, pastor } = escenario();
  const { comanda } = servicio.crearComanda({ mesa_id: 1 });
  const { agregados } = servicio.agregarItems(comanda.id, [
    { platillo_id: pastor, cantidad: 1 },
  ]);

  servicio.cambiarEstadoItem(agregados[0].id, 'preparando');
  const segundo = servicio.cambiarEstadoItem(agregados[0].id, 'preparando');
  assert.equal(segundo.sinCambio, true);
  assert.equal(segundo.item.estado, 'preparando');
});

test('no se cobra una comanda vacia', () => {
  const { servicio } = escenario();
  const { comanda } = servicio.crearComanda({ mesa_id: 1 });
  assert.throws(
    () => servicio.cerrarComanda(comanda.id),
    (err) => err.codigo === 'comanda_vacia'
  );
});

test('una cuenta sin platillos se cancela y libera la mesa', () => {
  const { servicio } = escenario();
  const { comanda } = servicio.crearComanda({ mesa_id: 1 });
  assert.equal(servicio.listarMesas().find((m) => m.id === 1).estado, 'ocupada');

  const { comanda: cancelada } = servicio.cancelarComandaVacia(comanda.id);

  assert.equal(cancelada.estado, 'cancelada');
  // Deja de estar entre las abiertas, que es lo que miran caja y meseras.
  assert.ok(!servicio.listarComandas().some((c) => c.id === comanda.id));
  assert.equal(servicio.listarMesas().find((m) => m.id === 1).estado, 'libre');
});

test('cancelar una cuenta vacia no mueve el corte del dia', () => {
  const { servicio } = escenario();
  const { comanda } = servicio.crearComanda({ mesa_id: 1 });
  servicio.cancelarComandaVacia(comanda.id);

  // Una cuenta que nunca existio no puede aparecer como venta ni como cobro.
  assert.equal(servicio.db.prepare('SELECT COUNT(*) AS n FROM pagos').get().n, 0);
  assert.equal(servicio.obtenerComanda(comanda.id).total_centavos, 0);
});

test('cancelar dos veces la misma cuenta vacia no es error', () => {
  const { servicio } = escenario();
  const { comanda } = servicio.crearComanda({ mesa_id: 1 });

  servicio.cancelarComandaVacia(comanda.id);
  // Reintento de la tablet tras perder la respuesta: tiene que ser inofensivo.
  const segunda = servicio.cancelarComandaVacia(comanda.id);

  assert.equal(segunda.yaEstabaCerrada, true);
  assert.equal(segunda.comanda.estado, 'cancelada');
});

test('no se cancela una cuenta que ya tiene platillos', () => {
  const { servicio, pastor } = escenario();
  const { comanda } = servicio.crearComanda({ mesa_id: 1 });
  servicio.agregarItems(comanda.id, [{ platillo_id: pastor, cantidad: 1 }]);

  assert.throws(
    () => servicio.cancelarComandaVacia(comanda.id),
    (err) => err.codigo === 'comanda_con_platillos'
  );
  // Sigue abierta: cancelarla habria borrado un pedido que ya salio a cocina.
  assert.equal(servicio.obtenerComanda(comanda.id).estado, 'abierta');
});

test('no se cancela una cuenta cobrada, ni siquiera si quedo sin platillos', () => {
  const { servicio, pastor } = escenario();
  const { comanda } = servicio.crearComanda({ mesa_id: 1 });
  servicio.agregarItems(comanda.id, [{ platillo_id: pastor, cantidad: 1 }]);
  servicio.cerrarComanda(comanda.id);

  assert.equal(servicio.cancelarComandaVacia(comanda.id).comanda.estado, 'cerrada');
});

test('la vista de cocina agrupa por comanda y omite lo ya entregado', () => {
  const { servicio, pastor, refresco } = escenario();

  const a = servicio.crearComanda({ mesa_id: 1, etiqueta: 'Familia 1' }).comanda;
  const b = servicio.crearComanda({ mesa_id: 4, etiqueta: 'Barra' }).comanda;
  const { agregados } = servicio.agregarItems(a.id, [
    { platillo_id: pastor, cantidad: 3 },
    { platillo_id: refresco, cantidad: 1 },
  ]);
  servicio.agregarItems(b.id, [{ platillo_id: pastor, cantidad: 2 }]);

  assert.equal(servicio.pendientesCocina().length, 2);

  // Al entregar el refresco desaparece de cocina, el resto sigue.
  servicio.cambiarEstadoItem(agregados[1].id, 'preparando');
  servicio.cambiarEstadoItem(agregados[1].id, 'listo');
  servicio.cambiarEstadoItem(agregados[1].id, 'entregado');

  const cocina = servicio.pendientesCocina();
  const grupoA = cocina.find((g) => g.comanda_id === a.id);
  assert.equal(grupoA.items.length, 1);
  assert.equal(grupoA.mesa_numero, 1);
  assert.equal(grupoA.etiqueta, 'Familia 1');
});
