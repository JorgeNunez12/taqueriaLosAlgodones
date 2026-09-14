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

import { useState } from 'react';
import { formatoMoneda, repartirEnPartes } from '../dinero.js';
import { Insignia, Modal } from '../componentes/Comunes.jsx';
import { nuevoId } from '../identificador.js';

const METODOS = [
  ['efectivo', 'Efectivo'],
  ['tarjeta', 'Tarjeta'],
  ['transferencia', 'Transferencia'],
];

export function Caja({ comandas, enviar }) {
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
