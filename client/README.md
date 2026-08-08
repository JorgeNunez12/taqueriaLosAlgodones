# PWA de Tacos Los Algodones

Las cuatro pantallas (mesera, cocina, caja, encargado) en una sola app. Cada
tablet elige su rol la primera vez que abre y se queda guardado.

## Correr

```bash
npm install
npm run dev      # desarrollo, puerto 5173 (hace proxy al servidor en 3000)
npm run build    # compila a dist/, que es lo que sirve el servidor
npm test         # 19 pruebas
```

Para usarla en el local: `npm run build` una vez, y luego levantar solo el
servidor. Las tablets abren la IP que imprime al arrancar.

## Diseño

La paleta sale del logo: negro carbón, naranja de fuego, amarillo de flama y el
crema de la tortilla. La marca se lleva **la barra superior, los títulos y los
acentos**, no el lienzo: el fondo se mantiene claro aunque el logo sea negro,
porque con el sol pegando en la pantalla el fondo oscuro se vuelve espejo y el
papel blanco se sigue leyendo. El naranja se usa oscurecido (`--acento`) para
texto y bordes, porque el naranja puro del logo sobre blanco no alcanza
contraste AA.

El logo vive en `public/logo.png`; `public/icono-192.png` y `icono-512.png` son
el icono de la PWA, recortados a cuadrado sobre fondo negro.

Las áreas de toque son de 60px como mínimo. En cocina las manos vienen con
grasa y no pueden apuntar: se aprieta con el canto del dedo o el nudillo, y una
casilla chica simplemente no se acierta. Por eso al cobrar por platillos la fila
entera es el botón, no un checkbox al lado.

Sin animaciones ni adornos. Es una herramienta de trabajo, se mira de reojo y se
usa con prisa.

## Las cuatro pantallas

**Mesera** — primero se inicia sesión tocando el nombre (ver abajo). Luego la
rejilla de 4 mesas; se toca una para ver sus cuentas, entrar a una o abrir otra.
Una mesa sostiene varias cuentas a la vez, que aquí es lo normal y no la
excepción: dos familias que se sientan juntas piden y pagan por separado. La
tarjeta de cada mesa lista sus cuentas con su total, para ver cómo va el local
sin abrir nada. Adentro: menú por categorías, carrito con cantidades y notas, y
un botón para mandar a cocina. Los platillos que cocina marca como listos
aparecen con un botón "Entregué".

**Cocina** — cola de lo pendiente, ordenada por antigüedad y agrupada por
comanda. El borde y el encabezado cambian de color solos a los 5 y a los 10
minutos: la urgencia se ve de reojo desde la plancha, sin leer un reloj. Un
botón por platillo, con la única acción que toca (`Empezar` → `Listo`).

**Caja** — cuentas abiertas ordenadas por mesa, con su desglose. Al cobrar se
elige método de pago y, si es efectivo, se puede teclear con cuánto paga el
cliente para que calcule el cambio. Y se puede cobrar en partes: ver abajo.

**Encargado** — corte del día y configuración. Dos pestañas:

- **Corte del día** — lo cobrado en grande (es lo que se anota al cerrar la
  caja), ticket promedio, lo que falta por cobrar y lo cancelado. Abajo: cómo
  pagaron, por mesero, a qué hora se cobró, qué se vendió y las cuentas ya
  cobradas. Se puede ver el corte de un día anterior con el selector de fecha.
- **Menú y personal** — precios, altas de platillos y el botón de "se acabó" /
  "ya hay", que es el que más prisa tiene: un solo toque y el platillo
  desaparece del menú de las meseras al instante. También altas y bajas de
  meseros.

Es la única pantalla que **no** es de tiempo real, a propósito: un corte que se
mueve solo mientras se está cuadrando la caja es peor que uno quieto. Se baja al
abrir y se actualiza cuando se pide. Tampoco pasa por la cola de reintentos:
son consultas, y un reporte que no cargó se vuelve a pedir tocando la pantalla.

## Inicio de sesión del mesero

La tablet de meseros pide identificarse antes de trabajar: se toca el nombre de
una lista y queda registrado ahí hasta que le den "Salir". A partir de entonces
cada cuenta que abra sale a su nombre solo, sin escribirlo.

Antes había un campo de texto en cada cuenta nueva. Era teclear lo mismo veinte
veces por turno, y bastaba una prisa para dejarlo en blanco y perder el rastro
de quién atendió esa mesa.

