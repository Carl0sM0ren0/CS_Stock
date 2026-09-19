export default {
  async fetch(request, env, ctx) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Accept, Content-Type',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8'
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json({ error: 'Metodo no permitido' }, 405, cors);

    const parametros = new URL(request.url).searchParams;
    const ean = parametros.get('ean')?.replace(/\D/g, '');
    const sinCache = parametros.get('nocache') === '1';

    if (!ean || !/^(\d{8}|\d{12}|\d{13})$/.test(ean)) {
      return json({ error: 'Anade un EAN valido: ?ean=8437012332577' }, 400, cors);
    }

    // El stock cambia a lo largo del dia, asi que la cache es deliberadamente corta.
    const claveCache = new Request(`https://cache.buscadorpvp/${ean}`, { method: 'GET' });
    if (!sinCache) {
      try {
        const guardado = await caches.default.match(claveCache);
        if (guardado) {
          const datos = await guardado.json();
          return json({ ...datos, cache: true }, 200, cors);
        }
      } catch (_) {}
    }

    try {
      const resultado = await consultarComicStores(ean);
      if (resultado.error) return json({ error: resultado.error }, resultado.status || 502, cors);

      const respuesta = json(resultado.datos, 200, cors);
      const copia = new Response(JSON.stringify(resultado.datos), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'max-age=180' }
      });
      if (ctx && ctx.waitUntil) ctx.waitUntil(caches.default.put(claveCache, copia));
      return respuesta;
    } catch (error) {
      return json({ error: `Error consultando Comic Stores: ${limpiarTexto(error.message || error)}` }, 502, cors);
    }
  }
};

async function consultarComicStores(ean) {
  const candidatos = [
    `https://comicstores.es/busqueda/listaLibros.php?tipoBus=full&palabrasBusqueda=${encodeURIComponent(ean)}`,
    `https://comicstores.es/busqueda/listaLibros.php?palabrasBusqueda=${encodeURIComponent(ean)}`
  ];

  let searchHtml = '';
  let searchFinalUrl = '';
  let enlaces = [];

  for (const url of candidatos) {
    const respuesta = await pedirHtml(url);
    const html = await leerHtmlConCodificacion(respuesta);
    const encontrados = extraerEnlacesProducto(html);
    if (encontrados.length || html.includes(ean)) {
      searchHtml = html;
      searchFinalUrl = respuesta.url;
      enlaces = encontrados;
      break;
    }
  }

  if (!searchHtml) return { error: 'Comic Stores no devolvio resultados para ese EAN', status: 404 };

  // Se prueban varias fichas: la busqueda puede colocar primero un articulo relacionado.
  let productHtml = '';
  let productUrl = '';

  for (const enlace of enlaces.slice(0, 5)) {
    const respuesta = await pedirHtml(enlace);
    const html = await leerHtmlConCodificacion(respuesta);
    if (htmlATexto(html).includes(ean)) {
      productHtml = html;
      productUrl = respuesta.url || enlace;
      break;
    }
  }

  if (!productHtml) {
    // Sin ficha propia: puede que la pagina de busqueda ya muestre el producto.
    if (!htmlATexto(searchHtml).includes(ean)) {
      return { error: 'La ficha encontrada no coincide con el EAN solicitado', status: 404 };
    }
    productHtml = searchHtml;
    productUrl = searchFinalUrl;
  }

  const titulo = limpiarTexto(extraerTitulo(productHtml)) || 'Producto encontrado';
  const pvp = extraerPvp(productHtml);

  if (pvp === null) return { error: 'Producto encontrado, pero no se pudo leer el precio', status: 422 };

  const imagen = extraerImagen(productHtml, productUrl);
  const sku = extraerSku(productUrl);
  const centros = extraerCentros(productHtml);

  return {
    datos: {
      ean,
      sku,
      titulo,
      pvp,
      imagen,
      url: productUrl,
      centros,
      consultado: new Date().toISOString()
    }
  };
}


/* ------------------------------------------------------------------ */
/* Precio                                                               */
/* ------------------------------------------------------------------ */

