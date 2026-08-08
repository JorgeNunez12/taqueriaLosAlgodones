// Espejo de server/src/dinero.js para lo que la UI necesita.
//
// Se duplica a proposito: el cliente y el servidor son dos paquetes que se
// instalan por separado, y montar un workspace compartido para tres funciones
// de aritmetica costaria mas de lo que ahorra. Lo que NO se duplica es la
// autoridad: el total que se cobra es siempre el que manda el servidor
// (total_centavos). Estas funciones son para pintar, no para decidir.

/** 1850 -> "$18.50". Entero adentro, texto afuera; nunca floats. */
export function formatoMoneda(centavos) {
  const n = Number(centavos) || 0;
  const signo = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${signo}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Subtotal de una linea del carrito, en centavos. */
export function subtotalItem(item) {
  return (item.precio_unitario_centavos ?? item.precio_centavos ?? 0) * item.cantidad;
}

/** Total de un carrito local (todavia no mandado a cocina), en centavos. */
export function totalCarrito(items) {
  return items.reduce((suma, item) => suma + subtotalItem(item), 0);
}

/**
 * Reparte un saldo en N partes iguales, en centavos enteros.
 *
 * Los centavos que no se pueden repartir parejo se le cargan a la PRIMERA
 * parte, no se distribuyen ni se tiran. $191 entre 3 son 63.66, 63.67 y 63.67
 * pero al reves: 63.68, 63.66, 63.66. Lo que importa es que la suma de las
 * partes de exactamente el saldo; si cada parte se redondeara por su cuenta, la
 * caja terminaria el dia con dos o tres pesos de diferencia y nadie sabria de
 * donde salieron.
 */
export function repartirEnPartes(saldoCentavos, partes) {
  const n = Math.max(1, Math.floor(partes));
  const base = Math.floor(saldoCentavos / n);
  const sobrante = saldoCentavos - base * n;
  return Array.from({ length: n }, (_, i) => (i === 0 ? base + sobrante : base));
}
