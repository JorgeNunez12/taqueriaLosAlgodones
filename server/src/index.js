import os from 'node:os';
import { crearApp } from './app.js';

const PUERTO = Number(process.env.PORT || 3000);
const { server, db } = crearApp();

/** IPs de la LAN, para saber que direccion escribir en las tablets. */
function ipsLocales() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

// 0.0.0.0: hay que escuchar en todas las interfaces o las tablets no llegan.
server.listen(PUERTO, '0.0.0.0', () => {
  console.log('\n  Taqueria — servidor local listo\n');
  for (const ip of ipsLocales()) console.log(`    http://${ip}:${PUERTO}`);
  console.log(`    http://localhost:${PUERTO}   (en esta maquina)\n`);
});

// Cerrar la base a mano deja el WAL consolidado y evita dejar archivos
// -wal/-shm sueltos cuando alguien apaga el equipo desde el boton.
function apagar(senal) {
  console.log(`\n  ${senal} recibido, cerrando...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  // Si algun socket se queda colgado, no bloquear el apagado para siempre.
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => apagar('SIGINT'));
process.on('SIGTERM', () => apagar('SIGTERM'));