// El PVP se lee SOLO del bloque de compra del producto: desde el <h1> del
// titulo hasta "IVA incluido" / "Anadir a mi cesta". Antes se cogia el importe
// mas alto de toda la pagina, y en fichas baratas ganaba el precio de algun
// producto relacionado (p. ej. un libro de 1,99 EUR salia a 73,00 EUR por un
// "Sherlock Holmes Anotado" de la seccion de recomendados).
function extraerPvp(html) {
  const contenido = String(html || '');
  const inicio = Math.max(0, contenido.search(/<h1\b/i));
  const resto = contenido.slice(inicio);

  const fin = resto.search(/IVA\s+incluido|A(?:ñ|&ntilde;|n)adir\s+a\s+mi\s+cesta/i);
  const bloque = fin === -1 ? resto.slice(0, 15000) : resto.slice(0, fin);

  // En el bloque de compra hay, como mucho, el PVP y el precio web con
  // descuento. El PVP normal es el mayor de los dos.
  const enBloque = leerImportes(htmlATexto(bloque));
  if (enBloque.length) return Math.max(...enBloque);

  // Respaldo: primeros importes tras el titulo (PVP y precio web van juntos).
  const primeros = leerImportes(htmlATexto(resto)).slice(0, 2);
  return primeros.length ? Math.max(...primeros) : null;
}

function leerImportes(texto) {
  return [...String(texto).matchAll(/(\d{1,4}(?:\.\d{3})*,\d{2})\s*€/g)]
    .map(m => Number(m[1].replace(/\./g, '').replace(',', '.')))
    .filter(n => Number.isFinite(n) && n > 0 && n < 100000);
}
/* ------------------------------------------------------------------ */
/* Stock en tiendas                                                     */
/* ------------------------------------------------------------------ */

// Centros conocidos, en minusculas y sin tildes. NO se usan para localizar las
// filas (asi la app sigue funcionando si abren un centro nuevo), solo para
// puntuar cual de los bloques de la ficha es de verdad el de stock.
const CENTROS_CONOCIDOS = [
  'almacen', 'cs fuengirola', 'cs granada', 'cs malaga soho', 'cs malaga tilos',
  'cs murcia', 'freak point almeria', 'freak point huelva', 'freak point malaga'
];

// Frases con las que Comic Stores expresa la disponibilidad de un centro.
// Ojo: nada de "semana" o "dias" sueltos. La ficha lleva resenas de Google con
// fechas tipo "hace 2 semanas" justo debajo, y se colaban como si fueran filas
// de disponibilidad. Las frases reales ya caen por "disponible" o "reserv".
const PATRON_DISPONIBILIDAD = /(en stock|sin stock|no disponible|agotado|descatalogado|ultim[oa]s? unidad|disponible|reserv|encargo|bajo pedido|consult|en \d+ (dia|semana))/;

function extraerCentros(html) {
  const contenido = String(html || '');

  // La ficha nombra "Stock en tiendas" mas de una vez: el boton que abre la
  // ventana y el encabezado de la ventana en si, separados por decenas de
  // miles de caracteres. Se prueban todas las apariciones y se elige la que
  // devuelve el listado mas creible.
  let mejor = [];
  let mejorPuntos = 0;

  for (const encaje of contenido.matchAll(/stock\s+en\s+tienda/gi)) {
    const centros = leerBloqueDeCentros(contenido.slice(encaje.index, encaje.index + 20000));
    const puntos = puntuarCentros(centros);
    if (puntos > mejorPuntos) {
      mejor = centros;
      mejorPuntos = puntos;
    }
  }

  return mejor;
}

// Se trabaja sobre los textos sueltos que hay entre etiquetas, sin depender de
// que el bloque sea <ul>, <table> o <div>: basta con que el nombre del centro y
// su disponibilidad esten en elementos distintos, que es como lo maqueta la web.
function leerBloqueDeCentros(bloque) {
  const segmentos = trocearEnTextos(bloque);
  const centros = [];
  let i = 0;
  let fallos = 0;

  while (i < segmentos.length && centros.length < 25) {
    const actual = segmentos[i];
    const siguiente = segmentos[i + 1];

    // Caso "CS Granada: En stock", todo dentro del mismo elemento. Se mira
    // primero para que el encabezado no se empareje con la fila que le sigue.
    const partido = partirSegmento(actual);
    if (partido) {
      centros.push(partido);
      i += 1;
      fallos = 0;
      continue;
    }

    // Caso normal: "CS Granada" y "En stock" en dos elementos seguidos.
    if (siguiente !== undefined && pareceCentro(actual) && pareceDisponibilidad(siguiente)) {
      centros.push(construirCentro(actual, siguiente));
      i += 2;
      fallos = 0;
      continue;
    }

    i += 1;
    // El listado es contiguo: si ya empezo y se corta, se deja de mirar.
    if (centros.length) {
      fallos += 1;
      if (fallos > 12) break;
    }
  }

  return centros;
}

