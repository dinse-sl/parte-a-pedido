/**
 * Parte a Pedido · cargador del servidor (Google Apps Script)
 * Este archivo NO hay que volver a tocarlo. El código de verdad (servidor/Codigo.gs) se lee de GitHub
 * y se guarda en caché unos minutos: cuando se sube una versión nueva a GitHub, el servidor la usa sola,
 * sin pegar nada ni hacer «Nueva versión».
 * La clave de Gemini y los códigos de empresa siguen guardados en el proyecto (guardarClaves).
 */
const CODIGO_EN_GITHUB = 'https://raw.githubusercontent.com/dinse-sl/parte-a-pedido/main/servidor/Codigo.gs';
const MINUTOS_CACHE = 5;

let servidor_ = null;

function servidor() {
  if (servidor_) return servidor_;
  const cache = CacheService.getScriptCache();
  let src = cache.get('codigo');
  if (!src) {
    src = descargarCodigo_();
    if (src) { cache.put('codigo', src, MINUTOS_CACHE * 60); guardarCopia_(src); }
    else src = leerCopia_(); // si GitHub no responde, se usa la última copia buena
  }
  if (!src) throw new Error('No se ha podido leer el código del servidor de GitHub y no hay copia guardada.');
  servidor_ = new Function(src + '\n;return {doGet: doGet, doPost: doPost, instalar: instalar, guardarClaves: guardarClaves,' +
    ' probarCatalogo: probarCatalogo, probarGemini: probarGemini, version: typeof VERSION_SERVIDOR === "undefined" ? "?" : VERSION_SERVIDOR};')();
  return servidor_;
}

function descargarCodigo_() {
  try {
    const r = UrlFetchApp.fetch(CODIGO_EN_GITHUB + '?t=' + Date.now(), {muteHttpExceptions: true});
    const t = r.getResponseCode() === 200 ? r.getContentText() : '';
    return t.length > 5000 && t.indexOf('function doPost') >= 0 ? t : '';
  } catch (e) { return ''; }
}

/* Copia de seguridad en las propiedades del proyecto, en trozos (cada valor admite unos 9 KB) */
function guardarCopia_(src) {
  const p = PropertiesService.getScriptProperties();
  const n = Math.ceil(src.length / 8000), datos = {COPIA_N: String(n)};
  for (let i = 0; i < n; i++) datos['COPIA_' + i] = src.slice(i * 8000, (i + 1) * 8000);
  if (p.getProperty('COPIA_0') !== datos.COPIA_0 || p.getProperty('COPIA_N') !== datos.COPIA_N) p.setProperties(datos);
}
function leerCopia_() {
  const p = PropertiesService.getScriptProperties();
  const n = Number(p.getProperty('COPIA_N') || 0);
  let s = '';
  for (let i = 0; i < n; i++) s += p.getProperty('COPIA_' + i) || '';
  return s;
}

function doGet(e) { return servidor().doGet(e); }
function doPost(e) { return servidor().doPost(e); }
function instalar() { return servidor().instalar(); }
function guardarClaves() { return servidor().guardarClaves(); }
function probarCatalogo() { return servidor().probarCatalogo(); }
function probarGemini() { return servidor().probarGemini(); }

/* Ejecuta esta función una vez después de pegar el cargador: limpia lo anterior y comprueba que todo funciona */
function probarServidor() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); }); // la actualización por API ya no se usa
  CacheService.getScriptCache().remove('codigo');
  const s = servidor();
  Logger.log('Código del servidor leído de GitHub · versión ' + s.version);
  s.probarCatalogo();
  Logger.log('Listo. Ahora haz una ÚLTIMA vez: Implementar → Gestionar implementaciones → lápiz → Nueva versión → Implementar.');
}

/* Por si quedara programada la comprobación anterior: no hace nada */
function actualizarDesdeGitHub() {}
