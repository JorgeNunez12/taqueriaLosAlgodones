// Pantalla de caja: cuentas abiertas y cobro.
//
// El total que se cobra es SIEMPRE el que manda el servidor (total_centavos y
// saldo_centavos), nunca una suma hecha aqui. Si esta pantalla sumara por su
// cuenta y se desfasara del servidor por un evento perdido, el corte de caja no
// cuadraria al final del dia y nadie sabria por que.
//
// Una misma cuenta se puede cobrar en varios pagos: aunque la familia pidio
// todo junto, a la hora de pagar cada quien saca lo suyo. Mientras quede saldo
// la cuenta sigue abierta; cuando llega a cero el servidor la cierra solo.

import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { formatoMoneda, repartirEnPartes, subtotalItem, totalCarrito } from '../dinero.js';
import { ElegirCarne, Insignia, Modal } from '../componentes/Comunes.jsx';
import { pideCarne } from '../carnes.js';
import { nuevoId } from '../identificador.js';

const METODOS = [
  ['efectivo', 'Efectivo'],
  ['tarjeta', 'Tarjeta'],
  ['transferencia', 'Transferencia'],
];

/**
 * Caja. Cuatro vistas, en pestañas:
 *
 *   "Cuentas"  -> lo de siempre: una mesa que ya pidio y viene a pagar.
 *   "Mostrador"-> el que llega, pide para llevar y paga ahi mismo, sin mesa.
 *   "Cobrar"   -> un monto escrito a mano, sin picar platillos.
 *   "Historial"-> lo que ya se cobro hoy, para cuando vuelven a preguntar.
 *
 * La de cuentas va primero porque es la que mas se usa, y es la que se muestra
 * al abrir. Las pestañas viven aqui arriba y no dentro de cada vista para que
 * cambiar de una a otra sea un solo toque estando en cualquiera: en hora pico
 * la caja alterna entre ellas todo el tiempo.
 */
export function Caja({ comandas, enviar, conectado }) {
  const [vista, setVista] = useState('cuentas');

  return (
    <>
      <div className="pestanas" style={{ marginBottom: 16 }}>
        <button
          className={vista === 'cuentas' ? 'boton activa' : 'boton'}
          onClick={() => setVista('cuentas')}
        >
          Cuentas{comandas.length > 0 ? ` (${comandas.length})` : ''}
        </button>
        <button
          className={vista === 'mostrador' ? 'boton activa' : 'boton'}
          onClick={() => setVista('mostrador')}
        >
          Mostrador
        </button>
        <button
          className={vista === 'libre' ? 'boton activa' : 'boton'}
          onClick={() => setVista('libre')}
        >
          Cobrar
        </button>
        <button
          className={vista === 'historial' ? 'boton activa' : 'boton'}
          onClick={() => setVista('historial')}
        >
          Historial
        </button>
      </div>

      {vista === 'cuentas' ? (
        <CuentasAbiertas comandas={comandas} enviar={enviar} />
      ) : vista === 'mostrador' ? (
        <VentaMostrador enviar={enviar} conectado={conectado} />
      ) : vista === 'libre' ? (
        <CobroLibre enviar={enviar} />
      ) : (
        <HistorialDelDia comandas={comandas} />
      )}
    </>
  );
}