function puntuarCentros(centros) {
  // Un listado de verdad trae los centros de la cadena; menos de tres filas
  // casi siempre es ruido de otro bloque de la pagina.
  if (centros.length < 3) return 0;
  const conocidos = centros.filter(centro => esCentroConocido(centro.centro)).length;
  return centros.length + conocidos * 10;
}

function esCentroConocido(nombre) {
  return CENTROS_CONOCIDOS.includes(quitarTildes(nombre).toLowerCase());
}

function pareceCentro(texto) {
  const t = quitarTildes(texto).toLowerCase();
  return texto.length >= 3
    && texto.length <= 50
    && /[a-z]/.test(t)
    && !/^\d+$/.test(t)
    && !/[:;!?]/.test(texto)
    && !/stock\s+en\s+tienda/.test(t)
    && !PATRON_DISPONIBILIDAD.test(t);
}

function pareceDisponibilidad(texto) {
  const t = quitarTildes(texto).toLowerCase();
  return texto.length >= 2
    && texto.length <= 90
    && !/^hace\s/.test(t)
    && PATRON_DISPONIBILIDAD.test(t);
}

function partirSegmento(texto) {
  const encaje = String(texto).match(/^(.{2,50}?)\s*[:\u2013\u2014-]\s*(.{2,90})$/);
  if (!encaje) return null;
  if (!pareceCentro(encaje[1]) || !pareceDisponibilidad(encaje[2])) return null;
  return construirCentro(encaje[1], encaje[2]);
}

function trocearEnTextos(bloque) {
  return String(bloque)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .split(/<[^>]*>/)
    .map(parte => limpiarTexto(decodificarEntidades(parte)))
    .filter(Boolean);
}

function construirCentro(nombre, disponibilidad) {
  return {
    centro: limpiarTexto(nombre),
    disponibilidad: limpiarTexto(disponibilidad),
    estado: clasificarEstado(disponibilidad)
  };
}

function clasificarEstado(texto) {
  const t = quitarTildes(String(texto)).toLowerCase();
  if (/sin stock|no disponible|agotado|descatalogado|no hay/.test(t)) return 'sin';
  if (/en stock|disponible en tienda|ultim[oa]s? unidad|hay stock/.test(t)) return 'stock';
  if (/reserv|encargo|bajo pedido|semana|dia|plazo/.test(t)) return 'encargo';
  return 'otro';
}

function quitarTildes(texto) {
  return String(texto).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/* ------------------------------------------------------------------ */
/* Utilidades de scraping                                               */
/* ------------------------------------------------------------------ */

async function pedirHtml(url) {
  const respuesta = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; PVPComicStores/3.0)',
      'Accept': 'text/html,application/xhtml+xml'
    },
    redirect: 'follow'
  });
  if (!respuesta.ok) throw new Error(`Comic Stores respondio HTTP ${respuesta.status}`);
  return respuesta;
}

