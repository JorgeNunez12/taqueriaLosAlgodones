// Cascaron: elige rol, inicia sesion el mesero, monta la pantalla que toca y
// pinta las señales de red. Una sola build para las tres tablets; el rol y la
// sesion se guardan en localStorage para que cada tablet abra directo en lo
// suyo y el mesero no tenga que identificarse en cada cuenta.

import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { usarTaqueria } from './usarTaqueria.js';
import { Avisos, EstadoRed, FranjaOffline } from './componentes/Comunes.jsx';
import { estaSilenciado, silenciar, sonar } from './sonido.js';
import { Mesera } from './pantallas/Mesera.jsx';
import { Cocina } from './pantallas/Cocina.jsx';
import { Caja } from './pantallas/Caja.jsx';
import { Reportes } from './pantallas/Reportes.jsx';
import { Admin } from './pantallas/Admin.jsx';

const LLAVE_ROL = 'taqueria:rol';
const LLAVE_SESION = 'taqueria:mesero';
const LLAVE_MESEROS = 'taqueria:meseros';

// El rol define para que sirve esta tablet. Los tres primeros son los puestos
// de piso; `admin` es la tablet del encargado y no participa del tiempo real.
const ROLES = [
  ['mesera', 'Meseros', 'Tomar pedidos en las mesas'],
  ['cocina', 'Cocina', 'Ver y despachar la comanda'],
  ['caja', 'Caja', 'Cobrar las cuentas'],
  ['admin', 'Encargado', 'Corte del día, menú y personal'],
];

