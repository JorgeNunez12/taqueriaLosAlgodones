// Cola de envios pendientes, en IndexedDB.
//
// El problema que resuelve: la mesera captura un pedido, aprieta "mandar a
// cocina", y en ese instante el WiFi se cae (o el mini PC se reinicia). El
// pedido no se puede perder ni se puede duplicar.
//
// La regla: el client_id se genera ANTES de mandar y se guarda junto con el
// pedido. Si no hubo respuesta, no sabemos si el servidor alcanzo a grabar o
// no; reenviamos igual y el servidor decide, porque ya vio ese client_id o no
// lo ha visto. Sin el client_id generado por adelantado, un reenvio y una
// segunda orden identica legitima ("otra ronda de lo mismo") son
// indistinguibles.
//
// Se usa IndexedDB y no localStorage porque localStorage es sincrono (traba la
// UI) y se borra con mas facilidad; la cola tiene que sobrevivir a que alguien
// cierre la pestaña o se apague la tablet.

const NOMBRE_DB = 'taqueria';
const VERSION_DB = 1;
const ALMACEN = 'pendientes';

let promesaDb = null;

function abrir() {
  if (promesaDb) return promesaDb;
  promesaDb = new Promise((resolver, rechazar) => {
    const solicitud = indexedDB.open(NOMBRE_DB, VERSION_DB);
    solicitud.onupgradeneeded = () => {
      const db = solicitud.result;
      if (!db.objectStoreNames.contains(ALMACEN)) {
        // autoIncrement da el orden de captura: la cola se reenvia en el mismo
        // orden en que la mesera capturo, que es el orden en que cocina espera
        // los platillos.
        db.createObjectStore(ALMACEN, { keyPath: 'seq', autoIncrement: true });
      }
    };
    solicitud.onsuccess = () => resolver(solicitud.result);
    solicitud.onerror = () => rechazar(solicitud.error);
  });
  return promesaDb;
}

/** Envuelve una transaccion de IndexedDB en promesa. */
async function conAlmacen(modo, fn) {
  const db = await abrir();
  return new Promise((resolver, rechazar) => {
    const tx = db.transaction(ALMACEN, modo);
    const almacen = tx.objectStore(ALMACEN);
    let resultado;
    try {
      resultado = fn(almacen);
    } catch (err) {
      rechazar(err);
      return;
    }
    // Se resuelve en oncomplete y no en el onsuccess de la peticion: hasta que
    // la transaccion no cierra, lo escrito no es durable.
    tx.oncomplete = () => resolver(resultado?.result ?? resultado);
    tx.onerror = () => rechazar(tx.error);
    tx.onabort = () => rechazar(tx.error);
  });
}

/**
 * Forma de un envio encolado:
 *   { seq, tipo: 'comanda' | 'items' | 'cerrar' | 'estado',
 *     client_id, cuerpo, ruta, creado_en, intentos }
 */
export async function encolar(envio) {
  const { seq, ...resto } = envio;
  return conAlmacen('readwrite', (almacen) =>
    almacen.add({ ...resto, creado_en: Date.now(), intentos: 0 })
  );
}

export async function listar() {
  const filas = await conAlmacen('readonly', (almacen) => almacen.getAll());
  return (filas ?? []).sort((a, b) => a.seq - b.seq);
}

export async function borrar(seq) {
  return conAlmacen('readwrite', (almacen) => almacen.delete(seq));
}

export async function marcarIntento(seq) {
  const db = await abrir();
  return new Promise((resolver, rechazar) => {
    const tx = db.transaction(ALMACEN, 'readwrite');
    const almacen = tx.objectStore(ALMACEN);
    const leer = almacen.get(seq);
    leer.onsuccess = () => {
      const fila = leer.result;
      if (fila) almacen.put({ ...fila, intentos: (fila.intentos ?? 0) + 1 });
    };
    tx.oncomplete = () => resolver();
    tx.onerror = () => rechazar(tx.error);
  });
}

export async function contar() {
  const filas = await listar();
  return filas.length;
}

export async function vaciar() {
  return conAlmacen('readwrite', (almacen) => almacen.clear());
}
