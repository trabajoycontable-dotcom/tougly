/**
 * TOUGLY - puente entre la app y Google Sheets.
 * Se pega en: Google Sheets > Extensiones > Apps Script.
 * Crea solo las pestañas "Lotes", "Movimientos", "Facturas" y "Ajustes".
 */

var TABLAS = {
  Lotes: ['id', 'color', 'cantidad', 'inicio', 'referencia', 'obs', 'creado', 'act', 'borrado'],
  Movimientos: ['id', 'loteId', 'fecha', 'tipo', 'cantidad', 'inicial', 'act', 'borrado', 'color', 'descripcion'],
  Facturas: ['id', 'cobradas', 'nota', 'act'],
};
var CLAVES = { lotes: 'Lotes', movs: 'Movimientos', facturas: 'Facturas' };
var NUMEROS = ['cantidad', 'inicio', 'creado', 'act', 'cobradas'];
var BOOLEANOS = ['borrado', 'inicial'];
var DESCRIPCION = {
  env1: 'Enviadas a La 30 (1ra)', dev1: 'Devueltas por La 30 (1ra)',
  env2: 'Enviadas a La 30 (2da)', dev2: 'Devueltas por La 30 (2da)',
  fin1: 'Finalizadas (solo 1)', fin2: 'Finalizadas',
};

// La app envía sus datos; se juntan con los de la hoja y se devuelven completos.
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var entrada = JSON.parse(e.postData.contents);
    var datos = leerTodo();
    for (var k in CLAVES) datos[k] = juntar(datos[k], entrada[k] || []);
    if ((entrada.coloresAct || 0) > (datos.coloresAct || 0)) {
      datos.colores = entrada.colores;
      datos.coloresAct = entrada.coloresAct;
    }
    escribirTodo(datos);
    datos.ok = true;
    return responder(datos);
  } catch (err) {
    return responder({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Abrir el enlace en el navegador muestra si funciona.
function doGet() {
  var datos = leerTodo();
  datos.ok = true;
  return responder(datos);
}

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function juntar(actual, nuevos) {
  var mapa = {};
  actual.forEach(function (x) { mapa[x.id] = x; });
  nuevos.forEach(function (x) {
    if (!x || !x.id) return;
    var y = mapa[x.id];
    if (!y || Number(x.act || 0) > Number(y.act || 0)) mapa[x.id] = x;
  });
  return Object.keys(mapa).map(function (id) { return mapa[id]; });
}

function hoja(nombre, columnas) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var h = ss.getSheetByName(nombre);
  if (!h) {
    h = ss.insertSheet(nombre);
    h.getRange(1, 1, 1, columnas.length).setValues([columnas]).setFontWeight('bold');
    h.setFrozenRows(1);
  }
  return h;
}

function leerTabla(nombre) {
  var cols = TABLAS[nombre];
  var h = hoja(nombre, cols);
  var n = h.getLastRow() - 1;
  if (n < 1) return [];
  var filas = h.getRange(2, 1, n, cols.length).getDisplayValues();
  return filas.filter(function (f) { return f[0]; }).map(function (f) {
    var o = {};
    cols.forEach(function (c, i) {
      if (c === 'color' && nombre === 'Movimientos') return;
      if (c === 'descripcion') return;
      var v = f[i];
      if (NUMEROS.indexOf(c) >= 0) v = Number(v) || 0;
      else if (BOOLEANOS.indexOf(c) >= 0) v = v === 'true' || v === 'TRUE' || v === 'VERDADERO';
      o[c] = v;
    });
    return o;
  });
}

function leerTodo() {
  var props = PropertiesService.getScriptProperties();
  var colores = props.getProperty('colores');
  return {
    lotes: leerTabla('Lotes'),
    movs: leerTabla('Movimientos'),
    facturas: leerTabla('Facturas'),
    colores: colores ? JSON.parse(colores) : null,
    coloresAct: Number(props.getProperty('coloresAct') || 0),
  };
}

function escribirTabla(nombre, lista, extra) {
  var cols = TABLAS[nombre];
  var h = hoja(nombre, cols);
  var filas = lista.map(function (o) {
    if (extra) extra(o);
    return cols.map(function (c) { return o[c] === undefined || o[c] === null ? '' : String(o[c]); });
  });
  if (h.getLastRow() > 1) h.getRange(2, 1, h.getLastRow() - 1, cols.length).clearContent();
  if (filas.length) {
    var r = h.getRange(2, 1, filas.length, cols.length);
    r.setNumberFormat('@');
    r.setValues(filas);
  }
}

function escribirTodo(datos) {
  var colorDe = {};
  datos.lotes.forEach(function (l) { colorDe[l.id] = l.color; });
  escribirTabla('Lotes', datos.lotes);
  escribirTabla('Movimientos', datos.movs.slice().sort(function (a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0; }),
    function (m) { m.color = colorDe[m.loteId] || ''; m.descripcion = DESCRIPCION[m.tipo] || m.tipo; });
  escribirTabla('Facturas', datos.facturas);
  datos.movs.forEach(function (m) { delete m.color; delete m.descripcion; });
  if (datos.colores) {
    var props = PropertiesService.getScriptProperties();
    props.setProperty('colores', JSON.stringify(datos.colores));
    props.setProperty('coloresAct', String(datos.coloresAct || 0));
  }
}
