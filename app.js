'use strict';

// La URL la ajusta instalar.bat si eliges otro nombre de Worker.
const API_URL = 'https://buscadorstock.carlos-moreno.workers.dev';

const zonaEscaner = document.getElementById('zona-escaner');
const resultado = document.getElementById('resultado');
const codigoLeido = document.getElementById('codigo-leido');
const infoProducto = document.getElementById('info-producto');
const enlaceDirecto = document.getElementById('enlace-directo');
const lectorDiv = document.getElementById('lector');
const video = document.getElementById('video');
const estadoCamara = document.getElementById('estado-camara');

let controlesVideo = null;
let procesandoLectura = false;
let ultimoCodigo = '';

const lectorZXing = new ZXingBrowser.BrowserMultiFormatReader(undefined, {
  delayBetweenScanAttempts: 120,
  delayBetweenScanSuccess: 700
});

document.getElementById('btn-escanear').addEventListener('click', iniciarEscaner);
document.getElementById('btn-parar').addEventListener('click', detenerEscaner);
document.getElementById('btn-nuevo').addEventListener('click', reiniciar);
document.getElementById('btn-manual').addEventListener('click', buscarManual);
document.getElementById('input-foto').addEventListener('change', escanearDesdeFoto);
document.getElementById('input-manual').addEventListener('keydown', e => {
  if (e.key === 'Enter') buscarManual();
});

function normalizarCodigo(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function esCodigoValido(codigo) {
  return /^(\d{8}|\d{12}|\d{13})$/.test(codigo);
}

function limpiarTexto(valor) {
  return String(valor ?? '')
    .normalize('NFC')
    .replace(/\uFFFD/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function mostrarCargando(texto) {
  infoProducto.innerHTML = `<div class="cargando"><div class="spinner"></div><p>${escapar(texto)}</p></div>`;
}

function buscarManual() {
  const codigo = normalizarCodigo(document.getElementById('input-manual').value);
  if (!esCodigoValido(codigo)) {
    alert('Introduce un EAN de 8 o 13 digitos, o un UPC de 12 digitos.');
    return;
  }
  procesarCodigo(codigo);
}

async function iniciarEscaner() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    alert('La camara necesita una conexion HTTPS y permiso del navegador.');
    return;
  }

  procesandoLectura = false;
  lectorDiv.style.display = 'block';
  document.getElementById('btn-escanear').style.display = 'none';
  document.getElementById('btn-parar').style.display = 'block';
  estadoCamara.textContent = 'Solicitando permiso para usar la camara...';

  try {
    controlesVideo = await abrirCamaraTrasera();
    estadoCamara.textContent = 'Coloca las barras en horizontal, ocupa casi todo el ancho y manten el movil quieto.';
  } catch (error) {
    console.error(error);
    detenerEscaner();
    alert(`No se pudo abrir la camara: ${limpiarTexto(error.message || error)}`);
  }
}

async function abrirCamaraTrasera() {
  const callback = (result, error) => {
    if (result && !procesandoLectura) {
      const codigo = normalizarCodigo(result.getText());
      if (!esCodigoValido(codigo)) return;
      procesandoLectura = true;
      if (navigator.vibrate) navigator.vibrate(80);
      detenerEscaner();
      procesarCodigo(codigo);
    } else if (error && error.name !== 'NotFoundException') {
      console.warn('Error de lectura:', error);
    }
  };

  const configuraciones = [
    {
      audio: false,
      video: {
        facingMode: { exact: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    },
    {
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    },
    { audio: false, video: true }
  ];

  let ultimoError;
  for (const constraints of configuraciones) {
    try {
      return await lectorZXing.decodeFromConstraints(constraints, video, callback);
    } catch (error) {
      ultimoError = error;
    }
  }
  throw ultimoError || new Error('No hay ninguna camara disponible');
}

function detenerEscaner() {
  try { controlesVideo?.stop(); } catch (_) {}
  controlesVideo = null;
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(track => track.stop());
    video.srcObject = null;
  }
  lectorDiv.style.display = 'none';
  document.getElementById('btn-escanear').style.display = 'block';
  document.getElementById('btn-parar').style.display = 'none';
}

async function escanearDesdeFoto(evento) {
  const archivo = evento.target.files?.[0];
  evento.target.value = '';
  if (!archivo) return;

  zonaEscaner.classList.add('oculto');
  resultado.classList.remove('oculto');
  codigoLeido.textContent = 'Analizando...';
  mostrarCargando('Preparando y analizando la fotografia...');

  try {
    const imagen = await cargarImagen(archivo);
    const codigo = await leerImagenConVariantes(imagen);
    if (!esCodigoValido(codigo)) throw new Error('No se detecto un EAN valido');
    await procesarCodigo(codigo);
  } catch (error) {
    console.error(error);
    codigoLeido.textContent = 'No detectado';
    infoProducto.innerHTML = '<p>No se ha podido reconocer el codigo.</p><p style="margin-top:10px;font-size:.95rem">Procura que las barras esten horizontales, bien iluminadas, sin reflejos y ocupando casi todo el ancho de la foto.</p>';
  }
}

async function cargarImagen(archivo) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(archivo, { imageOrientation: 'from-image' });
    } catch (_) {}
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(archivo);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo abrir la imagen')); };
    img.src = url;
  });
}

