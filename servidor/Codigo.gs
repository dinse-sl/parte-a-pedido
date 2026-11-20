/**
 * Parte a Pedido · servidor (Google Apps Script)
 * Guarda los partes, instalaciones y reglas en una Hoja de Google que crea él solo en tu Drive,
 * guarda las fotos en Google Drive y llama a Gemini para leer los partes en papel.
 * La clave de Gemini se queda en tu Google, no llega a los móviles.
 *
 * 1) SOLO LA PRIMERA VEZ (o para cambiar la clave o un código): rellena estas tres líneas, guarda
 *    y ejecuta «guardarClaves». Quedan guardadas en la configuración del proyecto
 *    (Configuración del proyecto → Propiedades de la secuencia de comandos).
 *    Después puedes dejarlas vacías: cuando pegues una versión nueva del código no hace falta rellenarlas.
 *    Si una línea tiene algo escrito, manda sobre lo guardado.
 */
const GEMINI_API_KEY  = '';          // Clave de https://aistudio.google.com/apikey
const CODIGO_TECNICOS = '';          // Código que escribirán los técnicos (ej. DINSE-TEC-4821)
const CODIGO_OFICINA  = '';          // Código de la oficina: además puede cambiar las reglas (ej. DINSE-OF-9374)

/* La clave y los códigos: lo escrito arriba o, si está vacío, lo guardado en el proyecto */
function ajuste_(nombre, escrito) {
  const v = String(escrito || '').trim();
  if (v) return v;
  return String(PropertiesService.getScriptProperties().getProperty(nombre) || '').trim();
}
function claveGemini_()    { return ajuste_('GEMINI_API_KEY', GEMINI_API_KEY); }
function codigoTecnicos_() { return ajuste_('CODIGO_TECNICOS', CODIGO_TECNICOS); }
function codigoOficina_()  { return ajuste_('CODIGO_OFICINA', CODIGO_OFICINA); }

/* Ejecuta esta función para guardar en el proyecto lo que hayas escrito en las tres líneas de arriba */
function guardarClaves() {
  const p = PropertiesService.getScriptProperties();
  const datos = {GEMINI_API_KEY: GEMINI_API_KEY, CODIGO_TECNICOS: CODIGO_TECNICOS, CODIGO_OFICINA: CODIGO_OFICINA};
  const guardadas = [];
  Object.keys(datos).forEach(function (k) {
    const v = String(datos[k] || '').trim();
    if (v) { p.setProperty(k, v); guardadas.push(k); }
  });
  if (codigoTecnicos_() && codigoTecnicos_() === codigoOficina_()) throw new Error('El código de técnicos y el de oficina tienen que ser distintos.');
  Logger.log(guardadas.length ? 'Guardado en el proyecto: ' + guardadas.join(', ') : 'Las tres líneas están vacías: no se ha cambiado nada.');
  Logger.log('Clave de Gemini: ' + (claveGemini_() ? 'guardada' : 'FALTA') + ' · Código técnicos: ' + (codigoTecnicos_() ? 'guardado' : 'FALTA') + ' · Código oficina: ' + (codigoOficina_() ? 'guardado' : 'FALTA'));
  Logger.log('Ya puedes dejar vacías las tres líneas. Si has cambiado algo, haz una nueva versión de la implementación.');
}

/* Modelos de Gemini (puedes cambiarlos si Google los renombra) */
const MODELO         = 'gemini-2.5-flash';      // leer la foto del parte: rápido y fiable sin razonamiento
const MODELO_RAPIDO  = 'gemini-3.5-flash-lite'; // elegir opciones de material
const MODELO_RESERVA = 'gemini-3.8-flash';      // el más listo pero más lento: solo si los otros fallan

/* 2) Arriba, elige la función «instalar» y pulsa ▶ Ejecutar. Acepta los permisos.
 *    Crea la Hoja «Parte a Pedido - datos» en tu Drive (con los datos iniciales) y prueba Gemini.
 * 3) Implementar → Nueva implementación → Aplicación web · Ejecutar como: Yo · Acceso: Cualquier usuario.
 *    Copia la URL que termina en /exec y pégala en web/config.js
 * ------------------------------------------------------------------------------------------------ */

const VERSION_SERVIDOR = '2026-11-20.5';
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
    console.log('Error: ' + (err && err.message || err));
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
  const of = codigoOficina_(), tec = codigoTecnicos_();
  if (of && codigo === of) return 'oficina';
  if (tec && codigo === tec) return 'tecnico';
  return null;
}

