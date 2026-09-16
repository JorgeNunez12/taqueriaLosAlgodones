// Capa de negocio. No sabe nada de HTTP ni de sockets: recibe una conexion a
// la base y expone operaciones. Asi las pruebas la ejercitan directo, sin
// levantar un servidor.
//
// better-sqlite3 es sincrono, asi que dentro de un db.transaction() no hay
// forma de que se cuele una escritura de otra tablet a la mitad. Esa es la
// base de la seguridad ante concurrencia: toda operacion que lee-modifica-
// escribe va envuelta en una transaccion.

import { centavosAPesos, formatoMoneda, subtotalItem, totalComanda } from './dinero.js';
import { validarTransicion } from './estados.js';

export class ErrorApi extends Error {
  constructor(status, codigo, mensaje, extra = {}) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
    Object.assign(this, extra);
  }
}

const noEncontrado = (que, id) =>
  new ErrorApi(404, 'no_encontrado', `No existe ${que} con id ${id}`);

export function crearServicio(db) {
  // --- Consultas preparadas (se compilan una vez, no en cada pedido) ---
  const q = {
    mesas: db.prepare('SELECT * FROM mesas ORDER BY numero'),
    mesaPorId: db.prepare('SELECT * FROM mesas WHERE id = ?'),
    marcarMesa: db.prepare('UPDATE mesas SET estado = ? WHERE id = ?'),
    contarAbiertasDeMesa: db.prepare(
      `SELECT COUNT(*) AS n FROM comandas WHERE mesa_id = ? AND estado = 'abierta'`
    ),

    platillos: db.prepare('SELECT * FROM platillos ORDER BY categoria, orden, nombre'),
    platilloPorId: db.prepare('SELECT * FROM platillos WHERE id = ?'),

    meseros: db.prepare('SELECT * FROM meseros WHERE activo = 1 ORDER BY orden, nombre'),
    meseroPorId: db.prepare('SELECT * FROM meseros WHERE id = ?'),

    comandaPorId: db.prepare('SELECT * FROM comandas WHERE id = ?'),
    comandaPorClientId: db.prepare('SELECT * FROM comandas WHERE client_id = ?'),
    insertarComanda: db.prepare(
      `INSERT INTO comandas (client_id, mesa_id, etiqueta, mesera, mesero_id,
                             venta_libre, concepto, total_centavos)
       VALUES (@client_id, @mesa_id, @etiqueta, @mesera, @mesero_id,
               @venta_libre, @concepto, @total_centavos)`
    ),
    comandasPorEstado: db.prepare(
      'SELECT * FROM comandas WHERE estado = ? ORDER BY creado_en'
    ),
    comandasDeMesa: db.prepare(
      `SELECT * FROM comandas WHERE mesa_id = ? AND estado = 'abierta' ORDER BY creado_en`
    ),
    actualizarTotal: db.prepare('UPDATE comandas SET total_centavos = ? WHERE id = ?'),
    cerrarComanda: db.prepare(
      `UPDATE comandas
          SET estado = 'cerrada',
              metodo_pago = ?,
              cerrado_en = datetime('now', 'localtime')
        WHERE id = ?`
    ),
    cancelarComanda: db.prepare(
      `UPDATE comandas
          SET estado = 'cancelada',
              cerrado_en = datetime('now', 'localtime')
        WHERE id = ?`
    ),

    itemsDeComanda: db.prepare(
      'SELECT * FROM comanda_items WHERE comanda_id = ? ORDER BY id'
    ),
    itemPorId: db.prepare('SELECT * FROM comanda_items WHERE id = ?'),
    itemPorClientId: db.prepare('SELECT * FROM comanda_items WHERE client_id = ?'),
    insertarItem: db.prepare(
      `INSERT INTO comanda_items
         (client_id, comanda_id, platillo_id, nombre_snapshot,
          precio_unitario_centavos, cantidad, notas)
       VALUES
         (@client_id, @comanda_id, @platillo_id, @nombre_snapshot,
          @precio_unitario_centavos, @cantidad, @notas)`
    ),
    actualizarEstadoItem: db.prepare(
      `UPDATE comanda_items
          SET estado = ?, actualizado_en = datetime('now', 'localtime')
        WHERE id = ?`
    ),
    // --- Pagos parciales ---
    pagoPorClientId: db.prepare('SELECT * FROM pagos WHERE client_id = ?'),
    pagosDeComanda: db.prepare('SELECT * FROM pagos WHERE comanda_id = ? ORDER BY id'),
    insertarPago: db.prepare(
      `INSERT INTO pagos (client_id, comanda_id, monto_centavos, metodo, tipo)
       VALUES (@client_id, @comanda_id, @monto_centavos, @metodo, @tipo)`
    ),
    sumaPagada: db.prepare(
      'SELECT COALESCE(SUM(monto_centavos), 0) AS total FROM pagos WHERE comanda_id = ?'
    ),
    marcarItemPagado: db.prepare('UPDATE comanda_items SET pago_id = ? WHERE id = ?'),

    // LEFT JOIN y no JOIN: una venta de mostrador no tiene mesa, y con un join
    // interno sus platillos desaparecerian de la pantalla de cocina sin que
    // nadie se enterara. Es justo el pedido que mas prisa tiene, porque el
    // cliente esta parado en la caja esperandolo.
    itemsPendientesCocina: db.prepare(
      `SELECT i.*, c.mesa_id, c.etiqueta, c.mesera, m.numero AS mesa_numero
         FROM comanda_items i
         JOIN comandas c ON c.id = i.comanda_id
         LEFT JOIN mesas m ON m.id = c.mesa_id
        WHERE i.estado IN ('recibido', 'preparando')
        ORDER BY i.creado_en`
    ),
  };

  // --- Helpers internos (siempre corren dentro de una transaccion) ---

  /**
   * Recalcula el total cacheado de la comanda desde sus items.
   *
   * Una venta libre no tiene items: su total lo fijo la caja al escribirlo y
   * recalcularlo desde items lo pondria en cero, que es justo el dinero que se
   * acaba de cobrar. Por eso se devuelve tal cual sin tocarlo.
   */
  function recalcularTotal(comandaId) {
    const comanda = q.comandaPorId.get(comandaId);
    if (comanda?.venta_libre === 1) return comanda.total_centavos;
    const items = q.itemsDeComanda.all(comandaId);
    const total = totalComanda(items);
    q.actualizarTotal.run(total, comandaId);
    return total;
  }

  /**
   * La mesa esta ocupada si y solo si tiene al menos una comanda abierta.
   *
   * Una venta de mostrador no tiene mesa que ocupar ni que liberar, asi que
   * aqui no hay nada que hacer. Se checa en un solo lugar en vez de en cada
   * quien llama: abrir, cobrar y cancelar pasan todos por esta funcion.
   */
  function sincronizarEstadoMesa(mesaId) {
    if (mesaId == null) return;
    const { n } = q.contarAbiertasDeMesa.get(mesaId);
    q.marcarMesa.run(n > 0 ? 'ocupada' : 'libre', mesaId);
  }

  function armarComanda(fila) {
    const items = q.itemsDeComanda.all(fila.id).map((item) => ({
      ...item,
      subtotal_centavos: subtotalItem(item),
      subtotal: centavosAPesos(subtotalItem(item)),
      precio_unitario: centavosAPesos(item.precio_unitario_centavos),
      pagado: item.pago_id != null,
    }));
    const mesa = fila.mesa_id != null ? q.mesaPorId.get(fila.mesa_id) : null;
    const pagos = q.pagosDeComanda.all(fila.id).map((p) => ({
      ...p,
      monto: centavosAPesos(p.monto_centavos),
      monto_formateado: formatoMoneda(p.monto_centavos),
    }));
    // El saldo es lo unico que la caja debe mirar para saber si ya se acabo de
    // cobrar. Se calcula aqui, del lado del servidor, por la misma razon que el
    // total: si cada tablet lo sumara por su cuenta, dos cajas cobrando la
    // misma mesa podrian discrepar.
    const pagado = q.sumaPagada.get(fila.id).total;
    const saldo = fila.total_centavos - pagado;

    return {
      ...fila,
      mesa_numero: mesa?.numero ?? null,
      // Bandera explicita para las pantallas: "sin mesa" y "mesa que no se
      // pudo leer" se ven igual mirando solo mesa_numero, y no son lo mismo.
      mostrador: fila.mesa_id == null,
      items,
      pagos,
      total: centavosAPesos(fila.total_centavos),
      total_formateado: formatoMoneda(fila.total_centavos),
      pagado_centavos: pagado,
      pagado_formateado: formatoMoneda(pagado),
      saldo_centavos: saldo,
      saldo_formateado: formatoMoneda(saldo),
    };
  }

  // --- Operaciones publicas ---

  const listarMesas = () =>
    q.mesas.all().map((mesa) => ({
      ...mesa,
      comandas: q.comandasDeMesa.all(mesa.id).map((c) => ({
        id: c.id,
        etiqueta: c.etiqueta,
        mesera: c.mesera,
        total: centavosAPesos(c.total_centavos),
        total_centavos: c.total_centavos,
        saldo_centavos: c.total_centavos - q.sumaPagada.get(c.id).total,
      })),
    }));

  const listarMeseros = () => q.meseros.all();

  const listarPlatillos = ({ soloDisponibles = false } = {}) =>
    q.platillos
      .all()
      .filter((p) => !soloDisponibles || p.disponible === 1)
      .map((p) => ({ ...p, precio: centavosAPesos(p.precio_centavos) }));

  function obtenerComanda(id) {
    const fila = q.comandaPorId.get(id);
    if (!fila) throw noEncontrado('la comanda', id);
    return armarComanda(fila);
  }

  const listarComandas = ({ estado = 'abierta' } = {}) =>
    q.comandasPorEstado.all(estado).map(armarComanda);

  /**
   * Crea una comanda. Si viene client_id y ya existe una comanda con ese
   * client_id, devuelve la existente en vez de crear otra: es el reintento
   * de una tablet que perdio la respuesta, no una segunda familia.
   */
  const crearComanda = db.transaction(({ client_id, mesa_id, etiqueta, mesera, mesero_id }) => {
    if (client_id) {
      const previa = q.comandaPorClientId.get(client_id);
      if (previa) return { comanda: armarComanda(previa), duplicada: true };
    }
    // Sin mesa = venta de mostrador. Con mesa, tiene que existir: una comanda
    // apuntando a una mesa inventada rompe el historial.
    const enMostrador = mesa_id == null;
    if (!enMostrador && !q.mesaPorId.get(mesa_id)) throw noEncontrado('la mesa', mesa_id);

    // El nombre se toma del mesero con sesion iniciada, no de lo que mande la
    // tablet: asi no puede quedar una cuenta a nombre de alguien que no existe.
    const mesero = mesero_id != null ? q.meseroPorId.get(mesero_id) : null;
    if (mesero_id != null && !mesero) throw noEncontrado('el mesero', mesero_id);

    const { lastInsertRowid } = q.insertarComanda.run({
      client_id: client_id ?? null,
      mesa_id: enMostrador ? null : mesa_id,
      etiqueta: etiqueta ?? null,
      mesera: mesero?.nombre ?? mesera ?? null,
      mesero_id: mesero?.id ?? null,
      venta_libre: 0,
      concepto: null,
      total_centavos: 0,
    });
    sincronizarEstadoMesa(mesa_id);
    // node:sqlite puede devolver el rowid como BigInt; normalizarlo aqui evita
    // que se filtre a JSON, donde BigInt no serializa.
    return { comanda: obtenerComanda(Number(lastInsertRowid)), duplicada: false };
  });

  /**
   * Agrega items a una comanda abierta, en bloque y de forma atomica: o entra
   * el pedido completo o no entra nada. Cada item trae su client_id; los que
   * ya existen se reportan como duplicados y se ignoran, que es lo que hace
   * seguro reenviar el pedido entero tras una reconexion.
   */
  const agregarItems = db.transaction((comandaId, items) => {
    const comanda = q.comandaPorId.get(comandaId);
    if (!comanda) throw noEncontrado('la comanda', comandaId);
    if (comanda.estado !== 'abierta') {
      throw new ErrorApi(
        409,
        'comanda_no_abierta',
        `La comanda ${comandaId} esta ${comanda.estado}; no se le pueden agregar platillos`
      );
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw new ErrorApi(400, 'sin_items', 'No se envio ningun platillo');
    }

    const agregados = [];
    const duplicados = [];

    for (const item of items) {
      if (item.client_id) {
        const previo = q.itemPorClientId.get(item.client_id);
        if (previo) {
          duplicados.push(previo);
          continue;
        }
      }

      const cantidad = Number(item.cantidad);
      if (!Number.isInteger(cantidad) || cantidad <= 0) {
        throw new ErrorApi(
          400,
          'cantidad_invalida',
          `Cantidad invalida para el platillo ${item.platillo_id}: ${item.cantidad}`
        );
      }

      const platillo = q.platilloPorId.get(item.platillo_id);
      if (!platillo) throw noEncontrado('el platillo', item.platillo_id);
      if (platillo.disponible !== 1) {
        throw new ErrorApi(
          409,
          'platillo_agotado',
          `"${platillo.nombre}" esta marcado como no disponible`
        );
      }

      const { lastInsertRowid } = q.insertarItem.run({
        client_id: item.client_id ?? null,
        comanda_id: comandaId,
        platillo_id: platillo.id,
        nombre_snapshot: platillo.nombre,
        precio_unitario_centavos: platillo.precio_centavos,
        cantidad,
        notas: item.notas?.trim() || null,
      });
      agregados.push(q.itemPorId.get(Number(lastInsertRowid)));
    }

    recalcularTotal(comandaId);
    return { comanda: obtenerComanda(comandaId), agregados, duplicados };
  });

  /** Cambia el estado de un item validando la maquina de estados. */
  const cambiarEstadoItem = db.transaction((itemId, nuevoEstado) => {
    const item = q.itemPorId.get(itemId);
    if (!item) throw noEncontrado('el platillo pedido', itemId);

    const problema = validarTransicion(item.estado, nuevoEstado);
    if (problema?.idempotente) {
      return { item, comanda: obtenerComanda(item.comanda_id), sinCambio: true };
    }
    if (problema) throw new ErrorApi(409, problema.codigo, problema.mensaje);

    // Cancelar un platillo que alguien ya pago dejaria el total por debajo de
    // lo cobrado, o sea saldo negativo: la caja habria cobrado de mas y el
    // sistema no tendria como devolverlo. Si de verdad hay que quitarlo, se
    // devuelve el dinero fuera del sistema y se ajusta a mano.
    if (nuevoEstado === 'cancelado' && item.pago_id != null) {
      throw new ErrorApi(
        409,
        'item_ya_pagado',
        `"${item.nombre_snapshot}" ya se cobro; no se puede cancelar`
      );
    }

    q.actualizarEstadoItem.run(nuevoEstado, itemId);
    // Cancelar saca el platillo del total; el resto de transiciones no lo mueven,
    // pero recalcular siempre cuesta nada y evita que el cache se desfase.
    recalcularTotal(item.comanda_id);
    return {
      item: q.itemPorId.get(itemId),
      comanda: obtenerComanda(item.comanda_id),
      sinCambio: false,
    };
  });

  /**
   * Registra un pago sobre una cuenta. Es la unica puerta por la que entra
   * dinero, y cubre los tres casos con el mismo camino:
   *
   *   tipo 'total'    -> se paga todo el saldo de un jalon (el caso de siempre).
   *   tipo 'items'    -> se pagan platillos concretos; quedan marcados con el
   *                      pago que los cubrio, para que el siguiente cliente de
   *                      la misma mesa vea solo lo que falta.
   *   tipo 'division' -> "entre 3": un monto suelto, sin platillos detras.
   *
   * Cuando el saldo llega a cero la comanda se cierra sola y la mesa se libera
   * si no le quedan otras cuentas. Cerrar es consecuencia de que ya no se debe
   * nada, no una accion aparte: asi no existe el estado "pagada pero abierta".
   */
  const registrarPago = db.transaction(
    ({ client_id, comanda_id, metodo = 'efectivo', tipo = 'total', item_ids, monto_centavos }) => {
      if (client_id) {
        const previo = q.pagoPorClientId.get(client_id);
        // Reintento de la tablet tras perder la respuesta: el pago ya entro.
        if (previo) {
          return {
            pago: previo,
            comanda: obtenerComanda(previo.comanda_id),
            duplicado: true,
            cerrada: q.comandaPorId.get(previo.comanda_id).estado === 'cerrada',
          };
        }
      }

      const comanda = q.comandaPorId.get(comanda_id);
      if (!comanda) throw noEncontrado('la comanda', comanda_id);
      if (comanda.estado !== 'abierta') {
        throw new ErrorApi(
          409,
          'comanda_no_abierta',
          `La comanda esta ${comanda.estado}; ya no se le puede cobrar`
        );
      }

      const total = recalcularTotal(comanda_id);
      const items = q.itemsDeComanda.all(comanda_id);
      // Una venta libre es legitimamente una cuenta sin platillos: su monto lo
      // escribio la caja. Exigirle items la haria imposible de cobrar.
      if (total === 0 && items.length === 0 && comanda.venta_libre !== 1) {
        throw new ErrorApi(409, 'comanda_vacia', 'No se puede cobrar una comanda sin platillos');
      }

      const saldoPrevio = total - q.sumaPagada.get(comanda_id).total;
      if (saldoPrevio <= 0) {
        throw new ErrorApi(409, 'sin_saldo', 'Esta cuenta ya esta pagada');
      }

      // Cuanto cubre este pago, segun como se reparta.
      let monto;
      let aMarcar = [];

      if (tipo === 'items') {
        const ids = new Set((item_ids ?? []).map(Number));
        if (ids.size === 0) {
          throw new ErrorApi(400, 'sin_items', 'No se selecciono ningun platillo para cobrar');
        }
        aMarcar = items.filter((i) => ids.has(i.id));
        if (aMarcar.length !== ids.size) {
          throw new ErrorApi(
            400,
            'item_ajeno',
            'Algun platillo seleccionado no pertenece a esta cuenta'
          );
        }
        const yaPagado = aMarcar.find((i) => i.pago_id != null);
        if (yaPagado) {
          throw new ErrorApi(
            409,
            'item_ya_pagado',
            `"${yaPagado.nombre_snapshot}" ya lo cubrio otro pago`
          );
        }
        // Un platillo cancelado no se cobra; incluirlo seria cobrar de mas.
        const cancelado = aMarcar.find((i) => i.estado === 'cancelado');
        if (cancelado) {
          throw new ErrorApi(
            409,
            'item_cancelado',
            `"${cancelado.nombre_snapshot}" esta cancelado; no se cobra`
          );
        }
        monto = aMarcar.reduce((suma, i) => suma + subtotalItem(i), 0);
      } else if (tipo === 'division') {
        monto = Number(monto_centavos);
        if (!Number.isInteger(monto) || monto <= 0) {
          throw new ErrorApi(400, 'monto_invalido', `Monto invalido: ${monto_centavos}`);
        }
      } else {
        // 'total': se liquida lo que quede, sea el total completo o el resto
        // despues de varios pagos parciales.
        monto = saldoPrevio;
      }

      if (monto > saldoPrevio) {
        throw new ErrorApi(
          409,
          'monto_excede_saldo',
          `El pago de ${formatoMoneda(monto)} pasa del saldo de ${formatoMoneda(saldoPrevio)}`
        );
      }

      const { lastInsertRowid } = q.insertarPago.run({
        client_id: client_id ?? null,
        comanda_id,
        monto_centavos: monto,
        metodo,
        tipo,
      });
      const pagoId = Number(lastInsertRowid);
      for (const item of aMarcar) q.marcarItemPagado.run(pagoId, item.id);

      // Si con esto quedo saldada, se cierra en la MISMA transaccion: no puede
      // existir un instante en que este pagada por completo y siga abierta.
      const cerrada = saldoPrevio - monto === 0;
      if (cerrada) {
        q.cerrarComanda.run(metodo, comanda_id);
        sincronizarEstadoMesa(comanda.mesa_id);
      }

      return {
        pago: db.prepare('SELECT * FROM pagos WHERE id = ?').get(pagoId),
        comanda: obtenerComanda(comanda_id),
        duplicado: false,
        cerrada,
      };
    }
  );

  /**
   * Cobro de toda la cuenta de un jalon. Se conserva porque es lo que usa la
   * caja el 90% de las veces; por dentro es un pago que liquida el saldo.
   */
  const cerrarComanda = db.transaction((comandaId, metodoPago = 'efectivo', client_id = null) => {
    const previa = q.comandaPorId.get(comandaId);
    if (!previa) throw noEncontrado('la comanda', comandaId);
    if (previa.estado === 'cerrada') {
      // Reintento de caja tras perder la respuesta: no es error.
      return { comanda: armarComanda(previa), yaEstabaCerrada: true };
    }

    const { comanda } = registrarPago({
      client_id,
      comanda_id: comandaId,
      metodo: metodoPago,
      tipo: 'total',
    });
    return { comanda, yaEstabaCerrada: false };
  });

  /**
   * Venta de mostrador: se abre la cuenta, se le cargan los platillos y se
   * cobra, TODO en una sola transaccion.
   *
   * Que sea una sola transaccion es el punto entero de que esto exista como
   * operacion y no como tres llamadas seguidas desde la tablet. Si la caja
   * abriera, agregara y cobrara por separado y se fuera la luz a la mitad,
   * quedaria una cuenta abierta sin mesa que nadie ve en ninguna pantalla:
   * no esta en las mesas porque no tiene mesa, y el cliente ya se fue con sus
   * tacos. Aqui o entra la venta completa o no entra nada.
   *
   * El client_id manda igual que en todo lo demas: si la respuesta se pierde y
   * la tablet reintenta, se devuelve la venta que ya se hizo en vez de cobrarla
   * dos veces. Se checa contra `comandas` porque la comanda es lo primero que
   * se inserta: si existe, la transaccion completa ya se habia comiteado.
   */
  const ventaMostrador = db.transaction(
    ({ client_id, items, metodo = 'efectivo', etiqueta, mesero_id }) => {
      if (client_id) {
        const previa = q.comandaPorClientId.get(client_id);
        if (previa) {
          const comanda = armarComanda(previa);
          return { comanda, pago: q.pagosDeComanda.all(previa.id)[0] ?? null, duplicada: true };
        }
      }
      if (!Array.isArray(items) || items.length === 0) {
        throw new ErrorApi(400, 'sin_items', 'No se envio ningun platillo');
      }

      const mesero = mesero_id != null ? q.meseroPorId.get(mesero_id) : null;
      if (mesero_id != null && !mesero) throw noEncontrado('el mesero', mesero_id);

      const { lastInsertRowid } = q.insertarComanda.run({
        client_id: client_id ?? null,
        mesa_id: null,
        etiqueta: etiqueta?.trim() || null,
        mesera: mesero?.nombre ?? null,
        mesero_id: mesero?.id ?? null,
        venta_libre: 0,
        concepto: null,
        total_centavos: 0,
      });
      const comandaId = Number(lastInsertRowid);

      // Se reusan agregarItems y registrarPago tal cual: validan agotados,
      // cantidades y montos igual que siempre, y al estar ya dentro de esta
      // transaccion se suman a ella en vez de abrir la suya (ver db.js).
      const { agregados } = agregarItems(comandaId, items);
      const { pago, comanda } = registrarPago({
        comanda_id: comandaId,
        metodo,
        tipo: 'total',
      });

      return { comanda, pago, agregados, duplicada: false };
    }
  );

  /**
   * Cobro de cantidad libre: la caja escribe un monto y cobra, sin picar
   * platillos.
   *
   * Para lo que no esta en el menu o no vale la pena capturar: un pedido que se
   * levanto por telefono, un encargo especial, algo que se acordo de palabra
   * con el cliente. Antes habia que inventar platillos o armar un carrito que
   * no correspondia a nada.
   *
   * Es una comanda como cualquier otra (por eso entra al corte y al historial
   * sin ningun caso especial), pero marcada con venta_libre = 1 y sin items. Su
   * total NO sale de sumar platillos: es el monto que se escribio, y se guarda
   * al insertar para que la comanda nazca ya cuadrada.
   *
   * El concepto es opcional pero se pide en la pantalla: sin el, el corte
   * acaba con renglones de dinero que nadie puede explicar tres dias despues.
   */
  const ventaLibre = db.transaction(
    ({ client_id, monto_centavos, concepto, metodo = 'efectivo', mesero_id }) => {
      if (client_id) {
        const previa = q.comandaPorClientId.get(client_id);
        if (previa) {
          const comanda = armarComanda(previa);
          return { comanda, pago: q.pagosDeComanda.all(previa.id)[0] ?? null, duplicada: true };
        }
      }

      const monto = Number(monto_centavos);
      if (!Number.isInteger(monto) || monto <= 0) {
        throw new ErrorApi(400, 'monto_invalido', `Monto invalido: ${monto_centavos}`);
      }

      const mesero = mesero_id != null ? q.meseroPorId.get(mesero_id) : null;
      if (mesero_id != null && !mesero) throw noEncontrado('el mesero', mesero_id);

      const { lastInsertRowid } = q.insertarComanda.run({
        client_id: client_id ?? null,
        mesa_id: null,
        etiqueta: null,
        mesera: mesero?.nombre ?? null,
        mesero_id: mesero?.id ?? null,
        venta_libre: 1,
        concepto: concepto?.trim() || null,
        // El total se fija aqui y recalcularTotal lo respeta al ver la bandera.
        total_centavos: monto,
      });
      const comandaId = Number(lastInsertRowid);

      // tipo 'total' liquida el saldo, que es exactamente el monto escrito, y
      // deja que el servidor cierre la comanda como en cualquier otro cobro.
      const { pago, comanda } = registrarPago({
        comanda_id: comandaId,
        metodo,
        tipo: 'total',
      });

      return { comanda, pago, duplicada: false };
    }
  );

  /**
   * Cancela una cuenta a la que nunca se le pidio nada: se abrio la mesa y el
   * cliente se fue antes de ordenar. Sin esto quedaba atrapada para siempre,
   * porque cerrar una comanda solo ocurre como consecuencia de un pago y un
   * pago exige que haya algo que cobrar.
   *
   * Se cancela, no se cobra en cero: un cobro de $0 ensuciaria el corte del dia
   * con un ticket que nunca existio.
   *
   * Solo aplica a cuentas realmente vacias. Con platillos de por medio la
   * decision es de quien atiende (cancelar plato por plato), y con dinero ya
   * cobrado cancelar dejaria el pago sin cuenta a la cual pertenecer.
   */
  const cancelarComandaVacia = db.transaction((comandaId) => {
    const comanda = q.comandaPorId.get(comandaId);
    if (!comanda) throw noEncontrado('la comanda', comandaId);
    if (comanda.estado !== 'abierta') {
      // Reintento de la tablet tras perder la respuesta: ya estaba cancelada.
      return { comanda: armarComanda(comanda), yaEstabaCerrada: true };
    }

    const items = q.itemsDeComanda.all(comandaId);
    if (items.length > 0) {
      throw new ErrorApi(
        409,
        'comanda_con_platillos',
        'Esta cuenta ya tiene platillos; cancelalos primero o cobrala'
      );
    }
    if (q.sumaPagada.get(comandaId).total > 0) {
      throw new ErrorApi(
        409,
        'comanda_con_pagos',
        'Esta cuenta ya tiene pagos registrados; no se puede cancelar'
      );
    }

    q.cancelarComanda.run(comandaId);
    sincronizarEstadoMesa(comanda.mesa_id);
    return { comanda: obtenerComanda(comandaId), yaEstabaCerrada: false };
  });

  /** Vista de cocina: lo que falta cocinar, agrupado por mesa y comanda. */
  function pendientesCocina() {
    const porComanda = new Map();
    for (const fila of q.itemsPendientesCocina.all()) {
      if (!porComanda.has(fila.comanda_id)) {
        porComanda.set(fila.comanda_id, {
          comanda_id: fila.comanda_id,
          mesa_id: fila.mesa_id,
          mesa_numero: fila.mesa_numero,
          mostrador: fila.mesa_id == null,
          etiqueta: fila.etiqueta,
          mesera: fila.mesera,
          desde: fila.creado_en,
          items: [],
        });
      }
      const { mesa_id, etiqueta, mesera, mesa_numero, ...item } = fila;
      porComanda.get(fila.comanda_id).items.push(item);
    }
    return [...porComanda.values()];
  }

  return {
    db,
    listarMesas,
    listarMeseros,
    listarPlatillos,
    listarComandas,
    obtenerComanda,
    crearComanda,
    agregarItems,
    cambiarEstadoItem,
    registrarPago,
    cerrarComanda,
    ventaMostrador,
    ventaLibre,
    cancelarComandaVacia,
    pendientesCocina,
  };
}