async function leerImagenConVariantes(img) {
  const variantes = [
    { giro: 0, contraste: false, recorte: false },
    { giro: 0, contraste: true, recorte: false },
    { giro: 0, contraste: false, recorte: true },
    { giro: 0, contraste: true, recorte: true },
    { giro: 90, contraste: false, recorte: false },
    { giro: -90, contraste: false, recorte: false },
    { giro: 180, contraste: false, recorte: false }
  ];

  let ultimoError;
  for (const variante of variantes) {
    const canvas = prepararCanvas(img, variante.giro, variante.contraste, variante.recorte);
    try {
      const lectura = await lectorZXing.decodeFromCanvas(canvas);
      const codigo = normalizarCodigo(lectura.getText());
      if (esCodigoValido(codigo)) return codigo;
    } catch (error) {
      ultimoError = error;
    }
  }
  throw ultimoError || new Error('Codigo no encontrado');
}

function prepararCanvas(img, giro, altoContraste, recorteCentral) {
  const origenW = img.naturalWidth || img.width;
  const origenH = img.naturalHeight || img.height;
  const maxLado = 2400;
  const escala = Math.min(1, maxLado / Math.max(origenW, origenH));
  const w = Math.max(1, Math.round(origenW * escala));
  const h = Math.max(1, Math.round(origenH * escala));
  const intercambiar = Math.abs(giro) === 90;

  const canvasBase = document.createElement('canvas');
  canvasBase.width = intercambiar ? h : w;
  canvasBase.height = intercambiar ? w : h;
  const ctx = canvasBase.getContext('2d', { willReadFrequently: true });
  ctx.translate(canvasBase.width / 2, canvasBase.height / 2);
  ctx.rotate(giro * Math.PI / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (altoContraste) {
    const datos = ctx.getImageData(0, 0, canvasBase.width, canvasBase.height);
    const p = datos.data;
    for (let i = 0; i < p.length; i += 4) {
      const gris = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
      const valor = gris < 155 ? 0 : 255;
      p[i] = p[i + 1] = p[i + 2] = valor;
    }
    ctx.putImageData(datos, 0, 0);
  }

  if (!recorteCentral) return canvasBase;

  const recorte = document.createElement('canvas');
  const margenX = Math.round(canvasBase.width * 0.05);
  const margenY = Math.round(canvasBase.height * 0.22);
  recorte.width = Math.max(1, canvasBase.width - margenX * 2);
  recorte.height = Math.max(1, canvasBase.height - margenY * 2);
  recorte.getContext('2d', { willReadFrequently: true }).drawImage(
    canvasBase,
    margenX,
    margenY,
    recorte.width,
    recorte.height,
    0,
    0,
    recorte.width,
    recorte.height
  );
  return recorte;
}

async function procesarCodigo(codigo, forzar = false) {
  detenerEscaner();
  codigo = normalizarCodigo(codigo);
  ultimoCodigo = codigo;
  codigoLeido.textContent = codigo;
  zonaEscaner.classList.add('oculto');
  resultado.classList.remove('oculto');
  mostrarCargando(forzar
    ? 'Actualizando el stock en comicstores.es...'
    : 'Buscando el PVP, el SKU y el stock en comicstores.es...');

  enlaceDirecto.href = `https://comicstores.es/busqueda/listaLibros.php?tipoBus=full&palabrasBusqueda=${encodeURIComponent(codigo)}`;
  enlaceDirecto.style.display = 'block';

  try {
    const endpoint = `${API_URL.replace(/\/$/, '')}/?ean=${encodeURIComponent(codigo)}${forzar ? '&nocache=1' : ''}`;
    const respuesta = await fetch(endpoint, { method: 'GET', mode: 'cors', cache: 'no-store' });
    const texto = await respuesta.text();
    let datos;
    try { datos = JSON.parse(texto); }
    catch (_) { throw new Error(`El Worker no devolvio JSON (HTTP ${respuesta.status})`); }
    if (!respuesta.ok) throw new Error(datos.error || `Error HTTP ${respuesta.status}`);

    enlaceDirecto.href = datos.url || enlaceDirecto.href;
    const titulo = limpiarTexto(datos.titulo) || 'Producto encontrado';
    const imagen = urlSegura(datos.imagen);
    const sku = normalizarSku(datos.sku, datos.url);
    const bloqueImagen = imagen
      ? `<figure class="producto-imagen-wrap">
           <img class="producto-imagen" src="${escapar(imagen)}" alt="${escapar(titulo)}" loading="eager" referrerpolicy="no-referrer"
                onerror="this.closest('figure').style.display='none'">
           <figcaption>Imagen de la ficha del producto</figcaption>
         </figure>`
      : '<p class="sin-imagen">La ficha no tiene una imagen disponible.</p>';

    infoProducto.innerHTML = `
      ${bloqueImagen}
      <p class="titulo-prod">${escapar(titulo)}</p>
      <p class="sku"><strong>SKU:</strong> ${escapar(sku || 'No disponible')}</p>
      <p class="pvp">${formatearPrecio(datos.pvp)}</p>
      ${bloqueCentros(datos.centros, datos.cache)}
    `;

    document.getElementById('btn-refrescar')
      ?.addEventListener('click', () => procesarCodigo(ultimoCodigo, true));
  } catch (error) {
    console.error(error);
    const mensaje = limpiarTexto(error.message || String(error));
    infoProducto.innerHTML = `<p>No se pudo obtener el PVP automaticamente.</p><p style="margin-top:10px;font-size:.9rem">${escapar(mensaje)}</p><p style="margin-top:10px;font-size:.85rem;opacity:.75">Comprueba el Worker abriendolo con <code>?ean=${codigo}</code>.</p>`;
  }
}

function normalizarSku(valor, productUrl) {
  const skuDevuelto = String(valor || '').replace(/\D/g, '');
  if (/^\d{6}$/.test(skuDevuelto)) return skuDevuelto;

  try {
    const pathname = new URL(String(productUrl || '')).pathname.replace(/\/$/, '');
    return pathname.match(/(?:_|-)(\d{6})$/)?.[1] || '';
  } catch (_) {
    return '';
  }
}

function urlSegura(valor) {
  try {
    const url = new URL(String(valor || ''), 'https://comicstores.es/');
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.href;
  } catch (_) {
    return '';
  }
}

function formatearPrecio(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return 'Precio no disponible';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(numero);
}

function escapar(texto) {
  return String(texto ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

/* ------------------------------------------------------------------ */
/* Stock en tiendas                                                     */
/* ------------------------------------------------------------------ */

// No se reescribe el texto de Comic Stores: se muestra tal cual lo dice la
// ficha. El estado solo decide el color, para poder leer la lista de un vistazo.

function bloqueCentros(centros, desdeCache) {
  const boton = `<button id="btn-refrescar" class="btn-refrescar" type="button">Actualizar</button>`;

  if (!Array.isArray(centros) || !centros.length) {
    return `<section class="centros">
              <div class="centros-cabecera"><h2>Stock en tiendas</h2>${boton}</div>
              <p class="centros-vacio">La ficha no muestra el stock por centros. Abrela en Comic Stores para comprobarlo.</p>
            </section>`;
  }

  const conStock = centros.filter(c => c.estado === 'stock');
  const resumen = conStock.length
    ? `${conStock.length} de ${centros.length} centros con stock`
    : `Ningun centro tiene stock ahora mismo`;


  // Primero los que tienen stock: es lo que se mira en el mostrador.
  const orden = { stock: 0, encargo: 1, otro: 2, sin: 3 };
  const ordenados = [...centros].sort((a, b) =>
    (orden[a.estado] ?? 9) - (orden[b.estado] ?? 9) || a.centro.localeCompare(b.centro, 'es'));

  const filas = ordenados.map(centro => `
    <li class="centro centro--${escapar(centro.estado)}">
      <span class="centro-nombre">${escapar(centro.centro)}</span>
      <span class="centro-estado">${escapar(centro.disponibilidad || 'Sin informacion')}</span>
    </li>`).join('');

  return `<section class="centros">
            <div class="centros-cabecera"><h2>Stock en tiendas</h2>${boton}</div>
            <p class="centros-resumen">${escapar(resumen)}${desdeCache ? ' &middot; dato cacheado' : ''}</p>
            <ul class="centros-lista">${filas}</ul>
          </section>`;
}

function reiniciar() {
  detenerEscaner();
  procesandoLectura = false;
  resultado.classList.add('oculto');
  zonaEscaner.classList.remove('oculto');
  infoProducto.innerHTML = '';
  enlaceDirecto.style.display = 'none';
  document.getElementById('input-manual').value = '';
}