async function leerHtmlConCodificacion(respuesta) {
  const buffer = await respuesta.arrayBuffer();
  const contentType = respuesta.headers.get('content-type') || '';
  let charset = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1]?.toLowerCase();

  if (!charset) {
    const muestra = new TextDecoder('windows-1252').decode(buffer.slice(0, 4096));
    charset = muestra.match(/<meta[^>]+charset=["']?([^"'\s/>]+)/i)?.[1]?.toLowerCase()
      || muestra.match(/content=["'][^"']*charset=([^"';\s]+)/i)?.[1]?.toLowerCase()
      || 'utf-8';
  }

  const equivalencias = {
    'iso-8859-1': 'windows-1252',
    'latin1': 'windows-1252',
    'latin-1': 'windows-1252',
    'utf8': 'utf-8'
  };

  try {
    return new TextDecoder(equivalencias[charset] || charset || 'utf-8').decode(buffer);
  } catch (_) {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

function extraerEnlacesProducto(html) {
  // Comic Stores usa varias rutas para sus fichas. Los libros, comics y manga
  // suelen estar bajo /libro/, mientras que otros articulos usan /producto/.
  const encontrados = [...String(html).matchAll(
    /href=["'](?:https?:\/\/comicstores\.es)?(\/(?:libro|producto)\/[^"'#?]+)["']/gi
  )].map(m => `https://comicstores.es${m[1].replace(/&amp;/g, '&')}`);

  return [...new Set(encontrados)];
}

function extraerSku(productUrl) {
  try {
    const pathname = new URL(productUrl).pathname.replace(/\/$/, '');
    // Las fichas terminan en un identificador interno de 6 cifras, por ejemplo:
    // /producto/star-wars-the-deckbuilding-game_556670
    return pathname.match(/(?:_|-)(\d{6})$/)?.[1] || '';
  } catch (_) {
    return '';
  }
}

function extraerTitulo(html) {
  const h1 = String(html).match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return htmlATexto(h1 || title || '').replace(/\s*[-|].*Comic Stores.*$/i, '').trim();
}

function extraerImagen(html, paginaUrl) {
  const contenido = String(html || '');
  const candidatos = [];

  // Metadatos sociales: suelen contener la imagen principal de la ficha.
  for (const etiqueta of contenido.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = extraerAtributos(etiqueta);
    const clave = String(attrs.property || attrs.name || '').toLowerCase();
    if (['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'].includes(clave)) {
      candidatos.push(attrs.content);
    }
  }

  // Datos estructurados de producto.
  for (const bloque of contenido.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || []) {
    const jsonTexto = bloque.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    try {
      recogerImagenesJsonLd(JSON.parse(decodificarEntidades(jsonTexto)), candidatos);
    } catch (_) {}
  }

  // Respaldo para tiendas que cargan la imagen con data-src, data-lazy-src o src.
  for (const etiqueta of contenido.match(/<img\b[^>]*>/gi) || []) {
    const attrs = extraerAtributos(etiqueta);
    const contexto = `${attrs.id || ''} ${attrs.class || ''} ${attrs.alt || ''}`.toLowerCase();
    const url = attrs['data-zoom-image'] || attrs['data-large-image'] || attrs['data-src'] || attrs['data-lazy-src'] || attrs.src;
    if (/product|producto|principal|cover|portada|ficha|zoom|image/.test(contexto)) candidatos.push(url);
  }

  for (const candidato of candidatos) {
    const url = normalizarUrlImagen(candidato, paginaUrl);
    if (url && !/logo|icon|sprite|banner|placeholder|loading|pixel|avatar/i.test(url)) return url;
  }
  return '';
}

function extraerAtributos(etiqueta) {
  const attrs = {};
  const regex = /([:\w-]+)\s*=\s*(?:["']([^"']*)["']|([^\s>]+))/g;
  let m;
  while ((m = regex.exec(etiqueta))) attrs[m[1].toLowerCase()] = decodificarEntidades(m[2] ?? m[3] ?? '');
  return attrs;
}

function recogerImagenesJsonLd(valor, salida) {
  if (!valor) return;
  if (Array.isArray(valor)) {
    valor.forEach(item => recogerImagenesJsonLd(item, salida));
    return;
  }
  if (typeof valor !== 'object') return;

  const tipo = valor['@type'];
  const esProducto = Array.isArray(tipo)
    ? tipo.some(t => String(t).toLowerCase() === 'product')
    : String(tipo || '').toLowerCase() === 'product';

  if (esProducto && valor.image) {
    if (Array.isArray(valor.image)) salida.push(...valor.image);
    else if (typeof valor.image === 'object') salida.push(valor.image.url || valor.image.contentUrl);
    else salida.push(valor.image);
  }

  Object.values(valor).forEach(item => recogerImagenesJsonLd(item, salida));
}

function normalizarUrlImagen(valor, paginaUrl) {
  const limpio = decodificarEntidades(String(valor || '').trim());
  if (!limpio || limpio.startsWith('data:')) return '';
  try {
    const url = new URL(limpio, paginaUrl || 'https://comicstores.es/');
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.href;
  } catch (_) {
    return '';
  }
}

function htmlATexto(html) {
  return limpiarTexto(
    decodificarEntidades(
      String(html)
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
    )
  );
}

function decodificarEntidades(texto) {
  const entidades = {
    nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', euro: '€',
    aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
    Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
    ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü',
    iexcl: '¡', iquest: '¿'
  };

  return String(texto)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, numero) => String.fromCodePoint(parseInt(numero, 10)))
    .replace(/&([a-zA-Z]+);/g, (original, nombre) => entidades[nombre] ?? original);
}

function limpiarTexto(valor) {
  return String(valor ?? '')
    .normalize('NFC')
    .replace(/\uFFFD/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers });
}
