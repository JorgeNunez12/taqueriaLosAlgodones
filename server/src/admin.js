// Administracion: menu y personal.
//
// Hasta ahora esto se hacia editando seed.js y reiniciando el servidor. Servia
// para arrancar, pero "se acabo el bistec" es algo que pasa a media hora pico y
// no puede exigir tocar codigo: para cuando alguien lo edita, ya se vendieron
// tres ordenes de algo que no hay.
//
// Dos reglas que se respetan en todo el modulo:
//
//   1. NADA se borra. Un platillo que ya salio en cuentas del historial no se
//      puede eliminar sin dejar ventas apuntando a un id inexistente; un mesero
//      tampoco. Se marcan como no disponible / no activo. El unico borrado real
//      es el de un platillo que jamas se pidio, donde no hay historial que
//      romper.
//   2. Los precios entran en centavos enteros, igual que en todo el sistema. La
//      UI puede mandar pesos ("85.50") y aqui se convierten con pesosACentavos,
//      que es la unica frontera donde se hace esa conversion.

import { centavosAPesos, pesosACentavos } from './dinero.js';
import { ErrorApi } from './servicio.js';

const noEncontrado = (que, id) =>
  new ErrorApi(404, 'no_encontrado', `No existe ${que} con id ${id}`);

/** Texto obligatorio y limpio, o error 400 con el nombre del campo. */
function textoRequerido(valor, campo) {
  const limpio = typeof valor === 'string' ? valor.trim() : '';
  if (!limpio) throw new ErrorApi(400, 'campo_requerido', `Falta ${campo}`);
  return limpio;
}

/**
 * Acepta centavos enteros o pesos, y siempre devuelve centavos.
 * `precio_centavos` gana si vienen los dos: es la forma exacta.
 */
function precioACentavos({ precio_centavos, precio }) {
  if (precio_centavos != null) {
    const n = Number(precio_centavos);
    if (!Number.isInteger(n) || n < 0) {
      throw new ErrorApi(400, 'precio_invalido', `Precio invalido: ${precio_centavos}`);
    }
    return n;
  }
  if (precio == null) throw new ErrorApi(400, 'campo_requerido', 'Falta el precio');
  try {
    return pesosACentavos(precio);
  } catch (err) {
    throw new ErrorApi(400, 'precio_invalido', err.message);
  }
}

