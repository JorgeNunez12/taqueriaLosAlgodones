// Administracion del menu y del personal.
//
// El nucleo de estas pruebas es una sola regla: NADA que tenga historial se
// borra. Un platillo que ya salio en cuentas viejas, o un mesero que ya levanto
// cuentas, no pueden desaparecer sin dejar ventas apuntando al vacio y romper
// los reportes hacia atras.

import test from 'node:test';
import assert from 'node:assert/strict';

import { crearServicio } from '../src/servicio.js';
import { crearAdmin } from '../src/admin.js';
import { baseDePrueba, idPlatillo, uuid } from './ayudas.js';

function conAdmin() {
  const db = baseDePrueba();
  return { db, servicio: crearServicio(db), admin: crearAdmin(db) };
}

// --- Menu ---

test('un platillo nuevo entra con el precio en centavos enteros', () => {
  const { admin } = conAdmin();

  // Se acepta en pesos (lo que teclea el encargado) y se guarda en centavos.
  const p = admin.crearPlatillo({ nombre: 'Quesadilla', precio: '38.50', categoria: 'especiales' });
  assert.equal(p.precio_centavos, 3850);
  assert.equal(p.precio, 38.5);
  assert.equal(p.disponible, 1, 'un platillo nuevo se puede pedir de inmediato');

  // Y tambien en centavos exactos, que es como lo manda otro sistema.
  const q = admin.crearPlatillo({ nombre: 'Agua', precio_centavos: 2500, categoria: 'bebidas' });
  assert.equal(q.precio_centavos, 2500);
});

test('rechaza precios y nombres invalidos en vez de guardar basura', () => {
  const { admin } = conAdmin();
  const invalido = (datos) => {
    assert.throws(() => admin.crearPlatillo(datos), (err) => err.status === 400);
  };

  invalido({ nombre: 'X', precio: '-5', categoria: 'tacos' });
  invalido({ nombre: 'X', precio: 'gratis', categoria: 'tacos' });
  invalido({ nombre: '   ', precio: '10', categoria: 'tacos' });
  invalido({ nombre: 'X', categoria: 'tacos' });
  invalido({ nombre: 'X', precio: '10' });
  invalido({ nombre: 'X', precio_centavos: 10.5, categoria: 'tacos' });
});

test('marcar "se acabo" saca el platillo de la venta de inmediato', () => {
  const { db, servicio, admin } = conAdmin();
  const { comanda } = servicio.crearComanda({ client_id: uuid(), mesa_id: 1 });
  const pastor = idPlatillo(db, 'Taco de pastor');

  admin.marcarDisponible(pastor, false);

  // El menu que ve la mesera ya no lo trae...
  const menu = servicio.listarPlatillos({ soloDisponibles: true });
  assert.ok(!menu.some((p) => p.id === pastor));

  // ...y si alguien alcanza a mandarlo, el servidor lo rechaza.
  assert.throws(
    () => servicio.agregarItems(comanda.id, [{ client_id: uuid(), platillo_id: pastor, cantidad: 1 }]),
    (err) => err.codigo === 'platillo_agotado'
  );

  // Al volver a haber, se vende otra vez sin tener que recrearlo.
  admin.marcarDisponible(pastor, true);
  const { agregados } = servicio.agregarItems(comanda.id, [
    { client_id: uuid(), platillo_id: pastor, cantidad: 1 },
  ]);
  assert.equal(agregados.length, 1);
});

test('subir el precio no mueve las cuentas que ya estan abiertas', () => {
  const { db, servicio, admin } = conAdmin();
  const pastor = idPlatillo(db, 'Taco de pastor');

  const { comanda } = servicio.crearComanda({ client_id: uuid(), mesa_id: 1 });
  servicio.agregarItems(comanda.id, [{ client_id: uuid(), platillo_id: pastor, cantidad: 3 }]);
  const antes = servicio.obtenerComanda(comanda.id).total_centavos;
  assert.equal(antes, 6600);

  admin.actualizarPlatillo(pastor, { precio: '40.00' });

  // La mesa que ya estaba sentada paga lo que le cantaron, no el precio nuevo.
  assert.equal(servicio.obtenerComanda(comanda.id).total_centavos, 6600);

  // Pero la siguiente cuenta ya usa el precio nuevo.
  const { comanda: otra } = servicio.crearComanda({ client_id: uuid(), mesa_id: 2 });
  servicio.agregarItems(otra.id, [{ client_id: uuid(), platillo_id: pastor, cantidad: 1 }]);
  assert.equal(servicio.obtenerComanda(otra.id).total_centavos, 4000);
});

test('editar deja intactos los campos que no se mandaron', () => {
  const { db, admin } = conAdmin();
  const pastor = idPlatillo(db, 'Taco de pastor');
  const previo = admin.listarPlatillos().find((p) => p.id === pastor);

  // La UI de "agotado" manda solo `disponible`; no tiene por que reenviar todo.
  const despues = admin.actualizarPlatillo(pastor, { disponible: false });
  assert.equal(despues.disponible, 0);
  assert.equal(despues.nombre, previo.nombre);
  assert.equal(despues.precio_centavos, previo.precio_centavos);
  assert.equal(despues.categoria, previo.categoria);
});

test('un platillo que ya se pidio NO se puede borrar', () => {
  const { db, servicio, admin } = conAdmin();
  const pastor = idPlatillo(db, 'Taco de pastor');

  const { comanda } = servicio.crearComanda({ client_id: uuid(), mesa_id: 1 });
  servicio.agregarItems(comanda.id, [{ client_id: uuid(), platillo_id: pastor, cantidad: 1 }]);

  // Borrarlo dejaria el item del historial apuntando a un platillo inexistente
  // y los reportes por platillo se romperian hacia atras.
  assert.throws(
    () => admin.eliminarPlatillo(pastor),
    (err) => err.codigo === 'platillo_con_historial' && err.status === 409
  );
  assert.ok(admin.listarPlatillos().some((p) => p.id === pastor), 'sigue ahi');
});

