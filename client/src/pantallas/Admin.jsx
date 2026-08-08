// Administracion del menu y del personal.
//
// Lo que antes obligaba a editar seed.js y reiniciar el servidor. El caso que
// manda el diseño de esta pantalla es "se acabo el bistec" a media hora pico:
// por eso lo primero de cada renglon del menu es el boton de agotar/reactivar,
// grande y de un solo toque, y todo lo demas (precio, nombre, categoria) esta un
// paso mas adentro.

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Modal } from '../componentes/Comunes.jsx';
import { formatoMoneda } from '../dinero.js';

export function Admin() {
  const [vista, setVista] = useState('menu');

  return (
    <>
      <div className="pestanas">
        <button
          className={vista === 'menu' ? 'boton activa' : 'boton'}
          onClick={() => setVista('menu')}
        >
          Menú
        </button>
        <button
          className={vista === 'personal' ? 'boton activa' : 'boton'}
          onClick={() => setVista('personal')}
        >
          Personal
        </button>
      </div>

      {vista === 'menu' ? <MenuAdmin /> : <PersonalAdmin />}
    </>
  );
}

// --- Menu ---

function MenuAdmin() {
  const [platillos, setPlatillos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [editando, setEditando] = useState(null); // objeto, o 'nuevo'

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setPlatillos(await api.adminPlatillos());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  /**
   * Agotar / reactivar. Se pinta el cambio de inmediato y se revierte si el
   * servidor dice que no: con el cliente enfrente esperando, un boton que tarda
   * medio segundo en responder se toca dos veces.
   */
  async function alternarDisponible(platillo) {
    const nuevo = platillo.disponible === 1 ? 0 : 1;
    setPlatillos((previos) =>
      previos.map((p) => (p.id === platillo.id ? { ...p, disponible: nuevo } : p))
    );
    try {
      await api.marcarDisponible(platillo.id, nuevo === 1);
      setError(null);
    } catch (err) {
      setPlatillos((previos) =>
        previos.map((p) => (p.id === platillo.id ? { ...p, disponible: platillo.disponible } : p))
      );
      setError(err.message);
    }
  }

  if (cargando && platillos.length === 0) return <div className="vacio">Cargando el menú…</div>;

  // Agrupado por categoria, en el mismo orden en que lo ve la mesera.
  const categorias = [...new Set(platillos.map((p) => p.categoria))];
  const agotados = platillos.filter((p) => p.disponible !== 1).length;

  return (
    <>
      {error && <p className="error-texto">{error}</p>}

      <div className="barra-reportes">
        <div style={{ flex: 1 }}>
          <strong>{platillos.length} platillos</strong>
          {agotados > 0 && (
            <span style={{ color: 'var(--rojo)', fontWeight: 600 }}> · {agotados} agotados</span>
          )}
        </div>
        <button className="boton primario" onClick={() => setEditando('nuevo')}>
          + Agregar platillo
        </button>
      </div>

      {categorias.map((categoria) => (
        <section key={categoria} className="seccion-reporte">
          <h2>{categoria}</h2>
          {platillos
            .filter((p) => p.categoria === categoria)
            .map((platillo) => (
              <div
                key={platillo.id}
                className={`fila-menu${platillo.disponible !== 1 ? ' agotado' : ''}`}
              >
                {/* Lo mas usado y con mas prisa: un solo toque, area grande. */}
                <button
                  className={platillo.disponible === 1 ? 'boton chico' : 'boton chico rojo'}
                  style={{ minWidth: 116 }}
                  onClick={() => alternarDisponible(platillo)}
                >
                  {platillo.disponible === 1 ? 'Hay' : 'Se acabó'}
                </button>

                <button className="info-menu" onClick={() => setEditando(platillo)}>
                  <span className="nombre">{platillo.nombre}</span>
                  <span className="detalle">Tocar para editar</span>
                </button>

                <span className="monto">{formatoMoneda(platillo.precio_centavos)}</span>
              </div>
            ))}
        </section>
      ))}

      {editando && (
        <EditorPlatillo
          platillo={editando === 'nuevo' ? null : editando}
          categorias={categorias}
          alCerrar={() => setEditando(null)}
          alGuardar={() => {
            setEditando(null);
            cargar();
          }}
        />
      )}
    </>
  );
}

function EditorPlatillo({ platillo, categorias, alCerrar, alGuardar }) {
  const [nombre, setNombre] = useState(platillo?.nombre ?? '');
  const [precio, setPrecio] = useState(
    platillo ? (platillo.precio_centavos / 100).toFixed(2) : ''
  );
  const [categoria, setCategoria] = useState(platillo?.categoria ?? categorias[0] ?? '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      // Se manda `precio` en pesos y el servidor lo convierte a centavos: la
      // conversion vive en un solo lado (dinero.js del servidor), no en cada
      // pantalla que capture dinero.
      const cuerpo = { nombre, precio, categoria };
      if (platillo) await api.actualizarPlatillo(platillo.id, cuerpo);
      else await api.crearPlatillo(cuerpo);
      alGuardar();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar() {
    setGuardando(true);
    setError(null);
    try {
      await api.eliminarPlatillo(platillo.id);
      alGuardar();
    } catch (err) {
      // Tipicamente "ya se pidio N veces": el servidor explica que hay que
      // marcarlo como agotado en vez de borrarlo.
      setError(err.message);
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={platillo ? 'Editar platillo' : 'Nuevo platillo'} alCerrar={alCerrar}>
      {error && <p className="error-texto">{error}</p>}

      <div className="campo">
        <label htmlFor="nombre-platillo">Nombre</label>
        <input
          id="nombre-platillo"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Taco de pastor"
        />
      </div>

      <div className="campo">
        <label htmlFor="precio-platillo">Precio</label>
        <input
          id="precio-platillo"
          inputMode="decimal"
          value={precio}
          onChange={(e) => setPrecio(e.target.value)}
          placeholder="18.50"
        />
      </div>

      <div className="campo">
        <label htmlFor="categoria-platillo">Categoría</label>
        <input
          id="categoria-platillo"
          list="categorias-existentes"
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
          placeholder="tacos"
        />
        <datalist id="categorias-existentes">
          {categorias.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>

      {platillo && (
        <p className="pie-nota">
          Cambiar el precio no mueve las cuentas que ya están abiertas: cada platillo guarda el
          precio que tenía cuando se pidió.
        </p>
      )}

      <div className="acciones">
        <button className="boton" onClick={alCerrar} disabled={guardando}>
          Cancelar
        </button>
        {platillo && (
          <button className="boton rojo" onClick={eliminar} disabled={guardando}>
            Borrar
          </button>
        )}
        <button
          className="boton verde"
          onClick={guardar}
          disabled={guardando || !nombre.trim() || !precio.trim() || !categoria.trim()}
          style={{ flex: 1.4 }}
        >
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </Modal>
  );
}

// --- Personal ---

function PersonalAdmin() {
  const [meseros, setMeseros] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [nuevo, setNuevo] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setMeseros(await api.adminMeseros());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function agregar() {
    if (!nuevo.trim()) return;
    setGuardando(true);
    setError(null);
    try {
      await api.crearMesero({ nombre: nuevo });
      setNuevo('');
      await cargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function alternarActivo(mesero) {
    setError(null);
    try {
      await api.actualizarMesero(mesero.id, { activo: mesero.activo !== 1 });
      await cargar();
    } catch (err) {
      setError(err.message);
    }
  }

  if (cargando && meseros.length === 0) return <div className="vacio">Cargando el personal…</div>;

  const activos = meseros.filter((m) => m.activo === 1);
  const inactivos = meseros.filter((m) => m.activo !== 1);

  return (
    <>
      {error && <p className="error-texto">{error}</p>}

      <div className="barra-reportes">
        <div className="campo" style={{ margin: 0, flex: 1, minWidth: 200 }}>
          <label htmlFor="nuevo-mesero">Dar de alta</label>
          <input
            id="nuevo-mesero"
            value={nuevo}
            onChange={(e) => setNuevo(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && agregar()}
            placeholder="Nombre"
          />
        </div>
        <button className="boton primario" onClick={agregar} disabled={guardando || !nuevo.trim()}>
          Agregar
        </button>
      </div>

      <section className="seccion-reporte">
        <h2>En turno ({activos.length})</h2>
        {activos.length === 0 ? (
          <p className="sin-datos">No hay meseros dados de alta.</p>
        ) : (
          activos.map((m) => (
            <div key={m.id} className="fila-menu">
              <button className="boton chico" style={{ minWidth: 116 }} onClick={() => alternarActivo(m)}>
                Dar de baja
              </button>
              <span className="info-menu" style={{ cursor: 'default' }}>
                <span className="nombre">{m.nombre}</span>
              </span>
            </div>
          ))
        )}
      </section>

      {inactivos.length > 0 && (
        <section className="seccion-reporte">
          <h2>Ya no trabajan aquí ({inactivos.length})</h2>
          {/* No se borran: sus cuentas del historial siguen apuntando a ellos.
              Si regresan, se reactivan y conservan lo que ya habian atendido. */}
          <p className="pie-nota" style={{ marginTop: 0 }}>
            Se conservan para que las ventas que atendieron sigan apareciendo en los reportes.
          </p>
          {inactivos.map((m) => (
            <div key={m.id} className="fila-menu agotado">
              <button className="boton chico" style={{ minWidth: 116 }} onClick={() => alternarActivo(m)}>
                Reactivar
              </button>
              <span className="info-menu" style={{ cursor: 'default' }}>
                <span className="nombre">{m.nombre}</span>
              </span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
