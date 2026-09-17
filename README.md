# Stock Comic Stores v3.1

App web (PWA) que, a partir de un EAN, muestra de comicstores.es:

- PVP normal, SKU interno de 6 cifras e imagen de la ficha
- **Stock de los 9 centros**, con semaforo: verde en stock, ambar bajo encargo,
  rojo sin stock

Es independiente de la app de PVP: repositorio propio, Worker propio e icono
propio, para poder tener las dos instaladas en el movil a la vez.

## Instalacion rapida (Windows)

Doble clic en **`instalar.bat`**. Pregunta cuatro datos (usuario de GitHub,
nombre del repo, subdominio de workers.dev y nombre del Worker), ajusta el
codigo, crea el repositorio, activa GitHub Pages y despliega el Worker.

Necesita tener instalados:

| Herramienta | Para que | Instalacion |
|---|---|---|
| Git | subir el codigo | https://git-scm.com/download/win |
| GitHub CLI (`gh`) | crear el repo y activar Pages | `winget install --id GitHub.cli` |
| Node.js | desplegar el Worker con Wrangler | https://nodejs.org (opcional) |

Sin Node.js el instalador funciona igual: solo hay que crear el Worker a mano
(paso 4 de abajo).

## Instalacion manual

### 1. Repositorio de GitHub

1. Crea un repositorio nuevo **publico**, por ejemplo `Buscador_Stock`.
2. Sube estos ficheros a la raiz: `index.html`, `app.js`, `estilos.css`,
   `manifest.json`, `icon-192.png`, `icon-512.png`.
3. En **Settings > Pages**: Source `Deploy from a branch`, Branch `main`,
   carpeta `/ (root)`. Guarda.
4. En 1-2 minutos estara en `https://TU-USUARIO.github.io/Buscador_Stock/`.

### 2. Worker de Cloudflare

1. Panel de Cloudflare > **Workers & Pages** > **Create** > **Create Worker**.
2. Ponle un nombre distinto al de la app de PVP, por ejemplo `buscadorstock`.
   Deploy.
3. **Edit code**: borra todo y pega el contenido de `worker.js`. Deploy.
4. Apunta la URL que te da: `https://buscadorstock.TU-CUENTA.workers.dev`.

### 3. Enlazar la app con el Worker

En `app.js`, primera linea util:

```js
const API_URL = 'https://buscadorstock.carlos-moreno.workers.dev';
```

Cambia esa URL por la de tu Worker y vuelve a subir `app.js`.

### 4. Instalar en el movil

Abre la web en Chrome y elige **Anadir a pantalla de inicio**. El icono
turquesa con la banda STOCK la distingue de la app de PVP.

## Comprobacion

```
https://TU-WORKER.TU-CUENTA.workers.dev/?ean=8437012332577&nocache=1
```

Debe devolver un JSON con 9 entradas en `centros`. Si viene vacio, Comic Stores
ha cambiado la maquetacion del bloque y hay que ajustar `extraerCentros()` en
`worker.js`.

## Novedades de la v3.1

- **Arreglado el stock en las fichas de libro.** La ficha nombra "Stock en
  tiendas" dos veces: el boton que abre la ventana y el encabezado de la
  ventana en si, separados por unos 90.000 caracteres. El parser se quedaba
  con la primera y acababa leyendo el listado de tiendas y el formulario de
  comentarios en vez de los centros. Ahora prueba todas las apariciones y se
  queda con la que devuelve un listado creible.
- **El parser ya no depende de la maquetacion.** Empareja el nombre del centro
  con su disponibilidad mirando los textos sueltos que hay entre etiquetas, asi
  que da igual que la web use `<ul>`, `<table>` o `<div>`.
- **Se muestra el texto literal de Comic Stores.** Antes se reescribia como
  "Bajo encargo" o "Consultar"; ahora pone exactamente lo que dice la ficha y
  el color es lo unico que interpreta.
- **Descartadas las resenas de Google** que la ficha trae debajo: fechas como
  "hace 2 semanas" se colaban como si fueran disponibilidad.

## Que cambia respecto a la v2.5 de PVP

- **Stock en tiendas** sin peticiones extra: ese bloque ya viene dentro del HTML
  de la ficha que el Worker descargaba, solo habia que leerlo.
- **Boton Actualizar**, que consulta saltandose la cache (`&nocache=1`).
- **Cache de 3 minutos** en el Worker: repetir el mismo articulo es instantaneo.
- **Busqueda de ficha mas fiable**: prueba hasta 5 fichas hasta dar con el EAN,
  en vez de fallar si el primer resultado no coincidia.

## Ficheros

| Fichero | Donde va |
|---|---|
| `index.html`, `app.js`, `estilos.css`, `manifest.json`, `icon-*.png` | GitHub Pages |
| `worker.js` | Cloudflare Workers |
| `wrangler.toml` | configuracion del despliegue con Wrangler |
| `instalar.bat`, `_configurar.ps1` | instalador para Windows |
