// Pantalla de cocina: la cola de lo que falta hacer.
//
// Se mira de reojo desde la plancha, a un metro de distancia y con las manos
// ocupadas. De ahi que sea una rejilla de tarjetas grandes ordenada por
// antiguedad, con el tiempo de espera pintado en el borde: lo que lleva mas
// de 10 minutos se pone rojo solo, sin que nadie lea un reloj.

import { usarMinutosDesde } from '../componentes/Comunes.jsx';

export function Cocina({ cocina, enviar }) {
  if (cocina.length === 0) {
    return <div className="vacio">Todo al corriente. No hay pedidos en cola.</div>;
  }

  return (
    <div className="rejilla-cocina">
      {cocina.map((grupo) => (
        <TarjetaComanda key={grupo.comanda_id} grupo={grupo} enviar={enviar} />
      ))}
    </div>
  );
}

function TarjetaComanda({ grupo, enviar }) {
  const minutos = usarMinutosDesde(grupo.desde);
  const urgencia = minutos >= 10 ? 'espera-larga' : minutos >= 5 ? 'espera-media' : '';

  return (
    <div className={`comanda-cocina ${urgencia}`}>
      <div className="cabeza">
        <span className="mesa-num">Mesa {grupo.mesa_numero}</span>
        {grupo.etiqueta && (
          <span style={{ color: 'var(--texto-tenue)', fontSize: 14 }}>{grupo.etiqueta}</span>
        )}
        <span className="minutos">{minutos} min</span>
      </div>

      {grupo.items.map((item) => (
        <ItemCocina key={item.id} item={item} enviar={enviar} />
      ))}
    </div>
  );
}

function ItemCocina({ item, enviar }) {
  // Un solo boton por item, con la accion que toca segun el estado. Elegir
  // entre varios botones cuesta atencion que en la plancha no sobra.
  const siguiente = item.estado === 'recibido' ? 'preparando' : 'listo';
  const etiqueta = item.estado === 'recibido' ? 'Empezar' : 'Listo';

  return (
    <div className="item-cocina">
      <span className="cant">{item.cantidad}×</span>
      <div className="info" style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{item.nombre_snapshot}</div>
        {item.notas && <div className="notas">{item.notas}</div>}
      </div>
      <button
        className={item.estado === 'recibido' ? 'boton chico' : 'boton chico verde'}
        onClick={() => enviar({ tipo: 'estado', item_id: item.id, cuerpo: { estado: siguiente } })}
      >
        {etiqueta}
      </button>
    </div>
  );
}
