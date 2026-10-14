'use strict';

/* ============================================================
   TOUGLY - control de hojas de cuero enviadas a La 30
   Todo se guarda primero en el celular (localStorage) y luego
   se copia a Google Sheets cuando hay internet.
   ============================================================ */

const CLAVE_DATOS = 'tougly-datos-v1';

// Tipos de movimiento de un lote
const TIPOS = {
  env1: { texto: 'Enviadas a La 30 (1ra)', corto: 'Enviadas 1ra' },
  dev1: { texto: 'Devueltas por La 30 (1ra)', corto: 'Devueltas 1ra' },
  env2: { texto: 'Enviadas a La 30 (2da)', corto: 'Enviadas 2da' },
  dev2: { texto: 'Devueltas por La 30 (2da)', corto: 'Devueltas 2da' },
  fin1: { texto: 'Finalizadas (solo 1 tougluada)', corto: 'Finalizadas' },
  fin2: { texto: 'Finalizadas', corto: 'Finalizadas' },
};

// Los 5 estados, con su color
const ESTADOS = [
  { k: 'e1', texto: 'En La 30 – 1ra tougluada', color: 'var(--e1)' },
  { k: 'd1', texto: 'Devuelta – 1ra lista', color: 'var(--e2)' },
  { k: 'e2', texto: 'En La 30 – 2da tougluada', color: 'var(--e3)' },
  { k: 'd2', texto: 'Devuelta – 2da lista', color: 'var(--e4)' },
  { k: 'f', texto: 'Finalizada', color: 'var(--e5)' },
];

const COLORES_INICIALES = ['Rosada', 'Negra', 'Café', 'Blanca', 'Roja', 'Azul', 'Beige', 'Gris'];

/* ---------------- Datos ---------------- */

let db = cargar();
let mesVista = mesDe(hoy());
let filtro = { estado: 'activos', color: '', texto: '' };

function vacio() {
  return { lotes: [], movs: [], facturas: [], colores: COLORES_INICIALES.slice(), coloresAct: 0,
           url: '', cambios: 0, ultimaSync: 0, error: '' };
}

function cargar() {
  try {
    const d = JSON.parse(localStorage.getItem(CLAVE_DATOS));
    if (d && Array.isArray(d.lotes)) return Object.assign(vacio(), d);
  } catch (e) { /* datos dañados o sin acceso: empezamos vacío */ }
  return vacio();
}

function guardarLocal() {
  try { localStorage.setItem(CLAVE_DATOS, JSON.stringify(db)); }
  catch (e) { avisar('No se pudo guardar en el celular'); }
}

// Se llama después de cada cambio del usuario
function cambio() {
  db.cambios++;
  guardarLocal();
  pintarSync();
  programarSync();
}

function nuevoId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function lotesVivos() { return db.lotes.filter(l => !l.borrado); }
function movsDe(loteId) {
  return db.movs.filter(m => !m.borrado && m.loteId === loteId)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.act - b.act);
}
function lotePorId(id) { return db.lotes.find(l => l.id === id && !l.borrado); }

/* ---------------- Fechas ---------------- */

function hoy() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function mesDe(fecha) { return fecha.slice(0, 7); }
function nombreMes(mes) {
  const [y, m] = mes.split('-').map(Number);
  const t = new Date(y, m - 1, 1).toLocaleDateString('es', { month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function moverMes(mes, n) {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function fechaCorta(f) {
  const [y, m, d] = f.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es', { day: 'numeric', month: 'short' });
}
function diasDesde(f) {
  const [y, m, d] = f.split('-').map(Number);
  const [y2, m2, d2] = hoy().split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y, m - 1, d)) / 86400000);
}

/* ---------------- Cálculos ---------------- */

// Cuántas hojas de un lote hay en cada estado
function cuenta(lote) {
  const s = { env1: 0, dev1: 0, env2: 0, dev2: 0, fin1: 0, fin2: 0 };
  for (const m of movsDe(lote.id)) s[m.tipo] += m.cantidad;
  return cuentaDe(lote, s);
}
function cuentaDe(lote, s) {
  const base = lote.inicio === 2 ? lote.cantidad : 0;
  return {
    e1: s.env1 - s.dev1,
    d1: s.dev1 + base - s.env2 - s.fin1,
    e2: s.env2 - s.dev2,
    d2: s.dev2 - s.fin2,
    f: s.fin1 + s.fin2,
  };
}
function cuentaValida(c) { return Object.values(c).every(n => n >= 0); }

// Fecha del envío más antiguo que sigue en La 30 (para contar los días)
function fechaPendiente(lote, ronda) {
  const movs = movsDe(lote.id);
  let devueltas = movs.filter(m => m.tipo === 'dev' + ronda).reduce((a, m) => a + m.cantidad, 0);
  for (const m of movs.filter(m => m.tipo === 'env' + ronda)) {
    if (devueltas >= m.cantidad) { devueltas -= m.cantidad; continue; }
    return m.fecha;
  }
  return null;
}

function fechaEnvio(lote) {
  const m = movsDe(lote.id).find(x => x.inicial) || movsDe(lote.id)[0];
  return m ? m.fecha : '';
}

// Hojas que siguen en La 30 (de cualquier mes)
function pendientes() {
  const out = [];
  for (const l of lotesVivos()) {
    const c = cuenta(l);
    if (c.e1 > 0) out.push({ lote: l, ronda: 1, n: c.e1, fecha: fechaPendiente(l, 1) });
    if (c.e2 > 0) out.push({ lote: l, ronda: 2, n: c.e2, fecha: fechaPendiente(l, 2) });
  }
  return out.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
}

function movsDelMes(mes) {
  const vivos = new Set(lotesVivos().map(l => l.id));
  return db.movs.filter(m => !m.borrado && vivos.has(m.loteId) && mesDe(m.fecha) === mes)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.act - b.act);
}

