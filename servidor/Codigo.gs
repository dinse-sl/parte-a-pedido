/**
 * Parte a Pedido · servidor (Google Apps Script)
 * Guarda los partes, instalaciones y reglas en una Hoja de Google que crea él solo en tu Drive,
 * guarda las fotos en Google Drive y llama a Gemini para leer los partes en papel.
 * La clave de Gemini se queda aquí, no llega a los móviles.
 *
 * 1) Rellena estas tres líneas y guarda:
 */
const GEMINI_API_KEY  = '';          // Clave de https://aistudio.google.com/apikey
const CODIGO_TECNICOS = '';          // Código que escribirán los técnicos (ej. DINSE-TEC-4821)
const CODIGO_OFICINA  = '';          // Código de la oficina: además puede cambiar las reglas (ej. DINSE-OF-9374)

/* Modelos de Gemini (puedes cambiarlos si Google los renombra) */
const MODELO        = 'gemini-3.8-flash';      // leer la foto del parte
const MODELO_RAPIDO = 'gemini-3.5-flash-lite'; // elegir opciones de material
const MODELO_RESERVA = 'gemini-2.5-flash';     // se usa si los anteriores no existen

/* 2) Arriba, elige la función «instalar» y pulsa ▶ Ejecutar. Acepta los permisos.
 *    Crea la Hoja «Parte a Pedido - datos» en tu Drive (con los datos iniciales) y prueba Gemini.
 * 3) Implementar → Nueva implementación → Aplicación web · Ejecutar como: Yo · Acceso: Cualquier usuario.
 *    Copia la URL que termina en /exec y pégala en web/config.js
 * ------------------------------------------------------------------------------------------------ */

const HOJA = 'datos';
const TROZO = 45000; // una celda admite 50.000 caracteres: los documentos grandes se reparten en varias columnas

function doGet() {
  return salida({ok: true, app: 'Parte a Pedido', mensaje: 'El servidor funciona. Pega esta URL en web/config.js'});
}

function doPost(e) {
  let r;
  try {
    const q = JSON.parse(e.postData.contents);
    r = atender(q);
  } catch (err) {
    r = {ok: false, error: String(err && err.message || err), code: (err && err.code) || 'error'};
  }
  return salida(r);
}

