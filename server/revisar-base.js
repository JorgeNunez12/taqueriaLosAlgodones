// Revision de salud de la base, para DIAGNOSTICO.bat.
//
// Vive en un archivo y no incrustado en el .bat porque ahi los signos de
// admiracion (!==) se los come la expansion retardada de cmd y el script
// quedaba roto de una forma que solo se ve al correrlo.

import { DatabaseSync } from 'node:sqlite';

const RUTA = process.argv[2] ?? 'server/datos/taqueria.db';

try {
  const db = new DatabaseSync(RUTA);
  const { integrity_check: estado } = db.prepare('PRAGMA integrity_check').get();

  if (estado !== 'ok') {
    console.log(`   [X] La base tiene danos: ${estado}`);
    console.log('        Restaura el ultimo respaldo de server\datos\respaldos');
    db.close();
    process.exit(1);
  }

  const cuentas = db.prepare('SELECT COUNT(*) AS n FROM comandas').get().n;
  const abiertas = db
    .prepare("SELECT COUNT(*) AS n FROM comandas WHERE estado = 'abierta'").get().n;
  db.close();

  console.log(`   [OK] Base de datos sana (${cuentas} cuentas, ${abiertas} abiertas ahora)`);
} catch (err) {
  console.log(`   [X] No se pudo abrir la base: ${err.message}`);
  process.exit(1);
}