No hay contraseña ni PIN. Esto es un registro de quién atiende, no una defensa
contra nadie: las tablets no salen del local y el local es cerrado. El nombre lo
pone el **servidor** a partir del id de la sesión, no la tablet, para que no
pueda quedar una cuenta a nombre de alguien que no existe.

Cocina y caja no inician sesión: son puestos fijos y pedirles identificarse cada
turno sería un estorbo sin nada a cambio.

La lista de meseros se guarda en `localStorage` al bajarla. Si el mini PC se
está reiniciando justo cuando alguien entra a trabajar, se puede iniciar sesión
con la última lista conocida en vez de quedarse afuera.

## Cobrar una cuenta en partes

Pasa seguido: la familia pide todo junto en una sola cuenta y a la hora de pagar
cada quien saca lo suyo. Antes había que adivinarlo al principio y abrir cuentas
separadas desde antes de pedir; eso solo se sabe al final.

El modal de cobro tiene tres pestañas:

- **Todo** — se paga el saldo completo. Es lo normal, por eso va primero.
- **Por cosas** — se marcan los platillos que paga esta persona. Los que ya
  cubrió un pago anterior salen atenuados y no se pueden volver a marcar.
- **Dividir** — se reparte el saldo en partes iguales, tocando entre cuántos.

Mientras quede saldo la cuenta **sigue abierta** y el modal se queda arriba con
el saldo nuevo, porque lo que sigue casi siempre es que pague el que va detrás.
Cuando el saldo llega a cero el servidor cierra la cuenta y libera la mesa solo,
en la misma transacción del último pago: no existe el estado "pagada pero
abierta".

Los centavos que no se pueden repartir parejo se le cargan a la **primera**
parte (`repartirEnPartes` en `dinero.js`). $191 entre 3 son 63.68 + 63.66 +
63.66. Si cada parte se redondeara por su cuenta, la caja terminaría el día con
dos o tres pesos de diferencia y nadie sabría de dónde salieron.

## Cómo sobrevive a que se caiga el WiFi

Es la razón de ser de casi todo el código de `cola.js` y `usarTaqueria.js`.

Cuando la mesera aprieta "mandar a cocina":

1. Se genera un `client_id` (UUID) por renglón **antes** de intentar mandar.
2. Se intenta el POST. Si el servidor contesta, listo.
3. Si **no hubo respuesta** (WiFi caído, mini PC reiniciándose), el envío
   completo —con sus `client_id` ya puestos— se guarda en IndexedDB. Para la
   mesera el pedido ya salió; puede seguir capturando.
4. Al reconectar se baja el estado completo (`sincronizar`) y **después** se
   drena la cola, en orden y uno por uno.
5. El servidor ignora los `client_id` que ya vio y los reporta en `duplicados`.

El paso 1 es el que hace que todo esto sea seguro. Si el `client_id` se generara
en el servidor, un reenvío tras perder la respuesta y una segunda orden idéntica
legítima ("otra ronda de lo mismo") serían indistinguibles, y habría que elegir
entre duplicar pedidos o perderlos.

Dos detalles del drenado que parecen menores y no lo son:

- **Sincronizar antes de drenar.** Si la cola trae "cerrar la comanda 7", hay
  que partir del estado real y no de uno de hace media hora.
- **Un fallo de red corta el drenado; un rechazo del servidor no.** Si se vuelve
  a caer la red, lo que falta se queda en la cola en orden. Pero si el servidor
  contestó que *no* (platillo agotado, comanda ya cerrada), reintentar no va a
  cambiar la respuesta: ese envío se saca de la cola y se avisa en pantalla,
  porque dejarlo ahí trabaría todos los que vienen detrás.

Cuando no hay conexión, una franja roja de ancho completo lo dice. Es
deliberadamente imposible de no ver: cambia lo que la mesera puede prometerle
al cliente.

## Qué NO se cachea

El *cascarón* de la app (JS, CSS, HTML) se sirve desde caché, así que abre
aunque el servidor esté apagado. Los **datos no se cachean nunca**: una pantalla
mostrando pedidos de hace una hora, sin señal de que están viejos, sería peor
que una pantalla vacía.

## El dinero

El total que se cobra es siempre `total_centavos` del servidor. `dinero.js` de
aquí es para pintar, no para decidir: si esta pantalla sumara por su cuenta y
se desfasara por un evento perdido, el corte de caja no cuadraría y nadie
sabría por qué.
