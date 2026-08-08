# Servidor de la taquería

Servidor local (LAN, sin internet) para tomar pedidos, verlos en cocina y cobrarlos.

## Correr

```bash
npm install
npm run seed     # solo la primera vez: crea mesas, meseros y menú
npm start        # imprime la IP que hay que escribir en las tablets
npm test         # 81 pruebas
```

El local tiene **4 mesas**. Están en `NUM_MESAS` en `src/seed.js`, junto con los
nombres de los meseros (`MESEROS`) y el menú. Correr `seed` otra vez es
inofensivo: no duplica nada, y si se reduce `NUM_MESAS` quita las mesas de más
**solo si nunca se usaron** — una mesa con cuentas en el historial no se borra,
se avisa, porque borrarla dejaría ventas apuntando a una mesa inexistente.

Para dar de baja a un mesero sin perder su historial, ponle `activo = 0` en vez
de borrarlo.

En producción este servidor también sirve la PWA compilada (`../client/dist`),
así que las tablets abren la IP del mini PC y ya: un solo proceso prendido.
Antes hay que compilarla una vez con `cd ../client && npm run build`.

Para desarrollo se levantan los dos: `npm run dev` aquí (puerto 3000) y
`npm run dev` en `../client` (puerto 5173, con proxy hacia acá).

Requiere **Node 22.5 o superior** (usa `node:sqlite`, el SQLite incluido en Node —
no hay módulos nativos que compilar).

La base vive en `datos/taqueria.db`. Respaldarla es copiar ese archivo
(junto con `-wal` y `-shm` si existen).

## API

| Método | Ruta | Para qué |
| --- | --- | --- |
| GET | `/api/salud` | ¿está vivo el servidor? |
| GET | `/api/mesas` | mesas con sus comandas abiertas |
| GET | `/api/meseros` | quiénes pueden iniciar sesión en una tablet |
| GET | `/api/platillos?disponibles=1` | menú |
| GET | `/api/comandas?estado=abierta` | comandas (caja) |
| GET | `/api/comandas/:id` | una comanda con sus items, total, pagos y saldo |
| POST | `/api/comandas` | abrir cuenta: `{client_id, mesa_id, etiqueta, mesero_id}` |
| POST | `/api/comandas/:id/items` | mandar a cocina: `{items:[{client_id, platillo_id, cantidad, notas}]}` |
| POST | `/api/comandas/:id/pagos` | cobrar una parte (ver abajo) |
| POST | `/api/comandas/:id/cerrar` | cobrar todo el saldo: `{metodo_pago, client_id}` |
| PATCH | `/api/items/:id/estado` | cocina/mesera: `{estado}` |
| GET | `/api/cocina/pendientes` | cola de cocina agrupada por comanda |
| GET | `/api/reportes/corte?fecha=` | corte del día completo |
| GET | `/api/reportes/historial?fecha=` | cuentas ya cobradas de ese día |
| GET | `/api/reportes/dias` | días con ventas, para el selector de fecha |
| GET | `/api/reportes/pagos?fecha=` | cada movimiento de dinero del día |
| GET | `/api/admin/platillos` | menú completo, **incluidos los agotados** |
| POST | `/api/admin/platillos` | alta: `{nombre, precio, categoria}` |
| PATCH | `/api/admin/platillos/:id` | edita solo los campos que se manden |
| PATCH | `/api/admin/platillos/:id/disponible` | "se acabó" / "ya hay": `{disponible}` |
| DELETE | `/api/admin/platillos/:id` | solo si nunca se pidió (si no, 409) |
| GET | `/api/admin/meseros` | personal, **incluidos los inactivos** |
| POST | `/api/admin/meseros` | alta: `{nombre}` |
| PATCH | `/api/admin/meseros/:id` | `{nombre, activo}` |
| DELETE | `/api/admin/meseros/:id` | desactiva si ya atendió; borra si no |

### Reportes

`GET /api/reportes/corte` trae el día entero en una sola respuesta: lo cobrado,
el desglose por método de pago, ticket promedio, ventas por platillo y por
categoría, por mesero, por hora, lo cancelado y lo que falta por cobrar. Es una
sola pantalla y una sola pregunta ("¿cómo nos fue hoy?"); partirlo en cinco
endpoints obligaría a la tablet a hacer cinco viajes para pintar una vista.

**La fuente del dinero son los `pagos`, no las comandas.** Una comanda cerrada
dice "se cobró todo", pero lo que entró a la caja —con su método y su hora— está
renglón por renglón en `pagos`. Sumar comandas daría un número parecido y mal: se
perdería cómo se repartió entre efectivo y tarjeta, y las cuentas cobradas a
medias no aparecerían hasta cerrarse.

Por eso el corte distingue dos cosas que **no tienen por qué coincidir**:

- **vendido** — lo que se pidió (se mide en `comanda_items`, sin los cancelados).
- **cobrado** — lo que entró a la caja (se mide en `pagos`).

La diferencia es `por_cobrar.saldo`, o sea las cuentas todavía abiertas. Si al
cerrar el día el efectivo del cajón no cuadra con `metodos.efectivo`, la
diferencia es real y hay que buscarla; no es un artefacto del reporte.

