// Cliente HTTP. Delgado a proposito: traduce respuestas del servidor a datos o
// a un ErrorApi con el codigo que el servidor mando, para que la UI pueda
// distinguir "el platillo se agoto" (hay que avisar) de "no hubo red" (hay que
// encolar y reintentar).

export class ErrorApi extends Error {
  constructor(status, codigo, mensaje) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
  }
}

/** No hubo respuesta del servidor: se cayo el WiFi o el mini PC. Se reintenta. */
export class ErrorDeRed extends Error {
  constructor(causa) {
    super('No se pudo contactar al servidor');
    this.causa = causa;
  }
}

/**
 * En desarrollo Vite hace proxy de /api al puerto 3000; en produccion el
 * mismo servidor sirve la PWA, asi que la ruta relativa funciona en los dos
 * casos y no hay que configurar la IP en cada tablet.
 */
async function pedir(ruta, opciones = {}) {
  let respuesta;
  try {
    respuesta = await fetch(`/api${ruta}`, {
      headers: opciones.cuerpo ? { 'Content-Type': 'application/json' } : undefined,
      method: opciones.metodo ?? 'GET',
      body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
      signal: opciones.signal,
    });
  } catch (err) {
    // fetch solo rechaza por fallo de red, no por status HTTP de error.
    throw new ErrorDeRed(err);
  }

  const texto = await respuesta.text();
  const datos = texto ? JSON.parse(texto) : null;

  if (!respuesta.ok) {
    throw new ErrorApi(
      respuesta.status,
      datos?.error ?? 'error_desconocido',
      datos?.mensaje ?? `El servidor respondio ${respuesta.status}`
    );
  }
  return datos;
}

export const api = {
  salud: () => pedir('/salud'),
  mesas: () => pedir('/mesas'),
  meseros: () => pedir('/meseros'),
  platillos: () => pedir('/platillos?disponibles=1'),
  comandas: (estado = 'abierta') => pedir(`/comandas?estado=${estado}`),
  comanda: (id) => pedir(`/comandas/${id}`),
  cocinaPendientes: () => pedir('/cocina/pendientes'),

  crearComanda: (cuerpo) => pedir('/comandas', { metodo: 'POST', cuerpo }),
  agregarItems: (comandaId, items) =>
    pedir(`/comandas/${comandaId}/items`, { metodo: 'POST', cuerpo: { items } }),
  cerrarComanda: (comandaId, metodo_pago, client_id) =>
    pedir(`/comandas/${comandaId}/cerrar`, { metodo: 'POST', cuerpo: { metodo_pago, client_id } }),
  cancelarComanda: (comandaId) => pedir(`/comandas/${comandaId}/cancelar`, { metodo: 'POST' }),
  registrarPago: (comandaId, cuerpo) =>
    pedir(`/comandas/${comandaId}/pagos`, { metodo: 'POST', cuerpo }),
  cambiarEstadoItem: (itemId, estado) =>
    pedir(`/items/${itemId}/estado`, { metodo: 'PATCH', cuerpo: { estado } }),

  // --- Reportes (solo lectura) ---
  // Sin fecha, el servidor usa hoy. No pasan por la cola de reintentos: un
  // reporte que no cargo se vuelve a pedir tocando la pantalla, no hay nada
  // que guardar ni riesgo de duplicar.
  corte: (fecha) => pedir(`/reportes/corte${fecha ? `?fecha=${fecha}` : ''}`),
  historial: (fecha) => pedir(`/reportes/historial${fecha ? `?fecha=${fecha}` : ''}`),
  diasConVentas: () => pedir('/reportes/dias'),

  // --- Administracion ---
  adminPlatillos: () => pedir('/admin/platillos'),
  crearPlatillo: (cuerpo) => pedir('/admin/platillos', { metodo: 'POST', cuerpo }),
  actualizarPlatillo: (id, cuerpo) =>
    pedir(`/admin/platillos/${id}`, { metodo: 'PATCH', cuerpo }),
  marcarDisponible: (id, disponible) =>
    pedir(`/admin/platillos/${id}/disponible`, { metodo: 'PATCH', cuerpo: { disponible } }),
  eliminarPlatillo: (id) => pedir(`/admin/platillos/${id}`, { metodo: 'DELETE' }),

  adminMeseros: () => pedir('/admin/meseros'),
  crearMesero: (cuerpo) => pedir('/admin/meseros', { metodo: 'POST', cuerpo }),
  actualizarMesero: (id, cuerpo) => pedir(`/admin/meseros/${id}`, { metodo: 'PATCH', cuerpo }),
  eliminarMesero: (id) => pedir(`/admin/meseros/${id}`, { metodo: 'DELETE' }),
};

/** Ejecuta un envio de la cola segun su tipo. */
export function ejecutarEnvio(envio) {
  switch (envio.tipo) {
    case 'comanda':
      return api.crearComanda(envio.cuerpo);
    case 'items':
      return api.agregarItems(envio.comanda_id, envio.cuerpo.items);
    case 'cerrar':
      return api.cerrarComanda(envio.comanda_id, envio.cuerpo.metodo_pago, envio.client_id);
    // Cancelar no lleva client_id: el servidor ya es idempotente por estado,
    // una cuenta que no esta abierta se devuelve tal cual en vez de fallar.
    case 'cancelar':
      return api.cancelarComanda(envio.comanda_id);
    case 'pago':
      return api.registrarPago(envio.comanda_id, { ...envio.cuerpo, client_id: envio.client_id });
    case 'estado':
      return api.cambiarEstadoItem(envio.item_id, envio.cuerpo.estado);
    default:
      throw new Error(`Tipo de envio desconocido: ${envio.tipo}`);
  }
}