function resumenMes(mes) {
  const r = { env1: 0, env2: 0, dev1: 0, dev2: 0, fin: 0, porColor: {}, porDia: {} };
  for (const m of movsDelMes(mes)) {
    const l = db.lotes.find(x => x.id === m.loteId);
    if (m.tipo === 'fin1' || m.tipo === 'fin2') { r.fin += m.cantidad; continue; }
    r[m.tipo] += m.cantidad;
    const pc = r.porColor[l.color] || (r.porColor[l.color] = { env1: 0, env2: 0, dev1: 0, dev2: 0 });
    pc[m.tipo] += m.cantidad;
    const pd = r.porDia[m.fecha] || (r.porDia[m.fecha] = { env: 0, dev: 0 });
    if (m.tipo[0] === 'e') pd.env += m.cantidad; else pd.dev += m.cantidad;
  }
  r.enviadas = r.env1 + r.env2;
  r.devueltas = r.dev1 + r.dev2;
  return r;
}

function totalesEstado() {
  const t = { e1: 0, d1: 0, e2: 0, d2: 0, f: 0 };
  for (const l of lotesVivos()) {
    const c = cuenta(l);
    for (const k in t) t[k] += c[k];
  }
  return t;
}

function facturaDe(mes) { return db.facturas.find(f => f.id === mes); }

function mesesConDatos() {
  const s = new Set([mesDe(hoy())]);
  db.movs.forEach(m => { if (!m.borrado) s.add(mesDe(m.fecha)); });
  db.facturas.forEach(f => s.add(f.id));
  return [...s].sort().reverse();
}

/* ---------------- Utilidades de pantalla ---------------- */

const $ = sel => document.querySelector(sel);
function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }

let avisoTimer;
function avisar(texto) {
  const a = $('#aviso');
  a.textContent = texto;
  a.classList.add('ver');
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => a.classList.remove('ver'), 2600);
}

// Diálogo sencillo. campos: [{nombre, etiqueta, tipo, valor, min, max}]
function dialogo({ titulo, texto, campos = [], ok = 'Aceptar', cancelar = 'Cancelar', peligro = false }) {
  return new Promise(resolve => {
    const d = $('#dialogo');
    const f = $('#dialogo-form');
    f.innerHTML = `<h2>${esc(titulo)}</h2>${texto ? `<p>${texto}</p>` : ''}
      ${campos.map(c => `<label class="campo">${esc(c.etiqueta)}
        <input name="${c.nombre}" type="${c.tipo || 'text'}" value="${esc(c.valor)}"
          ${c.min != null ? `min="${c.min}"` : ''} ${c.max != null ? `max="${c.max}"` : ''}
          ${c.tipo === 'number' ? 'inputmode="numeric"' : ''} ${c.opcional ? '' : 'required'}></label>`).join('')}
      <div class="botones">
        <button class="btn ${peligro ? 'peligro' : ''}" value="ok">${esc(ok)}</button>
        ${cancelar ? `<button class="btn sec" value="no" formnovalidate>${esc(cancelar)}</button>` : ''}
      </div>`;
    d.onclose = () => {
      if (d.returnValue !== 'ok') return resolve(null);
      const datos = {};
      campos.forEach(c => { datos[c.nombre] = f.elements[c.nombre].value; });
      resolve(datos);
    };
    d.returnValue = '';
    d.showModal();
  });
}

function selectorMes(mes, accion) {
  return `<div class="mes">
    <button type="button" data-mes="${moverMes(mes, -1)}" data-accion="${accion}" aria-label="Mes anterior">‹</button>
    <strong>${esc(nombreMes(mes))}</strong>
    <button type="button" data-mes="${moverMes(mes, 1)}" data-accion="${accion}" aria-label="Mes siguiente">›</button>
  </div>`;
}

function chipColor(color) { return `<span class="chip borde">${esc(color)}</span>`; }

function chipsEstado(c) {
  return ESTADOS.filter(e => c[e.k] > 0)
    .map(e => `<span class="chip" style="--c:${e.color}">${c[e.k]} · ${esc(e.texto)}</span>`).join('');
}

/* ---------------- Pantallas ---------------- */

const PANTALLAS = {
  inicio: pantallaInicio,
  nuevo: pantallaNuevo,
  lotes: pantallaLotes,
  lote: pantallaLote,
  devolver: pantallaDevolver,
  factura: pantallaFactura,
  historial: pantallaHistorial,
  ajustes: pantallaAjustes,
};

function mostrar() {
  const [nombre, param] = (location.hash.slice(1) || 'inicio').split('/');
  const fn = PANTALLAS[nombre] || pantallaInicio;
  document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('activa', a.dataset.tab === nombre ||
    (nombre === 'lote' && a.dataset.tab === 'lotes') || (nombre === 'devolver' && a.dataset.tab === 'inicio')));
  $('#fab').hidden = nombre === 'nuevo';
  $('#vista').innerHTML = '';
  fn($('#vista'), param ? decodeURIComponent(param) : '');
  window.scrollTo(0, 0);
}

function ir(hash) {
  if (location.hash === '#' + hash) mostrar(); else location.hash = hash;
}

