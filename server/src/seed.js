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
  //
  // Los tacos de panza, tripa de puerco, buche, carnitas y revuelto valen lo
  // mismo ($45); el de tripa vale $50 y por eso va aparte.
  ['Taco de panza', 45, 'tacos'],
  ['Taco de tripa de puerco', 45, 'tacos'],
  ['Taco de buche', 45, 'tacos'],
  ['Taco de carnitas', 45, 'tacos'],
  ['Taco de revuelto', 45, 'tacos'],
  ['Taco de tripa', 50, 'tacos'],

  // Planchada y pellizcada cuestan $100 sea cual sea la carne, asi que van como
  // un solo boton cada una en vez de uno por carne: son doce botones menos que
  // picar en hora pico, todos al mismo precio. Que carne lleva se pone en la
  // nota del platillo cuando hace falta.
  ['Planchada', 100, 'especialidades'],
  ['Pellizcada', 100, 'especialidades'],

  // Las bebidas van por tamano y no por sabor: el agua fresca cambia de sabor
  // cada dia y poner un boton por sabor obligaria a editar el menu cada manana.
  // Cual sabor se llevo se pone en la nota del platillo cuando hace falta.
  ['Agua fresca 1 litro', 30, 'bebidas'],
  ['Agua fresca 1/2 litro', 20, 'bebidas'],
  ['Coca Cola 500 ml', 25, 'bebidas'],
  ['Coca Cola 600 ml', 30, 'bebidas'],
  ['Topo Chico', 30, 'bebidas'],
  ['Agua embotellada 500 ml', 10, 'bebidas'],
];

// `npm run seed -- --purgar` ademas TIRA las ventas de los platillos que salen
// del menu. Es irreversible y por eso hay que pedirlo a mano: sin la bandera,
// un platillo con historial solo se oculta.
const PURGAR = process.argv.includes('--purgar');

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

  // La lista MENU de arriba es la verdad: lo que esta ahi queda con su precio y
  // su orden, y lo que NO esta se quita del menu.
  //
  // Se actualiza en vez de solo insertar porque si no, cambiar un precio aqui
  // no servia de nada: el platillo ya existia y se saltaba.
  const existe = db.prepare('SELECT id FROM platillos WHERE nombre = ?');
  const insertarPlatillo = db.prepare(
    `INSERT INTO platillos (nombre, precio_centavos, categoria, orden, disponible)
     VALUES (?, ?, ?, ?, 1)`
  );
  const actualizarPlatillo = db.prepare(
    `UPDATE platillos
        SET precio_centavos = ?, categoria = ?, orden = ?, disponible = 1
      WHERE id = ?`
  );
  MENU.forEach(([nombre, precio, categoria], i) => {
    const previo = existe.get(nombre);
    if (previo) actualizarPlatillo.run(pesosACentavos(precio), categoria, i, previo.id);
    else insertarPlatillo.run(nombre, pesosACentavos(precio), categoria, i);
  });

  // Lo que ya no esta en el menu. Se borra solo si nunca se vendio; si tiene
  // ventas encima, borrarlo se llevaria entre las patas los renglones de esas
  // ventas y el corte de los dias pasados dejaria de cuadrar. Esos se ocultan
  // (disponible = 0): desaparecen de las tablets, pero el historial se salva.
  //
  // Para tirar tambien los que tienen historial esta `npm run seed -- --purgar`,
  // que es una decision aparte y a proposito incomoda de tomar.
  const nombresMenu = MENU.map(([nombre]) => nombre);
  const marcadosMenu = nombresMenu.map(() => '?').join(', ');
  const fuera = db
    .prepare(`SELECT id, nombre FROM platillos WHERE nombre NOT IN (${marcadosMenu})`)
    .all(...nombresMenu);

  const vecesPedido = db.prepare(
    'SELECT COUNT(*) AS n FROM comanda_items WHERE platillo_id = ?'
  );
  const borrarPlatillo = db.prepare('DELETE FROM platillos WHERE id = ?');
  const ocultarPlatillo = db.prepare('UPDATE platillos SET disponible = 0 WHERE id = ?');

  const borrados = [];
  const ocultados = [];
  for (const { id, nombre } of fuera) {
    const { n } = vecesPedido.get(id);
    if (n === 0) {
      borrarPlatillo.run(id);
      borrados.push(nombre);
    } else if (PURGAR) {
      // El encargado pidio explicitamente tirar el historial. Se borra en orden
      // hijo -> padre para no dejar renglones apuntando a lo que ya no existe:
      // los items de ese platillo, y despues las comandas y pagos que se
      // quedaron sin ningun item.
      db.prepare('DELETE FROM comanda_items WHERE platillo_id = ?').run(id);
      borrarPlatillo.run(id);
      borrados.push(nombre);
    } else {
      ocultarPlatillo.run(id);
      ocultados.push(nombre);
    }
  }

  if (PURGAR) {
    // Comandas que se quedaron sin un solo platillo: ya no representan ninguna
    // venta. Primero sus pagos, luego ellas, para respetar las llaves foraneas.
    db.exec(`
      DELETE FROM pagos
       WHERE comanda_id IN (
         SELECT c.id FROM comandas c
          WHERE NOT EXISTS (SELECT 1 FROM comanda_items i WHERE i.comanda_id = c.id)
       );
      DELETE FROM comandas
       WHERE NOT EXISTS (SELECT 1 FROM comanda_items i WHERE i.comanda_id = comandas.id);
    `);
  }

  if (borrados.length > 0) {
    console.log(`Se quitaron del menu: ${borrados.join(', ')}.`);
  }
  if (ocultados.length > 0) {
    console.log(
      `Ya no aparecen en las tablets (tienen ventas, se conserva el historial): ` +
        `${ocultados.join(', ')}.`
    );
  }
});

sembrar();

const mesas = db.prepare('SELECT COUNT(*) AS n FROM mesas').get().n;
const platillos = db.prepare('SELECT COUNT(*) AS n FROM platillos').get().n;
const meseros = db.prepare('SELECT COUNT(*) AS n FROM meseros').get().n;
console.log(`Listo: ${mesas} mesas, ${meseros} meseros, ${platillos} platillos en el menu.`);
db.close();