El ticket promedio se divide entre **cuentas cerradas**, no entre pagos: una
cuenta que tres personas pagaron por separado es un ticket, no tres.

`fecha` acepta `YYYY-MM-DD`; cualquier otra cosa (incluido un intento de
inyección) cae en hoy en vez de llegar a la consulta.

### Administración

Antes esto se hacía editando `seed.js` y reiniciando. Servía para arrancar, pero
"se acabó el bistec" pasa a media hora pico y no puede exigir tocar código.

**Nada que tenga historial se borra.** Un platillo que ya salió en cuentas viejas
o un mesero que ya levantó cuentas no pueden desaparecer sin dejar ventas
apuntando a un id inexistente y romper los reportes hacia atrás:

- Platillo ya pedido → `DELETE` responde **409** y hay que marcarlo agotado.
- Mesero que ya atendió → `DELETE` lo **desactiva** (`activo = 0`) y conserva su
  historial. Solo se borra de verdad lo que nunca se usó, que típicamente es un
  alta mal escrita.
- Dar de alta a alguien con el nombre de un mesero inactivo lo **reactiva** en
  vez de crear un segundo registro, para no partir su historial en dos.

Cambiar el precio de un platillo **no mueve las cuentas ya abiertas**: cada item
guarda su `precio_unitario_centavos` al momento de pedirse.

Cada escritura del menú emite `menu:actualizado` por socket (y `meseros:actualizados`
para el personal): si se marca "se acabó" y la mesera lo sigue viendo en su
pantalla, lo va a vender.

### Cobro en partes

Una cuenta se puede cobrar en varios pagos, porque aunque la familia pidió todo
junto, a la hora de pagar cada quien saca lo suyo. `POST /api/comandas/:id/pagos`
acepta tres formas:

```jsonc
{ "tipo": "total",    "metodo": "efectivo" }                       // el saldo completo
{ "tipo": "items",    "item_ids": [4, 7], "metodo": "tarjeta" }    // platillos marcados
{ "tipo": "division", "monto_centavos": 6368 }                     // una parte de "entre N"
```

Cada comanda expone `total_centavos`, `pagado_centavos` y `saldo_centavos`, y
cada item trae `pagado`. **El saldo lo calcula el servidor**, por lo mismo que el
total: si cada tablet lo sumara por su cuenta, dos cajas cobrando la misma mesa
podrían discrepar.

Un pago no puede pasarse del saldo, un platillo no se puede cobrar dos veces, y
un platillo ya pagado **no se puede cancelar** — eso dejaría el total por debajo
de lo cobrado, o sea saldo negativo, y el sistema no tiene cómo devolver dinero.

Cuando el saldo llega a cero la comanda se cierra y la mesa se libera **en la
misma transacción** del último pago. Cerrar es consecuencia de que ya no se debe
nada, no una acción aparte: así no existe el estado "pagada pero abierta".

### Eventos de Socket.io

El cliente emite `registrar` con `{rol: 'mesera' | 'cocina' | 'caja'}` para entrar
a su canal, y `sincronizar` (con callback) al conectar o reconectar para bajar el
estado completo.

El servidor emite: `comanda:nueva`, `comanda:actualizada`, `comanda:cerrada`,
`item:estado`, `mesas:actualizadas`, `cocina:pendientes` (solo a cocina) y
`aviso:platillo-listo` (solo a meseras).

## Dos reglas que no se pueden romper

**1. El dinero es entero, en centavos.** `precio_centavos`, `total_centavos`.
Las respuestas también traen `total` en pesos por comodidad, pero la cuenta
oficial es la entera. Nada de sumar floats.

**2. Todo lo que la tablet manda lleva `client_id` (UUID).** Es lo que permite
que una tablet que perdió el WiFi reenvíe el pedido sin duplicarlo: el servidor
ignora los `client_id` que ya vio y contesta cuáles fueron duplicados. Sin eso
no hay forma de distinguir un reenvío de una segunda orden idéntica legítima.

El `client_id` se genera **antes** de mandar y se guarda en IndexedDB junto con
el pedido pendiente. Al reconectar se reenvía la cola completa tal cual: los
renglones que ya entraron regresan en `duplicados` y se descartan de la cola.

Esto también aplica a los **pagos**, donde importa más que en ningún otro lado:
si la caja pierde la respuesta y reintenta, el servidor reconoce el `client_id` y
devuelve el pago que ya había registrado en vez de cobrarle otra vez al cliente.

## Migraciones

`schema.sql` corre en cada arranque, pero `CREATE TABLE IF NOT EXISTS` no toca
una tabla que ya existe: sobre la base de un local que ya venía operando, no
agregaría las columnas nuevas. Eso lo hace `migrar()` en `src/db.js`, con
`ALTER TABLE` guardado tras revisar `PRAGMA table_info`.

Ojo con el orden: un `CREATE INDEX` sobre una columna que agrega la migración
tiene que ir **en la migración**, no en `schema.sql`, porque ahí correría antes
del `ALTER TABLE` y tumbaría el arranque.
