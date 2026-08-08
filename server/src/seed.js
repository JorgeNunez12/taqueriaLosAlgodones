// Carga inicial: mesas y menu de ejemplo. Ajusta los precios y platillos a los
// reales de la taqueria. Es idempotente: correrlo dos veces no duplica nada.

import { abrirDb } from './db.js';
import { pesosACentavos } from './dinero.js';

const NUM_MESAS = 4;

// Los meseros que pueden iniciar sesion en las tablets. Cambia los nombres por
// los reales; para dar de baja a alguien sin perder su historial de cuentas,
// pon activo = 0 en vez de borrarlo.
const MESEROS = ['sarahi', 'fanuel', 'gloria', 'mildred'];

const MENU = [
  // [nombre, precio en pesos, categoria]
  ['Taco de pastor', 22, 'tacos'],
  ['Taco de suadero', 24, 'tacos'],
  ['Taco de bistec', 26, 'tacos'],
  ['Taco de chorizo', 22, 'tacos'],
  ['Taco de campechano', 28, 'tacos'],
  ['Gringa', 65, 'especialidades'],
  ['Quesadilla de pastor', 55, 'especialidades'],
  ['Volcan', 38, 'especialidades'],
  ['Orden de pastor (1/4 kg)', 130, 'especialidades'],
  ['Refresco 600ml', 30, 'bebidas'],
  ['Agua de horchata', 35, 'bebidas'],
  ['Agua de jamaica', 35, 'bebidas'],
  ['Cerveza', 45, 'bebidas'],
  ['Consome', 25, 'extras'],
  ['Orden de cebollitas', 20, 'extras'],
  ['Guacamole', 25, 'extras'],
];

const db = abrirDb();

const sembrar = db.transaction(() => {
  const insertarMesa = db.prepare(
    'INSERT INTO mesas (numero) VALUES (?) ON CONFLICT (numero) DO NOTHING'
  );
  for (let n = 1; n <= NUM_MESAS; n++) insertarMesa.run(n);

  // El local paso de 12 mesas a 4. Las de mas se quitan, pero SOLO si nunca se
  // usaron: si alguna tiene comandas encima, borrarla dejaria cuentas apuntando
  // a una mesa que ya no existe y el historial de ventas quedaria roto. Esas se
  // reportan para decidir a mano.
  const sobrantes = db
    .prepare(
      `SELECT m.numero, COUNT(c.id) AS usos
         FROM mesas m LEFT JOIN comandas c ON c.mesa_id = m.id
        WHERE m.numero > ?
        GROUP BY m.id`
    )
    .all(NUM_MESAS);

  const borrarMesa = db.prepare('DELETE FROM mesas WHERE numero = ?');
  const conHistorial = [];
  for (const { numero, usos } of sobrantes) {
    if (usos === 0) borrarMesa.run(numero);
    else conHistorial.push(numero);
  }
  if (conHistorial.length > 0) {
    console.warn(
      `Aviso: las mesas ${conHistorial.join(', ')} tienen cuentas en el historial y no se ` +
        `borraron. Revisalas a mano si de verdad ya no existen.`
    );
  }

  // La lista MESEROS de arriba es la verdad: quien esta ahi queda activo (y con
  // el orden en que aparece), y quien NO esta se desactiva.
  //
  // Se desactiva en vez de borrarse porque las cuentas que ya levanto apuntan a
  // su id; borrarlo dejaria ventas huerfanas y el historial por mesero se
  // rompe. Un mesero inactivo no aparece en la pantalla de inicio de sesion,
  // que es lo que se busca al quitarlo de la lista.
  const insertarMesero = db.prepare(
    `INSERT INTO meseros (nombre, orden, activo) VALUES (?, ?, 1)
     ON CONFLICT (nombre) DO UPDATE SET orden = excluded.orden, activo = 1`
  );
  MESEROS.forEach((nombre, i) => insertarMesero.run(nombre, i));

  const marcados = MESEROS.map(() => '?').join(', ');
  const desactivados = db
    .prepare(`SELECT nombre FROM meseros WHERE activo = 1 AND nombre NOT IN (${marcados})`)
    .all(...MESEROS);
  db.prepare(`UPDATE meseros SET activo = 0 WHERE nombre NOT IN (${marcados})`).run(...MESEROS);

  if (desactivados.length > 0) {
    console.log(
      `Ya no aparecen para iniciar sesion: ${desactivados.map((m) => m.nombre).join(', ')}. ` +
        `Su historial de cuentas se conserva.`
    );
  }

  const existe = db.prepare('SELECT id FROM platillos WHERE nombre = ?');
  const insertarPlatillo = db.prepare(
    `INSERT INTO platillos (nombre, precio_centavos, categoria, orden)
     VALUES (?, ?, ?, ?)`
  );
  MENU.forEach(([nombre, precio, categoria], i) => {
    if (!existe.get(nombre)) insertarPlatillo.run(nombre, pesosACentavos(precio), categoria, i);
  });
});

sembrar();

const mesas = db.prepare('SELECT COUNT(*) AS n FROM mesas').get().n;
const platillos = db.prepare('SELECT COUNT(*) AS n FROM platillos').get().n;
const meseros = db.prepare('SELECT COUNT(*) AS n FROM meseros').get().n;
console.log(`Listo: ${mesas} mesas, ${meseros} meseros, ${platillos} platillos en el menu.`);
db.close();
