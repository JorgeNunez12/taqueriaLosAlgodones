// El unico lugar donde vive el estado compartido de la taqueria.
//
// Las tres pantallas leen de aqui. Dos cosas que parecen detalle y no lo son:
//
// 1. Al (re)conectar se pide el estado COMPLETO y se reemplaza, no se parchea.
//    Mientras la tablet estuvo caida se perdieron eventos; parchear dejaria
//    la pantalla mostrando pedidos que ya se cobraron.
//
// 2. La cola se drena DESPUES de sincronizar y en orden estricto, uno por uno.
//    En orden porque "abrir comanda" tiene que entrar antes que "agregar items
//    a esa comanda". Uno por uno porque si el segundo envio falla, el tercero
//    tampoco debe salir: se queda todo en la cola para el siguiente intento.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorApi, ErrorDeRed, ejecutarEnvio } from './api.js';
import { obtenerSocket, sincronizar } from './socket.js';
import * as cola from './cola.js';

export function usarTaqueria(rol) {
  const [conectado, setConectado] = useState(false);
  const [sincronizado, setSincronizado] = useState(false);
  const [mesas, setMesas] = useState([]);
  const [comandas, setComandas] = useState([]);
  const [cocina, setCocina] = useState([]);
  const [pendientes, setPendientes] = useState(0);
  const [avisos, setAvisos] = useState([]);

  // Evita dos drenados simultaneos (ej. el de "conectado" y el de un envio
  // nuevo cayendo al mismo tiempo), que reenviarian los mismos renglones.
  const drenando = useRef(false);

  const refrescarPendientes = useCallback(async () => {
    setPendientes(await cola.contar());
  }, []);

  /** Manda lo que este en la cola, en orden. Se detiene al primer fallo de red. */
  const drenar = useCallback(async () => {
    if (drenando.current) return;
    drenando.current = true;
    try {
      const envios = await cola.listar();
      for (const envio of envios) {
        try {
          await ejecutarEnvio(envio);
          // Salio (o el servidor contesto que ya lo tenia): fuera de la cola.
          await cola.borrar(envio.seq);
        } catch (err) {
          if (err instanceof ErrorDeRed) {
            // Se volvio a caer la red. Lo que falta se queda para el proximo
            // intento, en orden; salir del ciclo evita quemar reintentos.
            break;
          }
          // El servidor SI contesto, y contesto que no. Reintentar no va a
          // cambiar la respuesta: un platillo agotado seguira agotado y una
          // comanda cerrada seguira cerrada. Se saca de la cola y se avisa,
          // porque dejarlo ahi trabaria todos los envios que vienen detras.
          await cola.borrar(envio.seq);
          setAvisos((previos) => [
            ...previos,
            {
              id: `rechazo-${envio.seq}`,
              tipo: 'error',
              texto:
                err instanceof ErrorApi
                  ? `No se pudo enviar: ${err.message}`
                  : `No se pudo enviar un pedido pendiente`,
            },
          ]);
        }
      }
    } finally {
      drenando.current = false;
      await refrescarPendientes();
    }
  }, [refrescarPendientes]);

  /**
   * Mete o reemplaza una comanda en la lista. Si ya no esta abierta (se cobro
   * o se cancelo), se QUITA en vez de guardarse.
   *
   * Se usa desde los eventos de socket Y desde la respuesta del POST. Esto
   * ultimo importa: al abrir una cuenta, la pantalla salta de inmediato a
   * capturar, y si esperara al evento `comanda:nueva` para conocerla, ese
   * primer render la buscaria en una lista donde todavia no esta. El POST ya
   * devuelve la comanda completa, asi que no hay razon para esperar.
   *
   * El caso que esto arregla: la caja cobra una cuenta y `enviar()` aplica de
   * inmediato la respuesta del POST (`resultado.comanda`), que ya viene con
   * `estado: 'cerrada'`. Sin este filtro esa comanda se quedaba en la lista
   * local de ESA tablet hasta que llegara el evento `mesas:actualizadas`, y en
   * ese hueco la mesa la seguia mostrando (a veces en $0, porque el total ya
   * se habia recalculado contra el saldo pagado).
   */
  const guardarComanda = useCallback((comanda) => {
    if (!comanda?.id) return;
    if (comanda.estado !== 'abierta') {
      setComandas((previas) => previas.filter((c) => c.id !== comanda.id));
      return;
    }
    setComandas((previas) =>
      previas.some((c) => c.id === comanda.id)
        ? previas.map((c) => (c.id === comanda.id ? comanda : c))
        : [...previas, comanda]
    );
  }, []);

  /** Baja el estado completo del servidor y reemplaza lo que haya en pantalla. */
  const recargar = useCallback(async (socket) => {
    try {
      const estado = await sincronizar(socket);
      setMesas(estado.mesas ?? []);
      setComandas(estado.comandas ?? []);
      setCocina(estado.cocina ?? []);
      setSincronizado(true);
      return true;
    } catch {
      setSincronizado(false);
      return false;
    }
  }, []);

  useEffect(() => {
    const socket = obtenerSocket();

    const alConectar = async () => {
      setConectado(true);
      socket.emit('registrar', { rol });
      // Sincronizar primero, drenar despues: si la cola trae "cerrar comanda 7"
      // queremos partir de un estado real, no de uno de hace media hora.
      const ok = await recargar(socket);
      if (ok) await drenar();
    };

    const alDesconectar = () => {
      setConectado(false);
      setSincronizado(false);
    };

    // --- Eventos incrementales (solo mientras hay conexion viva) ---

    const alComandaNueva = (comanda) => guardarComanda(comanda);
    const alComandaActualizada = (comanda) => guardarComanda(comanda);

    const alComandaCerrada = (comanda) =>
      setComandas((previas) => previas.filter((c) => c.id !== comanda.id));

    const alMesas = (nuevas) => setMesas(nuevas);
    const alCocina = (nuevos) => setCocina(nuevos);

    const alItemEstado = ({ item, comanda_id }) =>
      setComandas((previas) =>
        previas.map((c) =>
          c.id !== comanda_id
            ? c
            : { ...c, items: c.items.map((i) => (i.id === item.id ? { ...i, ...item } : i)) }
        )
      );

    const alPlatilloListo = ({ item, mesa_numero, etiqueta }) =>
      setAvisos((previos) => [
        ...previos,
        {
          id: `listo-${item.id}-${Date.now()}`,
          tipo: 'listo',
          texto: `Mesa ${mesa_numero}${etiqueta ? ` (${etiqueta})` : ''}: ${item.cantidad}× ${item.nombre_snapshot}`,
        },
      ]);

    socket.on('connect', alConectar);
    socket.on('disconnect', alDesconectar);
    socket.on('comanda:nueva', alComandaNueva);
    socket.on('comanda:actualizada', alComandaActualizada);
    socket.on('comanda:cerrada', alComandaCerrada);
    socket.on('mesas:actualizadas', alMesas);
    socket.on('cocina:pendientes', alCocina);
    socket.on('item:estado', alItemEstado);
    socket.on('aviso:platillo-listo', alPlatilloListo);

    if (socket.connected) alConectar();
    refrescarPendientes();

    return () => {
      socket.off('connect', alConectar);
      socket.off('disconnect', alDesconectar);
      socket.off('comanda:nueva', alComandaNueva);
      socket.off('comanda:actualizada', alComandaActualizada);
      socket.off('comanda:cerrada', alComandaCerrada);
      socket.off('mesas:actualizadas', alMesas);
      socket.off('cocina:pendientes', alCocina);
      socket.off('item:estado', alItemEstado);
      socket.off('aviso:platillo-listo', alPlatilloListo);
    };
  }, [rol, recargar, drenar, refrescarPendientes, guardarComanda]);

  /**
   * Manda algo al servidor. Si la red falla, lo deja en la cola y avisa que
   * quedo pendiente en vez de tirar el pedido. El client_id ya viene puesto
   * por quien llama: se genera antes de intentar, no aqui.
   */
  const enviar = useCallback(
    async (envio) => {
      try {
        const resultado = await ejecutarEnvio(envio);

        // Aplicar de una vez la comanda que devolvio el servidor, sin esperar
        // el evento de socket. Quien manda casi siempre necesita verla en el
        // render siguiente (abrir cuenta salta directo a capturar en ella), y
        // el socket puede tardar un instante mas: ese hueco dejaba la pantalla
        // buscando una comanda que todavia no estaba en la lista.
        // La forma de la respuesta cambia segun el envio.
        if (envio.tipo === 'comanda') guardarComanda(resultado);
        else if (resultado?.comanda) guardarComanda(resultado.comanda);

        return { ok: true, resultado, encolado: false };
      } catch (err) {
        if (err instanceof ErrorDeRed) {
          await cola.encolar(envio);
          await refrescarPendientes();
          return { ok: true, resultado: null, encolado: true };
        }
        return { ok: false, error: err, encolado: false };
      }
    },
    [refrescarPendientes, guardarComanda]
  );

  const descartarAviso = useCallback(
    (id) => setAvisos((previos) => previos.filter((a) => a.id !== id)),
    []
  );

  return {
    conectado,
    sincronizado,
    mesas,
    comandas,
    cocina,
    pendientes,
    avisos,
    enviar,
    drenar,
    descartarAviso,
  };
}