/* ---- 1. Inicio: resumen del mes ---- */
function pantallaInicio(v) {
  const r = resumenMes(mesVista);
  const t = totalesEstado();
  const pend = pendientes();
  const finMes = r.fin;

  const colores = Object.keys(r.porColor).sort();
  const dias = Object.keys(r.porDia).sort().reverse();

  v.innerHTML = `
    ${selectorMes(mesVista, 'inicio')}
    <div class="cards">
      <a class="card ancha" href="#lotes" data-filtro="enla30" style="--c:var(--e1)">
        <div class="num">${t.e1 + t.e2}</div>
        <div class="lbl">En La 30 sin devolver${t.e2 ? ` (${t.e1} en 1ra, ${t.e2} en 2da)` : ''}</div>
      </a>
      <a class="card" href="#lotes" data-filtro="d1" style="--c:var(--e2)">
        <div class="num">${t.d1}</div><div class="lbl">Esperan 2da</div>
      </a>
      <a class="card" href="#lotes" data-filtro="d2" style="--c:var(--e4)">
        <div class="num">${t.d2}</div><div class="lbl">Devueltas 2da, sin finalizar</div>
      </a>
      <div class="card" style="--c:var(--cafe)">
        <div class="num">${r.enviadas}</div><div class="lbl">Enviadas este mes</div>
        <div class="small muted">${r.env1} en 1ra · ${r.env2} en 2da</div>
      </div>
      <div class="card" style="--c:var(--cafe)">
        <div class="num">${r.devueltas}</div><div class="lbl">Devueltas este mes</div>
        <div class="small muted">${r.dev1} de 1ra · ${r.dev2} de 2da</div>
      </div>
      <a class="card ancha" href="#lotes" data-filtro="f" style="--c:var(--e5)">
        <div class="num">${finMes}</div><div class="lbl">Finalizadas este mes</div>
      </a>
    </div>

    <h2>En La 30 ahora</h2>
    ${pend.length ? `<div class="lista">${pend.map(p => {
      const d = p.fecha ? diasDesde(p.fecha) : 0;
      return `<a class="fila" href="#lote/${p.lote.id}">
        <div class="fila-top"><strong>${plural(p.n, 'hoja', 'hojas')} ${esc(p.lote.color)}</strong>
          <span class="dias ${d > 15 ? 'viejo' : ''}">${plural(d, 'día', 'días')}</span></div>
        <div class="small muted">${p.ronda === 1 ? '1ra' : '2da'} tougluada · enviadas el ${esc(fechaCorta(p.fecha))}${p.lote.referencia ? ' · ' + esc(p.lote.referencia) : ''}</div>
      </a>`;
    }).join('')}</div>
    <div class="botones"><a class="btn" href="#devolver">Marcar varias devueltas</a></div>`
    : '<p class="vacio">No hay hojas en La 30.</p>'}

    <h2>Tougluadas del mes por color</h2>
    ${colores.length ? `<table>
      <tr><th>Color</th><th class="n">Enviadas</th><th class="n">Devueltas</th></tr>
      ${colores.map(c => { const x = r.porColor[c]; return `<tr><td>${esc(c)}</td>
        <td class="n">${x.env1 + x.env2}<div class="small muted">${x.env1}+${x.env2}</div></td>
        <td class="n">${x.dev1 + x.dev2}<div class="small muted">${x.dev1}+${x.dev2}</div></td></tr>`; }).join('')}
      <tr><th>Total</th><th class="n">${r.enviadas}</th><th class="n">${r.devueltas}</th></tr>
    </table><p class="small muted">El número pequeño es 1ra + 2da.</p>` : '<p class="vacio">Todavía no hay movimientos este mes.</p>'}

    ${dias.length ? `<h2>Por día</h2><table>
      <tr><th>Fecha</th><th class="n">Enviadas</th><th class="n">Devueltas</th></tr>
      ${dias.map(d => `<tr><td>${esc(fechaCorta(d))}</td><td class="n">${r.porDia[d].env}</td><td class="n">${r.porDia[d].dev}</td></tr>`).join('')}
    </table>` : ''}
  `;
}

/* ---- 2. Enviar hojas (lote nuevo) ---- */
let borradorFecha = null;
function pantallaNuevo(v) {
  const estado = { color: '', inicio: 1 };
  v.innerHTML = `
    <h1>Enviar hojas a La 30</h1>
    <form id="f-nuevo" autocomplete="off">
      <label class="campo">Fecha de envío
        <input type="date" name="fecha" value="${borradorFecha || hoy()}" required></label>
      <div class="campo"><b>Color</b>
        <div class="opciones" id="op-color">
          ${db.colores.map(c => `<button type="button" data-color="${esc(c)}">${esc(c)}</button>`).join('')}
          <button type="button" data-color="__otro">Otro…</button>
        </div>
      </div>
      <label class="campo">Cantidad de hojas
        <input type="number" name="cantidad" min="1" step="1" inputmode="numeric" placeholder="Ej: 10" required></label>
      <div class="campo"><b>¿Qué tougluada?</b>
        <div class="opciones" id="op-inicio">
          <button type="button" data-inicio="1" class="on">1ra tougluada</button>
          <button type="button" data-inicio="2">2da tougluada</button>
        </div>
        <span class="small muted">Usa "2da" solo si la 1ra no está registrada en la app.</span>
      </div>
      <label class="campo">Referencia o tipo de cuero <span class="ayuda">Opcional</span>
        <input type="text" name="referencia"></label>
      <label class="campo">Observaciones <span class="ayuda">Opcional</span>
        <textarea name="obs"></textarea></label>
      <div class="botones">
        <button class="btn" type="submit">Guardar y enviar a La 30</button>
        <a class="btn sec" href="#inicio">Cancelar</a>
      </div>
    </form>`;

  v.querySelector('#op-color').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    let color = b.dataset.color;
    if (color === '__otro') {
      const r = await dialogo({ titulo: 'Color nuevo', campos: [{ nombre: 'c', etiqueta: 'Nombre del color', valor: '' }], ok: 'Agregar' });
      if (!r || !r.c.trim()) return;
      color = r.c.trim();
      if (!db.colores.includes(color)) { db.colores.push(color); db.coloresAct = Date.now(); cambio(); }
      const nb = document.createElement('button');
      nb.type = 'button'; nb.dataset.color = color; nb.textContent = color;
      b.before(nb);
    }
    estado.color = color;
    v.querySelectorAll('#op-color button').forEach(x => x.classList.toggle('on', x.dataset.color === color));
  });
  v.querySelector('#op-inicio').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    estado.inicio = Number(b.dataset.inicio);
    v.querySelectorAll('#op-inicio button').forEach(x => x.classList.toggle('on', x === b));
  });

  v.querySelector('#f-nuevo').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const n = parseInt(f.cantidad.value, 10);
    if (!estado.color) return avisar('Elige el color');
    if (!(n > 0)) return avisar('Escribe la cantidad de hojas');
    const fecha = f.fecha.value || hoy();
    const ok = await dialogo({
      titulo: 'Confirmar envío',
      texto: `Vas a enviar <b>${plural(n, 'hoja', 'hojas')} ${esc(estado.color)}</b> a La 30 el ${esc(fechaCorta(fecha))} (${estado.inicio}${estado.inicio === 1 ? 'ra' : 'da'} tougluada).`,
      ok: 'Sí, guardar',
    });
    if (!ok) return;
    const ahora = Date.now();
    const lote = { id: nuevoId(), color: estado.color, cantidad: n, inicio: estado.inicio,
      referencia: f.referencia.value.trim(), obs: f.obs.value.trim(), creado: ahora, act: ahora, borrado: false };
    db.lotes.push(lote);
    db.movs.push({ id: nuevoId(), loteId: lote.id, tipo: estado.inicio === 2 ? 'env2' : 'env1', cantidad: n,
      fecha, inicial: true, act: ahora, borrado: false });
    cambio();
    const otro = await dialogo({ titulo: 'Guardado ✓', texto: `${plural(n, 'hoja', 'hojas')} ${esc(estado.color)} en La 30.<br>¿Quieres registrar otro lote con la misma fecha?`,
      ok: 'Sí, otro lote', cancelar: 'No, ir al inicio' });
    if (otro) { borradorFecha = fecha; mostrar(); }
    else { borradorFecha = null; ir('inicio'); }
  });
}