function atender(q) {
  if (!codigoTecnicos_() || !codigoOficina_()) throw fallo('Faltan los códigos de empresa en el servidor', 'sin_configurar');
  const rol = rolDe(q.codigo);
  if (!rol) throw fallo('Código de empresa incorrecto', 'no_autorizado');
  switch (q.accion) {
    case 'entrar': return {ok: true, rol: rol, ia: !!claveGemini_(), vacio: hoja().getLastRow() < 2, version: VERSION_SERVIDOR, datos: q.conDatos ? leer(null) : null};
    case 'leer': return leer(q.ver);
    case 'guardar': case 'actualizar': case 'borrar': return escribir(q.accion, q.col, q.id, q.data, rol);
    case 'sembrar': return sembrar(q.docs, rol);
    case 'ia': return ia(q);
    case 'foto': return guardarFoto(q);
    case 'verfoto': return verFoto(q.id);
    case 'catalogo': return catalogo();
    case 'catalogoInfo': return catalogoInfo();
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
  const clave = claveGemini_();
  if (!clave) throw fallo('Falta la clave de Gemini en el servidor', 'sampling_disabled');
  const partes = (q.imagenes || []).map(function (im) { return {inline_data: {mime_type: im.mime || 'image/jpeg', data: im.b64}}; });
  partes.push({text: String(q.prompt || '')});
  /* Orden de modelos: el elegido primero; si está saturado (503) o sin cupo (429), se prueba el siguiente */
  const modelos = (q.nivel === 'quick' ? [MODELO_RAPIDO, MODELO, MODELO_RESERVA] : [MODELO, MODELO_RAPIDO, MODELO_RESERVA])
    .filter(function (x, i, a) { return x && a.indexOf(x) === i; });
  const inicio = Date.now();
  let ultimo = null, limite = false;
  for (let m = 0; m < modelos.length; m++) {
    if (Date.now() - inicio > 75000) break; // no empezar otro modelo pasado minuto y cuarto
    /* Leer un parte no necesita «pensar» mucho: con poco razonamiento responde bastante más rápido */
    const pensar = /^gemini-2\./.test(modelos[m]) ? {thinkingBudget: 0} : {thinkingLevel: 'low'};
    let conPensar = true, res, code, j, t0 = Date.now();
    for (let intento = 0; intento < 3; intento++) {
      const gc = {responseMimeType: 'application/json', temperature: 0.1};
      if (conPensar) gc.thinkingConfig = pensar;
      t0 = Date.now();
      try {
        res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + modelos[m] + ':generateContent', {
          method: 'post', contentType: 'application/json', headers: {'x-goog-api-key': clave},
          payload: JSON.stringify({contents: [{role: 'user', parts: partes}], generationConfig: gc}), muteHttpExceptions: true
        });
        code = res.getResponseCode();
        j = {};
        try { j = JSON.parse(res.getContentText()); } catch (e) {}
      } catch (e) {
        code = 504; j = {error: {message: String(e && e.message || e)}}; // sin respuesta de Gemini a tiempo
      }
      /* si el modelo no admite el ajuste de razonamiento, se repite sin él */
      if (code === 400 && conPensar && /thinking/i.test(JSON.stringify(j))) { conPensar = false; continue; }
      /* saturado: un segundo intento con el mismo modelo tras una pausa corta */
      if ((code === 503 || code === 500) && intento === 0 && Date.now() - inicio < 20000) { Utilities.sleep(2000); continue; }
      break;
    }
    console.log('Gemini ' + modelos[m] + ' · ' + (q.imagenes || []).length + ' imágenes · HTTP ' + code + ' · ' + Math.round((Date.now() - t0) / 1000) + ' s');
    if (code === 200) {
      const c = (j.candidates || [])[0];
      const texto = c && c.content && c.content.parts ? c.content.parts.map(function (p) { return p.text || ''; }).join('') : '';
      if (!texto) throw fallo('Gemini no ha devuelto nada', j.promptFeedback && j.promptFeedback.blockReason ? 'refused' : 'empty_completion');
      return {ok: true, texto: texto, modelo: modelos[m], segundos: Math.round((Date.now() - inicio) / 1000)};
    }
    if (code === 400 && /API key/i.test(JSON.stringify(j))) throw fallo('La clave de Gemini no es válida', 'sampling_disabled');
    if (code === 429) limite = true;
    ultimo = fallo('Gemini respondió ' + code + ': ' + String(j.error && j.error.message || '').slice(0, 200), code === 404 ? 'not_found' : 'unavailable');
    /* se pasa al siguiente modelo si este no existe, está saturado, sin cupo o no contesta */
    if ([404, 429, 500, 503, 504].indexOf(code) < 0) break;
  }
  if (limite && ultimo && !/ 50[34]:/.test(ultimo.message)) throw fallo('Se ha llegado al límite gratuito de Gemini. Prueba dentro de un rato.', 'rate_limited');
  if (ultimo && / 50[34]:/.test(ultimo.message)) throw fallo('Gemini está saturado ahora mismo (lo hemos probado con ' + modelos.length + ' modelos). Prueba en unos minutos o rellena el parte a mano.', 'unavailable');
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
/* Busca el catálogo en tu Drive aunque al subirlo Drive le haya añadido « (1)» al nombre; usa el más reciente */
function buscarCatalogos_() {
  const yo = Session.getEffectiveUser().getEmail();
  const it = DriveApp.searchFiles("title contains 'parte-a-pedido-catalogo' and trashed = false");
  const lista = [];
  while (it.hasNext()) {
    const f = it.next();
    let mio = true;
    try { const o = f.getOwner(); mio = !yo || !o || o.getEmail() === yo; } catch (e) {}
    if (mio) lista.push(f);
  }
  lista.sort(function (a, b) { return b.getLastUpdated() - a.getLastUpdated(); });
  return lista;
}
function archivoCatalogo() {
  /* rápido: el archivo que se usó la última vez, si sigue siendo el más reciente */
  const p = PropertiesService.getScriptProperties();
  const id = p.getProperty('CATALOGO_ID');
  if (id) {
    try {
      const f = DriveApp.getFileById(id);
      if (!f.isTrashed() && f.getMimeType() !== MimeType.GOOGLE_DOCS && f.getLastUpdated().getTime() >= Number(p.getProperty('CATALOGO_REVISADO') || 0) - 600000) return f;
    } catch (e) {}
  }
  const encontrado = archivoCatalogoBuscando_();
  if (encontrado) { p.setProperty('CATALOGO_ID', encontrado.getId()); p.setProperty('CATALOGO_REVISADO', String(encontrado.getLastUpdated().getTime())); }
  return encontrado;
}
function archivoCatalogoBuscando_() {
  const lista = buscarCatalogos_();
  const txt = lista.filter(function (f) { return f.getMimeType() !== MimeType.GOOGLE_DOCS; });
  if (txt.length) return txt[0];
  if (lista.length) throw fallo('Drive ha convertido el catálogo en un documento de Google. Bórralo, desactiva en Drive ⚙ Configuración «Convertir archivos subidos» y súbelo otra vez.', 'not_found');
  return null;
}
/* Fecha del catálogo, para que el móvil sepa si el que tiene guardado sigue valiendo (una búsqueda completa cada 10 minutos como mucho) */
function catalogoInfo() {
  const cache = CacheService.getScriptCache();
  let info = cache.get('catalogoInfo');
  if (!info) {
    const p = PropertiesService.getScriptProperties();
    const f = archivoCatalogoBuscando_();
    if (!f) throw fallo('No encuentro ' + NOMBRE_CATALOGO + ' en tu Google Drive. Súbelo a «Mi unidad» sin cambiarle el nombre.', 'not_found');
    p.setProperty('CATALOGO_ID', f.getId()); p.setProperty('CATALOGO_REVISADO', String(f.getLastUpdated().getTime()));
    info = JSON.stringify({fecha: f.getLastUpdated().toISOString(), tam: f.getSize()});
    cache.put('catalogoInfo', info, 600);
  }
  return Object.assign({ok: true}, JSON.parse(info));
}
function catalogo() {
  const f = archivoCatalogo();
  if (!f) throw fallo('No encuentro ' + NOMBRE_CATALOGO + ' en tu Google Drive. Súbelo a «Mi unidad» sin cambiarle el nombre.', 'not_found');
  const texto = f.getBlob().getDataAsString();
  if (texto.length < 100000) throw fallo('El archivo del catálogo en Drive está incompleto (' + Math.round(texto.length / 1024) + ' KB). Súbelo otra vez.', 'not_found');
  return {ok: true, texto: texto, fecha: f.getLastUpdated().toISOString()};
}

/* Para revisar desde el editor: ejecuta esta función y mira el registro */
function probarCatalogo() {
  const lista = buscarCatalogos_();
  if (!lista.length) { Logger.log('No hay ningún archivo «parte-a-pedido-catalogo» en tu Drive (los de la papelera no cuentan). Súbelo a Mi unidad.'); return; }
  lista.forEach(function (f) { Logger.log('Encontrado: «' + f.getName() + '» · ' + f.getMimeType() + ' · ' + Math.round(f.getSize() / 1024) + ' KB · ' + f.getLastUpdated()); });
  try { const r = catalogo(); Logger.log('Catálogo correcto: ' + Math.round(r.texto.length / 1048576 * 10) / 10 + ' MB. La app lo puede descargar.'); }
  catch (e) { Logger.log('PROBLEMA: ' + e.message); }
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
  guardarClaves();
  if (!claveGemini_() || !codigoTecnicos_() || !codigoOficina_()) throw new Error('Rellena antes GEMINI_API_KEY, CODIGO_TECNICOS y CODIGO_OFICINA (arriba del todo) y guarda.');
  const h = hoja();
  if (h.getLastRow() < 2) DATOS_INICIALES.forEach(function (d) { escribir('guardar', d.col, d.id, d.data, 'oficina'); });
  const c = carpeta();
  Logger.log('Hoja de datos: ' + libro().getUrl());
  Logger.log('Carpeta de fotos: ' + c.getUrl());
  Logger.log('Documentos guardados: ' + (hoja().getLastRow() - 1));
  probarCatalogo();
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
