// Conexion Socket.io. Un solo socket por tablet, compartido por toda la app.
//
// socket.io ya reintenta solo con backoff; lo unico que se agrega aqui es el
// `registrar` (para entrar al cuarto del rol) y el `sincronizar` en cada
// reconexion. Eso ultimo es clave: mientras la tablet estuvo desconectada se
// perdieron eventos, y aplicar solo los eventos nuevos dejaria la pantalla
// mintiendo. Al reconectar se baja el estado completo y se reemplaza todo.

import { io } from 'socket.io-client';

let socket = null;

export function obtenerSocket() {
  if (!socket) {
    socket = io({
      // La ruta relativa hace que apunte al mismo host que sirvio la PWA:
      // no hay IP que configurar en cada tablet.
      autoConnect: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
      // Sin limite de reintentos: la tablet debe reconectar sola cuando el
      // WiFi vuelva, aunque hayan pasado horas y nadie la haya tocado.
      reconnectionAttempts: Infinity,
    });
  }
  return socket;
}

/** Baja el estado completo. Devuelve promesa porque el servidor usa callback. */
export function sincronizar(socket) {
  return new Promise((resolver, rechazar) => {
    // Si el servidor no contesta (se cayo justo al pedir), no dejar la promesa
    // colgada para siempre: la pantalla debe poder mostrar "sin conexion".
    const temporizador = setTimeout(() => rechazar(new Error('sincronizar: sin respuesta')), 8000);
    socket.emit('sincronizar', null, (estado) => {
      clearTimeout(temporizador);
      resolver(estado);
    });
  });
}
