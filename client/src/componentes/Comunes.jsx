// Piezas que usan las tres pantallas.

import { useEffect, useState } from 'react';

/** Punto verde/rojo + cuantos envios esperan salir. */
export function EstadoRed({ conectado, pendientes }) {
  return (
    <div className="estado-red">
      <span className={conectado ? 'punto' : 'punto caido'} />
      <span>{conectado ? 'En línea' : 'Sin conexión'}</span>
      {pendientes > 0 && <span>· {pendientes} por enviar</span>}
    </div>
  );
}

/**
 * Franja de "sin conexion". Ocupa ancho completo a proposito: la mesera tiene
 * que ver que esta desconectada sin ir a buscarlo, porque cambia lo que puede
 * prometerle al cliente.
 */
export function FranjaOffline({ pendientes }) {
  return (
    <div className="franja-offline">
      Sin conexión con el servidor
      <small>
        {pendientes > 0
          ? `${pendientes} ${pendientes === 1 ? 'envío pendiente' : 'envíos pendientes'} · se mandan solos al volver la señal`
          : 'Lo que captures se guarda y se manda al volver la señal'}
      </small>
    </div>
  );
}

/** Avisos flotantes. Los de "listo" se van solos; los errores no. */
export function Avisos({ avisos, alDescartar }) {
  useEffect(() => {
    const temporizadores = avisos
      .filter((a) => a.tipo !== 'error')
      .map((a) => setTimeout(() => alDescartar(a.id), 6000));
    return () => temporizadores.forEach(clearTimeout);
  }, [avisos, alDescartar]);

  if (avisos.length === 0) return null;

  return (
    <div className="avisos">
      {avisos.slice(-3).map((aviso) => (
        <div key={aviso.id} className={aviso.tipo === 'error' ? 'aviso error' : 'aviso'}>
          <span>{aviso.texto}</span>
          <button className="cerrar" onClick={() => alDescartar(aviso.id)} aria-label="Cerrar">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function Insignia({ estado }) {
  const nombres = {
    recibido: 'En cola',
    preparando: 'Haciéndose',
    listo: 'Listo',
    entregado: 'Entregado',
    cancelado: 'Cancelado',
    // No es un estado del platillo sino del cobro; la caja lo usa para marcar
    // lo que ya cubrio un pago anterior de la misma cuenta.
    pagado: 'Pagado',
  };
  return <span className={`insignia ${estado}`}>{nombres[estado] ?? estado}</span>;
}

export function Modal({ titulo, children, alCerrar }) {
  return (
    <div className="velo" onClick={alCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{titulo}</h2>
        {children}
      </div>
    </div>
  );
}

/**
 * Minutos transcurridos desde una fecha de SQLite ('YYYY-MM-DD HH:MM:SS' en
 * hora local). Se refresca solo cada 20s para que el color de urgencia en
 * cocina avance sin que nadie toque la pantalla.
 */
export function usarMinutosDesde(fechaLocal) {
  const calcular = () => {
    if (!fechaLocal) return 0;
    // El servidor guarda hora local sin zona; 'T' lo hace parseable y JS lo
    // interpreta como local, que es justo lo que queremos.
    const desde = new Date(String(fechaLocal).replace(' ', 'T'));
    if (Number.isNaN(desde.getTime())) return 0;
    return Math.max(0, Math.floor((Date.now() - desde.getTime()) / 60000));
  };

  const [minutos, setMinutos] = useState(calcular);

  useEffect(() => {
    setMinutos(calcular());
    const intervalo = setInterval(() => setMinutos(calcular()), 20000);
    return () => clearInterval(intervalo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fechaLocal]);

  return minutos;
}
