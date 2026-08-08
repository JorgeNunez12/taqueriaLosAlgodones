import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Se usa el SQLite que Node trae incluido (node:sqlite, Node >= 22.5) en vez
// de better-sqlite3: misma API sincrona, pero sin modulo nativo que compilar.
// Eso importa al instalar en el mini PC o en la Raspberry de la taqueria, donde
// no queremos depender de tener build tools ni de que existan binarios
// precompilados para la version de Node que toque.

const aqui = path.dirname(fileURLToPath(import.meta.url));
const RUTA_ESQUEMA = path.join(aqui, 'schema.sql');

export const RUTA_DB_POR_DEFECTO = path.join(aqui, '..', 'datos', 'taqueria.db');

/**
 * Abre (o crea) la base. Pasar ':memory:' para pruebas.
 *
 * Las PRAGMA de aqui son las que hacen que el sistema sobreviva a que alguien
 * desconecte el mini PC de la corriente a media hora pico:
 *   WAL          -> lecturas (cocina, caja) no bloquean escrituras (meseras).
 *   synchronous  -> FULL: cada commit llega al disco antes de contestar "ok".
 *                   Es mas lento que NORMAL, pero "mas lento" aqui son
 *                   milisegundos y lo que compra es no perder pedidos.
 *   foreign_keys -> SQLite las ignora si no se prenden explicitamente.
 *   busy_timeout -> si algun dia hay un segundo proceso (respaldo, reportes),
 *                   espera en vez de tirar SQLITE_BUSY.
 */
export function abrirDb(ruta = process.env.DB_PATH || RUTA_DB_POR_DEFECTO) {
  if (ruta !== ':memory:') {
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
  }

  const db = new DatabaseSync(ruta);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = FULL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  db.exec(fs.readFileSync(RUTA_ESQUEMA, 'utf8'));
  migrar(db);
  return conTransacciones(db);
}

/**
 * Columnas agregadas despues de que la taqueria ya estaba operando. El schema
 * las trae para bases nuevas, pero CREATE TABLE IF NOT EXISTS no toca una tabla
 * que ya existe: sin esto, actualizar el mini PC dejaria la base vieja sin las
 * columnas nuevas y el servidor tronaria al primer pedido.
 */
function migrar(db) {
  const columnas = (tabla) =>
    new Set(db.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name));

  const items = columnas('comanda_items');
  if (!items.has('pago_id')) {
    db.exec('ALTER TABLE comanda_items ADD COLUMN pago_id INTEGER REFERENCES pagos (id)');
  }
  // Va aqui y no en schema.sql porque ahi correria antes del ALTER de arriba.
  db.exec('CREATE INDEX IF NOT EXISTS idx_items_pago ON comanda_items (pago_id)');

  const comandas = columnas('comandas');
  if (!comandas.has('mesero_id')) {
    db.exec('ALTER TABLE comandas ADD COLUMN mesero_id INTEGER REFERENCES meseros (id)');
  }
}

/**
 * Agrega db.transaction(fn) al estilo de better-sqlite3: devuelve una funcion
 * que corre fn dentro de BEGIN/COMMIT y hace ROLLBACK si algo truena.
 *
 * BEGIN IMMEDIATE (y no BEGIN a secas) toma el candado de escritura desde el
 * inicio: evita que dos escrituras concurrentes descubran el conflicto hasta
 * el COMMIT, que es cuando ya no se puede reintentar limpio.
 */
function conTransacciones(db) {
  let dentro = false;

  db.transaction = (fn) =>
    function envuelta(...args) {
      // Anidar transacciones en SQLite es error; si ya estamos dentro de una,
      // la operacion se suma a esa y el commit lo hace quien abrio.
      if (dentro) return fn.apply(this, args);

      db.exec('BEGIN IMMEDIATE');
      dentro = true;
      try {
        const resultado = fn.apply(this, args);
        db.exec('COMMIT');
        return resultado;
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // Si la transaccion ya se deshizo sola, el rollback sobra.
        }
        throw err;
      } finally {
        dentro = false;
      }
    };

  return db;
}