/* ---- 3. Lotes: lista con filtros ---- */
const FILTROS_ESTADO = [
  { k: 'activos', texto: 'Sin finalizar' },
  { k: 'enla30', texto: 'En La 30' },
  { k: 'e1', texto: 'En La 30 – 1ra' },
  { k: 'd1', texto: 'Devuelta – 1ra' },
  { k: 'e2', texto: 'En La 30 – 2da' },
  { k: 'd2', texto: 'Devuelta – 2da' },
  { k: 'f', texto: 'Finalizada' },
  { k: 'todos', texto: 'Todos' },
];

function pasaFiltro(c, k) {
  if (k === 'todos') return true;
  if (k === 'activos') return c.e1 + c.d1 + c.e2 + c.d2 > 0;
  if (k === 'enla30') return c.e1 + c.e2 > 0;
  return c[k] > 0;
}

function pantallaLotes(v) {
  const colores = [...new Set(lotesVivos().map(l => l.color))].sort();
  v.innerHTML = `
    <h1>Lotes</h1>
    <input type="text" id="buscar" placeholder="Buscar por color, referencia u observación" value="${esc(filtro.texto)}">
    <div class="filtros" id="f-estado">${FILTROS_ESTADO.map(f =>
      `<button type="button" data-k="${f.k}" class="${filtro.estado === f.k ? 'on' : ''}">${f.texto}</button>`).join('')}</div>
    ${colores.length > 1 ? `<div class="filtros" id="f-color"><button type="button" data-c="" class="${!filtro.color ? 'on' : ''}">Todos los colores</button>${colores.map(c =>
      `<button type="button" data-c="${esc(c)}" class="${filtro.color === c ? 'on' : ''}">${esc(c)}</button>`).join('')}</div>` : ''}
    <div class="lista" id="lista"></div>`;

  const pintar = () => {
    const txt = filtro.texto.trim().toLowerCase();
    const lotes = lotesVivos()
      .map(l => ({ l, c: cuenta(l), fecha: fechaEnvio(l) }))
      .filter(x => pasaFiltro(x.c, filtro.estado))
      .filter(x => !filtro.color || x.l.color === filtro.color)
      .filter(x => !txt || [x.l.color, x.l.referencia, x.l.obs].join(' ').toLowerCase().includes(txt))
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.l.creado - a.l.creado);
    $('#lista').innerHTML = lotes.length ? lotes.map(x => `
      <a class="fila" href="#lote/${x.l.id}">
        <div class="fila-top"><strong>${plural(x.l.cantidad, 'hoja', 'hojas')} ${esc(x.l.color)}</strong>
          <span class="muted small">${esc(fechaCorta(x.fecha))}</span></div>
        ${x.l.referencia ? `<div class="small muted">${esc(x.l.referencia)}</div>` : ''}
        <div class="chips">${chipsEstado(x.c)}</div>
      </a>`).join('') : '<p class="vacio">No hay lotes con este filtro.</p>';
  };
  pintar();

  v.querySelector('#buscar').addEventListener('input', e => { filtro.texto = e.target.value; pintar(); });
  v.querySelector('#f-estado').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    filtro.estado = b.dataset.k;
    v.querySelectorAll('#f-estado button').forEach(x => x.classList.toggle('on', x === b));
    pintar();
  });
  const fc = v.querySelector('#f-color');
  if (fc) fc.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    filtro.color = b.dataset.c;
    fc.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    pintar();
  });
}

/* ---- 4. Detalle de un lote ---- */
const ACCIONES = [
  { tipo: 'dev1', desde: 'e1', boton: 'Marcar devueltas (1ra)', color: 'var(--e2)', pregunta: '¿Cuántas devolvió La 30?' },
  { tipo: 'env2', desde: 'd1', boton: 'Enviar a 2da tougluada', color: 'var(--e3)', pregunta: '¿Cuántas envías a 2da?' },
  { tipo: 'fin1', desde: 'd1', boton: 'Finalizar (solo llevan 1)', color: 'var(--e5)', pregunta: '¿Cuántas finalizas?' },
  { tipo: 'dev2', desde: 'e2', boton: 'Marcar devueltas (2da)', color: 'var(--e4)', pregunta: '¿Cuántas devolvió La 30?' },
  { tipo: 'fin2', desde: 'd2', boton: 'Finalizar', color: 'var(--e5)', pregunta: '¿Cuántas finalizas?' },
];

