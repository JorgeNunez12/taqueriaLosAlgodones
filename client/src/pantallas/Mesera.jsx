// Pantalla de mesera: mesas -> abrir cuenta -> capturar -> mandar a cocina.
//
// Todo lo que sale de aqui lleva client_id generado ANTES de mandar. Si el
// envio falla por red, se encola tal cual y se reintenta al reconectar; el
// servidor descarta los client_id que ya vio. Por eso la mesera puede apretar
// "mandar a cocina" con el WiFi caido y seguir trabajando.

import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { formatoMoneda, subtotalItem, totalCarrito } from '../dinero.js';
import { ElegirCarne, Insignia, Modal } from '../componentes/Comunes.jsx';
import { notaConCarne, pideCarne } from '../carnes.js';
import { nuevoId } from '../identificador.js';

export function Mesera({ mesas, comandas, enviar, conectado, sincronizado, mesero }) {
  const [platillos, setPlatillos] = useState([]);
  const [vista, setVista] = useState({ tipo: 'mesas' });
  const [abriendo, setAbriendo] = useState(null); // id de la mesa cuyo menu esta abierto

  // El menu cambia poco; se baja una vez y se reintenta al reconectar.
  useEffect(() => {
    let vivo = true;
    api
      .platillos()
      .then((lista) => vivo && setPlatillos(lista))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [conectado]);

  if (vista.tipo === 'comanda') {
    const comanda = comandas.find((c) => c.id === vista.comandaId);
    // Que no aparezca NO quiere decir que se cobro: tambien pasa mientras baja
    // el estado tras una reconexion. Solo se afirma que se cobro cuando la
    // pantalla esta al corriente con el servidor; si no, se espera.
    if (!comanda) {
      return (
        <div className="contenido">
          <div className="vacio">
            {sincronizado ? (
              <>
                <p>Esta cuenta ya se cobró.</p>
                <button className="boton primario" onClick={() => setVista({ tipo: 'mesas' })}>
                  Volver a las mesas
                </button>
              </>
            ) : (
              <p>Cargando la cuenta…</p>
            )}
          </div>
        </div>
      );
    }
    return (
      <Comanda
        comanda={comanda}
        platillos={platillos}
        enviar={enviar}
        alVolver={() => setVista({ tipo: 'mesas' })}
      />
    );
  }

  return (
    <div className="contenido">
      <div className="rejilla-mesas">
        {mesas.map((mesa) => (
          <button
            key={mesa.id}
            className={mesa.comandas.length > 0 ? 'mesa ocupada' : 'mesa'}
            // Siempre al menu de la mesa: son pocas mesas y varias cuentas por
            // mesa es lo normal, asi que entrar directo a la unica cuenta
            // abierta escondia el boton de "abrir otra cuenta" justo cuando
            // llega la segunda familia.
            onClick={() => setAbriendo(mesa.id)}
          >
            <span className="numero">Mesa {mesa.numero}</span>
            {mesa.comandas.length === 0 ? (
              <span className="cuentas">Libre</span>
            ) : (
              <>
                <span className="cuentas">
                  {mesa.comandas.length === 1 ? '1 cuenta' : `${mesa.comandas.length} cuentas`}
                </span>
                <span className="lista-cuentas">
                  {mesa.comandas.map((c) => (
                    <div key={c.id}>
                      <span>{c.etiqueta || `Cuenta ${c.id}`}</span>
                      <span>{formatoMoneda(c.total_centavos ?? 0)}</span>
                    </div>
                  ))}
                </span>
              </>
            )}
          </button>
        ))}
      </div>

      {abriendo && (
        <MenuDeMesa
          // La mesa viva del estado compartido: si otra tablet abrio una cuenta
          // mientras este modal estaba arriba, tiene que aparecer en la lista.
          mesa={mesas.find((m) => m.id === abriendo) ?? { id: abriendo, comandas: [] }}
          mesero={mesero}
          enviar={enviar}
          alCerrar={() => setAbriendo(null)}
          alEntrar={(comandaId) => {
            setAbriendo(null);
            setVista({ tipo: 'comanda', comandaId });
          }}
        />
      )}
    </div>
  );
}

/**
 * Menu de una mesa: entrar a una de sus cuentas abiertas, o abrir otra.
 *
 * Que una mesa sostenga varias cuentas es lo normal aqui, no la excepcion: dos
 * familias que se sientan juntas piden por separado y pagan por separado.
 */
function MenuDeMesa({ mesa, mesero, enviar, alCerrar, alEntrar }) {
  const [abriendoNueva, setAbriendoNueva] = useState(mesa.comandas.length === 0);

  if (abriendoNueva) {
    return (
      <AbrirCuenta
        mesa={mesa}
        mesero={mesero}
        enviar={enviar}
        alCerrar={alCerrar}
        alEntrar={alEntrar}
      />
    );
  }

  return (
    <Modal titulo={`Mesa ${mesa.numero}`} alCerrar={alCerrar}>
      {mesa.comandas.map((c) => (
        <button
          key={c.id}
          className="boton ancho"
          style={{ marginBottom: 10, justifyContent: 'space-between' }}
          onClick={() => alEntrar(c.id)}
        >
          <span>{c.etiqueta || `Cuenta ${c.id}`}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {formatoMoneda(c.total_centavos ?? 0)}
          </span>
        </button>
      ))}
      <div className="acciones">
        <button className="boton" onClick={alCerrar}>
          Cancelar
        </button>
        <button className="boton primario" onClick={() => setAbriendoNueva(true)}>
          Abrir otra cuenta
        </button>
      </div>
    </Modal>
  );
}

/**
 * Abrir una cuenta nueva en la mesa. Ya no se pregunta quien es el mesero: la
 * tablet trae la sesion iniciada y el servidor pone el nombre a partir del id
 * que se manda. Escribirlo en cada cuenta era teclear lo mismo veinte veces por
 * turno, y bastaba una prisa para dejarlo en blanco.
 */
function AbrirCuenta({ mesa, mesero, enviar, alCerrar, alEntrar }) {
  const [etiqueta, setEtiqueta] = useState('');
  const [mandando, setMandando] = useState(false);
  const [error, setError] = useState(null);

  async function abrir() {
    setMandando(true);
    setError(null);
    // El try/finally es lo que garantiza que el boton NUNCA se quede en
    // "Abriendo…": si algo truena aqui adentro, la mesera tiene que poder
    // volver a intentar en vez de quedarse con la pantalla congelada.
    try {
      // El client_id se genera aqui, antes de intentar mandar: es lo que hace
      // seguro el reintento.
      const client_id = nuevoId();

      const respuesta = await enviar({
        tipo: 'comanda',
        client_id,
        cuerpo: {
          client_id,
          mesa_id: mesa.id,
          etiqueta: etiqueta.trim() || null,
          mesero_id: mesero?.id ?? null,
        },
      });

      if (!respuesta.ok) {
        setError(respuesta.error.message);
        return;
      }
      if (respuesta.encolado) {
        // Sin red no hay id de comanda todavia, asi que no se puede entrar a
        // capturar: la cuenta se abrira sola al volver la señal.
        alCerrar();
        return;
      }
      alEntrar(respuesta.resultado.id);
    } catch (err) {
      setError(`No se pudo abrir la cuenta: ${err.message}`);
    } finally {
      setMandando(false);
    }
  }

  const yaAbiertas = mesa.comandas.length;

  return (
    <Modal titulo={`Nueva cuenta — Mesa ${mesa.numero}`} alCerrar={alCerrar}>
      {yaAbiertas > 0 && (
        <p style={{ color: 'var(--texto-tenue)', margin: '0 0 14px' }}>
          Esta mesa ya tiene {yaAbiertas === 1 ? 'una cuenta abierta' : `${yaAbiertas} cuentas abiertas`}.
          Esta va aparte.
        </p>
      )}
      <div className="campo">
        <label htmlFor="etiqueta">Referencia (opcional)</label>
        <input
          id="etiqueta"
          value={etiqueta}
          onChange={(e) => setEtiqueta(e.target.value)}
          placeholder="Señor de camisa azul"
          autoComplete="off"
        />
      </div>
      {mesero && (
        <p style={{ color: 'var(--texto-tenue)', margin: '0 0 4px', fontSize: 15 }}>
          Se abre a nombre de <strong>{mesero.nombre}</strong>.
        </p>
      )}
      {error && <p className="error-texto" style={{ marginTop: 12 }}>{error}</p>}
      <div className="acciones">
        <button className="boton" onClick={alCerrar}>
          Cancelar
        </button>
        <button className="boton primario" onClick={abrir} disabled={mandando}>
          {mandando ? 'Abriendo…' : 'Abrir cuenta'}
        </button>
      </div>
    </Modal>
  );
}

/** Captura: menu arriba, carrito abajo, boton de mandar a cocina. */
function Comanda({ comanda, platillos, enviar, alVolver }) {
  const [carrito, setCarrito] = useState([]);
  const [notasDe, setNotasDe] = useState(null);
  const [carneDe, setCarneDe] = useState(null); // platillo esperando que digan su carne
  const [mandando, setMandando] = useState(false);
  const [error, setError] = useState(null);

  const porCategoria = useMemo(() => {
    const grupos = new Map();
    for (const p of platillos) {
      if (!grupos.has(p.categoria)) grupos.set(p.categoria, []);
      grupos.get(p.categoria).push(p);
    }
    return [...grupos.entries()];
  }, [platillos]);

  function agregar(platillo) {
    // Planchada y pellizcada no caen al carrito hasta saber de que carne son:
    // es lo primero que cocina necesita y lo que antes se perdia cuando la
    // mesera traia prisa y no escribia la nota.
    if (pideCarne(platillo.nombre)) {
      setCarneDe(platillo);
      return;
    }
    agregarConNota(platillo, '');
  }

  function agregarConNota(platillo, notas) {
    setCarrito((previo) => {
      // Se apilan las lineas iguales SIN notas; con notas cada una va aparte,
      // porque "sin cebolla" no se puede fusionar con "con todo". Eso es
      // tambien lo que mantiene separadas una planchada de buche y una de
      // carnitas, que llevan la carne en la nota.
      const i = previo.findIndex((l) => l.platillo_id === platillo.id && !l.notas && !notas);
      if (i >= 0) {
        const copia = [...previo];
        copia[i] = { ...copia[i], cantidad: copia[i].cantidad + 1 };
        return copia;
      }
      return [
        ...previo,
        {
          linea: nuevoId(),
          platillo_id: platillo.id,
          nombre: platillo.nombre,
          precio_unitario_centavos: platillo.precio_centavos,
          cantidad: 1,
          notas,
        },
      ];
    });
  }

  const cambiarCantidad = (linea, delta) =>
    setCarrito((previo) =>
      previo
        .map((l) => (l.linea === linea ? { ...l, cantidad: l.cantidad + delta } : l))
        .filter((l) => l.cantidad > 0)
    );

  async function mandarACocina() {
    if (carrito.length === 0) return;
    setMandando(true);
    setError(null);

    try {
      // Un client_id por renglon, generado antes de mandar.
      const items = carrito.map((l) => ({
        client_id: nuevoId(),
        platillo_id: l.platillo_id,
        cantidad: l.cantidad,
        notas: l.notas?.trim() || null,
      }));

      const respuesta = await enviar({
        tipo: 'items',
        comanda_id: comanda.id,
        cuerpo: { items },
      });

      if (!respuesta.ok) {
        setError(respuesta.error.message);
        return;
      }
      // Encolado o entregado, para la mesera el pedido ya salio: se limpia el
      // carrito. Si se quedo en la cola, se mandara solo al volver la señal.
      setCarrito([]);
    } catch (err) {
      // El carrito NO se limpia: el pedido no salio y hay que poder reintentar.
      setError(`No se pudo mandar el pedido: ${err.message}`);
    } finally {
      setMandando(false);
    }
  }

  const totalNuevo = totalCarrito(carrito);
  const yaPedidos = comanda.items.filter((i) => i.estado !== 'cancelado');

  return (
    <>
      <div className="contenido">
        <button className="boton chico" onClick={alVolver} style={{ marginBottom: 14 }}>
          ← Mesas
        </button>

        <h2 style={{ margin: '0 0 4px', fontSize: 21 }}>
          Mesa {comanda.mesa_numero}
          {comanda.etiqueta ? ` · ${comanda.etiqueta}` : ''}
        </h2>
        <p style={{ color: 'var(--texto-tenue)', margin: '0 0 8px' }}>
          Cuenta actual: <strong>{comanda.total_formateado}</strong>
        </p>

        {yaPedidos.length > 0 && (
          <div className="tarjeta" style={{ marginBottom: 8 }}>
            <div className="categoria" style={{ marginTop: 0 }}>
              Ya pedido
            </div>
            {yaPedidos.map((item) => (
              <div key={item.id} className="linea">
                <div className="info">
                  <div className="titulo">
                    {item.cantidad}× {item.nombre_snapshot}
                  </div>
                  {item.notas && <div className="notas">{item.notas}</div>}
                </div>
                <Insignia estado={item.estado} />
                {item.estado === 'listo' && (
                  <button
                    className="boton chico verde"
                    onClick={() =>
                      enviar({ tipo: 'estado', item_id: item.id, cuerpo: { estado: 'entregado' } })
                    }
                  >
                    Entregué
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {carrito.length > 0 && (
          <div className="tarjeta" style={{ borderColor: 'var(--acento)', borderWidth: 2 }}>
            <div className="categoria" style={{ marginTop: 0 }}>
              Por mandar
            </div>
            {carrito.map((l) => (
              <div key={l.linea} className="linea">
                <div className="info">
                  <div className="titulo">{l.nombre}</div>
                  <button
                    className="notas"
                    onClick={() => setNotasDe(l.linea)}
                    style={{ padding: 0, textAlign: 'left' }}
                  >
                    {l.notas || '+ agregar nota'}
                  </button>
                </div>
                <div className="contador">
                  <button onClick={() => cambiarCantidad(l.linea, -1)} aria-label="Quitar uno">
                    −
                  </button>
                  <span className="cantidad">{l.cantidad}</span>
                  <button onClick={() => cambiarCantidad(l.linea, 1)} aria-label="Agregar uno">
                    +
                  </button>
                </div>
                <span className="monto">{formatoMoneda(subtotalItem(l))}</span>
              </div>
            ))}
          </div>
        )}

        {error && <p className="error-texto">{error}</p>}

        {porCategoria.map(([categoria, lista]) => (
          <div key={categoria}>
            <div className="categoria">{categoria}</div>
            <div className="rejilla">
              {lista.map((p) => (
                <button key={p.id} className="platillo" onClick={() => agregar(p)}>
                  <span className="nombre">{p.nombre}</span>
                  <span className="precio">{formatoMoneda(p.precio_centavos)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="pie">
        <div>
          <div className="etiqueta-total">Por mandar</div>
          <div className="total">{formatoMoneda(totalNuevo)}</div>
        </div>
        <button
          className="boton primario"
          style={{ flex: 1 }}
          onClick={mandarACocina}
          disabled={carrito.length === 0 || mandando}
        >
          {mandando ? 'Mandando…' : 'Mandar a cocina'}
        </button>
      </div>

      {carneDe && (
        <ElegirCarne
          nombre={carneDe.nombre}
          alElegir={(carne) => {
            agregarConNota(carneDe, carne);
            setCarneDe(null);
          }}
          alCerrar={() => setCarneDe(null)}
        />
      )}

      {notasDe && (
        <NotasModal
          linea={carrito.find((l) => l.linea === notasDe)}
          alGuardar={(texto) => {
            setCarrito((previo) =>
              previo.map((l) => (l.linea === notasDe ? { ...l, notas: texto } : l))
            );
            setNotasDe(null);
          }}
          alCerrar={() => setNotasDe(null)}
        />
      )}
    </>
  );
}

function NotasModal({ linea, alGuardar, alCerrar }) {
  const [texto, setTexto] = useState(linea?.notas ?? '');
  const sugerencias = ['Sin cebolla', 'Sin cilantro', 'Con todo', 'Bien dorado', 'Para llevar'];

  return (
    <Modal titulo={linea?.nombre ?? 'Nota'} alCerrar={alCerrar}>
      <div className="campo">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Cómo lo quiere el cliente"
          autoFocus
        />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {sugerencias.map((s) => (
          <button
            key={s}
            className="boton chico"
            onClick={() => setTexto((t) => (t ? `${t}, ${s.toLowerCase()}` : s))}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="acciones">
        <button className="boton" onClick={alCerrar}>
          Cancelar
        </button>
        <button className="boton primario" onClick={() => alGuardar(texto)}>
          Guardar
        </button>
      </div>
    </Modal>
  );
}
