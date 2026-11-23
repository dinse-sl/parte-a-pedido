/* Parte a Pedido · versión fuera de Claude
   Sustituye los servicios que la app usaba dentro de Claude por un servidor propio
   (Google Apps Script + Hoja de Google + Gemini). La app no cambia: este archivo
   ofrece la misma interfaz (window.claude.use('db' | 'user' | 'sample' | 'assets')). */
(function () {
  'use strict';
  var CFG = window.PAP_CONFIG || {};
  if (window.claude || !CFG.servidor || /PEGA_AQUI/.test(CFG.servidor)) return; /* sin servidor: modo prueba */

  var SERVIDOR = CFG.servidor;
  var CLAVE = 'pap-codigo';
  var codigo = '';
  try { codigo = localStorage.getItem(CLAVE) || ''; } catch (_) {}
  var q = new URLSearchParams(location.search);
  if (q.get('codigo')) {
    codigo = q.get('codigo').trim();
    try { localStorage.setItem(CLAVE, codigo); } catch (_) {}
    q.delete('codigo');
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
  }

  function error(msg, code) { var e = new Error(msg); e.code = code || 'error'; return e; }
  function llamar(accion, datos, signal, maxMs) {
    var cuerpo = Object.assign({accion: accion, codigo: codigo}, datos || {});
    /* tiempo máximo: si el servidor no contesta, se avisa en vez de quedarse cargando */
    var ctl = new AbortController(), agotado = false;
    var reloj = setTimeout(function () { agotado = true; ctl.abort(); }, maxMs || 60000);
    if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', function () { ctl.abort(); }); }
    return fetch(SERVIDOR, {method: 'POST', body: JSON.stringify(cuerpo), headers: {'Content-Type': 'text/plain;charset=utf-8'}, redirect: 'follow', signal: ctl.signal})
      .then(function (r) { if (!r.ok) throw error('HTTP ' + r.status, r.status === 429 ? 'rate_limited' : 'unavailable'); return r.text(); },
            function (e) {
              if (agotado) throw error('El servidor no ha contestado a tiempo', 'timeout');
              if (e && e.name === 'AbortError') throw error('Cancelado', 'cancelled');
              throw error('Sin conexión con el servidor', 'unavailable');
            })
      .then(function (t) {
        var j = null; try { j = JSON.parse(t); } catch (_) {}
        if (!j) throw error(/tiempo máximo|maximum execution time/i.test(t) ? 'El servidor de Google ha superado su tiempo máximo' : 'Respuesta no válida del servidor', 'unavailable');
        if (!j.ok) throw error(j.error || 'Error del servidor', j.code || 'error');
        return j;
      })
      .finally(function () { clearTimeout(reloj); });
  }
  /* Mientras Gemini lee el parte, se enseñan los segundos que lleva */
  function contador() {
    var t0 = Date.now();
    var id = setInterval(function () {
      var el = document.querySelector('#p-foto-estado > span:not(.spin)');
      if (!el) return;
      var s = Math.round((Date.now() - t0) / 1000);
      el.textContent = 'Leyendo el parte con Gemini… ' + s + ' s (suele tardar menos de un minuto)';
    }, 1000);
    return function () { clearInterval(id); };
  }

  /* ---------- Acceso con código de empresa ---------- */
  var sesion = null;
  function pedirCodigo(msg) {
    return new Promise(function (resolve) {
      var d = document.createElement('div');
      d.setAttribute('style', 'position:fixed;inset:0;z-index:99999;background:rgba(15,20,30,.55);display:flex;align-items:center;justify-content:center;padding:16px');
      d.innerHTML = '<form id="pap-login" style="background:#fff;color:#1a1f2b;max-width:360px;width:100%;border-radius:8px;padding:22px;font:15px system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.3)">' +
        '<h2 style="margin:0 0 6px;font-size:19px">Parte a Pedido</h2>' +
        '<p style="margin:0 0 14px;color:#556">Escribe el código de empresa que te ha dado la oficina.</p>' +
        '<input name="c" autocomplete="off" autocapitalize="characters" required style="width:100%;box-sizing:border-box;font-size:17px;padding:10px;border:1px solid #9aa5b5;border-radius:6px">' +
        '<p data-e style="color:#b42318;min-height:1.2em;margin:8px 0 0;font-size:14px"></p>' +
        '<button style="margin-top:8px;width:100%;padding:11px;font-size:16px;border:0;border-radius:6px;background:#2340b0;color:#fff;cursor:pointer">Entrar</button></form>';
      document.body.appendChild(d);
      var f = d.querySelector('form'), inp = f.querySelector('input'), err = f.querySelector('[data-e]');
      if (msg) err.textContent = msg;
      inp.focus();
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var c = inp.value.trim(); if (!c) return;
        err.textContent = 'Comprobando…';
        codigo = c;
        llamar('entrar', {conDatos: true}).then(function (j) {
          try { localStorage.setItem(CLAVE, codigo); } catch (_) {}
          d.remove(); resolve(j);
        }, function (e) { err.textContent = e.code === 'no_autorizado' ? 'Ese código no es válido.' : 'No hay conexión con el servidor. Prueba otra vez.'; });
      });
    });
  }
  function entrar() {
    if (sesion) return sesion;
    sesion = (codigo ? llamar('entrar', {conDatos: true}).catch(function (e) { return pedirCodigo(e.code === 'no_autorizado' ? 'El código guardado ya no vale.' : ''); }) : pedirCodigo(''))
      .then(function (j) {
        mostrarSalir(j.rol);
        if (j.datos) cargarDatos(j.datos);
        setTimeout(precargarCatalogo, 1500); /* el catálogo se prepara en segundo plano */
        return j;
      });
    return sesion;
  }
  function mostrarSalir(rol) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = (rol === 'oficina' ? 'Oficina' : 'Técnico') + ' · salir';
    b.title = 'Cerrar la sesión en este dispositivo';
    b.setAttribute('style', 'position:fixed;right:8px;bottom:8px;z-index:9999;font:12px system-ui,sans-serif;padding:5px 9px;border-radius:999px;border:1px solid #9aa5b5;background:#fff;color:#334;opacity:.85;cursor:pointer');
    b.addEventListener('click', function () { if (!confirm('¿Cerrar la sesión en este dispositivo? Tendrás que volver a escribir el código.')) return; try { localStorage.removeItem(CLAVE); } catch (_) {} location.reload(); });
    document.body.appendChild(b);
  }

  /* ---------- Base de datos (partes, instalaciones, config) ---------- */
  var datos = {};          /* col -> {id: data} */
  var ver = null;
  var oyentesCol = {};     /* col -> [fn] */
  var oyentesDoc = {};     /* 'col/id' -> [fn] */
  var listo = false;
  function clon(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }
  function snapCol(col) {
    var m = datos[col] || {};
    return {docs: Object.keys(m).map(function (id) { return {id: id, data: function () { return clon(m[id]); }}; }), metadata: {fromCache: !listo}};
  }
  function snapDoc(path) {
    var p = path.split('/'), m = datos[p[0]] || {}, v = m[p[1]];
    return {id: p[1], exists: v !== undefined, data: function () { return clon(v); }};
  }
  function avisar(col, id) {
    (oyentesCol[col] || []).forEach(function (o) { try { o.fn(snapCol(col)); } catch (e) { console.error(e); } });
    Object.keys(oyentesDoc).forEach(function (k) {
      var p = k.split('/');
      if (p[0] === col && (id == null || p[1] === id)) oyentesDoc[k].forEach(function (o) { try { o.fn(snapDoc(k)); } catch (e) { console.error(e); } });
    });
  }
  function avisarTodo() { Object.keys(oyentesCol).forEach(function (c) { avisar(c); }); Object.keys(oyentesDoc).forEach(function (k) { var c = k.split('/')[0]; if (!oyentesCol[c]) avisar(c); }); }
  function cargarDatos(j) {
    var nuevo = {};
    (j.docs || []).forEach(function (d) { (nuevo[d.col] = nuevo[d.col] || {})[d.id] = d.data; });
    datos = nuevo; ver = j.ver; listo = true;
    avisarTodo();
  }
  var sincronizando = null, pendiente = false;
  function sincronizar() {
    if (sincronizando) { pendiente = true; return sincronizando; }
    sincronizando = llamar('leer', {ver: ver}).then(function (j) {
      if (!j.igual) {
        var nuevo = {};
        (j.docs || []).forEach(function (d) { (nuevo[d.col] = nuevo[d.col] || {})[d.id] = d.data; });
        datos = nuevo;
      }
      ver = j.ver;
      var primera = !listo; listo = true;
      if (!j.igual || primera) avisarTodo();
    }).catch(function (e) {
      Object.keys(oyentesCol).forEach(function (c) { (oyentesCol[c] || []).forEach(function (o) { if (o.err && !listo) o.err(e); }); });
    }).then(function () { sincronizando = null; if (pendiente) { pendiente = false; sincronizar(); } });
    return sincronizando;
  }
  var reloj = null;
  function arrancarSondeo() {
    if (reloj) return;
    reloj = setInterval(function () { if (!document.hidden) sincronizar(); }, 8000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) sincronizar(); });
  }
  function escribir(accion, col, id, data) {
    /* se aplica en pantalla al momento y después se guarda en el servidor */
    var m = datos[col] = datos[col] || {};
    var antes = clon(m[id]);
    if (accion === 'guardar') m[id] = clon(data);
    else if (accion === 'actualizar') m[id] = Object.assign({}, m[id] || {}, clon(data));
    else if (accion === 'borrar') delete m[id];
    avisar(col, id);
    return llamar(accion, {col: col, id: id, data: data}).then(function (j) { if (j.ver) ver = null; sincronizar(); }, function (e) {
      if (antes === undefined) delete m[id]; else m[id] = antes;
      avisar(col, id);
      if (e.code === 'sin_permiso') e.code = 'invalid_argument';
      throw e;
    });
  }
  function nuevoId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  var db = {
    collection: function (col) {
      return {
        add: function (data) { var id = nuevoId(); return escribir('guardar', col, id, data).then(function () { return {id: id}; }); },
        doc: function (id) { return db.doc(col + '/' + id); },
        onSnapshot: function (fn, err) {
          var o = {fn: fn, err: err}; (oyentesCol[col] = oyentesCol[col] || []).push(o);
          if (listo) fn(snapCol(col)); else sincronizar();
          arrancarSondeo();
          return function () { oyentesCol[col] = oyentesCol[col].filter(function (x) { return x !== o; }); };
        }
      };
    },
    doc: function (path) {
      var p = path.split('/');
      return {
        id: p[1],
        set: function (data) { return escribir('guardar', p[0], p[1], data); },
        update: function (patch) { return escribir('actualizar', p[0], p[1], patch); },
        delete: function () { return escribir('borrar', p[0], p[1]); },
        get: function () { return sincronizar().then(function () { return snapDoc(path); }); },
        onSnapshot: function (fn, err) {
          var o = {fn: fn, err: err}; (oyentesDoc[path] = oyentesDoc[path] || []).push(o);
          if (listo) fn(snapDoc(path)); else sincronizar();
          arrancarSondeo();
          return function () { oyentesDoc[path] = oyentesDoc[path].filter(function (x) { return x !== o; }); };
        }
      };
    }
  };

  /* ---------- Usuario (rol según el código: técnicos u oficina) ---------- */
  function usuario(j) {
    var idDisp = '';
    try { idDisp = localStorage.getItem('pap-disp') || ''; if (!idDisp) { idDisp = 'd-' + nuevoId(); localStorage.setItem('pap-disp', idDisp); } } catch (_) { idDisp = 'd-' + nuevoId(); }
    return {
      id: function () { return Promise.resolve(idDisp); },
      canEdit: function () { return Promise.resolve(j.rol === 'oficina'); },
      can: function () { return Promise.resolve(true); }
    };
  }

  /* ---------- IA: Gemini a través del servidor (la clave no sale de Google) ---------- */
  function aBase64(blob) {
    return new Promise(function (ok, ko) {
      var r = new FileReader();
      r.onload = function () { ok(String(r.result).split(',')[1] || ''); };
      r.onerror = function () { ko(error('imagen', 'image_rejected')); };
      r.readAsDataURL(blob);
    });
  }
  function sacarJson(t) {
    t = String(t || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(t); } catch (_) {}
    var a = t.search(/[\[{]/), b = Math.max(t.lastIndexOf(']'), t.lastIndexOf('}'));
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (_) {} }
    throw error('Respuesta no válida', 'invalid_json');
  }
  /* Plantilla fija de respuesta (responseSchema de Gemini): misma forma siempre, con tipos y valores permitidos.
     Los campos son los que ya lee la app (normalizarLectura); los textos de cada campo repiten las reglas del prompt. */
  function txt(desc) { return {type: 'STRING', nullable: true, description: desc}; }
  function esquemaLectura() {
    var P = window.PAP || {}, ids = [];
    try { ids = ((P.S && P.S.inst) || []).map(function (i) { return String(i.id || ''); }).filter(Boolean).slice(0, 300); } catch (_) {}
    var props = {
      numero_parte: txt('Número del parte impreso (normalmente en rojo), solo las cifras'),
      fecha: txt('Fecha del parte en formato AAAA-MM-DD (en el papel va día-mes-año)'),
      cliente: txt('Cliente tal como está escrito'),
      direccion: txt('Dirección'),
      poblacion: txt('Población'),
      localizacion: txt('Localización de la instalación'),
      instalacion_id: ids.length ? {type: 'STRING', nullable: true, enum: ids, description: 'id de la instalación de la lista si encaja claramente; si no, null'} : txt('id de la instalación de la lista o null'),
      es_ct: {type: 'BOOLEAN', nullable: true, description: 'true si es en un centro de transformación (media tensión), false si es baja tensión, null si no se sabe'},
      descripcion: txt('Descripción de la actuación efectuada, transcrita sin añadir nada'),
      tecnicos: {type: 'ARRAY', description: 'Mano de obra empleada: un elemento por técnico', items: {type: 'OBJECT', properties: {
        nombre: {type: 'STRING', description: 'Nombre del técnico; si se parece a uno conocido, el nombre exacto de la lista'},
        inicio: txt('Hora de inicio HH:MM en 24 h, o null si no se lee'),
        fin: txt('Hora de fin HH:MM en 24 h, o null si no se lee'),
        seguro: {type: 'BOOLEAN', description: 'false si la letra no se lee bien o has tenido que suponerlo; true si está claro'}
      }, required: ['nombre', 'inicio', 'fin', 'seguro'], propertyOrdering: ['nombre', 'inicio', 'fin', 'seguro']}},
      materiales: {type: 'ARRAY', description: 'Solo material: ni mano de obra ni desplazamiento', items: {type: 'OBJECT', properties: {
        cantidad: {type: 'NUMBER', nullable: true, description: 'Cantidad escrita'},
        texto: {type: 'STRING', description: 'El material tal como está escrito'},
        busquedas: {type: 'ARRAY', items: {type: 'STRING'}, description: 'De una a tres formas de buscarlo en el catálogo, en mayúsculas y sin abreviaturas'},
        seguro: {type: 'BOOLEAN', description: 'false si la letra no se lee bien o has tenido que suponerlo; true si está claro'}
      }, required: ['cantidad', 'texto', 'busquedas', 'seguro'], propertyOrdering: ['cantidad', 'texto', 'busquedas', 'seguro']}},
      coches: {type: 'INTEGER', nullable: true, description: 'Coches del servicio de desplazamiento; null si el parte no lo dice'},
      firma_cliente: {type: 'BOOLEAN', nullable: true, description: 'true si se ve la firma del cliente, false si el recuadro está vacío'},
      anotaciones: txt('Anotaciones a mano de la oficina, como «P 504»'),
      dudas: {type: 'ARRAY', items: {type: 'STRING'}, description: 'Lo que no se lee bien o falta'},
      seguros: {type: 'OBJECT', description: 'Para cada dato: true si se lee claro, false si dudas o lo has supuesto', properties: {
        numero_parte: {type: 'BOOLEAN'}, fecha: {type: 'BOOLEAN'}, instalacion: {type: 'BOOLEAN'}, descripcion: {type: 'BOOLEAN'}, coches: {type: 'BOOLEAN'}
      }, required: ['numero_parte', 'fecha', 'instalacion', 'descripcion', 'coches'], propertyOrdering: ['numero_parte', 'fecha', 'instalacion', 'descripcion', 'coches']}
    };
    if (conPosiciones()) {
      /* posición de cada dato en la imagen: [ymin, xmin, ymax, xmax] de 0 a 1000 (la convención de Gemini) */
      var caja = {type: 'ARRAY', nullable: true, items: {type: 'INTEGER'}, description: '[ymin, xmin, ymax, xmax] de 0 a 1000 sobre la imagen; null si no se ve'};
      props.tecnicos.items.properties.caja = caja; props.tecnicos.items.required.push('caja'); props.tecnicos.items.propertyOrdering.push('caja');
      props.materiales.items.properties.caja = caja; props.materiales.items.required.push('caja'); props.materiales.items.propertyOrdering.push('caja');
      var pk = ['numero_parte', 'fecha', 'localizacion', 'descripcion', 'coches', 'firma_cliente'], pp = {};
      pk.forEach(function (k) { pp[k] = caja; });
      props.posiciones = {type: 'OBJECT', description: 'Dónde está escrito cada dato en la imagen', properties: pp, required: pk, propertyOrdering: pk};
    }
    var orden = Object.keys(props);
    return {type: 'OBJECT', properties: props, required: orden, propertyOrdering: orden};
  }
  function conPosiciones() { try { return localStorage.getItem('pap-posiciones') === '1'; } catch (_) { return false; } }
  var PROMPT_POSICIONES = '\n\nAdemás, indica dónde está escrito cada dato en la imagen: en "posiciones" (número de parte, fecha, localización, descripción, desplazamiento y recuadro de la firma del cliente) y en "caja" de cada técnico y cada material, con [ymin, xmin, ymax, xmax] normalizado de 0 a 1000 sobre la imagen. Abarca el texto escrito a mano completo de ese dato, sin el rótulo impreso. Si no se ve, null.';
  function esquemaMateriales() {
    return {type: 'ARRAY', items: {type: 'OBJECT', properties: {
      linea: {type: 'INTEGER', description: 'Número de línea que se está eligiendo'},
      opciones: {type: 'ARRAY', description: 'Entre 4 y 8 opciones, la más probable primero', items: {type: 'OBJECT', properties: {
        codigo: {type: 'STRING', description: 'Código de uno de los candidatos de esa línea'},
        nota: {type: 'STRING', description: 'Muy breve: qué es y en qué se diferencia'}
      }, required: ['codigo', 'nota'], propertyOrdering: ['codigo', 'nota']}}
    }, required: ['linea', 'opciones'], propertyOrdering: ['linea', 'opciones']}};
  }
  function esquemaPlaca() {
    var t = function (d) { return {type: 'STRING', nullable: true, description: d}; };
    var props = {
      tipo: {type: 'STRING', nullable: true, enum: ['Transformador', 'Celda de MT', 'Cuadro de BT', 'Grupo electrógeno', 'Batería de condensadores', 'SAI', 'Otro'], description: 'Tipo de equipo'},
      fabricante: t('Marca o fabricante'), modelo: t('Modelo o referencia'), numero_serie: t('Número de serie, tal cual'),
      anio: t('Año de fabricación (4 cifras)'), potencia: t('Potencia con su unidad, p. ej. 630 kVA'), tension: t('Tensiones con unidades, p. ej. 20 kV / 420 V'),
      notas: t('Otros datos útiles de la placa (grupo de conexión, Ucc, peso, norma…)')
    };
    var orden = Object.keys(props);
    return {type: 'OBJECT', properties: props, required: orden, propertyOrdering: orden};
  }
  function esquemaPara(prompt, imagenes) {
    if (imagenes.length && /PLACA DE CARACTERÍSTICAS/.test(prompt)) return esquemaPlaca();
    if (imagenes.length) return esquemaLectura();
    if (/"candidatos"/.test(prompt) && /"linea"/.test(prompt)) return esquemaMateriales();
    return null;
  }
  var sample = {
    /* una sola imagen del parte entero: se sube mucho antes desde el móvil y Gemini responde antes */
    limits: function () { return Promise.resolve({images: {maxCount: 1}}); },
    json: function (prompt, opts) {
      opts = opts || {};
      var imgs = opts.images || [];
      return Promise.all(imgs.map(function (b) { return aBase64(b).then(function (s) { return {mime: b.type || 'image/jpeg', b64: s}; }); }))
        .then(function (imagenes) {
          var parar = imagenes.length ? contador() : function () {};
          var esquema = null; try { esquema = esquemaPara(prompt, imagenes); } catch (_) {}
          var extra = imagenes.length && conPosiciones() ? PROMPT_POSICIONES : '';
          return llamar('ia', {prompt: prompt + extra + '\n\nResponde únicamente con JSON válido, sin texto antes ni después.', imagenes: imagenes, esquema: esquema, nivel: opts.modelTier === 'quick' ? 'quick' : 'default'}, opts.signal, CFG.iaMaxMs || 180000)
            .finally(parar);
        })
        .then(function (j) { if (j.modelo) console.log('Gemini: ' + j.modelo + ' en ' + j.segundos + ' s'); return sacarJson(j.texto); });
    }
  };

  /* ---------- Fotos de los partes (se guardan en Google Drive) ---------- */
  var fotos = {};
  var assets = {
    upload: function (blob) {
      return aBase64(blob).then(function (b64) { return llamar('foto', {b64: b64, mime: blob.type || 'image/jpeg'}, null, 120000); }).then(function (j) { return {id: j.id}; });
    }
  };
  function cargarFotos(raiz) {
    (raiz.querySelectorAll ? raiz.querySelectorAll('img[src^="/_blob/"]') : []).forEach(function (img) {
      var id = img.getAttribute('src').slice(7);
      img.removeAttribute('src'); img.dataset.fotoId = id;
      if (!fotos[id]) fotos[id] = llamar('verfoto', {id: id}).then(function (j) { return 'data:' + j.mime + ';base64,' + j.b64; });
      fotos[id].then(function (u) { if (img.dataset.fotoId === id) img.src = u; }, function () { img.alt = 'No se ha podido cargar la foto'; });
    });
  }
  new MutationObserver(function (ms) { ms.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) { if (n.matches && n.matches('img[src^="/_blob/"]')) cargarFotos(n.parentNode || document); else cargarFotos(n); } }); }); })
    .observe(document.documentElement, {childList: true, subtree: true});

  /* ---------- Interfaz que usa la app ---------- */
  /* ---------- Catálogo con precios: no está en la web pública, lo da el servidor tras comprobar el código ---------- */
  var fetchOriginal = window.fetch.bind(window);
  var CAJA = 'pap-catalogo', cargaCatalogo = null;
  function claveCatalogo(fecha) { return new Request(location.origin + '/__catalogo/' + encodeURIComponent(fecha)); }
  function catalogoGuardado() {
    if (!window.caches) return Promise.resolve(null);
    return caches.open(CAJA).then(function (c) {
      return c.keys().then(function (ks) {
        if (!ks.length) return null;
        var fecha = decodeURIComponent(ks[0].url.split('/__catalogo/')[1] || '');
        return c.match(ks[0]).then(function (r) { return r ? r.text().then(function (t) { return {fecha: fecha, texto: t}; }) : null; });
      });
    }).catch(function () { return null; });
  }
  function descargarCatalogo(fecha) {
    return llamar('catalogo', null, null, 120000).then(function (r) {
      if (window.caches && fecha) {
        caches.open(CAJA).then(function (c) {
          return c.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return c.delete(k); })); })
            .then(function () { return c.put(claveCatalogo(fecha), new Response(r.texto, {headers: {'Content-Type': 'text/plain'}})); });
        }).catch(function () {});
      }
      return r.texto;
    });
  }
  /* Devuelve el texto del catálogo: el guardado si sigue al día; si no, lo descarga y lo guarda */
  function textoCatalogo() {
    if (cargaCatalogo) return cargaCatalogo;
    cargaCatalogo = entrar().then(function () {
      /* si hay uno guardado se usa ya, y se comprueba en segundo plano si en Drive hay otro más nuevo */
      return catalogoGuardado().then(function (g) {
        if (!g || g.texto.length < 100000) return null;
        llamar('catalogoInfo', null, null, 30000).then(function (info) {
          if (info.fecha !== g.fecha) descargarCatalogo(info.fecha).catch(function () {});
        }).catch(function () {});
        return g.texto;
      });
    }).then(function (texto) {
      if (texto) return texto;
      return llamar('catalogoInfo', null, null, 30000).then(function (info) {
        if (!window.caches) return descargarCatalogo(null);
        return caches.open(CAJA).then(function (c) { return c.match(claveCatalogo(info.fecha)); }).catch(function () { return null; })
          .then(function (r) { return r ? r.text() : descargarCatalogo(info.fecha); });
      }, function (e) {
        /* sin servidor o servidor antiguo: el guardado, aunque sea de otro día; si no hay, descarga directa */
        return catalogoGuardado().then(function (g) { return g ? g.texto : descargarCatalogo(null); });
      });
    });
    cargaCatalogo.catch(function () { cargaCatalogo = null; });
    return cargaCatalogo;
  }
  function precargarCatalogo() { textoCatalogo().catch(function () {}); }
  window.fetch = function (url, opts) {
    if (typeof url === 'string' && /(^|\/)catalogo\.txt$/.test(url)) {
      return textoCatalogo().then(function (texto) {
        return new Response(texto, {status: 200, headers: {'Content-Type': 'text/plain'}});
      }, function (e) {
        /* se enseña el motivo que da el servidor, para saber qué falta */
        var msg = 'No se pudo cargar el catálogo: ' + (e && e.message || 'error') + '. Puedes añadir el material como texto.';
        setTimeout(function () { document.querySelectorAll('[data-cat]').forEach(function (el) { el.textContent = msg; }); }, 300);
        throw e;
      });
    }
    return fetchOriginal(url, opts);
  };

  window.claude = {
    use: function (nombre) {
      return entrar().then(function (j) {
        if (nombre === 'db') return db;
        if (nombre === 'user') return usuario(j);
        if (nombre === 'sample') return j.ia ? sample : null;
        if (nombre === 'assets') return assets;
        return null;
      });
    }
  };
})();
