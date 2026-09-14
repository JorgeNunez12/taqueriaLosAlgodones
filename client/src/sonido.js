// Avisos sonoros de los puestos.
//
// Se generan con Web Audio en vez de reproducir archivos: no hay nada que
// descargar (el local trabaja sin internet), no pesan, y cada aviso puede tener
// su propio tono para distinguirse sin mirar la pantalla, que es justo el punto
// cuando se trae la charola en las manos o se esta frente a la plancha.
//
// Los tres suben de tono segun lo que piden del que escucha:
//   preparando -> un toque grave, "ya va". No hay que hacer nada.
//   pedido     -> dos toques medios para el cocinero: entro trabajo.
//   listo      -> tres toques agudos: hay que ir a recogerlo YA.

const LLAVE_SILENCIO = 'taqueria:silencio';

// Alto a proposito: esto compite con la plancha, la musica y la gente. Es lo
// mas que se puede subir sin que la bocina de una tablet empiece a distorsionar.
const VOLUMEN = 0.5;

/** Cada aviso: notas (Hz), cuanto dura cada una y el hueco entre ellas. */
const AVISOS = {
  preparando: { notas: [440], duracion: 0.12, hueco: 0 },
  pedido: { notas: [660, 880], duracion: 0.13, hueco: 0.11 },
  listo: { notas: [880, 1100, 1320], duracion: 0.12, hueco: 0.1 },
};

let contexto = null;

function obtenerContexto() {
  if (!contexto) {
    const Audio = window.AudioContext ?? window.webkitAudioContext;
    if (!Audio) return null;
    contexto = new Audio();
  }
  if (contexto.state === 'suspended') contexto.resume().catch(() => {});
  return contexto;
}

/**
 * Destraba el audio con el primer toque en la pantalla.
 *
 * En iPad (y en Safari en general) un AudioContext solo se puede desbloquear
 * DENTRO del gesto del usuario. Nuestros avisos nacen de eventos del socket,
 * que no son gestos: si el contexto se creara ahi, `resume()` quedaria
 * pendiente para siempre y la tablet nunca sonaria. Por eso se prepara antes,
 * aprovechando el primer toque que de el puesto en cualquier parte.
 *
 * El tono mudo es el truco que exige iOS: no basta con crear el contexto, hay
 * que reproducir algo real dentro del gesto para que quede habilitado.
 *
 * Se escucha en captura y sin `once` propio: el listener se quita solo cuando
 * el contexto queda corriendo, no con el primer toque a secas, porque un toque
 * puede llegar antes de que el navegador este listo para desbloquearlo.
 */
function preparar() {
  const ctx = obtenerContexto();
  if (!ctx) return;

  try {
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();
    vol.gain.value = 0;
    osc.connect(vol).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.01);
  } catch {
    // Si el navegador no deja ni esto, el toque siguiente lo vuelve a intentar.
  }

  if (ctx.state === 'running') {
    for (const evento of ['pointerdown', 'touchstart', 'keydown']) {
      window.removeEventListener(evento, preparar, true);
    }
  }
}

if (typeof window !== 'undefined') {
  for (const evento of ['pointerdown', 'touchstart', 'keydown']) {
    window.addEventListener(evento, preparar, true);
  }
}

export function estaSilenciado() {
  try {
    return localStorage.getItem(LLAVE_SILENCIO) === '1';
  } catch {
    // Modo privado o almacenamiento bloqueado: se asume con sonido, que es lo
    // util en el local. Nunca debe tronar por esto.
    return false;
  }
}

export function silenciar(valor) {
  try {
    localStorage.setItem(LLAVE_SILENCIO, valor ? '1' : '0');
  } catch {
    // Si no se puede recordar, al menos vale para esta sesion.
  }
}

/**
 * Suena un aviso. Nunca lanza: un fallo de audio no puede tumbar la pantalla
 * que el puesto necesita para trabajar.
 */
export function sonar(tipo) {
  if (estaSilenciado()) return;
  const aviso = AVISOS[tipo];
  if (!aviso) return;

  try {
    const ctx = obtenerContexto();
    if (!ctx) return;

    aviso.notas.forEach((hz, i) => {
      const desde = ctx.currentTime + i * (aviso.duracion + aviso.hueco);
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();

      // Onda triangular: se oye clara sobre el ruido del local sin el filo
      // molesto de la cuadrada, que cansa cuando suena decenas de veces.
      osc.type = 'triangle';
      osc.frequency.value = hz;

      // Subida y bajada suaves. Un corte seco produce un chasquido que en una
      // bocina de tablet se oye como falla.
      vol.gain.setValueAtTime(0, desde);
      vol.gain.linearRampToValueAtTime(VOLUMEN, desde + 0.012);
      vol.gain.setValueAtTime(VOLUMEN, desde + aviso.duracion - 0.03);
      vol.gain.linearRampToValueAtTime(0, desde + aviso.duracion);

      osc.connect(vol).connect(ctx.destination);
      osc.start(desde);
      osc.stop(desde + aviso.duracion + 0.02);
    });
  } catch {
    // Sin audio se sigue trabajando: el aviso visual ya esta en pantalla.
  }
}