export function App() {
  const [rol, setRol] = useState(() => localStorage.getItem(LLAVE_ROL));
  const [mesero, setMesero] = useState(() => {
    const guardado = localStorage.getItem(LLAVE_SESION);
    return guardado ? JSON.parse(guardado) : null;
  });

  const elegirRol = useCallback((nuevo) => {
    localStorage.setItem(LLAVE_ROL, nuevo);
    setRol(nuevo);
  }, []);

  const iniciarSesion = useCallback((quien) => {
    localStorage.setItem(LLAVE_SESION, JSON.stringify(quien));
    setMesero(quien);
  }, []);

  const cerrarSesion = useCallback(() => {
    localStorage.removeItem(LLAVE_SESION);
    setMesero(null);
  }, []);

  // Una sesion abierta puede quedar apuntando a alguien que ya se dio de baja
  // (o que se renombro). Se revisa contra el servidor al arrancar: si ese
  // mesero ya no esta activo, la sesion se cierra y la tablet vuelve a pedir
  // quien atiende. Sin esto seguiria abriendo cuentas a nombre de alguien que
  // ya no trabaja aqui, y el servidor las rechazaria.
  // Depende del id y no del objeto `mesero`: el efecto se corre una vez por
  // sesion, no cada vez que se refresca el nombre.
  const meseroId = mesero?.id ?? null;
  useEffect(() => {
    if (rol !== 'mesera' || meseroId == null) return;
    let vivo = true;
    api
      .meseros()
      .then((lista) => {
        if (!vivo) return;
        const sigue = lista.find((m) => m.id === meseroId);
        if (!sigue) {
          cerrarSesion();
          return;
        }
        // Si le cambiaron el nombre, se refresca sin sacarlo de su turno.
        localStorage.setItem(LLAVE_SESION, JSON.stringify(sigue));
        setMesero(sigue);
      })
      // Sin servidor no se puede confirmar nada; se respeta la sesion actual en
      // vez de dejar a la mesera afuera por una caida de WiFi.
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [rol, meseroId, cerrarSesion]);

  if (!rol) return <ElegirRol alElegir={elegirRol} />;

  // El encargado no toma pedidos: su tablet no necesita el estado en vivo del
  // local, solo consultar y configurar.
  if (rol === 'admin') return <PantallaAdmin alCambiarRol={() => setRol(null)} />;

  // Solo la tablet de meseros necesita saber quien la trae: cocina y caja son
  // puestos fijos, y pedirles identificarse cada turno seria un estorbo.
  if (rol === 'mesera' && !mesero) {
    return <IniciarSesion alEntrar={iniciarSesion} alCambiarRol={() => setRol(null)} />;
  }

  return (
    <Pantalla
      rol={rol}
      mesero={mesero}
      alCambiarRol={() => setRol(null)}
      alCerrarSesion={cerrarSesion}
    />
  );
}

function ElegirRol({ alElegir }) {
  return (
    <div className="pantalla-inicio">
      <img src="/logo.png" alt="Tacos Los Algodones" className="logo-inicio" />
      <h1>Tacos Los Algodones</h1>
      <p>¿Para qué se va a usar esta tablet?</p>
      <div className="opciones">
        {ROLES.map(([valor, nombre, descripcion]) => (
          <button key={valor} className="boton opcion-rol" onClick={() => alElegir(valor)}>
            <span className="nombre-rol">{nombre}</span>
            <span className="descripcion-rol">{descripcion}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Inicio de sesion del mesero: toca su nombre y queda registrado en esta tablet
 * hasta que le den "Salir". A partir de ahi cada cuenta que abra sale a su
 * nombre sin que tenga que escribirlo.
 *
 * La lista guardada en localStorage es un respaldo, NO la fuente: mientras el
 * servidor no conteste se muestra "Cargando…", y la copia vieja solo aparece si
 * de plano no hubo respuesta, avisando que puede estar desactualizada. Pintarla
 * de inmediato hacia que al dar de alta o de baja a alguien la tablet siguiera
 * enseñando los nombres de antes sin ninguna señal de que estaban viejos.
 */
function IniciarSesion({ alEntrar, alCambiarRol }) {
  const [meseros, setMeseros] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [desdeCache, setDesdeCache] = useState(false);

  useEffect(() => {
    let vivo = true;
    api
      .meseros()
      .then((lista) => {
        if (!vivo) return;
        setMeseros(lista);
        setDesdeCache(false);
        localStorage.setItem(LLAVE_MESEROS, JSON.stringify(lista));
      })
      .catch(() => {
        // Sin servidor: se recurre a la ultima lista conocida para que alguien
        // que llega a trabajar mientras el mini PC se reinicia pueda entrar.
        if (!vivo) return;
        const cache = localStorage.getItem(LLAVE_MESEROS);
        if (cache) {
          setMeseros(JSON.parse(cache));
          setDesdeCache(true);
        }
      })
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, []);

  return (
    <div className="pantalla-inicio">
      <img src="/logo.png" alt="Tacos Los Algodones" className="logo-inicio chico" />
      <h1>¿Quién va a atender?</h1>
      <p>Toca tu nombre para empezar el turno.</p>

      {cargando ? (
        <div className="vacio">Cargando…</div>
      ) : meseros.length === 0 ? (
        <div className="vacio">
          No se pudo cargar la lista. Revisa que el servidor esté prendido.
        </div>
      ) : (
        <>
          {desdeCache && (
            <p className="error-texto" style={{ maxWidth: 420 }}>
              Sin conexión con el servidor. Esta lista puede estar desactualizada.
            </p>
          )}
          <div className="rejilla-meseros">
            {meseros.map((m) => (
              <button key={m.id} className="boton" onClick={() => alEntrar(m)}>
                {m.nombre}
              </button>
            ))}
          </div>
        </>
      )}

      <button className="boton chico" style={{ marginTop: 24 }} onClick={alCambiarRol}>
        Cambiar el uso de esta tablet
      </button>
    </div>
  );
}

const TITULOS = {
  mesera: 'Mesas',
  cocina: 'Cocina',
  caja: 'Caja',
  admin: 'Encargado',
};

/**
 * Apagador del sonido, por tablet. La preferencia se guarda en el dispositivo:
 * la caja puede quererlo callado por estar junto al cliente mientras cocina lo
 * necesita a todo volumen, y son la misma build.
 *
 * Al prenderlo suena el aviso de prueba: es un boton cuyo efecto no se ve, y
 * sin esa confirmacion nadie sabe si quedo funcionando hasta que se pierde un
 * pedido.
 */
function BotonSonido() {
  const [callado, setCallado] = useState(estaSilenciado);

  const alternar = () => {
    const nuevo = !callado;
    silenciar(nuevo);
    setCallado(nuevo);
    if (!nuevo) sonar('listo');
  };

  return (
    <button
      className="boton chico"
      onClick={alternar}
      aria-pressed={callado}
      title={callado ? 'Prender el sonido de los avisos' : 'Silenciar los avisos'}
    >
      {callado ? '🔇' : '🔔'}
    </button>
  );
}

/** Barra superior, igual para todas las pantallas. */
function Barra({ rol, mesero, conectado, pendientes, alCambiarRol, alCerrarSesion, tiempoReal }) {
  return (
    <div className="barra">
      <img src="/logo.png" alt="" className="logo-barra" />
      <h1>{TITULOS[rol]}</h1>
      <span className="relleno" />
      {/* La tablet del encargado no vive del tiempo real: pintarle un punto de
          conexion sugeriria que hay pedidos llegando aqui, y no los hay. */}
      {tiempoReal && <BotonSonido />}
      {tiempoReal && <EstadoRed conectado={conectado} pendientes={pendientes} />}
      {mesero ? (
        <>
          <span className="sesion">
            <strong>{mesero.nombre}</strong>
          </span>
          <button className="boton chico" onClick={alCerrarSesion}>
            Salir
          </button>
        </>
      ) : (
        <button className="boton chico" onClick={alCambiarRol}>
          Cambiar
        </button>
      )}
    </div>
  );
}

/**
 * Pantalla del encargado. Va aparte de `Pantalla` a proposito: no se suscribe a
 * `usarTaqueria`, porque no necesita el estado vivo del local. Un corte de caja
 * que se mueve solo mientras se esta cuadrando es peor que uno quieto, y un
 * socket abierto de mas es una tablet que recibe eventos que no va a pintar.
 */
function PantallaAdmin({ alCambiarRol }) {
  const [vista, setVista] = useState('reportes');

  return (
    <div className="app">
      <Barra rol="admin" alCambiarRol={alCambiarRol} tiempoReal={false} />
      <div className="pestanas-principales">
        <button
          className={vista === 'reportes' ? 'activa' : ''}
          onClick={() => setVista('reportes')}
        >
          Corte del día
        </button>
        <button className={vista === 'admin' ? 'activa' : ''} onClick={() => setVista('admin')}>
          Menú y personal
        </button>
      </div>
      <div className="contenido">{vista === 'reportes' ? <Reportes /> : <Admin />}</div>
    </div>
  );
}

function Pantalla({ rol, mesero, alCambiarRol, alCerrarSesion }) {
  const {
    conectado,
    sincronizado,
    mesas,
    comandas,
    cocina,
    pendientes,
    avisos,
    enviar,
    descartarAviso,
  } = usarTaqueria(rol, mesero?.id ?? null);

  const cuerpo =
    rol === 'mesera' ? (
      <Mesera
        mesas={mesas}
        comandas={comandas}
        enviar={enviar}
        conectado={conectado}
        sincronizado={sincronizado}
        mesero={mesero}
      />
    ) : rol === 'cocina' ? (
      <Cocina cocina={cocina} enviar={enviar} />
    ) : (
      <Caja comandas={comandas} enviar={enviar} />
    );

  return (
    <div className="app">
      <Barra
        rol={rol}
        mesero={mesero}
        conectado={conectado}
        pendientes={pendientes}
        alCambiarRol={alCambiarRol}
        alCerrarSesion={alCerrarSesion}
        tiempoReal
      />

      {!conectado && <FranjaOffline pendientes={pendientes} />}

      {conectado && !sincronizado ? (
        <div className="vacio">Cargando…</div>
      ) : rol === 'mesera' ? (
        // Mesera monta su propio contenedor: en captura necesita .contenido con
        // scroll MAS un .pie fijo con el total, y envolverla en un .contenido
        // extra dejaria el pie flotando dentro del area que hace scroll.
        cuerpo
      ) : (
        <div className="contenido">{cuerpo}</div>
      )}

      <Avisos avisos={avisos} alDescartar={descartarAviso} />
    </div>
  );
}