function CuentasAbiertas({ comandas, enviar }) {
  const [cobrando, setCobrando] = useState(null);
  const [cancelando, setCancelando] = useState(null);

  if (comandas.length === 0) {
    return <div className="vacio">No hay cuentas abiertas.</div>;
  }

  // Ordenadas por mesa para encontrarlas rapido cuando el cliente llega a pagar.
  const ordenadas = [...comandas].sort(
    (a, b) => (a.mesa_numero ?? 0) - (b.mesa_numero ?? 0) || a.id - b.id
  );

  // La comanda viva viene del estado compartido, no de la copia que se guardo
  // al abrir el modal: si llega otro platillo mientras la caja cobra, el saldo
  // que se ve tiene que ser el nuevo.
  const enCobro = cobrando ? comandas.find((c) => c.id === cobrando) : null;
  const enCancelacion = cancelando ? comandas.find((c) => c.id === cancelando) : null;

  return (
    <>
      <div className="rejilla-cocina">
        {ordenadas.map((comanda) => {
          const parcial = comanda.pagado_centavos > 0;
          // Cuenta abierta a la que nunca se le pidio nada: no hay que cobrar,
          // hay que soltar la mesa. Ofrecerle "Cobrar $0.00" no lleva a ningun
          // lado, porque el servidor rechaza cobrar una cuenta sin platillos.
          const vacia = comanda.items.length === 0 && comanda.pagado_centavos === 0;
          return (
            <div key={comanda.id} className="comanda-cocina">
              <div className="cabeza">
                <span className="mesa-num">Mesa {comanda.mesa_numero}</span>
                {comanda.etiqueta && (
                  <span style={{ color: 'var(--texto-tenue)', fontSize: 14 }}>
                    {comanda.etiqueta}
                  </span>
                )}
                <span className="minutos">{comanda.total_formateado}</span>
              </div>

              {comanda.items.map((item) => (
                <div key={item.id} className="item-cocina">
                  <span className="cant">{item.cantidad}×</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{item.nombre_snapshot}</div>
                    {item.notas && <div className="notas">{item.notas}</div>}
                  </div>
                  {item.pagado ? <Insignia estado="pagado" /> : <Insignia estado={item.estado} />}
                  <span className="monto">
                    {item.estado === 'cancelado' ? '—' : formatoMoneda(item.subtotal_centavos)}
                  </span>
                </div>
              ))}

              <div style={{ padding: 12 }}>
                {parcial && (
                  <p
                    style={{
                      margin: '0 0 10px',
                      fontSize: 14,
                      color: 'var(--texto-tenue)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    Ya pagaron {comanda.pagado_formateado} de {comanda.total_formateado}
                  </p>
                )}
                {vacia ? (
                  <>
                    <p
                      style={{
                        margin: '0 0 10px',
                        fontSize: 14,
                        color: 'var(--texto-tenue)',
                      }}
                    >
                      No se pidió nada en esta cuenta.
                    </p>
                    <button className="boton ancho" onClick={() => setCancelando(comanda.id)}>
                      Cancelar cuenta y liberar mesa
                    </button>
                  </>
                ) : (
                  <button className="boton primario ancho" onClick={() => setCobrando(comanda.id)}>
                    {parcial
                      ? `Cobrar resto ${comanda.saldo_formateado}`
                      : `Cobrar ${comanda.total_formateado}`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {enCobro && (
        <Cobro comanda={enCobro} enviar={enviar} alCerrar={() => setCobrando(null)} />
      )}

      {enCancelacion && (
        <CancelarVacia
          comanda={enCancelacion}
          enviar={enviar}
          alCerrar={() => setCancelando(null)}
        />
      )}
    </>
  );
}

/**
 * Confirmacion para soltar una cuenta que nunca se uso. Se pregunta porque el
 * paso no tiene vuelta atras, y el boton vive junto a los de cobro: un toque
 * de mas en la mesa equivocada no deberia cerrar nada solo.
 */
function CancelarVacia({ comanda, enviar, alCerrar }) {
  const [mandando, setMandando] = useState(false);
  const [error, setError] = useState(null);

  async function cancelar() {
    setMandando(true);
    setError(null);
    try {
      const respuesta = await enviar({ tipo: 'cancelar', comanda_id: comanda.id, cuerpo: {} });
      if (!respuesta.ok) {
        setError(respuesta.error.message);
        return;
      }
      alCerrar();
    } catch (err) {
      setError(`No se pudo cancelar: ${err.message}`);
    } finally {
      setMandando(false);
    }
  }

  const titulo = `Mesa ${comanda.mesa_numero}${comanda.etiqueta ? ` · ${comanda.etiqueta}` : ''}`;

  return (
    <Modal titulo={titulo} alCerrar={alCerrar}>
      <p style={{ margin: '0 0 6px' }}>
        Esta cuenta se abrió pero nunca se le pidió nada.
      </p>
      <p style={{ color: 'var(--texto-tenue)', margin: '0 0 4px' }}>
        Se va a cancelar y la mesa queda libre. No entra dinero ni aparece en el corte del día.
      </p>
      {error && <p className="error-texto" style={{ marginTop: 14 }}>{error}</p>}
      <div className="acciones">
        <button className="boton" onClick={alCerrar}>
          Dejarla abierta
        </button>
        <button
          className="boton primario"
          onClick={cancelar}
          disabled={mandando}
          style={{ flex: 1.4 }}
        >
          {mandando ? 'Cancelando…' : 'Cancelar cuenta'}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Cobro. Tres formas de repartir, en pestañas:
 *
 *   "Todo"      -> se paga el saldo completo. Es lo normal y va primero.
 *   "Por cosas" -> se marcan los platillos que paga esta persona.
 *   "Dividir"   -> se reparte el saldo en partes iguales.
 *
 * Las tres terminan en un pago contra el servidor. Si el pago no liquida la
 * cuenta, el modal se queda abierto con el saldo nuevo, porque lo que sigue casi
 * siempre es que pague el que va detras.
 */
function Cobro({ comanda, enviar, alCerrar }) {
  const [modo, setModo] = useState('total');
  const [metodo, setMetodo] = useState('efectivo');
  const [marcados, setMarcados] = useState(() => new Set());
  const [partes, setPartes] = useState(2);
  const [parteActual, setParteActual] = useState(1);
  const [recibido, setRecibido] = useState('');
  const [mandando, setMandando] = useState(false);
  const [error, setError] = useState(null);

  const saldo = comanda.saldo_centavos;
  // Lo que todavia se puede marcar: ni pagado antes, ni cancelado.
  const cobrables = comanda.items.filter((i) => !i.pagado && i.estado !== 'cancelado');

  const sumaMarcada = cobrables
    .filter((i) => marcados.has(i.id))
    .reduce((t, i) => t + i.subtotal_centavos, 0);

  // El reparto vive en dinero.js: el sobrante de centavos se le carga a la
  // primera parte para que la suma de exactamente el saldo.
  const repartidas = repartirEnPartes(saldo, partes);
  const montoParte = repartidas[parteActual - 1] ?? 0;
  const sobrante = saldo - Math.floor(saldo / partes) * partes;

  const aCobrar = modo === 'items' ? sumaMarcada : modo === 'division' ? montoParte : saldo;

  const alternar = (id) =>
    setMarcados((previos) => {
      const copia = new Set(previos);
      if (copia.has(id)) copia.delete(id);
      else copia.add(id);
      return copia;
    });

  // El cambio se calcula en centavos enteros: pesos * 100 redondeado, nunca
  // restando floats. La caja tiene que cuadrar al centavo.
  const recibidoCentavos = recibido.trim()
    ? Math.round(Number(recibido.replace(/[$,\s]/g, '')) * 100)
    : null;
  const cambio =
    recibidoCentavos !== null && Number.isFinite(recibidoCentavos)
      ? recibidoCentavos - aCobrar
      : null;

  async function cobrar() {
    if (aCobrar <= 0) return;
    setMandando(true);
    setError(null);

    try {
      // El client_id se genera ANTES de mandar: si la respuesta se pierde, el
      // reintento no cobra dos veces porque el servidor ya vio ese id.
      const client_id = nuevoId();
      const cuerpo =
        modo === 'items'
          ? { tipo: 'items', item_ids: [...marcados], metodo }
          : modo === 'division'
            ? { tipo: 'division', monto_centavos: montoParte, metodo }
            : { tipo: 'total', metodo };

      const respuesta = await enviar({
        tipo: 'pago',
        client_id,
        comanda_id: comanda.id,
        cuerpo,
      });

      if (!respuesta.ok) {
        setError(respuesta.error.message);
        return;
      }

      // Si liquidaba todo, la cuenta ya cerro y no hay nada mas que cobrar.
      if (aCobrar >= saldo || respuesta.encolado) {
        alCerrar();
        return;
      }

      // Quedo saldo: se limpia lo cobrado y se deja listo al siguiente que paga.
      setMarcados(new Set());
      setRecibido('');
      if (modo === 'division') setParteActual((n) => Math.min(n + 1, partes));
    } catch (err) {
      // Aqui es donde mas importa no dejar la pantalla congelada: la caja tiene
      // al cliente enfrente esperando. Lo marcado se conserva para reintentar.
      setError(`No se pudo cobrar: ${err.message}`);
    } finally {
      setMandando(false);
    }
  }

  const titulo = `Cobrar mesa ${comanda.mesa_numero}${comanda.etiqueta ? ` · ${comanda.etiqueta}` : ''}`;

  return (
    <Modal titulo={titulo} alCerrar={alCerrar}>
      <div className="monto-grande">{formatoMoneda(aCobrar)}</div>
      <p className="resumen-saldo">
        {comanda.pagado_centavos > 0 ? (
          <>
            Saldo de la cuenta: {comanda.saldo_formateado} · ya pagaron{' '}
            {comanda.pagado_formateado}
          </>
        ) : (
          <>Cuenta completa: {comanda.total_formateado}</>
        )}
      </p>

      <div className="pestanas">
        <button
          className={modo === 'total' ? 'boton activa' : 'boton'}
          onClick={() => setModo('total')}
        >
          Todo
        </button>
        <button
          className={modo === 'items' ? 'boton activa' : 'boton'}
          onClick={() => setModo('items')}
        >
          Por cosas
        </button>
        <button
          className={modo === 'division' ? 'boton activa' : 'boton'}
          onClick={() => setModo('division')}
        >
          Dividir
        </button>
      </div>

      {modo === 'items' && (
        <div className="campo">
          <label>Marca lo que paga esta persona</label>
          {comanda.items
            .filter((i) => i.estado !== 'cancelado')
            .map((item) => {
              const marcada = marcados.has(item.id);
              const clase = item.pagado
                ? 'fila-cobro pagada'
                : marcada
                  ? 'fila-cobro marcada'
                  : 'fila-cobro';
              return (
                <button
                  key={item.id}
                  className={clase}
                  disabled={item.pagado}
                  onClick={() => alternar(item.id)}
                >
                  <span className="marca">{marcada ? '✓' : ''}</span>
                  <span className="info">
                    <span style={{ fontWeight: 600 }}>
                      {item.cantidad}× {item.nombre_snapshot}
                    </span>
                    {item.pagado && (
                      <span style={{ display: 'block', fontSize: 13, color: 'var(--texto-tenue)' }}>
                        Ya pagado
                      </span>
                    )}
                  </span>
                  <span className="monto">{formatoMoneda(item.subtotal_centavos)}</span>
                </button>
              );
            })}
          {cobrables.length === 0 && (
            <p style={{ color: 'var(--texto-tenue)' }}>Ya se pagaron todos los platillos.</p>
          )}
        </div>
      )}

      {modo === 'division' && (
        <>
          <div className="campo">
            <label>¿Entre cuántos se reparte el saldo?</label>
            <div className="partes">
              {[2, 3, 4, 5, 6].map((n) => (
                <button
                  key={n}
                  className={partes === n ? 'boton activa' : 'boton'}
                  onClick={() => {
                    setPartes(n);
                    setParteActual(1);
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <p style={{ color: 'var(--texto-tenue)', margin: '0 0 14px', fontSize: 15 }}>
            Cobrando la parte {parteActual} de {partes}
            {sobrante > 0 && parteActual === 1 && ' (le toca el sobrante para que cuadre)'}
          </p>
        </>
      )}

      <div className="campo">
        <label>Método de pago</label>
        <div style={{ display: 'flex', gap: 8 }}>
          {METODOS.map(([valor, nombre]) => (
            <button
              key={valor}
              className={metodo === valor ? 'boton primario' : 'boton'}
              style={{ flex: 1, minHeight: 52, fontSize: 15, padding: '0 8px' }}
              onClick={() => setMetodo(valor)}
            >
              {nombre}
            </button>
          ))}
        </div>
      </div>

      {metodo === 'efectivo' && (
        <div className="campo">
          <label htmlFor="recibido">Con cuánto paga (opcional)</label>
          <input
            id="recibido"
            inputMode="decimal"
            value={recibido}
            onChange={(e) => setRecibido(e.target.value)}
            placeholder="500"
          />
          {cambio !== null && cambio >= 0 && (
            <p style={{ fontSize: 22, fontWeight: 700, color: 'var(--verde)', margin: '6px 0 0' }}>
              Cambio: {formatoMoneda(cambio)}
            </p>
          )}
          {cambio !== null && cambio < 0 && (
            <p style={{ color: 'var(--ambar)', margin: '6px 0 0', fontWeight: 600 }}>
              Faltan {formatoMoneda(Math.abs(cambio))}
            </p>
          )}
        </div>
      )}

      {comanda.pagos.length > 0 && (
        <div className="pagos-previos">
          <strong style={{ fontSize: 14 }}>Ya cobrado en esta cuenta</strong>
          {comanda.pagos.map((p) => (
            <div key={p.id} className="renglon">
              <span>{METODOS.find(([v]) => v === p.metodo)?.[1] ?? p.metodo}</span>
              <span>{p.monto_formateado}</span>
            </div>
          ))}
        </div>
      )}

      {error && <p className="error-texto" style={{ marginTop: 14 }}>{error}</p>}

      <div className="acciones">
        <button className="boton" onClick={alCerrar}>
          {comanda.pagado_centavos > 0 ? 'Dejar pendiente' : 'Cancelar'}
        </button>
        <button
          className="boton verde"
          onClick={cobrar}
          disabled={mandando || aCobrar <= 0}
          style={{ flex: 1.4 }}
        >
          {mandando
            ? 'Cobrando…'
            : aCobrar >= saldo
              ? `Cobrar ${formatoMoneda(aCobrar)} y cerrar`
              : `Cobrar ${formatoMoneda(aCobrar)}`}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Cobro de cantidad libre: se escribe el monto y se cobra, sin picar platillos.
 *
 * Para lo que no esta en el menu o no vale la pena capturar: un pedido que se
 * levanto por telefono, un encargo especial, algo que se acordo de palabra.
 * Antes habia que inventar un carrito que no correspondia a nada.
 *
 * El concepto se pide pero no se obliga: obligarlo haria que en la prisa se
 * escriba "x" con tal de pasar, y un concepto falso es peor que ninguno porque
 * se ve informativo en el corte sin serlo. Se avisa que sin el, el encargado no
 * va a saber de que fue.
 */
function CobroLibre({ enviar }) {
  const [monto, setMonto] = useState('');
  const [concepto, setConcepto] = useState('');
  const [metodo, setMetodo] = useState('efectivo');
  const [mandando, setMandando] = useState(false);
  const [error, setError] = useState(null);
  const [ultimo, setUltimo] = useState(null);

  // Se teclea en pesos y se convierte a centavos enteros aqui, igual que en el
  // resto del sistema: el dinero nunca viaja como float.
  const limpio = monto.replace(/[$,\s]/g, '');
  const centavos = limpio ? Math.round(Number(limpio) * 100) : 0;
  const valido = Number.isInteger(centavos) && centavos > 0;

  async function cobrar() {
    if (!valido || mandando) return;
    setMandando(true);
    setError(null);
    try {
      // client_id antes de mandar, como todo lo que cobra: si se pierde la
      // respuesta, el reintento devuelve el cobro que ya se hizo.
      const client_id = nuevoId();
      const respuesta = await enviar({
        tipo: 'venta-libre',
        client_id,
        cuerpo: { monto_centavos: centavos, concepto: concepto.trim() || null, metodo },
      });

      if (!respuesta.ok) {
        setError(respuesta.error.message);
        return;
      }

      setUltimo({
        monto: formatoMoneda(centavos),
        concepto: concepto.trim(),
        encolado: respuesta.encolado,
      });
      setMonto('');
      setConcepto('');
    } catch (err) {
      setError(`No se pudo cobrar: ${err.message}`);
    } finally {
      setMandando(false);
    }
  }

  return (
    <div className="cobro-libre">
      {ultimo && (
        <div className="acuse">
          <strong>
            {ultimo.encolado ? 'Se cobrará al volver la señal: ' : 'Cobrado '}
            {ultimo.monto}
          </strong>
          {ultimo.concepto && <span> · {ultimo.concepto}</span>}
        </div>
      )}

      <div className="campo">
        <label htmlFor="monto-libre">¿Cuánto se va a cobrar?</label>
        <input
          id="monto-libre"
          className="entrada-monto"
          inputMode="decimal"
          value={monto}
          onChange={(e) => {
            setMonto(e.target.value);
            // El acuse del cobro anterior se va en cuanto se empieza otro: si
            // se quedara, "Cobrado $120" seguiria en pantalla mientras se
            // teclea el siguiente y podria leerse como que este ya se cobro.
            setUltimo(null);
          }}
          placeholder="0.00"
          autoFocus
        />
      </div>

      <div className="campo">
        <label htmlFor="concepto-libre">¿De qué fue? (opcional)</label>
        <input
          id="concepto-libre"
          value={concepto}
          onChange={(e) => setConcepto(e.target.value)}
          placeholder="Pedido por teléfono"
          autoComplete="off"
        />
      </div>

      <div className="campo">
        <label>Método de pago</label>
        <div style={{ display: 'flex', gap: 8 }}>
          {METODOS.map(([valor, nombre]) => (
            <button
              key={valor}
              className={metodo === valor ? 'boton primario' : 'boton'}
              style={{ flex: 1, minHeight: 52, fontSize: 15, padding: '0 8px' }}
              onClick={() => setMetodo(valor)}
            >
              {nombre}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error-texto">{error}</p>}

      {valido && !concepto.trim() && (
        <p className="pie-nota">
          Sin concepto, en el corte del día solo aparecerá el monto y no se va a saber de qué fue.
        </p>
      )}

      <button
        className="boton verde"
        onClick={cobrar}
        disabled={!valido || mandando}
        style={{ width: '100%', minHeight: 64, fontSize: 19, marginTop: 8 }}
      >
        {mandando ? 'Cobrando…' : valido ? `Cobrar ${formatoMoneda(centavos)}` : 'Cobrar'}
      </button>
    </div>
  );
}

/**
 * Lo que ya se cobro hoy. La pregunta que contesta es "¿que le cobre a la mesa
 * 3 hace rato?", cuando el cliente vuelve a la caja a reclamar.
 *
 * Se baja del servidor y no se arma con lo que esta en pantalla: la caja pudo
 * haberse reiniciado a media tarde, y el historial tiene que seguir completo.
 * `comandas` (las cuentas abiertas) entra solo como disparador para recargar:
 * cuando una se cierra desaparece de ahi, que es justo cuando hay algo nuevo
 * que mostrar aqui.
 */
function HistorialDelDia({ comandas }) {
  const [cuentas, setCuentas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [abierta, setAbierta] = useState(null);

  const cuantasAbiertas = comandas.length;

  useEffect(() => {
    let vivo = true;
    api
      .historialCaja()
      .then((lista) => {
        if (!vivo) return;
        setCuentas(lista);
        setError(null);
      })
      .catch((err) => vivo && setError(err.message))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [cuantasAbiertas]);

  if (cargando && cuentas.length === 0) return <div className="vacio">Cargando el historial…</div>;

  // Las canceladas no son cobros: se muestran aparte para no inflar la cuenta
  // de "cobros de hoy" con cuentas donde nunca entro dinero.
  const cobradas = cuentas.filter((c) => c.estado === 'cerrada');
  const total = cobradas.reduce((suma, c) => suma + (c.total_centavos ?? 0), 0);

  return (
    <>
      {error && <p className="error-texto">{error}</p>}

      <div className="barra-reportes">
        <div style={{ flex: 1 }}>
          <strong>
            {cobradas.length} {cobradas.length === 1 ? 'cobro' : 'cobros'} hoy
          </strong>
        </div>
        <span className="monto" style={{ fontSize: 19 }}>
          {formatoMoneda(total)}
        </span>
      </div>

      {cuentas.length === 0 ? (
        <div className="vacio">Todavía no se cobra nada hoy.</div>
      ) : (
        cuentas.map((c) => (
          <button key={c.id} className="fila-historial" onClick={() => setAbierta(c.id)}>
            <span className="hora">{soloHora(c.cerrado_en ?? c.creado_en)}</span>
            <span className="quien">
              <span className="nombre">{nombreDeCuenta(c)}</span>
              {c.concepto && <span className="detalle">{c.concepto}</span>}
              {c.estado === 'cancelada' && <span className="detalle">Cancelada</span>}
            </span>
            <span className={c.estado === 'cancelada' ? 'monto tenue' : 'monto'}>
              {c.total_formateado}
            </span>
          </button>
        ))
      )}

      {abierta && <DetalleCuenta comandaId={abierta} alCerrar={() => setAbierta(null)} />}
    </>
  );
}

/** "Mesa 3", "Mostrador" o "Cobro directo", segun de que tipo sea la cuenta. */
function nombreDeCuenta(c) {
  if (c.venta_libre) return 'Cobro directo';
  if (c.mesa_numero != null) return `Mesa ${c.mesa_numero}`;
  return 'Mostrador';
}

/** 'YYYY-MM-DD HH:MM:SS' -> 'HH:MM'. */
function soloHora(fechaLocal) {
  if (!fechaLocal) return '';
  const partes = String(fechaLocal).split(' ')[1];
  return partes ? partes.slice(0, 5) : '';
}

/**
 * Que llevo una cuenta ya cobrada y como se pago. Se pide al abrir y no se
 * guarda de antes: el historial lista decenas de cuentas y bajar los platillos
 * de todas para que se vean una o dos seria trabajo tirado.
 */
function DetalleCuenta({ comandaId, alCerrar }) {
  const [comanda, setComanda] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let vivo = true;
    api
      .comanda(comandaId)
      .then((c) => vivo && setComanda(c))
      .catch((err) => vivo && setError(err.message));
    return () => {
      vivo = false;
    };
  }, [comandaId]);

  const titulo = comanda ? nombreDeCuenta(comanda) : 'Cuenta';
  const items = (comanda?.items ?? []).filter((i) => i.estado !== 'cancelado');

  return (
    <Modal titulo={titulo} alCerrar={alCerrar}>
      {error && <p className="error-texto">{error}</p>}
      {!comanda && !error && <div className="vacio">Cargando…</div>}

      {comanda && (
        <>
          {comanda.concepto && (
            <p className="pie-nota" style={{ marginTop: 0 }}>
              {comanda.concepto}
            </p>
          )}

          {items.length > 0 ? (
            items.map((item) => (
              <div key={item.id} className="linea">
                <div className="info">
                  <div className="titulo">
                    {item.cantidad}× {item.nombre_snapshot}
                  </div>
                  {item.notas && <div className="notas">{item.notas}</div>}
                </div>
                <span className="monto">{formatoMoneda(item.subtotal_centavos)}</span>
              </div>
            ))
          ) : (
            <p className="sin-datos">
              {comanda.venta_libre
                ? 'Cobro directo, sin platillos.'
                : 'Esta cuenta no tiene platillos.'}
            </p>
          )}

          <div className="linea" style={{ fontWeight: 700 }}>
            <div className="info">
              <div className="titulo">Total</div>
            </div>
            <span className="monto">{comanda.total_formateado}</span>
          </div>

          {comanda.pagos?.length > 0 && (
            <>
              <div className="categoria">Cómo se pagó</div>
              {comanda.pagos.map((p) => (
                <div key={p.id} className="linea">
                  <div className="info">
                    <div className="titulo">
                      {METODOS.find(([v]) => v === p.metodo)?.[1] ?? p.metodo}
                    </div>
                    <div className="notas">{soloHora(p.creado_en)}</div>
                  </div>
                  <span className="monto">{p.monto_formateado}</span>
                </div>
              ))}
            </>
          )}

          {comanda.mesera && <p className="pie-nota">Atendió {comanda.mesera}.</p>}
        </>
      )}

      <div className="acciones">
        <button className="boton primario" onClick={alCerrar}>
          Cerrar
        </button>
      </div>
    </Modal>
  );
}

/**
 * Venta de mostrador: el cliente que llega, pide para llevar y paga en el acto
 * sin ocupar mesa.
 *
 * Es una sola pantalla y no un flujo de varios pasos porque el cliente esta
 * parado enfrente esperando: se tocan los platillos, se ve el total, se cobra.
 * A diferencia de una cuenta de mesa, aqui nunca existe un estado intermedio
 * "pedido pero no pagado": el servidor abre, carga y cobra en una sola
 * transaccion, asi que o la venta entra completa o no entra.
 */
function VentaMostrador({ enviar, conectado }) {
  const [platillos, setPlatillos] = useState([]);
  const [carrito, setCarrito] = useState([]);
  const [metodo, setMetodo] = useState('efectivo');
  const [recibido, setRecibido] = useState('');
  const [mandando, setMandando] = useState(false);
  const [error, setError] = useState(null);
  const [ultima, setUltima] = useState(null);
  const [carneDe, setCarneDe] = useState(null); // platillo esperando que digan su carne

  // Mismo patron que en la pantalla de meseros: el menu se baja una vez y se
  // reintenta al reconectar.
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

  const porCategoria = useMemo(() => {
    const grupos = new Map();
    for (const p of platillos) {
      if (!grupos.has(p.categoria)) grupos.set(p.categoria, []);
      grupos.get(p.categoria).push(p);
    }
    return [...grupos.entries()];
  }, [platillos]);

  function agregar(platillo) {
    // Igual que en la pantalla de meseros: la planchada y la pellizcada no
    // entran hasta saber de que carne son. Aqui tambien la necesita cocina,
    // porque la venta de mostrador se despacha igual que una de mesa.
    if (pideCarne(platillo.nombre)) {
      setCarneDe(platillo);
      return;
    }
    agregarConNota(platillo, '');
  }

  function agregarConNota(platillo, notas) {
    // Al agregar algo se borra el acuse de la venta anterior: si se quedara,
    // "Cobrado $120" seguiria en pantalla mientras se arma la venta siguiente
    // y la caja podria leerlo como que esta ya se cobro.
    setUltima(null);
    setCarrito((previo) => {
      // Solo se apilan las lineas sin nota: dos carnes distintas del mismo
      // platillo tienen que quedar en renglones aparte o cocina veria
      // "2x Planchada" sin saber que una es de buche y la otra de carnitas.
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

  const total = totalCarrito(carrito);

  // El cambio se calcula en centavos enteros, igual que en el cobro de una
  // cuenta: restar floats es lo que hace que la caja no cuadre al final.
  const recibidoCentavos = recibido.trim()
    ? Math.round(Number(recibido.replace(/[$,\s]/g, '')) * 100)
    : null;
  const cambio =
    recibidoCentavos !== null && Number.isFinite(recibidoCentavos)
      ? recibidoCentavos - total
      : null;

  async function cobrar() {
    if (carrito.length === 0 || mandando) return;
    setMandando(true);
    setError(null);

    try {
      // El client_id se genera ANTES de mandar: si se pierde la respuesta, el
      // reintento devuelve la venta que ya se hizo en vez de cobrarla otra vez.
      const client_id = nuevoId();
      const items = carrito.map((l) => ({
        client_id: nuevoId(),
        platillo_id: l.platillo_id,
        cantidad: l.cantidad,
        notas: l.notas?.trim() || null,
      }));

      const respuesta = await enviar({
        tipo: 'venta-mostrador',
        client_id,
        cuerpo: { items, metodo },
      });

      if (!respuesta.ok) {
        setError(respuesta.error.message);
        return;
      }

      // El acuse se arma ANTES de limpiar, para poder decir cuanto se cobro y
      // cuanto cambio se dio cuando el carrito ya se vacio.
      setUltima({
        total,
        cambio: metodo === 'efectivo' ? cambio : null,
        encolado: respuesta.encolado,
      });
      setCarrito([]);
      setRecibido('');
    } catch (err) {
      // El carrito NO se limpia: la venta no salio y hay que poder reintentar
      // sin volver a picar todo con el cliente enfrente.
      setError(`No se pudo cobrar: ${err.message}`);
    } finally {
      setMandando(false);
    }
  }

  return (
    <>
      {ultima && (
        <div className="acuse-venta">
          <strong>
            {ultima.encolado
              ? `Venta guardada ${formatoMoneda(ultima.total)}`
              : `Cobrado ${formatoMoneda(ultima.total)}`}
          </strong>
          {ultima.cambio !== null && ultima.cambio > 0 && (
            <div className="cambio">Cambio: {formatoMoneda(ultima.cambio)}</div>
          )}
          {ultima.encolado && (
            <div className="nota">Sin conexión: se manda sola al volver la señal.</div>
          )}
        </div>
      )}

      {carrito.length > 0 && (
        <div className="tarjeta" style={{ borderColor: 'var(--acento)', borderWidth: 2 }}>
          <div className="categoria" style={{ marginTop: 0 }}>
            Por cobrar
          </div>
          {carrito.map((l) => (
            <div key={l.linea} className="linea">
              <div className="info">
                <div className="titulo">{l.nombre}</div>
                {l.notas && <div className="notas">{l.notas}</div>}
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

          <div style={{ padding: 12 }}>
            <div className="monto-grande">{formatoMoneda(total)}</div>

            <div className="campo">
              <label>Método de pago</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {METODOS.map(([valor, nombre]) => (
                  <button
                    key={valor}
                    className={metodo === valor ? 'boton primario' : 'boton'}
                    style={{ flex: 1, minHeight: 52, fontSize: 15, padding: '0 8px' }}
                    onClick={() => setMetodo(valor)}
                  >
                    {nombre}
                  </button>
                ))}
              </div>
            </div>

            {metodo === 'efectivo' && (
              <div className="campo">
                <label htmlFor="recibido-mostrador">Con cuánto paga (opcional)</label>
                <input
                  id="recibido-mostrador"
                  inputMode="decimal"
                  value={recibido}
                  onChange={(e) => setRecibido(e.target.value)}
                  placeholder="500"
                />
                {cambio !== null && cambio >= 0 && (
                  <p
                    style={{
                      fontSize: 22,
                      fontWeight: 700,
                      color: 'var(--verde)',
                      margin: '6px 0 0',
                    }}
                  >
                    Cambio: {formatoMoneda(cambio)}
                  </p>
                )}
                {cambio !== null && cambio < 0 && (
                  <p style={{ color: 'var(--ambar)', margin: '6px 0 0', fontWeight: 600 }}>
                    Faltan {formatoMoneda(Math.abs(cambio))}
                  </p>
                )}
              </div>
            )}

            {error && <p className="error-texto">{error}</p>}

            <div className="acciones">
              <button className="boton" onClick={() => setCarrito([])} disabled={mandando}>
                Limpiar
              </button>
              <button
                className="boton verde"
                onClick={cobrar}
                disabled={mandando}
                style={{ flex: 1.4 }}
              >
                {mandando ? 'Cobrando…' : `Cobrar ${formatoMoneda(total)}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {platillos.length === 0 ? (
        <div className="vacio">
          No se pudo cargar el menú. Revisa que el servidor esté prendido.
        </div>
      ) : (
        porCategoria.map(([categoria, lista]) => (
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
        ))
      )}

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
    </>
  );
}
