// Piezas que usan las tres pantallas.

import { useEffect, useState } from 'react';
import { CARNES } from '../carnes.js';

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
 * Pregunta cual carne lleva una planchada o una pellizcada.
 *
 * Sale sola al tocar el platillo, antes de que caiga al carrito: preguntarlo
 * despues significaria que la mesera puede mandar el pedido sin contestar, y
 * cocina se quedaria otra vez sin saber que carne poner.
 *
 * Un solo toque agrega y cierra. No hay boton de "guardar" porque seria un
 * segundo toque para la decision mas repetida del turno; para arrepentirse
 * esta Cancelar, y la carne se puede corregir despues desde la nota.
 */
export function ElegirCarne({ nombre, alElegir, alCerrar }) {
  return (
    <Modal titulo={`${nombre} — ¿de qué carne?`} alCerrar={alCerrar}>
      <div className="rejilla-carnes">
        {CARNES.map((carne) => (
          <button key={carne} className="boton" onClick={() => alElegir(carne)}>
            {carne}
          </button>
        ))}
      </div>
      <div className="acciones">
        <button className="boton" onClick={alCerrar}>
          Cancelar
        </button>
      </div>
    </Modal>
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
