# Pasar el sistema a otra computadora

Guía para mover Tacos Los Algodones a la computadora que va a quedarse en el
local. Son tres pasos y no hace falta saber de computadoras.

---

## Antes de empezar

En la computadora **nueva** necesitas:

- **Windows** (10 u 11).
- **Node.js**, versión LTS. Se baja de <https://nodejs.org> — el botón grande de
  la izquierda. Se instala dándole Siguiente a todo.
- Estar conectada al **mismo WiFi que las tablets**.
- **Internet**, solo para bajar el proyecto la primera vez. Despues el sistema
  funciona sin internet: todo ocurre dentro del WiFi del local.

Conviene que sea una computadora que se quede prendida y que nadie apague ni
use para otra cosa.

---

## Paso 1 — Bajar el proyecto

El proyecto vive en GitHub, en un repositorio **privado** (solo tuyo). Desde la
computadora nueva:

1. Abre el navegador y entra a
   <https://github.com/JorgeNunez12/taqueriaLosAlgodones>
2. Si te pide iniciar sesion, entra con tu cuenta.
3. Boton verde **"Code"** -> **"Download ZIP"**
4. Descomprime el ZIP en `C:\taqueria`
   (clic derecho sobre el archivo -> "Extraer todo")

> **Ojo: el ZIP NO trae las ventas.** Trae el sistema, no los datos. Eso es a
> proposito: el historial es informacion del negocio y no debe vivir en
> internet. Para llevarte las ventas de la computadora vieja, ve al final de
> esta guia ("Pasar el historial de ventas").
>
> Si vas a empezar de cero en la taqueria, no tienes que hacer nada: el sistema
> crea una base vacia al arrancar.

---

## Paso 1.5 — Poner la clave del encargado

La clave no viene en el ZIP (si viniera, estaria publicada junto con el codigo).
Hay que ponerla una vez en la computadora nueva:

1. Entra a la carpeta `server`
2. Busca el archivo **`.env.ejemplo`** y hazle una copia
3. A la copia ponle de nombre **`.env`** (sin `.ejemplo`)
4. Abrelo con el Bloc de notas y escribe la clave que quieras:

```
TAQUERIA_USUARIO=algodones
TAQUERIA_CLAVE=la-clave-que-tu-decidas
```

Esa es la que van a usar para entrar a la pantalla del Encargado.

---

## Paso 2 — Instalar

En la computadora nueva, dentro de la carpeta:

1. Busca **INSTALAR.bat**
2. **Clic derecho → "Ejecutar como administrador"**
   (si le das doble clic normal, te va a avisar que faltan permisos)
3. Espera. Tarda unos minutos la primera vez.

El instalador solo:

- Revisa que Node esté instalado y sea suficientemente nuevo.
- Instala lo que el servidor necesita y compila la app de las tablets.
- **Deja el servidor arrancando solo** cada vez que prenda la computadora.
- **Programa un respaldo diario** a las 5:00 AM.
- Abre el puerto en el Firewall para que entren las tablets.

Al terminar te muestra la dirección que hay que teclear en las tablets.

---

## Paso 3 — Conectar las tablets

En cada tablet, abre el navegador y entra a la dirección que dio el instalador:

```
http://192.168.1.XXX:3000
```

(los números cambian según la red — usa los que salieron en pantalla)

Luego:

1. Elige para qué sirve esa tablet: Meseros, Cocina, Caja o Encargado.
2. En iPad conviene "Compartir → Agregar a inicio" para que quede como app.

Clave del encargado: la que pusiste en `server/.env`

---

## Los botones, para qué es cada uno

| Archivo | Para qué |
|---|---|
| **INSTALAR.bat** | Una sola vez, al principio. Como administrador. |
| **DIAGNOSTICO.bat** | Cuando algo falla. Dice qué está mal en español. |
| **INICIAR.bat** | Levantar el servidor si se cayó. |
| **DETENER.bat** | Pararlo antes de mover o actualizar. |
| **RESPALDAR.bat** | Respaldo a mano, antes de algo delicado. |

---

## Si algo sale mal

**Corre DIAGNOSTICO.bat primero.** Te dice cuál de las piezas falla.

**Las tablets dicen "sin conexión"**
- ¿La computadora está prendida y en el mismo WiFi?
- ¿La dirección es la correcta? La IP cambia si el módem se reinicia. Corre
  DIAGNOSTICO.bat para ver la de ahora.
- Si cambia seguido, pídele a quien puso el internet que le deje **IP fija** a
  esa computadora.

**"Node.js no está instalado"**
- Instálalo de <https://nodejs.org> (versión LTS) y corre INSTALAR.bat otra vez.

**Se perdió todo / la base está dañada**
- En `server\datos\respaldos` están los últimos 30 días.
- Detén el sistema (DETENER.bat), copia el respaldo más reciente encima de
  `server\datos\taqueria.db` renombrándolo así, y vuelve a iniciar.

---

## Cuidados

- **La computadora no se apaga.** Si se apaga, no hay sistema; el servidor
  arranca solo al prenderla otra vez, pero mientras tanto no se puede cobrar.
- **Un no-break ayuda mucho.** Los datos aguantan un apagón (se probó), pero si
  se va la luz las tablets se quedan sin WiFi y no pueden mandar nada.
- **Los respaldos viven en la misma computadora.** Si se descompone el disco, se
  van con ella. Cada tanto copia la carpeta `respaldos` a una USB o a Drive.
- **Cambia la contraseña del encargado** si la sabe demasiada gente. Se hace
  arrancando el servidor con las variables `TAQUERIA_USUARIO` y `TAQUERIA_CLAVE`.

---

## Pasar el historial de ventas

Solo si quieres conservar las cuentas y cortes de la computadora vieja. Las dos
computadoras tienen que estar en el **mismo WiFi**.

**En la computadora vieja:**

1. Doble clic en **DETENER.bat** (para que la base no se copie a medias).
2. Abre la carpeta `server\datos`.
3. Clic derecho sobre la carpeta `datos` -> "Dar acceso a" -> "Usuarios
   especificos" -> elige "Todos" -> Compartir. Windows te da una direccion
   parecida a `\\DESKTOP-XXXX\datos`.

**En la computadora nueva:**

4. Abre el Explorador y pega esa direccion en la barra de arriba.
5. Copia el archivo `taqueria.db`.
6. Pegalo en `C:\taqueria\server\datos` (reemplaza el que este).
7. Arranca con **INICIAR.bat**.

Si no logras compartir la carpeta, la alternativa sencilla es subir ese unico
archivo a tu OneDrive desde la computadora vieja y bajarlo en la nueva. Pesa
unos 100 KB.
