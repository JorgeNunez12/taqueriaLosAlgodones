// Maquina de estados del flujo de cocina.
// Se valida en el servidor y no solo en la UI: dos tablets pueden mandar el
// mismo cambio al mismo tiempo, o llegar un reenvio viejo despues de una
// reconexion, y no queremos que un plato ya entregado regrese a "preparando".

export const TRANSICIONES_ITEM = {
  recibido:  ['preparando', 'cancelado'],
  preparando: ['listo', 'cancelado'],
  listo:     ['entregado', 'preparando'], // "preparando" = se enfrio, rehacer
  entregado: [],
  cancelado: [],
};

export const ESTADOS_ITEM = Object.keys(TRANSICIONES_ITEM);

export function puedeTransicionar(desde, hacia) {
  return (TRANSICIONES_ITEM[desde] ?? []).includes(hacia);
}

/**
 * Devuelve null si el cambio es valido, o un objeto con el motivo del rechazo.
 * `idempotente: true` significa "ya estaba en ese estado": no es un error,
 * el cliente puede tratarlo como exito.
 */
export function validarTransicion(desde, hacia) {
  if (!ESTADOS_ITEM.includes(hacia)) {
    return { codigo: 'estado_invalido', mensaje: `Estado desconocido: ${hacia}` };
  }
  if (desde === hacia) {
    return { codigo: 'sin_cambio', mensaje: `Ya estaba en ${hacia}`, idempotente: true };
  }
  if (!puedeTransicionar(desde, hacia)) {
    return {
      codigo: 'transicion_invalida',
      mensaje: `No se puede pasar de "${desde}" a "${hacia}"`,
    };
  }
  return null;
}
