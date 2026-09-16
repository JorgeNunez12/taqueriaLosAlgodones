// Reportes y corte de caja.
//
// Va aparte de servicio.js por una razon de fondo: aqui NO se escribe nada.
// Todo este modulo son consultas de solo lectura sobre lo que ya paso. Si algun
// dia un reporte necesita "ajustar" un numero, eso es una operacion de negocio y
// va en servicio.js, no aqui.
//
// La fuente de la verdad del dinero son los PAGOS, no las comandas. Una comanda
// cerrada dice "se cobro todo", pero lo que entro a la caja, con su metodo y su
// hora, esta renglon por renglon en `pagos`. Sumar comandas daria un numero
// parecido y mal: se perderia como se repartio entre efectivo y tarjeta, y las
// cuentas cobradas a medias no aparecerian hasta cerrarse.
//
// Las fechas se guardan como 'YYYY-MM-DD HH:MM:SS' en hora local (un solo
// local, una sola zona horaria), asi que comparar por prefijo de texto con
// date(...) es exacto y usa el indice.

import { centavosAPesos, formatoMoneda } from './dinero.js';

/** 'YYYY-MM-DD' de hoy en hora local, que es como guarda la base. */
export function hoyLocal() {
  const ahora = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}`;
}

const RANGO_VALIDO = /^\d{4}-\d{2}-\d{2}$/;

/** Normaliza la fecha que llega por query. Si viene basura, se usa hoy. */
export function normalizarFecha(valor) {
  return typeof valor === 'string' && RANGO_VALIDO.test(valor) ? valor : hoyLocal();
}

export function crearReportes(db) {
  const q = {
    // --- Dinero que entro ---
    pagosDelDia: db.prepare(
      `SELECT p.*, c.mesa_id, c.mesero_id, c.mesera, m.numero AS mesa_numero
         FROM pagos p
         JOIN comandas c ON c.id = p.comanda_id
         LEFT JOIN mesas m ON m.id = c.mesa_id
        WHERE date(p.creado_en) = ?
        ORDER BY p.creado_en`
    ),
    totalPorMetodo: db.prepare(
      `SELECT metodo,
              COUNT(*)                    AS cobros,
              COALESCE(SUM(monto_centavos), 0) AS total
         FROM pagos
        WHERE date(creado_en) = ?
        GROUP BY metodo
        ORDER BY total DESC`
    ),
    // Ventas por hora: es lo que dice a que hora conviene tener mas gente.
    porHora: db.prepare(
      `SELECT strftime('%H', creado_en) AS hora,
              COUNT(*)                  AS cobros,
              COALESCE(SUM(monto_centavos), 0) AS total
         FROM pagos
        WHERE date(creado_en) = ?
        GROUP BY hora
        ORDER BY hora`
    ),

    // --- Que se vendio ---
    // Se cuenta sobre comanda_items y no sobre pagos porque un pago de tipo
    // 'division' no tiene platillos detras. Lo que se vendio se mide en items;
    // lo que se cobro, en pagos. Son dos preguntas distintas y no tienen por
    // que dar el mismo numero cuando hay cuentas abiertas a medio pagar.
    platillosVendidos: db.prepare(
      `SELECT i.platillo_id,
              i.nombre_snapshot                                AS nombre,
              SUM(i.cantidad)                                  AS unidades,
              SUM(i.cantidad * i.precio_unitario_centavos)     AS total,
              p.categoria                                      AS categoria
         FROM comanda_items i
         LEFT JOIN platillos p ON p.id = i.platillo_id
        WHERE date(i.creado_en) = ?
          AND i.estado != 'cancelado'
        GROUP BY i.platillo_id, i.nombre_snapshot
        ORDER BY unidades DESC, total DESC`
    ),
    porCategoria: db.prepare(
      `SELECT COALESCE(p.categoria, 'otros')                   AS categoria,
              SUM(i.cantidad)                                  AS unidades,
              SUM(i.cantidad * i.precio_unitario_centavos)     AS total
         FROM comanda_items i
         LEFT JOIN platillos p ON p.id = i.platillo_id
        WHERE date(i.creado_en) = ?
          AND i.estado != 'cancelado'
        GROUP BY categoria
        ORDER BY total DESC`
    ),

    // --- Quien atendio ---
    // Se agrupa por el nombre congelado en la comanda y no por mesero_id: las
    // cuentas viejas pueden no tener id (es columna agregada despues), y el
    // nombre sobrevive aunque al mesero lo den de baja.
    porMesero: db.prepare(
      `SELECT CASE
                WHEN c.mesa_id IS NULL THEN 'mostrador'
                ELSE COALESCE(c.mesera, 'sin asignar')
              END                                   AS mesero,
              COUNT(DISTINCT c.id)                  AS cuentas,
              COALESCE(SUM(p.monto_centavos), 0)    AS total
         FROM pagos p
         JOIN comandas c ON c.id = p.comanda_id
        WHERE date(p.creado_en) = ?
        GROUP BY mesero
        ORDER BY total DESC`
    ),

    // Las ventas de mostrador aparte. Van en su propio renglon del corte
    // porque responden otra pregunta: no "quien vendio mas" sino "cuanto se
    // fue para llevar". Mezcladas en 'sin asignar' se confundirian con las
    // cuentas que alguien abrio sin iniciar sesion, que es un descuido, no
    // una forma de vender.
    mostrador: db.prepare(
      `SELECT COUNT(DISTINCT c.id)                  AS cuentas,
              COALESCE(SUM(p.monto_centavos), 0)    AS total
         FROM pagos p
         JOIN comandas c ON c.id = p.comanda_id
        WHERE date(p.creado_en) = ?
          AND c.mesa_id IS NULL
          AND c.venta_libre = 0`
    ),

    // Los cobros de cantidad libre, aparte. Son ventas sin mesa igual que las
    // de mostrador, pero se separan a proposito: en las de mostrador se sabe
    // que se vendio (hay platillos), y en estas solo hay un monto que alguien
    // escribio. Verlas juntas escondería justo lo que hay que vigilar.
    ventasLibres: db.prepare(
      `SELECT COUNT(DISTINCT c.id)                  AS cuentas,
              COALESCE(SUM(p.monto_centavos), 0)    AS total
         FROM pagos p
         JOIN comandas c ON c.id = p.comanda_id
        WHERE date(p.creado_en) = ?
          AND c.venta_libre = 1`
    ),

    // El detalle de cada una, para que el encargado pueda revisarlas una por
    // una sin salir del corte: un total agregado no dice si fueron cuatro
    // pedidos por telefono o un cobro raro de $800.
    detalleVentasLibres: db.prepare(
      `SELECT c.id, c.concepto, c.total_centavos, c.creado_en, c.mesera,
              p.metodo
         FROM comandas c
         JOIN pagos p ON p.comanda_id = c.id
        WHERE date(p.creado_en) = ?
          AND c.venta_libre = 1
        ORDER BY p.creado_en DESC`
    ),

    // --- Contadores del dia ---
    comandasDelDia: db.prepare(
      `SELECT estado, COUNT(*) AS n
         FROM comandas
        WHERE date(creado_en) = ?
        GROUP BY estado`
    ),
    cancelados: db.prepare(
      `SELECT COUNT(*)                                     AS n,
              COALESCE(SUM(i.cantidad), 0)                 AS unidades,
              COALESCE(SUM(i.cantidad * i.precio_unitario_centavos), 0) AS total
         FROM comanda_items i
        WHERE date(i.creado_en) = ?
          AND i.estado = 'cancelado'`
    ),
    // Lo que ya se pidio y todavia no se cobra. Al hacer el corte importa:
    // explica por que "vendido" y "cobrado" no cuadran.
    //
    // No lleva filtro de fecha a proposito: son las cuentas abiertas AHORA, y
    // una mesa que se sento antes de la medianoche sigue debiendo despues. El
    // corte de un dia pasado igual muestra lo que hay pendiente hoy, que es lo
    // unico accionable.
    porCobrar: db.prepare(
      `SELECT COUNT(*)                              AS cuentas,
              COALESCE(SUM(c.total_centavos), 0)
                - COALESCE(SUM((SELECT SUM(p.monto_centavos)
                                  FROM pagos p
                                 WHERE p.comanda_id = c.id)), 0)
                                                    AS saldo
         FROM comandas c
        WHERE c.estado = 'abierta'`
    ),

    // --- Historial ---
    comandasCerradas: db.prepare(
      `SELECT c.*, m.numero AS mesa_numero
         FROM comandas c
         LEFT JOIN mesas m ON m.id = c.mesa_id
        WHERE date(c.creado_en) = ?
          AND c.estado != 'abierta'
        ORDER BY COALESCE(c.cerrado_en, c.creado_en) DESC`
    ),

    // Dias que tienen movimiento, para el selector de fecha del reporte.
    diasConVentas: db.prepare(
      `SELECT date(creado_en)                    AS dia,
              COUNT(*)                           AS cobros,
              COALESCE(SUM(monto_centavos), 0)   AS total
         FROM pagos
        GROUP BY dia
        ORDER BY dia DESC
        LIMIT ?`
    ),
  };

  /** Agrega `total`/`total_formateado` a una fila que trae centavos. */
  const conMoneda = (fila, campo = 'total') => ({
    ...fila,
    [`${campo}_centavos`]: fila[campo],
    [campo]: centavosAPesos(fila[campo]),
    [`${campo}_formateado`]: formatoMoneda(fila[campo]),
  });

  /**
   * Corte del dia: todo lo que hace falta para cerrar la caja y para saber como
   * fue la jornada, en una sola respuesta. Es una sola pantalla y una sola
   * pregunta ("¿como nos fue hoy?"); partirlo en cinco endpoints obligaria a la
   * tablet a hacer cinco viajes para pintar una vista.
   */
  function corteDelDia(fecha = hoyLocal()) {
    const metodos = q.totalPorMetodo.all(fecha).map((f) => conMoneda(f));
    const cobrado = metodos.reduce((suma, m) => suma + m.total_centavos, 0);

    const platillos = q.platillosVendidos.all(fecha).map((f) => conMoneda(f));
    const vendido = platillos.reduce((suma, p) => suma + p.total_centavos, 0);

    const estados = Object.fromEntries(q.comandasDelDia.all(fecha).map((f) => [f.estado, f.n]));
    const cancelado = conMoneda(q.cancelados.get(fecha));
    const pendiente = q.porCobrar.get() ?? { cuentas: 0, saldo: 0 };

    const cobros = metodos.reduce((suma, m) => suma + m.cobros, 0);
    // Ticket promedio por CUENTA cerrada, no por pago: una cuenta que tres
    // personas pagaron en partes es un ticket, no tres. Dividir entre pagos
    // haria ver el ticket promedio artificialmente chico los dias que mucha
    // gente pago por separado.
    const cuentasCerradas = estados.cerrada ?? 0;
    const ticketPromedio = cuentasCerradas > 0 ? Math.round(cobrado / cuentasCerradas) : 0;

    return {
      fecha,
      cobrado_centavos: cobrado,
      cobrado: centavosAPesos(cobrado),
      cobrado_formateado: formatoMoneda(cobrado),
      vendido_centavos: vendido,
      vendido_formateado: formatoMoneda(vendido),
      ticket_promedio_centavos: ticketPromedio,
      ticket_promedio_formateado: formatoMoneda(ticketPromedio),
      cobros,
      cuentas: {
        cerradas: cuentasCerradas,
        abiertas: estados.abierta ?? 0,
        canceladas: estados.cancelada ?? 0,
      },
      por_cobrar: {
        cuentas: pendiente.cuentas ?? 0,
        saldo_centavos: pendiente.saldo ?? 0,
        saldo_formateado: formatoMoneda(pendiente.saldo ?? 0),
      },
      cancelado: {
        items: cancelado.n,
        unidades: cancelado.unidades,
        total_centavos: cancelado.total_centavos,
        total_formateado: cancelado.total_formateado,
      },
      mostrador: conMoneda(q.mostrador.get(fecha) ?? { cuentas: 0, total: 0 }),
      ventas_libres: {
        ...conMoneda(q.ventasLibres.get(fecha) ?? { cuentas: 0, total: 0 }),
        detalle: q.detalleVentasLibres.all(fecha).map((v) => ({
          ...v,
          total_formateado: formatoMoneda(v.total_centavos),
        })),
      },
      metodos,
      platillos,
      categorias: q.porCategoria.all(fecha).map((f) => conMoneda(f)),
      meseros: q.porMesero.all(fecha).map((f) => conMoneda(f)),
      horas: q.porHora.all(fecha).map((f) => conMoneda(f)),
    };
  }

  /** Cuentas ya cerradas (o canceladas) de un dia, para consultar un cobro. */
  function historial(fecha = hoyLocal()) {
    return q.comandasCerradas.all(fecha).map((c) => ({
      ...c,
      // Una venta libre tampoco tiene mesa, pero no es una venta de mostrador:
      // la pantalla las pinta distinto y necesita poder distinguirlas.
      mostrador: c.mesa_id == null && c.venta_libre !== 1,
      venta_libre: c.venta_libre === 1,
      total: centavosAPesos(c.total_centavos),
      total_formateado: formatoMoneda(c.total_centavos),
    }));
  }

  const diasConVentas = (limite = 30) =>
    q.diasConVentas.all(limite).map((f) => conMoneda(f));

  const pagosDelDia = (fecha = hoyLocal()) =>
    q.pagosDelDia.all(fecha).map((p) => ({
      ...p,
      monto: centavosAPesos(p.monto_centavos),
      monto_formateado: formatoMoneda(p.monto_centavos),
    }));

  return { corteDelDia, historial, diasConVentas, pagosDelDia };
}