function salida(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function fallo(msg, code) { const e = new Error(msg); e.code = code; return e; }

function rolDe(codigo) {
  codigo = String(codigo || '').trim();
  if (!codigo) return null;
  if (CODIGO_OFICINA && codigo === CODIGO_OFICINA) return 'oficina';
  if (CODIGO_TECNICOS && codigo === CODIGO_TECNICOS) return 'tecnico';
  return null;
}

function atender(q) {
  if (!CODIGO_TECNICOS || !CODIGO_OFICINA) throw fallo('Faltan los códigos de empresa en el servidor', 'sin_configurar');
  const rol = rolDe(q.codigo);
  if (!rol) throw fallo('Código de empresa incorrecto', 'no_autorizado');
  switch (q.accion) {
    case 'entrar': return {ok: true, rol: rol, ia: !!GEMINI_API_KEY, vacio: hoja().getLastRow() < 2};
    case 'leer': return leer(q.ver);
    case 'guardar': case 'actualizar': case 'borrar': return escribir(q.accion, q.col, q.id, q.data, rol);
    case 'sembrar': return sembrar(q.docs, rol);
    case 'ia': return ia(q);
    case 'foto': return guardarFoto(q);
    case 'verfoto': return verFoto(q.id);
    case 'catalogo': return catalogo();
  }
  throw fallo('Acción desconocida', 'invalid_argument');
}

/* ---------- Datos ---------- */
function libro() {
  /* Si el script está dentro de una Hoja, usa esa; si no, la que creó «instalar» (o la crea ahora) */
  let l = null;
  try { l = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
  if (l) return l;
  const p = PropertiesService.getScriptProperties();
  const id = p.getProperty('LIBRO');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  l = SpreadsheetApp.create('Parte a Pedido - datos');
  p.setProperty('LIBRO', l.getId());
  return l;
}
function hoja() {
  const libro_ = libro();
  let h = libro_.getSheetByName(HOJA);
  if (!h) {
    h = libro_.insertSheet(HOJA);
    const sobra = libro_.getSheetByName('Hoja 1') || libro_.getSheetByName('Sheet1') || libro_.getSheetByName('Hoja1');
    if (sobra && libro_.getSheets().length > 1) libro_.deleteSheet(sobra);
    h.getRange(1, 1, 1, 4).setValues([['colección', 'id', 'actualizado', 'datos (JSON)']]);
    h.setFrozenRows(1);
  }
  return h;
}
function version() { return PropertiesService.getScriptProperties().getProperty('VER') || '0'; }
function subirVersion() { const v = String(Date.now()); PropertiesService.getScriptProperties().setProperty('VER', v); return v; }

function filas() {
  const h = hoja(), n = h.getLastRow() - 1;
  if (n < 1) return [];
  return h.getRange(2, 1, n, Math.max(4, h.getLastColumn())).getValues();
}
function textoDe(fila) { return fila.slice(3).map(String).join(''); }

function leer(verCliente) {
  const v = version();
  if (verCliente && String(verCliente) === v) return {ok: true, ver: v, igual: true};
  const docs = [];
  filas().forEach(function (f) {
    if (!f[0] || !f[1]) return;
    try { docs.push({col: String(f[0]), id: String(f[1]), data: JSON.parse(textoDe(f))}); } catch (e) {}
  });
  return {ok: true, ver: v, docs: docs};
}

const COLECCIONES = ['partes', 'instalaciones', 'config'];

function escribir(accion, col, id, data, rol) {
  if (COLECCIONES.indexOf(col) < 0 || !/^[A-Za-z0-9_.:-]{1,100}$/.test(String(id || ''))) throw fallo('Datos no válidos', 'invalid_argument');
  if (col === 'config' && rol !== 'oficina') throw fallo('Solo la oficina puede cambiar las reglas', 'sin_permiso');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const h = hoja(), fs = filas();
    let i = fs.findIndex(function (f) { return String(f[0]) === col && String(f[1]) === String(id); });
    if (accion === 'borrar') {
      if (i >= 0) h.deleteRow(i + 2);
    } else {
      let valor = data || {};
      if (accion === 'actualizar') {
        if (i < 0) throw fallo('No existe', 'not_found');
        const prev = JSON.parse(textoDe(fs[i]) || '{}');
        Object.keys(valor).forEach(function (k) { prev[k] = valor[k]; });
        valor = prev;
      }
      const txt = JSON.stringify(valor), trozos = [];
      for (let k = 0; k < txt.length; k += TROZO) trozos.push(txt.slice(k, k + TROZO));
      if (!trozos.length) trozos.push('{}');
      const fila = [col, String(id), new Date()].concat(trozos);
      const ancho = Math.max(h.getLastColumn(), fila.length);
      while (fila.length < ancho) fila.push('');
      const n = i >= 0 ? i + 2 : h.getLastRow() + 1;
      h.getRange(n, 1, 1, ancho).setNumberFormat('@').setValues([fila.map(function (x, j) { return j === 2 ? x.toISOString() : x; })]);
    }
    return {ok: true, ver: subirVersion()};
  } finally {
    lock.releaseLock();
  }
}

function sembrar(docs, rol) {
  if (rol !== 'oficina' || hoja().getLastRow() >= 2) return {ok: true, ver: version()};
  (docs || []).forEach(function (d) { escribir('guardar', d.col, d.id, d.data, rol); });
  return {ok: true, ver: version()};
}

/* ---------- Gemini ---------- */
function ia(q) {
  if (!GEMINI_API_KEY) throw fallo('Falta la clave de Gemini en el servidor', 'sampling_disabled');
  const partes = (q.imagenes || []).map(function (im) { return {inline_data: {mime_type: im.mime || 'image/jpeg', data: im.b64}}; });
  partes.push({text: String(q.prompt || '')});
  const cuerpo = {contents: [{role: 'user', parts: partes}], generationConfig: {responseMimeType: 'application/json', temperature: 0.1}};
  const modelos = [q.nivel === 'quick' ? MODELO_RAPIDO : MODELO, MODELO_RESERVA];
  let ultimo = null;
  for (let m = 0; m < modelos.length; m++) {
    const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + modelos[m] + ':generateContent', {
      method: 'post', contentType: 'application/json', headers: {'x-goog-api-key': GEMINI_API_KEY},
      payload: JSON.stringify(cuerpo), muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    let j = {};
    try { j = JSON.parse(res.getContentText()); } catch (e) {}
    if (code === 200) {
      const c = (j.candidates || [])[0];
      const texto = c && c.content && c.content.parts ? c.content.parts.map(function (p) { return p.text || ''; }).join('') : '';
      if (!texto) throw fallo('Gemini no ha devuelto nada', j.promptFeedback && j.promptFeedback.blockReason ? 'refused' : 'empty_completion');
      return {ok: true, texto: texto, modelo: modelos[m]};
    }
    if (code === 429) throw fallo('Se ha llegado al límite gratuito de Gemini. Prueba dentro de un rato.', 'rate_limited');
    if (code === 400 && /API key/i.test(JSON.stringify(j))) throw fallo('La clave de Gemini no es válida', 'sampling_disabled');
    ultimo = fallo('Gemini respondió ' + code + ': ' + (j.error && j.error.message || ''), code === 404 ? 'not_found' : 'unavailable');
    if (code !== 404) break; // solo se prueba el modelo de reserva si el modelo no existe
  }
  throw ultimo;
}

/* ---------- Fotos en Google Drive (carpeta privada del propietario) ---------- */
function carpeta() {
  const p = PropertiesService.getScriptProperties();
  const id = p.getProperty('CARPETA');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const c = DriveApp.createFolder('Parte a Pedido · fotos de partes');
  p.setProperty('CARPETA', c.getId());
  return c;
}
function guardarFoto(q) {
  if (!q.b64 || String(q.b64).length > 15000000) throw fallo('Foto no válida', 'invalid_argument');
  const nombre = 'parte-' + Utilities.formatDate(new Date(), 'Europe/Madrid', 'yyyy-MM-dd-HHmmss') + '.jpg';
  const f = carpeta().createFile(Utilities.newBlob(Utilities.base64Decode(q.b64), q.mime || 'image/jpeg', nombre));
  return {ok: true, id: f.getId()};
}
/* ---------- Catálogo de Sage con precios: solo lo recibe quien tiene un código válido ---------- */
const NOMBRE_CATALOGO = 'parte-a-pedido-catalogo.txt';
function archivoCatalogo() {
  const yo = Session.getEffectiveUser().getEmail();
  const it = DriveApp.getFilesByName(NOMBRE_CATALOGO);
  while (it.hasNext()) {
    const f = it.next();
    try { if (!yo || f.getOwner().getEmail() === yo) return f; } catch (e) {}
  }
  return null;
}
function catalogo() {
  const f = archivoCatalogo();
  if (!f) throw fallo('Falta subir ' + NOMBRE_CATALOGO + ' a Google Drive', 'not_found');
  return {ok: true, texto: f.getBlob().getDataAsString(), fecha: f.getLastUpdated().toISOString()};
}

function verFoto(id) {
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(String(id || ''))) throw fallo('Foto no válida', 'invalid_argument');
  const f = DriveApp.getFileById(id);
  const padre = f.getParents();
  if (!padre.hasNext() || padre.next().getId() !== carpeta().getId()) throw fallo('Foto no encontrada', 'not_found');
  const b = f.getBlob();
  return {ok: true, mime: b.getContentType(), b64: Utilities.base64Encode(b.getBytes())};
}

/* Ejecuta esta función una vez desde el editor: crea la Hoja de datos y la carpeta de fotos, carga los datos iniciales y prueba Gemini */
function instalar() {
  if (!GEMINI_API_KEY || !CODIGO_TECNICOS || !CODIGO_OFICINA) throw new Error('Rellena antes GEMINI_API_KEY, CODIGO_TECNICOS y CODIGO_OFICINA (arriba del todo) y guarda.');
  if (CODIGO_TECNICOS === CODIGO_OFICINA) throw new Error('El código de técnicos y el de oficina tienen que ser distintos.');
  const h = hoja();
  if (h.getLastRow() < 2) DATOS_INICIALES.forEach(function (d) { escribir('guardar', d.col, d.id, d.data, 'oficina'); });
  const c = carpeta();
  Logger.log('Hoja de datos: ' + libro().getUrl());
  Logger.log('Carpeta de fotos: ' + c.getUrl());
  Logger.log('Documentos guardados: ' + (hoja().getLastRow() - 1));
  const cat = archivoCatalogo();
  Logger.log(cat ? 'Catálogo de Sage: encontrado (' + Math.round(cat.getSize() / 1048576 * 10) / 10 + ' MB)' : 'Catálogo de Sage: NO encontrado. Sube ' + NOMBRE_CATALOGO + ' a tu Google Drive y vuelve a ejecutar instalar.');
  try { Logger.log('Gemini responde: ' + ia({prompt: 'Responde con este JSON: {"hola": "mundo"}', nivel: 'quick'}).texto); }
  catch (e) { Logger.log('Gemini NO responde: ' + e.message); }
  Logger.log('Listo. Ahora: Implementar → Nueva implementación → Aplicación web.');
}

const DATOS_INICIALES = [
  {
    "col": "config",
    "id": "general",
    "data": {
      "tecnicos": [
        "Marius Rosca",
        "Moisés González"
      ]
    }
  },
  {
    "col": "instalaciones",
    "id": "a381-ct-pk72",
    "data": {
      "clienteCodigo": "430001461",
      "clienteNombre": "SERVEO SERVICIOS Y ALYON SERVICIOS S.A.",
      "ct": true,
      "kmIda": 88,
      "lat": 36.24621,
      "lng": -5.58105,
      "nombre": "Túneles A-381 · CT PK 72",
      "notas": "Túneles Autovía Jerez–Los Barrios. Km sacados del pedido 504 (176 km ida y vuelta). El punto del mapa está calculado por el PK 72 sobre la carretera: corregidlo si el CT está en otro sitio.",
      "precision": "pk",
      "ubicacion": "Autovía A-381 km 72, Cádiz"
    }
  },
  {
    "col": "partes",
    "id": "p12043",
    "data": {
      "coches": 1,
      "creadoEn": "2026-08-06T19:45:00.000Z",
      "creadoPor": null,
      "ct": true,
      "descripcion": "Se observa celda disparada, se sustituye fusible M.T. IBD1 fundido. Se comprueba celda transformador y se observa rata muerta y se retira. Se comprueba suministro. Todo OK.",
      "ejemplo": true,
      "estado": "pendiente",
      "fecha": "2026-08-06",
      "firma": null,
      "instalacion": {
        "clienteCodigo": "430001461",
        "clienteNombre": "SERVEO SERVICIOS Y ALYON SERVICIOS S.A.",
        "ct": true,
        "kmIda": 88,
        "nombre": "Túneles A-381 · CT PK 72"
      },
      "instalacionId": "a381-ct-pk72",
      "materiales": [
        {
          "cantidad": 1,
          "codigo": "M23P15BB144",
          "descripcion": "FUSIBLE IBD1 MEDIA TENSION 10/24 KV 25A",
          "descripcion2": "PRONUTEC S300061325",
          "precio": 28
        }
      ],
      "numero": 12043,
      "pedido": null,
      "tecnicos": [
        {
          "fin": "19:30",
          "inicio": "17:00",
          "nombre": "Marius Rosca"
        },
        {
          "fin": "19:30",
          "inicio": "17:00",
          "nombre": "Moisés González"
        }
      ]
    }
  }
];

/* Para probar desde el editor: ejecuta esta función y mira el registro */
function probarGemini() {
  const r = ia({prompt: 'Responde con este JSON: {"hola": "mundo"}', nivel: 'quick'});
  Logger.log(r);
}
