// El candado de la tablet del encargado.
//
// Lo que importa aqui no es que el encargado pueda entrar (eso lo usan ya casi
// todas las demas pruebas por medio de `levantarServidor`), sino que SIN clave
// no se entre: menu, personal y corte del dia son justo lo que no queremos que
// toque cualquiera que agarre una tablet de piso del mismo WiFi.

import test from 'node:test';
import assert from 'node:assert/strict';

import { levantarServidor, pedir } from './ayudas.js';

// Rutas que no deben contestar sin token, una por familia y por metodo.
const PROTEGIDAS = [
  ['GET', '/api/reportes/corte'],
  ['GET', '/api/reportes/historial'],
  ['GET', '/api/reportes/dias'],
  ['GET', '/api/admin/platillos'],
  ['POST', '/api/admin/platillos'],
  ['GET', '/api/admin/meseros'],
];

test('sin iniciar sesion, el corte y la administracion contestan 401', async (t) => {
  const s = await levantarServidor();
  t.after(() => s.cerrar());

  for (const [method, ruta] of PROTEGIDAS) {
    const { status, cuerpo } = await pedir(s.url, ruta, { method, body: method === 'POST' ? {} : undefined });
    assert.equal(status, 401, `${method} ${ruta} deberia pedir clave`);
    assert.equal(cuerpo.error, 'acceso_denegado');
  }
});

test('las pantallas de piso siguen entrando sin clave', async (t) => {
  const s = await levantarServidor();
  t.after(() => s.cerrar());

  // Si el candado se hubiera puesto de mas, la mesera no podria ni ver el menu
  // y el local se para. Estas son las rutas que usan las tablets de piso.
  for (const ruta of ['/api/salud', '/api/mesas', '/api/meseros', '/api/platillos', '/api/comandas']) {
    const { status } = await pedir(s.url, ruta);
    assert.equal(status, 200, `${ruta} no deberia pedir clave`);
  }
});

test('la clave correcta abre y la equivocada no', async (t) => {
  const s = await levantarServidor();
  t.after(() => s.cerrar());

  const bien = await pedir(s.url, '/api/acceso', {
    method: 'POST',
    body: { usuario: 'algodones', clave: 'clave-de-prueba' },
  });
  assert.equal(bien.status, 200);
  assert.ok(bien.cuerpo.token);

  const conToken = await pedir(s.url, '/api/admin/platillos', { token: bien.cuerpo.token });
  assert.equal(conToken.status, 200);

  for (const body of [
    { usuario: 'algodones', clave: 'herman' },
    { usuario: 'algodones', clave: '' },
    { usuario: 'otro', clave: 'clave-de-prueba' },
    {},
  ]) {
    const mal = await pedir(s.url, '/api/acceso', { method: 'POST', body });
    assert.equal(mal.status, 401, `no deberia abrir con ${JSON.stringify(body)}`);
  }
});

test('un token inventado no sirve', async (t) => {
  const s = await levantarServidor();
  t.after(() => s.cerrar());

  // Incluye una fecha de vencimiento lejana con firma inventada: sin la firma
  // del servidor no basta con pedir que el token dure mucho.
  const lejos = Date.now() + 1000 * 60 * 60 * 24;
  for (const token of ['', 'abc', `${lejos}.firmafalsa`, `${lejos}.`]) {
    const { status } = await pedir(s.url, '/api/admin/platillos', { token });
    assert.equal(status, 401, `no deberia pasar con "${token}"`);
  }
});

test('un token vencido no sirve', async (t) => {
  const s = await levantarServidor();
  t.after(() => s.cerrar());

  // Se toma un token de verdad y se le mueve la fecha hacia atras: la firma ya
  // no corresponde, y aunque correspondiera la fecha ya paso.
  const vencido = `${Date.now() - 1000}.${s.token.split('.')[1]}`;
  const { status } = await pedir(s.url, '/api/admin/platillos', { token: vencido });
  assert.equal(status, 401);
});
