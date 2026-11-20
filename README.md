# Parte a Pedido

App para que los técnicos rellenen los partes de actuación y la oficina prepare el pedido de venta de Sage 200.

## Carpetas

- `web/`: la app que se publica en Netlify. No lleva datos de la empresa (ni precios, ni clientes, ni partes).
  - `web/config.js`: la URL del servidor (Apps Script). Es lo único que hay que editar.
- `servidor/Cargador.gs`: lo único que está pegado en Apps Script. Lee `servidor/Codigo.gs` de GitHub (caché de 5 minutos, con copia de seguridad).
- `servidor/Codigo.gs`: el servidor en Google Apps Script. Guarda los datos en la Hoja «Parte a Pedido - datos», las fotos en Drive y llama a Gemini.
  Aquí está **sin** la clave de Gemini ni los códigos de empresa: están guardados en las propiedades del proyecto de Apps Script (⚙ Configuración del proyecto → Propiedades de la secuencia de comandos).
- `netlify.toml`: le dice a Netlify que publique la carpeta `web`.

## Cómo se actualiza

- Cambios en `web/`: al guardarlos en GitHub, Netlify publica la web sola en uno o dos minutos.
- Cambios en `servidor/Codigo.gs`: el cargador los usa solo en unos 5 minutos. No hay que pegar nada ni hacer «Nueva versión».
- Solo si cambian `Cargador.gs` o `appsscript.json` (casi nunca) hay que pegarlos a mano y hacer una nueva versión.
- El catálogo de Sage con precios (`parte-a-pedido-catalogo.txt`) no está aquí: va en Google Drive.
