# Parte a Pedido

App para que los técnicos rellenen los partes de actuación y la oficina prepare el pedido de venta de Sage 200.

## Carpetas

- `web/`: la app que se publica en Netlify. No lleva datos de la empresa (ni precios, ni clientes, ni partes).
  - `web/config.js`: la URL del servidor (Apps Script). Es lo único que hay que editar.
- `servidor/Codigo.gs`: el servidor en Google Apps Script. Guarda los datos en la Hoja «Parte a Pedido - datos», las fotos en Drive y llama a Gemini.
  Aquí está **sin** la clave de Gemini ni los códigos de empresa: se guardan una vez en el proyecto de Apps Script con `guardarClaves`.
- `netlify.toml`: le dice a Netlify que publique la carpeta `web`.

## Cómo se actualiza

- Cambios en `web/`: al guardarlos en GitHub, Netlify publica la web sola en uno o dos minutos.
- Cambios en `servidor/`: el propio servidor los copia de GitHub cada 15 minutos (función `actualizarDesdeGitHub`)
  y actualiza la implementación web sin cambiar la URL. Se activa una vez con `activarActualizacionAutomatica`.
- El catálogo de Sage con precios (`parte-a-pedido-catalogo.txt`) no está aquí: va en Google Drive.
