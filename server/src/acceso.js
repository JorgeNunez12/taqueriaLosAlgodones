// Acceso a la tablet del encargado.
//
// Menu, personal y corte del dia son las tres cosas que no puede tocar
// cualquiera: quien entre ahi puede cambiar precios, dar de baja meseros y ver
// cuanto se hizo en el dia. Las tablets de piso viven en el mismo WiFi y la
// pantalla de inicio ofrece el rol "Encargado" a un toque, asi que sin esto
// basta con agarrar la tablet de la mesera para abrir el corte.
//
// Es una sola cuenta compartida, no un sistema de usuarios: en el local hay un
// encargado y punto. Lo que se busca es que la tablet de piso no entre, no
// resistir a alguien decidido con acceso fisico al mini PC.
//
// La contrasena se puede cambiar sin tocar codigo con las variables de entorno
// TAQUERIA_USUARIO y TAQUERIA_CLAVE (ver index.js).

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { ErrorApi } from './servicio.js';

// Usuario y clave viven en server/.env, NO aqui.
//
// Estaban escritos en el codigo y eso los publicaba: este proyecto se sube a
// GitHub para poder instalarlo en otra computadora, y la clave se iba con el.
// El .env no se sube (esta en .gitignore) y ademas se cambia sin tocar codigo,
// que es lo que hace falta cuando alguien deja de trabajar aqui.
//
// Si falta el archivo, el servidor NO arranca con una clave adivinable: se
// para y lo dice. Un sistema que cobra dinero no debe quedarse abierto de par
// en par porque un archivo de configuracion no llego en la copia.
const USUARIO = process.env.TAQUERIA_USUARIO;
const CLAVE = process.env.TAQUERIA_CLAVE;

// Salto de linea, para que el mensaje de abajo se lea en varios renglones.
const SALTO = String.fromCharCode(10);

if (!USUARIO || !CLAVE) {
  throw new Error(
    [
      'Falta la clave del encargado.',
      '',
      '  Crea el archivo  server/.env  con estas dos lineas:',
      '',
      '    TAQUERIA_USUARIO=algodones',
      '    TAQUERIA_CLAVE=la-clave-que-quieras',
      '',
      '  (hay un ejemplo listo en server/.env.ejemplo)',
      '',
    ].join(SALTO)
  );
}

// La sesion dura un turno largo. Al vencer, la tablet vuelve a pedir la clave
// en vez de quedarse abierta para siempre sobre el mostrador.
const DURACION_MS = 12 * 60 * 60 * 1000;

// Secreto nuevo en cada arranque: al reiniciar el mini PC las sesiones viejas
// dejan de valer, que es justo lo que se quiere de un reinicio.
const SECRETO = randomBytes(32);

/** Compara en tiempo constante y sin tronar cuando los largos no coinciden. */
function igual(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

const firmar = (vence) =>
  `${vence}.${createHmac('sha256', SECRETO).update(String(vence)).digest('hex')}`;

/**
 * Revisa usuario y clave. Devuelve un token firmado, o lanza 401.
 *
 * El mensaje no dice si fallo el usuario o la clave: no hay nada que ganar
 * ayudando a adivinar cual de los dos era.
 */
export function iniciarSesion({ usuario, clave } = {}) {
  if (!igual(usuario ?? '', USUARIO) || !igual(clave ?? '', CLAVE)) {
    throw new ErrorApi(401, 'acceso_denegado', 'Usuario o contraseña incorrectos');
  }
  const vence = Date.now() + DURACION_MS;
  return { token: firmar(vence), vence };
}

/** True si el token lo firmamos nosotros y todavia no vence. */
export function tokenValido(token) {
  if (typeof token !== 'string') return false;
  const corte = token.indexOf('.');
  if (corte < 1) return false;
  const vence = Number(token.slice(0, corte));
  if (!Number.isFinite(vence) || vence < Date.now()) return false;
  return igual(token, firmar(vence));
}

/**
 * Middleware para las rutas del encargado. El token viaja en el header
 * Authorization: Bearer <token>.
 */
export function exigirEncargado(req, _res, next) {
  const encabezado = req.get('authorization') ?? '';
  const token = encabezado.startsWith('Bearer ') ? encabezado.slice(7) : '';
  if (!tokenValido(token)) {
    return next(new ErrorApi(401, 'acceso_denegado', 'Hay que iniciar sesión como encargado'));
  }
  next();
}
