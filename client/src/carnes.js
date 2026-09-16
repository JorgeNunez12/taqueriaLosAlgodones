// Que platillos se piden por carne, y cuales carnes hay.
//
// Planchada y pellizcada cuestan $100 sea cual sea la carne, por eso en el menu
// son un solo boton en vez de uno por carne (ver seed.js). Pero cocina SI
// necesita saber cual lleva, y antes eso dependia de que la mesera se acordara
// de escribirlo en la nota: si se le pasaba, cocina tenia que ir a preguntar
// con el pedido detenido.
//
// Aqui la carne se pregunta sola al tocar el platillo y se guarda en la nota,
// elegida de una lista en vez de escrita a mano. Que sea de una lista es lo que
// hace que cocina lea siempre "Buche" y no "buche"/"Buchee"/"b".

/** Las mismas seis carnes que se venden en tacos. */
export const CARNES = [
  'Panza',
  'Tripa de puerco',
  'Buche',
  'Carnitas',
  'Revuelto',
  'Tripa',
];

/**
 * True si a este platillo hay que preguntarle la carne.
 *
 * Se decide por el nombre y no por un id fijo porque el encargado puede borrar
 * y volver a crear un platillo desde su tablet, y el id cambiaria. Tolera
 * mayusculas y acentos para que "Pellizcada", "pellizcada" y "PELLIZCADA"
 * cuenten igual, que es como los nombres terminan escribiendose en la practica.
 */
export function pideCarne(nombre) {
  const limpio = String(nombre ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return limpio.includes('planchada') || limpio.includes('pellizcada');
}

/**
 * Mete la carne al principio de la nota, conservando lo que ya hubiera.
 * "Buche" + "sin cebolla" -> "Buche, sin cebolla".
 */
export function notaConCarne(carne, notaPrevia) {
  const resto = (notaPrevia ?? '').trim();
  if (!carne) return resto;
  return resto ? `${carne}, ${resto}` : carne;
}
