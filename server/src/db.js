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
  // Cobro de cantidad libre, agregado cuando la caja pidio poder cobrar sin
  // picar platillos. Las comandas viejas son todas ventas normales, y el
  // DEFAULT 0 las deja marcadas asi sin tener que tocarlas una por una.
  if (!comandas.has('venta_libre')) {
    db.exec('ALTER TABLE comandas ADD COLUMN venta_libre INTEGER NOT NULL DEFAULT 0');
  }
  if (!comandas.has('concepto')) {
    db.exec('ALTER TABLE comandas ADD COLUMN concepto TEXT');
  }

  aflojarMesaId(db);
}

/**
 * Las ventas de mostrador son comandas sin mesa, y la base vieja declaraba
 * `mesa_id INTEGER NOT NULL`. SQLite no sabe quitar un NOT NULL con ALTER
 * TABLE: hay que rehacer la tabla y copiar las filas.
 *
 * Se hace una sola vez, y solo si de verdad hace falta: se mira el NOT NULL en
 * el PRAGMA en vez de intentar un INSERT de prueba, porque esto corre en cada
 * arranque del mini PC y no queremos tocar la tabla de ventas sin motivo.
 *
 * Todo va dentro de una transaccion y con las llaves foraneas apagadas. Apagar
 * foreign_keys es lo que permite que comanda_items y pagos sigan apuntando a
 * las comandas mientras la tabla vieja desaparece; al terminar se vuelven a
 * prender y se verifica que no quedo nada colgando. Si algo falla, el ROLLBACK
 * deja la base exactamente como estaba: es la base de ventas del negocio y no
 * puede quedar a medias.
 */
function aflojarMesaId(db) {
  const columna = db
    .prepare('PRAGMA table_info(comandas)')
    .all()
    .find((c) => c.name === 'mesa_id');
  if (!columna || columna.notnull === 0) return;

  // PRAGMA foreign_keys no se puede cambiar dentro de una transaccion: SQLite
  // lo ignora en silencio. Por eso va antes del BEGIN.
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    db.exec(`
      CREATE TABLE comandas_nueva (
        id              INTEGER PRIMARY KEY,
        client_id       TEXT    UNIQUE,
        mesa_id         INTEGER REFERENCES mesas (id),
        etiqueta        TEXT,
        mesera          TEXT,
        mesero_id       INTEGER REFERENCES meseros (id),
        estado          TEXT    NOT NULL DEFAULT 'abierta'
                        CHECK (estado IN ('abierta', 'cerrada', 'cancelada')),
        total_centavos  INTEGER NOT NULL DEFAULT 0,
        metodo_pago     TEXT,
        creado_en       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
        cerrado_en      TEXT
      );
      INSERT INTO comandas_nueva
        (id, client_id, mesa_id, etiqueta, mesera, mesero_id,
         estado, total_centavos, metodo_pago, creado_en, cerrado_en)
      SELECT id, client_id, mesa_id, etiqueta, mesera, mesero_id,
             estado, total_centavos, metodo_pago, creado_en, cerrado_en
        FROM comandas;
      DROP TABLE comandas;
      ALTER TABLE comandas_nueva RENAME TO comandas;
      CREATE INDEX IF NOT EXISTS idx_comandas_mesa   ON comandas (mesa_id, estado);
      CREATE INDEX IF NOT EXISTS idx_comandas_estado ON comandas (estado, creado_en);
    `);
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Si ya se deshizo sola, el rollback sobra.
    }
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }

  const rotas = db.prepare('PRAGMA foreign_key_check').all();
  if (rotas.length > 0) {
    throw new Error(
      `La migracion de comandas dejo ${rotas.length} referencias rotas; la base no se toco mas.`
    );
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