test('un platillo que nunca se pidio si se borra (fue un alta mal escrita)', () => {
  const { admin } = conAdmin();
  const nuevo = admin.crearPlatillo({ nombre: 'Tacoo', precio: '10', categoria: 'tacos' });

  assert.deepEqual(admin.eliminarPlatillo(nuevo.id), { eliminado: true, id: nuevo.id });
  assert.ok(!admin.listarPlatillos().some((p) => p.id === nuevo.id));
});

test('el admin ve los agotados; la mesera no', () => {
  const { db, servicio, admin } = conAdmin();
  admin.marcarDisponible(idPlatillo(db, 'Gringa'), false);

  // El encargado tiene que verlo para poder reactivarlo.
  assert.ok(admin.listarPlatillos().some((p) => p.nombre === 'Gringa'));
  // La mesera no, porque no lo puede vender.
  const menu = servicio.listarPlatillos({ soloDisponibles: true });
  assert.ok(!menu.some((p) => p.nombre === 'Gringa'));
});

// --- Personal ---

test('dar de alta a alguien lo deja listo para iniciar sesion', () => {
  const { servicio, admin } = conAdmin();
  const nuevo = admin.crearMesero({ nombre: 'Chuy' });

  assert.equal(nuevo.activo, 1);
  assert.ok(servicio.listarMeseros().some((m) => m.id === nuevo.id));
});

test('un mesero que ya atendio se desactiva, no se borra', () => {
  const { db, servicio, admin } = conAdmin();
  const maria = db.prepare("SELECT id FROM meseros WHERE nombre = 'Maria'").get().id;

  const { comanda } = servicio.crearComanda({ client_id: uuid(), mesa_id: 1, mesero_id: maria });
  assert.equal(servicio.obtenerComanda(comanda.id).mesera, 'Maria');

  const resultado = admin.eliminarMesero(maria);
  assert.equal(resultado.desactivado, true);
  assert.equal(resultado.mesero.activo, 0);

  // Ya no aparece para iniciar sesion...
  assert.ok(!servicio.listarMeseros().some((m) => m.id === maria));
  // ...pero su cuenta del historial sigue diciendo que la atendio ella.
  assert.equal(servicio.obtenerComanda(comanda.id).mesera, 'Maria');
});

test('recontratar a alguien reactiva su registro en vez de duplicarlo', () => {
  const { db, servicio, admin } = conAdmin();
  const maria = db.prepare("SELECT id FROM meseros WHERE nombre = 'Maria'").get().id;

  servicio.crearComanda({ client_id: uuid(), mesa_id: 1, mesero_id: maria });
  admin.eliminarMesero(maria);

  const devuelta = admin.crearMesero({ nombre: 'Maria' });
  assert.equal(devuelta.id, maria, 'es el mismo registro, con su historial');
  assert.equal(devuelta.activo, 1);
  assert.equal(admin.listarMeseros().filter((m) => m.nombre === 'Maria').length, 1);
});

test('no se permiten dos meseros activos con el mismo nombre', () => {
  const { admin } = conAdmin();
  assert.throws(
    () => admin.crearMesero({ nombre: 'Maria' }),
    (err) => err.codigo === 'mesero_duplicado' && err.status === 409
  );
  // Y tampoco renombrando a uno para que choque con otro.
  const chuy = admin.crearMesero({ nombre: 'Chuy' });
  assert.throws(
    () => admin.actualizarMesero(chuy.id, { nombre: 'Maria' }),
    (err) => err.codigo === 'mesero_duplicado'
  );
});

test('renombrar a un mesero no le quita las cuentas que ya levanto', () => {
  const { db, servicio, admin } = conAdmin();
  const maria = db.prepare("SELECT id FROM meseros WHERE nombre = 'Maria'").get().id;
  const { comanda } = servicio.crearComanda({ client_id: uuid(), mesa_id: 1, mesero_id: maria });

  admin.actualizarMesero(maria, { nombre: 'Maria Elena' });

  // El nombre de la comanda es el que se congelo al abrirla.
  assert.equal(servicio.obtenerComanda(comanda.id).mesera, 'Maria');
  // Y la cuenta nueva ya sale con el nombre corregido.
  const { comanda: otra } = servicio.crearComanda({ client_id: uuid(), mesa_id: 2, mesero_id: maria });
  assert.equal(servicio.obtenerComanda(otra.id).mesera, 'Maria Elena');
});

test('un alta mal escrita que nunca atendio si se borra', () => {
  const { admin } = conAdmin();
  const error = admin.crearMesero({ nombre: 'Chy' });
  assert.deepEqual(admin.eliminarMesero(error.id), { eliminado: true, id: error.id });
  assert.ok(!admin.listarMeseros().some((m) => m.id === error.id));
});

test('operar sobre algo que no existe da 404, no un crash', () => {
  const { admin } = conAdmin();
  const noExiste = (fn) => assert.throws(fn, (err) => err.status === 404);

  noExiste(() => admin.actualizarPlatillo(9999, { nombre: 'X' }));
  noExiste(() => admin.marcarDisponible(9999, false));
  noExiste(() => admin.eliminarPlatillo(9999));
  noExiste(() => admin.actualizarMesero(9999, { nombre: 'X' }));
  noExiste(() => admin.eliminarMesero(9999));
});