export function crearAdmin(db) {
  const q = {
    platilloPorId: db.prepare('SELECT * FROM platillos WHERE id = ?'),
    todosLosPlatillos: db.prepare(
      'SELECT * FROM platillos ORDER BY categoria, orden, nombre'
    ),
    insertarPlatillo: db.prepare(
      `INSERT INTO platillos (nombre, precio_centavos, categoria, disponible, orden)
       VALUES (@nombre, @precio_centavos, @categoria, @disponible, @orden)`
    ),
    actualizarPlatillo: db.prepare(
      `UPDATE platillos
          SET nombre = @nombre,
              precio_centavos = @precio_centavos,
              categoria = @categoria,
              disponible = @disponible,
              orden = @orden
        WHERE id = @id`
    ),
    cambiarDisponible: db.prepare('UPDATE platillos SET disponible = ? WHERE id = ?'),
    borrarPlatillo: db.prepare('DELETE FROM platillos WHERE id = ?'),
    vecesPedido: db.prepare(
      'SELECT COUNT(*) AS n FROM comanda_items WHERE platillo_id = ?'
    ),
    // El orden nuevo se pone al final de su categoria.
    ultimoOrden: db.prepare(
      'SELECT COALESCE(MAX(orden), 0) AS ultimo FROM platillos WHERE categoria = ?'
    ),

    meseroPorId: db.prepare('SELECT * FROM meseros WHERE id = ?'),
    meseroPorNombre: db.prepare('SELECT * FROM meseros WHERE nombre = ?'),
    todosLosMeseros: db.prepare('SELECT * FROM meseros ORDER BY activo DESC, orden, nombre'),
    insertarMesero: db.prepare(
      'INSERT INTO meseros (nombre, activo, orden) VALUES (@nombre, 1, @orden)'
    ),
    actualizarMesero: db.prepare(
      'UPDATE meseros SET nombre = @nombre, activo = @activo WHERE id = @id'
    ),
    ultimoOrdenMesero: db.prepare('SELECT COALESCE(MAX(orden), 0) AS ultimo FROM meseros'),
    cuentasDeMesero: db.prepare('SELECT COUNT(*) AS n FROM comandas WHERE mesero_id = ?'),
    borrarMesero: db.prepare('DELETE FROM meseros WHERE id = ?'),
  };

  const conPrecio = (p) => ({ ...p, precio: centavosAPesos(p.precio_centavos) });

  // --- Menu ---

  /** Todos los platillos, incluidos los agotados: admin necesita verlos. */
  const listarPlatillos = () => q.todosLosPlatillos.all().map(conPrecio);

  const crearPlatillo = db.transaction((datos) => {
    const nombre = textoRequerido(datos.nombre, 'el nombre del platillo');
    const categoria = textoRequerido(datos.categoria, 'la categoria');
    const precio_centavos = precioACentavos(datos);
    const orden =
      datos.orden != null ? Number(datos.orden) : q.ultimoOrden.get(categoria).ultimo + 10;

    const { lastInsertRowid } = q.insertarPlatillo.run({
      nombre,
      precio_centavos,
      categoria,
      disponible: datos.disponible === false || datos.disponible === 0 ? 0 : 1,
      orden,
    });
    return conPrecio(q.platilloPorId.get(Number(lastInsertRowid)));
  });

  /**
   * Edita un platillo. Los campos que no vienen conservan su valor: la UI de
   * "agotado" manda solo `disponible` y no tiene por que reenviar el precio.
   *
   * Cambiar el precio NO afecta cuentas ya abiertas: cada item guarda su
   * `precio_unitario_centavos` al momento de pedirse. Subir el precio a media
   * tarde no le mueve el total a nadie que ya este sentado.
   */
  const actualizarPlatillo = db.transaction((id, datos) => {
    const previo = q.platilloPorId.get(id);
    if (!previo) throw noEncontrado('el platillo', id);

    const nombre = datos.nombre != null ? textoRequerido(datos.nombre, 'el nombre') : previo.nombre;
    const categoria =
      datos.categoria != null ? textoRequerido(datos.categoria, 'la categoria') : previo.categoria;
    const precio_centavos =
      datos.precio_centavos != null || datos.precio != null
        ? precioACentavos(datos)
        : previo.precio_centavos;
    const disponible =
      datos.disponible != null ? (datos.disponible ? 1 : 0) : previo.disponible;
    const orden = datos.orden != null ? Number(datos.orden) : previo.orden;

    q.actualizarPlatillo.run({ id, nombre, precio_centavos, categoria, disponible, orden });
    return conPrecio(q.platilloPorId.get(id));
  });

  /** Atajo para el boton de "se acabo" / "ya hay", que es lo mas usado. */
  const marcarDisponible = db.transaction((id, disponible) => {
    if (!q.platilloPorId.get(id)) throw noEncontrado('el platillo', id);
    q.cambiarDisponible.run(disponible ? 1 : 0, id);
    return conPrecio(q.platilloPorId.get(id));
  });

  /**
   * Borra un platillo SOLO si nunca se pidio. Si ya salio en alguna cuenta, se
   * niega y se explica que hay que marcarlo como no disponible: borrarlo
   * dejaria items del historial apuntando a un platillo inexistente y los
   * reportes por platillo se romperian hacia atras.
   */
  const eliminarPlatillo = db.transaction((id) => {
    const platillo = q.platilloPorId.get(id);
    if (!platillo) throw noEncontrado('el platillo', id);

    const { n } = q.vecesPedido.get(id);
    if (n > 0) {
      throw new ErrorApi(
        409,
        'platillo_con_historial',
        `"${platillo.nombre}" ya se pidio ${n} ${n === 1 ? 'vez' : 'veces'}; marcalo como no disponible en vez de borrarlo`
      );
    }
    q.borrarPlatillo.run(id);
    return { eliminado: true, id };
  });

  // --- Personal ---

  /** Todos, activos e inactivos: es la lista que administra el encargado. */
  const listarMeseros = () => q.todosLosMeseros.all();

  const crearMesero = db.transaction((datos) => {
    const nombre = textoRequerido(datos.nombre, 'el nombre del mesero');

    // Un nombre repetido casi siempre es alguien que ya trabajo aqui y regresa.
    // Reactivarlo conserva su historial; crear otro renglon lo partiria en dos.
    const previo = q.meseroPorNombre.get(nombre);
    if (previo) {
      if (previo.activo === 1) {
        throw new ErrorApi(409, 'mesero_duplicado', `Ya hay un mesero llamado "${nombre}"`);
      }
      q.actualizarMesero.run({ id: previo.id, nombre, activo: 1 });
      return q.meseroPorId.get(previo.id);
    }

    const { lastInsertRowid } = q.insertarMesero.run({
      nombre,
      orden: q.ultimoOrdenMesero.get().ultimo + 10,
    });
    return q.meseroPorId.get(Number(lastInsertRowid));
  });

  const actualizarMesero = db.transaction((id, datos) => {
    const previo = q.meseroPorId.get(id);
    if (!previo) throw noEncontrado('el mesero', id);

    const nombre = datos.nombre != null ? textoRequerido(datos.nombre, 'el nombre') : previo.nombre;
    if (nombre !== previo.nombre) {
      const choca = q.meseroPorNombre.get(nombre);
      if (choca && choca.id !== id) {
        throw new ErrorApi(409, 'mesero_duplicado', `Ya hay un mesero llamado "${nombre}"`);
      }
    }
    const activo = datos.activo != null ? (datos.activo ? 1 : 0) : previo.activo;

    q.actualizarMesero.run({ id, nombre, activo });
    return q.meseroPorId.get(id);
  });

  /**
   * Baja de un mesero. Si ya levanto cuentas se desactiva (activo = 0) y su
   * historial queda intacto; solo se borra de verdad al que nunca atendio nada,
   * que es tipicamente un alta mal escrita.
   */
  const eliminarMesero = db.transaction((id) => {
    const mesero = q.meseroPorId.get(id);
    if (!mesero) throw noEncontrado('el mesero', id);

    const { n } = q.cuentasDeMesero.get(id);
    if (n > 0) {
      q.actualizarMesero.run({ id, nombre: mesero.nombre, activo: 0 });
      return { desactivado: true, mesero: q.meseroPorId.get(id) };
    }
    q.borrarMesero.run(id);
    return { eliminado: true, id };
  });

  return {
    listarPlatillos,
    crearPlatillo,
    actualizarPlatillo,
    marcarDisponible,
    eliminarPlatillo,
    listarMeseros,
    crearMesero,
    actualizarMesero,
    eliminarMesero,
  };
}
