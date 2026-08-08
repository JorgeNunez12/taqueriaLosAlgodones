// Todo el dinero del sistema vive en centavos enteros.
// Este modulo es la unica frontera donde se convierte a pesos, y no toca
// la base de datos: es logica pura, facil de probar.

/** "18.50" o 18.5 -> 1850 centavos. Rechaza basura en vez de devolver NaN. */
export function pesosACentavos(pesos) {
  if (typeof pesos === 'string') pesos = pesos.trim().replace(/[$,\s]/g, '');
  const n = Number(pesos);
  if (!Number.isFinite(n)) throw new Error(`Monto invalido: ${pesos}`);
  if (n < 0) throw new Error(`El monto no puede ser negativo: ${pesos}`);
  // El toFixed(4) intermedio limpia el error de representacion ANTES de
  // redondear. Sin el, Math.round(1.005 * 100) da 100 y no 101, porque
  // 1.005 * 100 en punto flotante es 100.49999999999999.
  return Math.round(Number((n * 100).toFixed(4)));
}

/** 1850 -> 18.5 (numero, para JSON). */
export function centavosAPesos(centavos) {
  return centavos / 100;
}

/** 1850 -> "$18.50" (texto, para imprimir tickets). */
export function formatoMoneda(centavos) {
  const signo = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  return `${signo}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Subtotal de una linea del pedido. */
export function subtotalItem(item) {
  return item.precio_unitario_centavos * item.cantidad;
}

/**
 * Total de una comanda. Los items cancelados no se cobran; el resto si,
 * incluyendo los que todavia estan en la cocina (el cliente ya los pidio).
 */
export function totalComanda(items) {
  return items.reduce(
    (suma, item) => (item.estado === 'cancelado' ? suma : suma + subtotalItem(item)),
    0
  );
}
