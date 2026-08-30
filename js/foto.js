// ==========================================================
//  LA FOTO DEL TICKET
//
//  Se reduce en el propio móvil antes de subirla: menos datos por
//  una cobertura mala y, de paso, los HEIC del iPhone salen en JPEG.
//
//  Se hace con `createImageBitmap` sobre el archivo, y si el navegador
//  no lo trae, con una URL de objeto. Lo que NO se hace es leer el
//  archivo entero como data URL: una foto de 12 megapíxeles son unos
//  quince megas de texto en memoria, y en un móvil justo de RAM eso se
//  queda a medias sin decir nada.
// ==========================================================

import { FOTO } from './config.js';
import { api } from './api.js';

/** Dibuja la imagen ya escalada y devuelve el JPEG en base64. */
function aJpeg(imagen, ancho, alto) {
  const escala = Math.min(1, FOTO.maxLado / Math.max(ancho, alto));
  const cv = document.createElement('canvas');
  cv.width = Math.round(ancho * escala);
  cv.height = Math.round(alto * escala);
  cv.getContext('2d').drawImage(imagen, 0, 0, cv.width, cv.height);
  const dataUrl = cv.toDataURL('image/jpeg', FOTO.calidad);
  return { dataUrl, b64: dataUrl.split(',')[1], mime: 'image/jpeg' };
}

function porUrlDeObjeto(file) {
  return new Promise((ok, mal) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        ok(aJpeg(img, img.naturalWidth, img.naturalHeight));
      } catch (err) {
        mal(err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      mal(new Error('No se pudo leer esa imagen. Prueba con otra o desde la galería.'));
    };
    img.src = url;
  });
}

/**
 * Convierte el archivo de la cámara o de la galería en un JPEG reducido.
 * Lanza con un mensaje que se puede enseñar tal cual.
 */
export async function prepararFoto(file) {
  if (!file) throw new Error('No llegó ninguna foto.');
  if (!file.size) throw new Error('La foto llegó vacía. Vuelve a hacerla.');

  if (typeof createImageBitmap === 'function') {
    let mapa = null;
    try {
      mapa = await createImageBitmap(file);
      return aJpeg(mapa, mapa.width, mapa.height);
    } catch (err) {
      // Safari viejo no acepta HEIC aquí; se prueba por el otro camino
    } finally {
      if (mapa && mapa.close) mapa.close();
    }
  }
  return porUrlDeObjeto(file);
}

/** Sube la foto a Drive. Devuelve el recibo, o null con el motivo. */
export async function subirFoto(b64, mime) {
  const r = await api({ action: 'subir', imagenBase64: b64, mimeType: mime || 'image/jpeg' });
  return r.ok ? { fileId: r.fileId, url: r.url } : { error: r.error || 'no se pudo subir' };
}