function pantallaLote(v, id) {
  const l = lotePorId(id);
  if (!l) { v.innerHTML = '<p class="vacio">Este lote no existe.</p><a class="btn sec" href="#lotes">Volver</a>'; return; }
  const c = cuenta(l);
  const movs = movsDe(l.id);
  const acciones = ACCIONES.filter(a => c[a.desde] > 0);

  v.innerHTML = `
    <a href="#lotes" class="muted">‹ Lotes</a>
    <h1>${plural(l.cantidad, 'hoja', 'hojas')} ${esc(l.color)}</h1>
    <p class="muted">Enviadas el ${esc(fechaCorta(fechaEnvio(l)))}${l.inicio === 2 ? ' a 2da tougluada' : ''}
      ${l.referencia ? `<br>Referencia: ${esc(l.referencia)}` : ''}
      ${l.obs ? `<br>${esc(l.obs)}` : ''}</p>

    <div class="estados">${ESTADOS.map(e =>
      `<div class="estado ${c[e.k] ? '' : 'cero'}" style="--c:${e.color}"><span>${esc(e.texto)}</span><span class="n">${c[e.k]}</span></div>`).join('')}</div>

    <div class="botones">${acciones.map(a =>
      `<button class="btn" data-c style="--c:${a.color}" data-tipo="${a.tipo}">${esc(a.boton)}</button>`).join('')}
    </div>

    <h2>Movimientos</h2>
    <div class="lista">${movs.map(m => `
      <div class="fila mov">
        <div><strong>${esc(fechaCorta(m.fecha))}</strong> · ${esc(TIPOS[m.tipo].texto)}: <b>${m.cantidad}</b></div>
        <button type="button" data-mov="${m.id}">Corregir</button>
      </div>`).join('')}</div>

    <div class="botones">
      <button class="btn sec" id="editar">Editar color, referencia u observación</button>
      <button class="btn peligro" id="borrar">Borrar este lote</button>
    </div>`;

  v.querySelector('.botones').addEventListener('click', async e => {
    const b = e.target.closest('button[data-tipo]'); if (!b) return;
    const a = ACCIONES.find(x => x.tipo === b.dataset.tipo);
    const max = c[a.desde];
    const r = await dialogo({ titulo: a.boton, campos: [
      { nombre: 'n', etiqueta: `${a.pregunta} (máximo ${max})`, tipo: 'number', valor: max, min: 1, max },
      { nombre: 'fecha', etiqueta: 'Fecha', tipo: 'date', valor: hoy() },
    ], ok: 'Guardar' });
    if (!r) return;
    const n = parseInt(r.n, 10);
    if (!(n >= 1 && n <= max)) return avisar(`La cantidad debe estar entre 1 y ${max}`);
    db.movs.push({ id: nuevoId(), loteId: l.id, tipo: a.tipo, cantidad: n, fecha: r.fecha || hoy(), act: Date.now(), borrado: false });
    cambio();
    avisar('Guardado ✓');
    mostrar();
  });

  v.querySelectorAll('[data-mov]').forEach(b => b.addEventListener('click', () => corregirMov(l, b.dataset.mov)));

  v.querySelector('#editar').addEventListener('click', async () => {
    const r = await dialogo({ titulo: 'Editar lote', campos: [
      { nombre: 'color', etiqueta: 'Color', valor: l.color },
      { nombre: 'referencia', etiqueta: 'Referencia (opcional)', valor: l.referencia || '' },
      { nombre: 'obs', etiqueta: 'Observaciones (opcional)', valor: l.obs || '' },
    ].map(x => x.nombre === 'color' ? x : Object.assign(x, { opcional: true })), ok: 'Guardar' });
    if (!r) return;
    if (!r.color.trim()) return avisar('El color no puede quedar vacío');
    Object.assign(l, { color: r.color.trim(), referencia: r.referencia.trim(), obs: r.obs.trim(), act: Date.now() });
    cambio();
    mostrar();
  });

  v.querySelector('#borrar').addEventListener('click', async () => {
    const ok = await dialogo({ titulo: '¿Borrar este lote?', texto: 'Se borra el lote con todos sus movimientos. No se puede deshacer.',
      ok: 'Sí, borrar', peligro: true });
    if (!ok) return;
    const ahora = Date.now();
    l.borrado = true; l.act = ahora;
    db.movs.forEach(m => { if (m.loteId === l.id && !m.borrado) { m.borrado = true; m.act = ahora; } });
    cambio();
    avisar('Lote borrado');
    ir('lotes');
  });
}

// Corregir la fecha o la cantidad de un movimiento, o borrarlo
async function corregirMov(lote, movId) {
  const m = db.movs.find(x => x.id === movId);
  const d = $('#dialogo');
  const f = $('#dialogo-form');
  f.innerHTML = `<h2>Corregir</h2><p>${esc(TIPOS[m.tipo].texto)}</p>
    <label class="campo">Fecha<input type="date" name="fecha" value="${m.fecha}" required></label>
    <label class="campo">Cantidad<input type="number" name="n" min="1" inputmode="numeric" value="${m.cantidad}" required></label>
    <div class="botones">
      <button class="btn" value="ok">Guardar</button>
      ${m.inicial ? '' : '<button class="btn peligro" value="borrar" formnovalidate>Borrar este movimiento</button>'}
      <button class="btn sec" value="no" formnovalidate>Cancelar</button>
    </div>`;
  d.returnValue = '';
  d.onclose = () => {
    const accion = d.returnValue;
    if (accion !== 'ok' && accion !== 'borrar') return;
    // Probamos el cambio y verificamos que ninguna cantidad quede negativa
    const copia = { cantidad: m.cantidad, fecha: m.fecha, borrado: m.borrado, loteCant: lote.cantidad };
    if (accion === 'borrar') m.borrado = true;
    else {
      const n = parseInt(f.elements.n.value, 10);
      if (!(n >= 1)) { avisar('Cantidad no válida'); return; }
      m.cantidad = n;
      m.fecha = f.elements.fecha.value || m.fecha;
      if (m.inicial) lote.cantidad = n;
    }
    if (!cuentaValida(cuenta(lote))) {
      Object.assign(m, { cantidad: copia.cantidad, fecha: copia.fecha, borrado: copia.borrado });
      lote.cantidad = copia.loteCant;
      avisar('No se puede: las cantidades no cuadrarían');
      return;
    }
    m.act = Date.now();
    if (m.inicial) lote.act = m.act;
    cambio();
    avisar('Corregido ✓');
    mostrar();
  };
  d.showModal();
}

