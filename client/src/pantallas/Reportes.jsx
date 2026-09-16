// Corte de caja y reportes del dia.
//
// Es la unica pantalla que NO es de tiempo real, y es a proposito: un reporte
// que se mueve solo mientras el encargado lo esta leyendo para cuadrar la caja
// es peor que uno quieto. Se baja al abrir y se actualiza cuando se pide.
//
// Los numeros vienen formateados del servidor (`*_formateado`). Aqui no se suma
// ni se divide nada de dinero: si esta pantalla sacara sus propias cuentas y se
// desfasara, el corte no cuadraria y nadie sabria cual de los dos esta mal.

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

/** 'YYYY-MM-DD' de hoy en local, igual que lo guarda el servidor. */
function hoy() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const METODOS = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
};

/** '2026-08-07' -> 'viernes 7 de agosto'. */
function fechaLarga(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(a, m - 1, d).toLocaleDateString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export function Reportes() {
  const [fecha, setFecha] = useState(hoy);
  const [corte, setCorte] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [vista, setVista] = useState('resumen');

  const cargar = useCallback(async (dia) => {
    setCargando(true);
    setError(null);
    try {
      // Los dos juntos: son la misma pregunta partida en dos vistas, y pedirlos
      // en serie haria parpadear la pantalla dos veces.
      const [c, h] = await Promise.all([api.corte(dia), api.historial(dia)]);
      setCorte(c);
      setHistorial(h);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar(fecha);
  }, [fecha, cargar]);

  if (cargando && !corte) return <div className="vacio">Cargando el corte…</div>;
  if (error) {
    return (
      <div className="vacio">
        <p className="error-texto">{error}</p>
        <button className="boton" onClick={() => cargar(fecha)}>
          Reintentar
        </button>
      </div>
    );
  }
  if (!corte) return null;

  const esHoy = fecha === hoy();

  return (
    <>
      <div className="barra-reportes">
        <div className="campo" style={{ margin: 0, flex: 1, minWidth: 190 }}>
          <label htmlFor="fecha-corte">Día del corte</label>
          <input
            id="fecha-corte"
            type="date"
            value={fecha}
            max={hoy()}
            onChange={(e) => setFecha(e.target.value || hoy())}
          />
        </div>
        <button className="boton" onClick={() => cargar(fecha)} disabled={cargando}>
          {cargando ? 'Actualizando…' : 'Actualizar'}
        </button>
        {!esHoy && (
          <button className="boton" onClick={() => setFecha(hoy())}>
            Volver a hoy
          </button>
        )}
      </div>

      <p className="pie-nota" style={{ marginTop: 0 }}>
        {fechaLarga(fecha)}
        {esHoy && ' · el día va corriendo, los números cambian conforme se cobra'}
      </p>

      {/* Lo que la caja necesita ver primero y en grande: cuanto entro hoy. */}
      <div className="tiras">
        <Tira
          principal
          etiqueta="Cobrado en el día"
          valor={corte.cobrado_formateado}
          nota={`${corte.cobros} ${corte.cobros === 1 ? 'cobro' : 'cobros'} · ${corte.cuentas.cerradas} ${corte.cuentas.cerradas === 1 ? 'cuenta cerrada' : 'cuentas cerradas'}`}
        />
        <Tira
          etiqueta="Ticket promedio"
          valor={corte.ticket_promedio_formateado}
          nota="por cuenta cerrada"
        />
        <Tira
          etiqueta="Falta por cobrar"
          valor={corte.por_cobrar.saldo_formateado}
          nota={`${corte.por_cobrar.cuentas} ${corte.por_cobrar.cuentas === 1 ? 'cuenta abierta' : 'cuentas abiertas'} ahora`}
          alerta={corte.por_cobrar.saldo_centavos > 0}
        />
        <Tira
          etiqueta="Cancelado"
          valor={corte.cancelado.total_formateado}
          nota={`${corte.cancelado.unidades} ${corte.cancelado.unidades === 1 ? 'platillo' : 'platillos'}`}
        />
      </div>

      <div className="pestanas" style={{ marginTop: 18 }}>
        {[
          ['resumen', 'Resumen'],
          ['platillos', 'Qué se vendió'],
          ['cuentas', 'Cuentas cobradas'],
        ].map(([valor, nombre]) => (
          <button
            key={valor}
            className={vista === valor ? 'boton activa' : 'boton'}
            onClick={() => setVista(valor)}
          >
            {nombre}
          </button>
        ))}
      </div>

      {vista === 'resumen' && (
        <>
          <Seccion titulo="Cómo pagaron" vacio="Todavía no se cobra nada hoy.">
            {corte.metodos.map((m) => (
              <Renglon
                key={m.metodo}
                nombre={METODOS[m.metodo] ?? m.metodo}
                detalle={`${m.cobros} ${m.cobros === 1 ? 'cobro' : 'cobros'}`}
                monto={m.total_formateado}
                proporcion={corte.cobrado_centavos ? m.total_centavos / corte.cobrado_centavos : 0}
              />
            ))}
          </Seccion>

          <Seccion titulo="Por mesero" vacio="Nadie ha cerrado cuentas hoy.">
            {corte.meseros.map((m) => (
              <Renglon
                key={m.mesero}
                nombre={m.mesero}
                detalle={`${m.cuentas} ${m.cuentas === 1 ? 'cuenta' : 'cuentas'}`}
                monto={m.total_formateado}
                proporcion={corte.cobrado_centavos ? m.total_centavos / corte.cobrado_centavos : 0}
              />
            ))}
          </Seccion>

          {/* A que horas entra el dinero: es lo que dice cuando conviene tener
              mas gente en el turno. */}
          <Seccion titulo="A qué hora se cobró" vacio="Sin movimiento todavía.">
            <div className="horas">
              {corte.horas.map((h) => {
                const mayor = Math.max(...corte.horas.map((x) => x.total_centavos), 1);
                return (
                  <div key={h.hora} className="hora">
                    <div className="columna">
                      <div
                        className="relleno-columna"
                        style={{ height: `${Math.max(4, (h.total_centavos / mayor) * 100)}%` }}
                        title={h.total_formateado}
                      />
                    </div>
                    <span className="etiqueta-hora">{h.hora}</span>
                    <span className="monto-hora">{h.total_formateado}</span>
                  </div>
                );
              })}
            </div>
          </Seccion>
        </>
      )}

      {vista === 'platillos' && (
        <>
          <Seccion titulo="Por categoría" vacio="No se ha pedido nada hoy.">
            {corte.categorias.map((c) => (
              <Renglon
                key={c.categoria}
                nombre={c.categoria}
                esCategoria
                detalle={`${c.unidades} ${c.unidades === 1 ? 'pieza' : 'piezas'}`}
                monto={c.total_formateado}
                proporcion={corte.vendido_centavos ? c.total_centavos / corte.vendido_centavos : 0}
              />
            ))}
          </Seccion>

          <Seccion titulo="Platillo por platillo" vacio="No se ha pedido nada hoy.">
            {corte.platillos.map((p) => (
              <Renglon
                key={`${p.platillo_id}-${p.nombre}`}
                nombre={p.nombre}
                detalle={`${p.unidades} ${p.unidades === 1 ? 'pieza' : 'piezas'}`}
                monto={p.total_formateado}
                proporcion={
                  corte.platillos.length
                    ? p.unidades / Math.max(...corte.platillos.map((x) => x.unidades))
                    : 0
                }
              />
            ))}
          </Seccion>
        </>
      )}

      {vista === 'cuentas' && (
        <Seccion titulo="Cuentas ya cobradas" vacio="Todavía no se cierra ninguna cuenta hoy.">
          {historial.map((c) => (
            <div key={c.id} className="renglon-reporte">
              <div className="info">
                <div className="nombre">
                  {c.mostrador ? 'Mostrador' : `Mesa ${c.mesa_numero ?? '—'}`}
                  {c.etiqueta ? ` · ${c.etiqueta}` : ''}
                </div>
                <div className="detalle">
                  {(c.cerrado_en ?? c.creado_en)?.slice(11, 16)}
                  {c.mesera ? ` · ${c.mesera}` : ''}
                  {c.metodo_pago ? ` · ${METODOS[c.metodo_pago] ?? c.metodo_pago}` : ''}
                  {c.estado === 'cancelada' ? ' · cancelada' : ''}
                </div>
              </div>
              <span className="monto">{c.total_formateado}</span>
            </div>
          ))}
        </Seccion>
      )}
    </>
  );
}

/** Numero grande del corte. El principal va mas grande porque es el que se lee. */
function Tira({ etiqueta, valor, nota, principal = false, alerta = false }) {
  return (
    <div className={`tira${principal ? ' principal' : ''}${alerta ? ' alerta' : ''}`}>
      <span className="etiqueta">{etiqueta}</span>
      <span className="valor">{valor}</span>
      {nota && <span className="nota">{nota}</span>}
    </div>
  );
}

function Seccion({ titulo, children, vacio }) {
  const hayAlgo = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section className="seccion-reporte">
      <h2>{titulo}</h2>
      {hayAlgo ? children : <p className="sin-datos">{vacio}</p>}
    </section>
  );
}

/**
 * Renglon con barra de proporcion detras. La barra no es adorno: deja ver de un
 * vistazo cual metodo o cual platillo domina, sin leer los numeros uno por uno.
 */
function Renglon({ nombre, detalle, monto, proporcion = 0, esCategoria = false }) {
  return (
    <div className="renglon-reporte">
      <div className="barra-proporcion" style={{ width: `${Math.round(proporcion * 100)}%` }} />
      <div className="info">
        <div className={esCategoria ? 'nombre categoria-nombre' : 'nombre'}>{nombre}</div>
        {detalle && <div className="detalle">{detalle}</div>}
      </div>
      <span className="monto">{monto}</span>
    </div>
  );
}
