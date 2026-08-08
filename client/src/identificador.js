// Genera los client_id (UUID) que hacen seguro reenviar un pedido o un cobro
// despues de una caida de red. Es la pieza de la que depende no duplicar
// dinero, asi que vive en un solo lugar y no copiada en cada pantalla.
//
// Por que no basta `crypto.randomUUID()`:
//
// Solo existe en "contextos seguros": HTTPS o localhost. Las tablets entran por
// la IP del mini PC (http://192.168.1.x), que el navegador considera inseguro,
// asi que ahi la funcion NO existe y la llamada truena. En la maquina donde
// corre el servidor no se nota, porque se abre por localhost.
//
// El sintoma era feo justo por eso: "Abrir cuenta" se quedaba en "Abriendo…"
// para siempre y solo en las tablets, mientras que en la computadora del local
// funcionaba bien.
//
// La red es local y cerrada, sin internet: no hay forma de servir HTTPS con un
// certificado valido sin montar una autoridad propia e instalarla en cada
// tablet. Por eso la solucion es no depender de esa funcion.

/**
 * UUID v4. Usa la mejor fuente disponible, en orden:
 *
 *   1. crypto.randomUUID   — contexto seguro (localhost, o HTTPS si algun dia).
 *   2. crypto.getRandomValues — existe por HTTP simple en todos los navegadores
 *      que nos importan (Safari de iPad, Chrome de Android). Aleatoriedad
 *      criptografica de verdad, solo que armando el UUID a mano.
 *   3. Math.random         — ultimo recurso, para no dejar la app inservible en
 *      un navegador raro. Es peor aleatoriedad, pero un choque entre dos UUID
 *      sigue siendo practicamente imposible con los pocos ids que genera una
 *      taqueria en un dia.
 */
export function nuevoId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    // Los bits que marcan "version 4" y "variante RFC 4122".
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