/* ---- 5. Marcar varias devueltas ---- */
function pantallaDevolver(v) {
  const pend = pendientes();
  v.innerHTML = `
    <a href="#inicio" class="muted">‹ Inicio</a>
    <h1>Marcar devueltas</h1>
    ${pend.length ? `<p class="muted">Marca los lotes que devolvió La 30. Si no volvieron todas, cambia la cantidad.</p>
    <form id="f-dev">
      <label class="campo">Fecha de devolución<input type="date" name="fecha" value="${hoy()}" required></label>
      <div class="lista">${pend.map((p, i) => `
        <div class="fila">
          <label class="check"><input type="checkbox" name="sel" value="${i}">
            <span><strong>${esc(p.lote.color)}</strong> · ${p.ronda === 1 ? '1ra' : '2da'} · enviadas ${esc(fechaCorta(p.fecha))}
            <br><span class="small muted">${plural(p.n, 'sigue', 'siguen')} en La 30</span></span></label>
          <label class="campo small">Devueltas
            <input type="number" name="n${i}" value="${p.n}" min="1" max="${p.n}" inputmode="numeric"></label>
        </div>`).join('')}</div>
      <div class="botones"><button class="btn" type="submit" id="btn-dev">Marcar devueltas</button></div>
    </form>` : '<p class="vacio">No hay hojas en La 30.</p>'}`;

  const form = v.querySelector('#f-dev');
  if (!form) return;
  const total = () => {
    let t = 0;
    form.querySelectorAll('input[name=sel]:checked').forEach(c => { t += parseInt(form.elements['n' + c.value].value, 10) || 0; });
    $('#btn-dev').textContent = t ? `Marcar ${plural(t, 'hoja devuelta', 'hojas devueltas')}` : 'Marcar devueltas';
  };
  form.addEventListener('input', total);
  form.addEventListener('submit', e => {
    e.preventDefault();
    const sel = [...form.querySelectorAll('input[name=sel]:checked')].map(c => Number(c.value));
    if (!sel.length) return avisar('Marca al menos un lote');
    const fecha = form.fecha.value || hoy();
    for (const i of sel) {
      const p = pend[i];
      const n = parseInt(form.elements['n' + i].value, 10);
      if (!(n >= 1 && n <= p.n)) return avisar(`Revisa la cantidad de ${p.lote.color} (máximo ${p.n})`);
    }
    let t = 0;
    for (const i of sel) {
      const p = pend[i];
      const n = parseInt(form.elements['n' + i].value, 10);
      t += n;
      db.movs.push({ id: nuevoId(), loteId: p.lote.id, tipo: 'dev' + p.ronda, cantidad: n, fecha, act: Date.now(), borrado: false });
    }
    cambio();
    avisar(`${plural(t, 'hoja marcada', 'hojas marcadas')} como devueltas ✓`);
    ir('inicio');
  });
}

/* ---- 6. Factura de La 30 ---- */
function diferenciaTexto(cobradas, registradas, que) {
  const d = cobradas - registradas;
  if (d === 0) return `<div class="caja bien"><b class="verde">Coincide</b> con las ${que} (${registradas}).</div>`;
  if (d > 0) return `<div class="caja mal"><div class="grande rojo">+${d}</div>Te cobraron <b>${d} de más</b> frente a las ${que} (${registradas}).</div>`;
  return `<div class="caja"><div class="grande">${d}</div>Te cobraron ${-d} de menos frente a las ${que} (${registradas}).</div>`;
}

function pantallaFactura(v) {
  const mes = mesVista;
  const r = resumenMes(mes);
  const fac = facturaDe(mes);
  const movs = movsDelMes(mes).filter(m => m.tipo[0] !== 'f');

  v.innerHTML = `
    <h1>Factura de La 30</h1>
    ${selectorMes(mes, 'factura')}
    <form id="f-fac">
      <label class="campo">¿Cuántas tougluadas te cobró La 30 en ${esc(nombreMes(mes).toLowerCase())}?
        <input type="number" name="cobradas" min="0" inputmode="numeric" value="${fac ? fac.cobradas : ''}" placeholder="Ej: 120" required></label>
      <label class="campo">Nota <span class="ayuda">Opcional, por ejemplo el número de la factura</span>
        <input type="text" name="nota" value="${esc(fac ? fac.nota : '')}"></label>
      <div class="botones"><button class="btn" type="submit">Guardar y comparar</button></div>
    </form>

    ${fac ? `<h2>Comparación</h2>
      <div class="comparar">
        <div class="caja">La 30 cobró <b>${fac.cobradas}</b>. Tú registraste <b>${r.enviadas}</b> enviadas y <b>${r.devueltas}</b> devueltas.</div>
        ${diferenciaTexto(fac.cobradas, r.devueltas, 'devueltas en el mes')}
        ${diferenciaTexto(fac.cobradas, r.enviadas, 'enviadas en el mes')}
      </div>
      <div class="botones">
        <button class="btn" id="excel">Exportar detalle a Excel</button>
        <button class="btn sec" id="compartir">Compartir resumen</button>
      </div>` : ''}

    <h2>Detalle del mes</h2>
    ${movs.length ? `<table>
      <tr><th>Fecha</th><th>Color</th><th>Movimiento</th><th class="n">Hojas</th></tr>
      ${movs.map(m => { const l = db.lotes.find(x => x.id === m.loteId);
        return `<tr><td>${esc(fechaCorta(m.fecha))}</td><td>${esc(l.color)}</td><td>${esc(TIPOS[m.tipo].corto)}</td><td class="n">${m.cantidad}</td></tr>`; }).join('')}
    </table>` : '<p class="vacio">No hay movimientos este mes.</p>'}`;

  v.querySelector('#f-fac').addEventListener('submit', e => {
    e.preventDefault();
    const n = parseInt(e.target.cobradas.value, 10);
    if (!(n >= 0)) return avisar('Escribe cuántas te cobraron');
    const datos = { id: mes, cobradas: n, nota: e.target.nota.value.trim(), act: Date.now() };
    const i = db.facturas.findIndex(f => f.id === mes);
    if (i >= 0) db.facturas[i] = datos; else db.facturas.push(datos);
    cambio();
    avisar('Guardado ✓');
    mostrar();
  });
  const bx = v.querySelector('#excel');
  if (bx) bx.addEventListener('click', () => exportarMes(mes));
  const bc = v.querySelector('#compartir');
  if (bc) bc.addEventListener('click', () => compartirFactura(mes));
}

