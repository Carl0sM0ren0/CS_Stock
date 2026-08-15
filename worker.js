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

  const texto = htmlATexto(productHtml);
  const titulo = limpiarTexto(extraerTitulo(productHtml)) || 'Producto encontrado';
  const precios = [...texto.matchAll(/(\d{1,4}(?:\.\d{3})*,\d{2})\s*€/g)]
    .map(m => Number(m[1].replace(/\./g, '').replace(',', '.')))
    .filter(n => Number.isFinite(n) && n > 0 && n < 100000);

  if (!precios.length) return { error: 'Producto encontrado, pero no se pudo leer el precio', status: 422 };

  const pvp = Math.max(...new Set(precios));
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
/* Stock en tiendas                                                     */
/* ------------------------------------------------------------------ */

// Centros conocidos de Comic Stores. Solo se usan como respaldo si el bloque
// de la ficha no viene con la estructura de lista habitual.
const CENTROS_CONOCIDOS = [
  'Almacen', 'Almacén',
  'CS Fuengirola', 'CS Granada',
  'CS Malaga Soho', 'CS Málaga Soho',
  'CS Malaga Tilos', 'CS Málaga Tilos',
  'CS Murcia',
  'Freak Point Almeria', 'Freak Point Almería',
  'Freak Point Huelva',
  'Freak Point Malaga', 'Freak Point Málaga'
];

function extraerCentros(html) {
  const contenido = String(html || '');
  const encabezado = contenido.search(/stock\s+en\s+tienda/i);
  if (encabezado === -1) return [];

  const bloque = contenido.slice(encabezado, encabezado + 30000);
  const centros = extraerCentrosDeLista(bloque);
  return centros.length ? centros : extraerCentrosPorNombre(bloque);
}

function extraerCentrosDeLista(bloque) {
  // Tras el encabezado puede haber varias listas (migas, menus, relacionados).
  // Se leen todas y se elige la que mas filas de disponibilidad reconocibles tenga.
  const listas = bloque.match(/<(ul|ol|table)\b[^>]*>[\s\S]*?<\/\1>/gi) || [];
  let mejor = [];

  for (const lista of listas) {
    const centros = leerFilas(lista);
    const reconocidos = centros.filter(c => c.estado !== 'otro').length;
    const mejorReconocidos = mejor.filter(c => c.estado !== 'otro').length;
    if (reconocidos > mejorReconocidos) mejor = centros;
  }

  return mejor.filter(c => c.estado !== 'otro').length >= 2 ? mejor : [];
}

function leerFilas(lista) {
  const filas = lista.match(/<(li|tr)\b[^>]*>[\s\S]*?<\/\1>/gi) || [];
  const centros = [];

  for (const fila of filas) {
    const partes = trocearFila(fila);
    if (partes.length < 2) continue;

    const nombre = partes[0];
    const disponibilidad = partes.slice(1).join(' ');
    // Las filas reales son cortas; asi se descartan menus y bloques ajenos.
    if (nombre.length > 60 || disponibilidad.length > 120) continue;

    centros.push(construirCentro(nombre, disponibilidad));
    if (centros.length >= 20) break;
  }
  return centros;
}

function extraerCentrosPorNombre(bloque) {
  const texto = htmlATexto(bloque);
  const nombres = [...new Set(CENTROS_CONOCIDOS)]
    .map(nombre => ({ nombre, indice: texto.indexOf(nombre) }))
    .filter(item => item.indice !== -1)
    .sort((a, b) => a.indice - b.indice);

  const centros = [];
  for (let i = 0; i < nombres.length; i++) {
    const actual = nombres[i];
    const fin = i + 1 < nombres.length
      ? nombres[i + 1].indice
      : Math.min(texto.length, actual.indice + 160);
    const disponibilidad = limpiarTexto(texto.slice(actual.indice + actual.nombre.length, fin));
    if (!disponibilidad) continue;
    centros.push(construirCentro(actual.nombre, disponibilidad));
  }
  return centros;
}

function trocearFila(fila) {
  return String(fila)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .split(/<[^>]+>/)
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
  if (/en stock|disponible en tienda|ultimas unidades|hay stock/.test(t)) return 'stock';
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
