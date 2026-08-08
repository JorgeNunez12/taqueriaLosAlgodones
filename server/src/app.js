import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server as SocketServer } from 'socket.io';

import { abrirDb } from './db.js';
import { crearServicio, ErrorApi } from './servicio.js';
import { crearReportes, normalizarFecha } from './reportes.js';
import { crearAdmin } from './admin.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const RUTA_PWA = path.join(aqui, '..', '..', 'client', 'dist');

/**
 * Arma la aplicacion sin escuchar en ningun puerto. Las pruebas la levantan
 * en puerto 0 con una base en memoria; produccion usa index.js.
 */
export function crearApp({ db = abrirDb() } = {}) {
  const servicio = crearServicio(db);
  const reportes = crearReportes(db);
  const admin = crearAdmin(db);
  const app = express();
  const server = http.createServer(app);

  // Red local cerrada: cualquier dispositivo del WiFi de la taqueria entra.
  const io = new SocketServer(server, { cors: { origin: '*' } });

  app.use(cors());
  app.use(express.json({ limit: '256kb' }));

  // Cada pantalla se anuncia y entra a su cuarto, para poder mandar avisos
  // dirigidos (ej. "pedido listo" solo a las tablets de meseras).
  io.on('connection', (socket) => {
    socket.on('registrar', ({ rol } = {}) => {
      if (['mesera', 'cocina', 'caja', 'admin'].includes(rol)) socket.join(rol);
    });
    // Al conectar (o reconectar) la pantalla pide el estado completo.
    socket.on('sincronizar', (_, ack) => {
      if (typeof ack === 'function') {
        ack({
          mesas: servicio.listarMesas(),
          comandas: servicio.listarComandas({ estado: 'abierta' }),
          cocina: servicio.pendientesCocina(),
        });
      }
    });
  });

  /** Envuelve un handler para que los throw lleguen al manejador de errores. */
  const ruta = (fn) => (req, res, next) => {
    try {
      fn(req, res);
    } catch (err) {
      next(err);
    }
  };

  // --- Catalogo ---

  app.get('/api/salud', (_req, res) => res.json({ ok: true, hora: new Date().toISOString() }));

  app.get('/api/mesas', ruta((_req, res) => res.json(servicio.listarMesas())));

  // La tablet baja la lista al arrancar y la guarda: si el mini PC se reinicia
  // a media hora pico, el mesero no se queda sin poder iniciar sesion.
  app.get('/api/meseros', ruta((_req, res) => res.json(servicio.listarMeseros())));

  app.get(
    '/api/platillos',
    ruta((req, res) =>
      res.json(servicio.listarPlatillos({ soloDisponibles: req.query.disponibles === '1' }))
    )
  );

  // --- Comandas ---

  app.get(
    '/api/comandas',
    ruta((req, res) => res.json(servicio.listarComandas({ estado: req.query.estado ?? 'abierta' })))
  );

  app.get(
    '/api/comandas/:id',
    ruta((req, res) => res.json(servicio.obtenerComanda(Number(req.params.id))))
  );

  app.post(
    '/api/comandas',
    ruta((req, res) => {
      const { comanda, duplicada } = servicio.crearComanda(req.body ?? {});
      if (!duplicada) {
        io.emit('comanda:nueva', comanda);
        io.emit('mesas:actualizadas', servicio.listarMesas());
      }
      // 200 en vez de 201 cuando fue un reintento: nada nuevo se creo.
      res.status(duplicada ? 200 : 201).json(comanda);
    })
  );

  app.post(
    '/api/comandas/:id/items',
    ruta((req, res) => {
      const comandaId = Number(req.params.id);
      const cuerpo = req.body ?? {};
      const items = Array.isArray(cuerpo) ? cuerpo : cuerpo.items;
      const { comanda, agregados, duplicados } = servicio.agregarItems(comandaId, items);

      if (agregados.length > 0) {
        io.emit('comanda:actualizada', comanda);
        io.to('cocina').emit('cocina:pendientes', servicio.pendientesCocina());
      }
      res.status(201).json({
        comanda,
        agregados: agregados.length,
        duplicados: duplicados.map((d) => d.client_id),
      });
    })
  );

  app.post(
    '/api/comandas/:id/cerrar',
    ruta((req, res) => {
      const { comanda } = servicio.cerrarComanda(
        Number(req.params.id),
        req.body?.metodo_pago ?? 'efectivo',
        req.body?.client_id ?? null
      );
      io.emit('comanda:cerrada', comanda);
      io.emit('mesas:actualizadas', servicio.listarMesas());
      res.json(comanda);
    })
  );

  // Cobro parcial: platillos sueltos o una parte de la division. Si con este
  // pago se salda la cuenta, el servicio ya la cerro y aqui solo se avisa.
  app.post(
    '/api/comandas/:id/pagos',
    ruta((req, res) => {
      const { pago, comanda, cerrada } = servicio.registrarPago({
        ...(req.body ?? {}),
        comanda_id: Number(req.params.id),
      });

      if (cerrada) {
        io.emit('comanda:cerrada', comanda);
        io.emit('mesas:actualizadas', servicio.listarMesas());
      } else {
        io.emit('comanda:actualizada', comanda);
      }
      res.status(201).json({ pago, comanda, cerrada });
    })
  );

  // --- Items (cocina y meseras) ---

  app.patch(
    '/api/items/:id/estado',
    ruta((req, res) => {
      const { item, comanda } = servicio.cambiarEstadoItem(
        Number(req.params.id),
        req.body?.estado
      );
      io.emit('item:estado', { item, comanda_id: comanda.id, mesa_id: comanda.mesa_id });
      io.emit('comanda:actualizada', comanda);
      io.to('cocina').emit('cocina:pendientes', servicio.pendientesCocina());
      if (item.estado === 'listo') {
        io.to('mesera').emit('aviso:platillo-listo', {
          item,
          mesa_numero: comanda.mesa_numero,
          etiqueta: comanda.etiqueta,
        });
      }
      res.json({ item, comanda });
    })
  );

  app.get('/api/cocina/pendientes', ruta((_req, res) => res.json(servicio.pendientesCocina())));

  // --- Reportes (solo lectura) ---

  // Corte del dia completo en una sola respuesta: es una sola pantalla y una
  // sola pregunta ("¿como nos fue hoy?"). Partirlo obligaria a la tablet a
  // hacer cinco viajes para pintar una vista.
  app.get(
    '/api/reportes/corte',
    ruta((req, res) => res.json(reportes.corteDelDia(normalizarFecha(req.query.fecha))))
  );

  // Cuentas ya cobradas: lo que la caja consulta cuando el cliente vuelve a
  // preguntar por un cobro de hace rato.
  app.get(
    '/api/reportes/historial',
    ruta((req, res) => res.json(reportes.historial(normalizarFecha(req.query.fecha))))
  );

  app.get(
    '/api/reportes/dias',
    ruta((req, res) => res.json(reportes.diasConVentas(Number(req.query.limite) || 30)))
  );

  app.get(
    '/api/reportes/pagos',
    ruta((req, res) => res.json(reportes.pagosDelDia(normalizarFecha(req.query.fecha))))
  );

  // --- Administracion: menu y personal ---

  // Un cambio de menu tiene que llegar a las tablets que ya estan abiertas: si
  // se marca "se acabo el bistec" y la mesera sigue viendolo en su pantalla, va
  // a venderlo. Por eso cada escritura avisa por socket con el menu completo.
  const avisarMenu = () => io.emit('menu:actualizado', servicio.listarPlatillos());
  const avisarMeseros = () => io.emit('meseros:actualizados', servicio.listarMeseros());

  app.get('/api/admin/platillos', ruta((_req, res) => res.json(admin.listarPlatillos())));

  app.post(
    '/api/admin/platillos',
    ruta((req, res) => {
      const platillo = admin.crearPlatillo(req.body ?? {});
      avisarMenu();
      res.status(201).json(platillo);
    })
  );

  app.patch(
    '/api/admin/platillos/:id',
    ruta((req, res) => {
      const platillo = admin.actualizarPlatillo(Number(req.params.id), req.body ?? {});
      avisarMenu();
      res.json(platillo);
    })
  );

  // Atajo para el boton de "se acabo" / "ya hay", que es el cambio mas frecuente
  // y el que mas prisa tiene.
  app.patch(
    '/api/admin/platillos/:id/disponible',
    ruta((req, res) => {
      const platillo = admin.marcarDisponible(Number(req.params.id), req.body?.disponible);
      avisarMenu();
      res.json(platillo);
    })
  );

  app.delete(
    '/api/admin/platillos/:id',
    ruta((req, res) => {
      const resultado = admin.eliminarPlatillo(Number(req.params.id));
      avisarMenu();
      res.json(resultado);
    })
  );

  app.get('/api/admin/meseros', ruta((_req, res) => res.json(admin.listarMeseros())));

  app.post(
    '/api/admin/meseros',
    ruta((req, res) => {
      const mesero = admin.crearMesero(req.body ?? {});
      avisarMeseros();
      res.status(201).json(mesero);
    })
  );

  app.patch(
    '/api/admin/meseros/:id',
    ruta((req, res) => {
      const mesero = admin.actualizarMesero(Number(req.params.id), req.body ?? {});
      avisarMeseros();
      res.json(mesero);
    })
  );

  app.delete(
    '/api/admin/meseros/:id',
    ruta((req, res) => {
      const resultado = admin.eliminarMesero(Number(req.params.id));
      avisarMeseros();
      res.json(resultado);
    })
  );

  // --- PWA ---

  // En produccion el mismo servidor sirve la app compilada: las tablets abren
  // la IP del mini PC y ya, sin un segundo proceso que mantener prendido. Si
  // no hay build (desarrollo, donde Vite sirve en 5173), esto no se monta.
  if (fs.existsSync(RUTA_PWA)) {
    app.use(express.static(RUTA_PWA));
    // Cualquier ruta que no sea /api la resuelve la PWA: es una sola pagina y
    // recargar en una vista interna no debe dar 404.
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(RUTA_PWA, 'index.html')));
  }

  // --- Errores ---

  app.use((_req, res) => res.status(404).json({ error: 'ruta_no_encontrada' }));

  app.use((err, _req, res, _next) => {
    if (err instanceof ErrorApi) {
      return res.status(err.status).json({ error: err.codigo, mensaje: err.message });
    }
    console.error('[error no manejado]', err);
    res.status(500).json({ error: 'error_interno', mensaje: err.message });
  });

  return { app, server, io, servicio, reportes, admin, db };
}