function textoFactura(mes) {
  const r = resumenMes(mes);
  const fac = facturaDe(mes);
  const lineas = [`Tougluadas ${nombreMes(mes)}`,
    `La 30 cobró: ${fac ? fac.cobradas : '-'}`,
    `Enviadas a La 30: ${r.enviadas} (1ra ${r.env1}, 2da ${r.env2})`,
    `Devueltas por La 30: ${r.devueltas} (1ra ${r.dev1}, 2da ${r.dev2})`, '', 'Detalle:'];
  for (const m of movsDelMes(mes).filter(x => x.tipo[0] !== 'f')) {
    const l = db.lotes.find(x => x.id === m.loteId);
    lineas.push(`${m.fecha} · ${l.color} · ${TIPOS[m.tipo].corto} · ${m.cantidad}`);
  }
  return lineas.join('\n');
}

async function compartirFactura(mes) {
  const texto = textoFactura(mes);
  try {
    if (navigator.share) { await navigator.share({ title: 'Tougluadas ' + nombreMes(mes), text: texto }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(texto); avisar('Resumen copiado. Pégalo en WhatsApp o correo.'); }
  catch (e) { avisar('No se pudo compartir desde este celular'); }
}

/* ---- 7. Historial ---- */
function pantallaHistorial(v) {
  const meses = mesesConDatos();
  v.innerHTML = `<h1>Historial de meses</h1>
    <div class="lista">${meses.map(mes => {
      const r = resumenMes(mes); const fac = facturaDe(mes);
      return `<div class="fila">
        <div class="fila-top"><strong>${esc(nombreMes(mes))}</strong></div>
        <div class="small">Enviadas <b>${r.enviadas}</b> · Devueltas <b>${r.devueltas}</b> · La 30 cobró <b>${fac ? fac.cobradas : '–'}</b></div>
        <div class="botones" style="grid-template-columns:1fr 1fr;margin:10px 0 0">
          <button class="btn sec" data-ver="${mes}">Ver</button>
          <button class="btn sec" data-excel="${mes}">Excel</button>
        </div></div>`; }).join('')}</div>`;
  v.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.ver) { mesVista = b.dataset.ver; ir('inicio'); }
    if (b.dataset.excel) exportarMes(b.dataset.excel);
  });
}

/* ---- 8. Ajustes ---- */
function pantallaAjustes(v) {
  v.innerHTML = `
    <h1>Ajustes</h1>
    <h2>Google Sheets</h2>
    <form id="f-url">
      <label class="campo">Enlace de tu Google Sheets
        <span class="ayuda">Es el enlace que termina en "/exec" que copiaste al publicar el programa en Google.</span>
        <input type="url" name="url" value="${esc(db.url)}" placeholder="https://script.google.com/macros/s/.../exec"></label>
      <div class="botones"><button class="btn" type="submit">Guardar enlace</button></div>
    </form>
    <p>${textoSync()}</p>
    <div class="botones">
      <button class="btn sec" id="sync-ya">Guardar ahora en Google Sheets</button>
    </div>

    <h2>Colores</h2>
    <div class="chips" id="colores">${db.colores.map(c => `<button type="button" class="chip borde" data-quitar="${esc(c)}">${esc(c)} ✕</button>`).join('')}</div>
    <div class="botones"><button class="btn sec" id="color-nuevo">Agregar color</button></div>

    <h2>Copia de seguridad</h2>
    <div class="botones"><button class="btn sec" id="respaldo">Descargar todo en Excel</button></div>
    <p class="small muted">Tougly · versión 1</p>`;

  v.querySelector('#f-url').addEventListener('submit', e => {
    e.preventDefault();
    const url = e.target.url.value.trim();
    if (url && !/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) return avisar('Ese enlace no parece de Google Apps Script');
    db.url = url; db.error = '';
    guardarLocal();
    avisar(url ? 'Enlace guardado. Conectando…' : 'Enlace borrado');
    if (url) sincronizar(true).then(mostrar); else mostrar();
  });
  v.querySelector('#sync-ya').addEventListener('click', () => sincronizar(true).then(mostrar));
  v.querySelector('#colores').addEventListener('click', async e => {
    const b = e.target.closest('[data-quitar]'); if (!b) return;
    const ok = await dialogo({ titulo: `¿Quitar "${b.dataset.quitar}" de la lista?`, texto: 'Los lotes que ya tienen este color no cambian.', ok: 'Quitar' });
    if (!ok) return;
    db.colores = db.colores.filter(c => c !== b.dataset.quitar); db.coloresAct = Date.now();
    cambio(); mostrar();
  });
  v.querySelector('#color-nuevo').addEventListener('click', async () => {
    const r = await dialogo({ titulo: 'Color nuevo', campos: [{ nombre: 'c', etiqueta: 'Nombre del color', valor: '' }], ok: 'Agregar' });
    if (!r || !r.c.trim() || db.colores.includes(r.c.trim())) return;
    db.colores.push(r.c.trim()); db.coloresAct = Date.now();
    cambio(); mostrar();
  });
  v.querySelector('#respaldo').addEventListener('click', exportarTodo);
}

/* ---------------- Excel ---------------- */

function filasMovs(movs) {
  return movs.map(m => {
    const l = db.lotes.find(x => x.id === m.loteId);
    return { Fecha: m.fecha, Color: l.color, Referencia: l.referencia || '', Movimiento: TIPOS[m.tipo].texto, Hojas: m.cantidad, Observaciones: l.obs || '' };
  });
}

