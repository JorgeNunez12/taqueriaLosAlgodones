-- Esquema de la taqueria.
--
-- Reglas de diseno que aplican a todo el archivo:
--   * El dinero SIEMPRE se guarda en centavos como INTEGER. SQLite no tiene
--     DECIMAL real: lo degrada a REAL (punto flotante) y las sumas arrastran
--     error. Con centavos enteros el corte de caja cuadra al centavo.
--   * client_id es un UUID que genera la tablet. Es lo que permite reenviar
--     un pedido despues de una caida de WiFi sin duplicarlo.
--   * Las fechas se guardan en hora local del local (un solo restaurante,
--     una sola zona horaria) para que los reportes por dia sean directos.

CREATE TABLE IF NOT EXISTS mesas (
  id     INTEGER PRIMARY KEY,
  numero INTEGER NOT NULL UNIQUE,
  estado TEXT    NOT NULL DEFAULT 'libre'
         CHECK (estado IN ('libre', 'ocupada'))
);

-- El mesero inicia sesion en la tablet tocando su nombre y queda registrado
-- ahi hasta que le den "Salir". No hay PIN: el local es cerrado, las tablets
-- no salen de el, y en hora pico un teclado numerico cuesta segundos que no
-- hay. Lo que se quiere de esto es saber quien levanto cada cuenta, no
-- proteger contra un atacante.
CREATE TABLE IF NOT EXISTS meseros (
  id     INTEGER PRIMARY KEY,
  nombre TEXT    NOT NULL UNIQUE,
  activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  orden  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS platillos (
  id               INTEGER PRIMARY KEY,
  nombre           TEXT    NOT NULL,
  precio_centavos  INTEGER NOT NULL CHECK (precio_centavos >= 0),
  categoria        TEXT    NOT NULL,
  disponible       INTEGER NOT NULL DEFAULT 1 CHECK (disponible IN (0, 1)),
  orden            INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_platillos_categoria ON platillos (categoria, orden);

-- Una mesa puede tener varias comandas abiertas al mismo tiempo:
-- dos familias distintas sentadas juntas, cuentas separadas.
--
-- mesa_id es NULL en las ventas de mostrador: alguien que llega, pide para
-- llevar y paga en la caja sin ocupar mesa. No es una mesa especial inventada
-- para el caso (esa apareceria en la pantalla de meseros y en el corte como si
-- fuera una mesa real); es la ausencia de mesa, que es justo lo que pasa.
CREATE TABLE IF NOT EXISTS comandas (
  id              INTEGER PRIMARY KEY,
  client_id       TEXT    UNIQUE,
  mesa_id         INTEGER REFERENCES mesas (id),
  etiqueta        TEXT,
  -- `mesera` es el nombre congelado al momento de abrir; `mesero_id` apunta al
  -- que inicio sesion. Se guardan los dos: el id sirve para reportes por
  -- persona, y el nombre sobrevive si algun dia se da de baja al mesero.
  mesera          TEXT,
  mesero_id       INTEGER REFERENCES meseros (id),
  estado          TEXT    NOT NULL DEFAULT 'abierta'
                  CHECK (estado IN ('abierta', 'cerrada', 'cancelada')),
  -- Cobro de cantidad libre: la caja escribio un monto sin picar platillos
  -- (un pedido por telefono, algo que no esta en el menu, una propina que el
  -- cliente quiere en el ticket). No tiene comanda_items, asi que su
  -- total_centavos NO se recalcula desde items: se fija al cobrar y se queda.
  -- Se marca para poder separarlas en el corte y vigilar que no se abuse del
  -- boton, que es dinero que entra sin decir de que fue.
  venta_libre     INTEGER NOT NULL DEFAULT 0 CHECK (venta_libre IN (0, 1)),
  concepto        TEXT,
  -- Cache denormalizado: se recalcula desde comanda_items dentro de la misma
  -- transaccion que modifica los items, nunca se edita por separado.
  total_centavos  INTEGER NOT NULL DEFAULT 0,
  metodo_pago     TEXT,
  creado_en       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  cerrado_en      TEXT
);

CREATE INDEX IF NOT EXISTS idx_comandas_mesa   ON comandas (mesa_id, estado);
CREATE INDEX IF NOT EXISTS idx_comandas_estado ON comandas (estado, creado_en);

-- Una cuenta puede cobrarse en varios pagos: aunque sean la misma mesa y la
-- misma comanda, a veces cada quien paga lo suyo. Cada renglon de aqui es
-- dinero que entro a la caja, con su metodo, y la suma de los pagos de una
-- comanda tiene que dar exactamente su total al cerrarla.
--
-- Dos formas de repartir, y por eso 'items' puede ir vacio:
--   'items'    -> se marcaron platillos concretos (quedan ligados por pago_id).
--   'division' -> "entre 3": no corresponde a platillos, solo a un monto.
--   'total'    -> se pago todo de un jalon, el caso de siempre.
CREATE TABLE IF NOT EXISTS pagos (
  id              INTEGER PRIMARY KEY,
  client_id       TEXT    UNIQUE,
  comanda_id      INTEGER NOT NULL REFERENCES comandas (id),
  monto_centavos  INTEGER NOT NULL CHECK (monto_centavos > 0),
  metodo          TEXT    NOT NULL DEFAULT 'efectivo',
  tipo            TEXT    NOT NULL DEFAULT 'items'
                  CHECK (tipo IN ('items', 'division', 'total')),
  creado_en       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_pagos_comanda ON pagos (comanda_id);
CREATE INDEX IF NOT EXISTS idx_pagos_fecha   ON pagos (creado_en);

CREATE TABLE IF NOT EXISTS comanda_items (
  id                       INTEGER PRIMARY KEY,
  client_id                TEXT    UNIQUE,
  comanda_id               INTEGER NOT NULL REFERENCES comandas (id),
  platillo_id              INTEGER NOT NULL REFERENCES platillos (id),
  -- Snapshot al momento de pedir: si el precio del platillo cambia a media
  -- tarde, las cuentas ya abiertas no se mueven.
  nombre_snapshot          TEXT    NOT NULL,
  precio_unitario_centavos INTEGER NOT NULL CHECK (precio_unitario_centavos >= 0),
  cantidad                 INTEGER NOT NULL CHECK (cantidad > 0),
  notas                    TEXT,
  estado                   TEXT    NOT NULL DEFAULT 'recibido'
                           CHECK (estado IN ('recibido', 'preparando', 'listo',
                                             'entregado', 'cancelado')),
  -- Que pago cubrio este platillo. NULL = todavia no lo paga nadie. Es lo que
  -- permite que en una misma cuenta uno pague sus tacos y otro los suyos:
  -- lo que falta cobrar son los items con pago_id NULL.
  pago_id                  INTEGER REFERENCES pagos (id),
  creado_en                TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  actualizado_en           TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_items_comanda ON comanda_items (comanda_id);
CREATE INDEX IF NOT EXISTS idx_items_estado  ON comanda_items (estado, creado_en);
-- idx_items_pago NO va aqui: sobre una base que ya venia operando, la columna
-- pago_id todavia no existe cuando este archivo corre, y CREATE INDEX sobre una
-- columna inexistente truena el arranque. Lo crea migrar() en db.js, despues
-- del ALTER TABLE.