function exportarMes(mes) {
  if (!window.XLSX) return avisar('El Excel todavía está cargando, intenta de nuevo');
  const r = resumenMes(mes);
  const fac = facturaDe(mes);
  const wb = XLSX.utils.book_new();
  const resumen = [
    ['Mes', nombreMes(mes)],
    ['Enviadas a La 30 (1ra)', r.env1], ['Enviadas a La 30 (2da)', r.env2], ['Total enviadas', r.enviadas],
    ['Devueltas por La 30 (1ra)', r.dev1], ['Devueltas por La 30 (2da)', r.dev2], ['Total devueltas', r.devueltas],
    ['Finalizadas', r.fin],
    ['La 30 cobró', fac ? fac.cobradas : ''],
    ['Diferencia contra devueltas', fac ? fac.cobradas - r.devueltas : ''],
    ['Diferencia contra enviadas', fac ? fac.cobradas - r.enviadas : ''],
    ['Nota de factura', fac ? fac.nota : ''],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), 'Resumen');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasMovs(movsDelMes(mes))), 'Movimientos');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.keys(r.porColor).sort().map(c => ({
    Color: c, 'Enviadas 1ra': r.porColor[c].env1, 'Enviadas 2da': r.porColor[c].env2,
    'Devueltas 1ra': r.porColor[c].dev1, 'Devueltas 2da': r.porColor[c].dev2 }))), 'Por color');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.keys(r.porDia).sort().map(d => ({
    Fecha: d, Enviadas: r.porDia[d].env, Devueltas: r.porDia[d].dev }))), 'Por día');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pendientes().map(p => ({
    Color: p.lote.color, Tougluada: p.ronda === 1 ? '1ra' : '2da', 'Enviadas el': p.fecha, 'Hojas en La 30': p.n,
    'Días allá': p.fecha ? diasDesde(p.fecha) : '', Referencia: p.lote.referencia || '' }))), 'Pendientes hoy');
  XLSX.writeFile(wb, `Tougly-${mes}.xlsx`);
}

function exportarTodo() {
  if (!window.XLSX) return avisar('El Excel todavía está cargando, intenta de nuevo');
  const wb = XLSX.utils.book_new();
  const vivos = new Set(lotesVivos().map(l => l.id));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasMovs(db.movs.filter(m => !m.borrado && vivos.has(m.loteId))
    .sort((a, b) => a.fecha.localeCompare(b.fecha)))), 'Movimientos');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(db.facturas.map(f => ({ Mes: f.id, 'La 30 cobró': f.cobradas, Nota: f.nota }))), 'Facturas');
  XLSX.writeFile(wb, `Tougly-todo-${hoy()}.xlsx`);
}

/* ---------------- Google Sheets ---------------- */

function textoSync() {
  if (!db.url) return 'Sin conectar a Google Sheets';
  if (db.error) return '⚠ No se pudo guardar en Google: ' + db.error;
  if (db.cambios > 0) return `${plural(db.cambios, 'cambio', 'cambios')} por guardar en Google`;
  return db.ultimaSync ? '✓ Todo guardado en Google (' + new Date(db.ultimaSync).toLocaleString('es') + ')' : '✓ Todo guardado';
}

function pintarSync() {
  const b = $('#sync');
  b.className = 'sync';
  if (!db.url) { b.textContent = 'Sin Google'; b.classList.add('pend'); return; }
  if (db.error) { b.textContent = '⚠ Sin guardar'; b.classList.add('error'); return; }
  if (db.cambios > 0) { b.textContent = `● ${db.cambios} por guardar`; b.classList.add('pend'); return; }
  b.textContent = '✓ Guardado';
}

let syncTimer, sincronizando = false;
function programarSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => sincronizar(false), 2000);
}

// Junta dos listas por id; gana el registro cambiado más recientemente
function juntar(local, remoto) {
  const mapa = new Map(local.map(x => [x.id, x]));
  for (const r of remoto) {
    const l = mapa.get(r.id);
    if (!l || (r.act || 0) > (l.act || 0)) mapa.set(r.id, r);
  }
  return [...mapa.values()];
}

async function sincronizar(manual) {
  if (!db.url) { if (manual) avisar('Primero pega el enlace de Google en Ajustes'); return; }
  if (!navigator.onLine) { if (manual) avisar('Sin internet. Se guardará solo cuando vuelva.'); return; }
  if (sincronizando) return;
  sincronizando = true;
  const cambiosAntes = db.cambios;
  try {
    const res = await fetch(db.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ lotes: db.lotes, movs: db.movs, facturas: db.facturas, colores: db.colores, coloresAct: db.coloresAct }),
    });
    const r = await res.json();
    if (!r.ok) throw new Error(r.error || 'respuesta inválida');
    db.lotes = juntar(db.lotes, r.lotes || []);
    db.movs = juntar(db.movs, r.movs || []);
    db.facturas = juntar(db.facturas, r.facturas || []);
    if ((r.coloresAct || 0) > (db.coloresAct || 0) && Array.isArray(r.colores)) { db.colores = r.colores; db.coloresAct = r.coloresAct; }
    db.cambios = Math.max(0, db.cambios - cambiosAntes);
    db.ultimaSync = Date.now();
    db.error = '';
    guardarLocal();
    if (manual) avisar('Guardado en Google Sheets ✓');
    // Si llegaron datos de otro celular, refrescamos la pantalla (sin interrumpir un formulario)
    if (!$('#dialogo').open && !document.querySelector('#vista form')) mostrar();
  } catch (e) {
    db.error = navigator.onLine ? 'revisa el enlace en Ajustes' : 'sin internet';
    guardarLocal();
    if (manual) avisar('No se pudo guardar en Google');
  } finally {
    sincronizando = false;
    pintarSync();
    if (db.cambios > 0 && !db.error) programarSync();
  }
}

/* ---------------- Arranque ---------------- */

document.addEventListener('click', e => {
  const b = e.target.closest('[data-mes]');
  if (b) { mesVista = b.dataset.mes; mostrar(); return; }
  const card = e.target.closest('[data-filtro]');
  if (card) { filtro = { estado: card.dataset.filtro, color: '', texto: '' }; }
});
$('#fab').addEventListener('click', () => { borradorFecha = null; ir('nuevo'); });
$('#sync').addEventListener('click', () => ir('ajustes'));
window.addEventListener('hashchange', mostrar);
window.addEventListener('online', () => { db.error = ''; sincronizar(false); });

mostrar();
pintarSync();
sincronizar(false);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
