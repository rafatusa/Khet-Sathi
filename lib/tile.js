// Fetches one square satellite image centred on a lat/lon.
// Source: Esri World Imagery (attribution: Esri, Maxar, Earthstar Geographics).

const ESRI_EXPORT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export';
const R = 20037508.34;

export function toWebMercator(lat, lon) {
  const x = (lon * R) / 180;
  const y = (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * (R / 180);
  return { x, y };
}

// halfSideMeters is ground distance from centre to edge; Web Mercator stretches by 1/cos(lat).
export function bboxFor(lat, lon, halfSideMeters) {
  const { x, y } = toWebMercator(lat, lon);
  const half = halfSideMeters / Math.cos((lat * Math.PI) / 180);
  return [x - half, y - half, x + half, y + half];
}

// Esri's export refuses requests sharper than its finest zoom (~0.6 m per Web
// Mercator pixel), so never ask for less ground than that allows.
export function minHalfSide(lat, size) {
  return Math.ceil(0.31 * size * Math.cos((lat * Math.PI) / 180));
}

export async function fetchSatelliteImage({ lat, lon, halfSideMeters = 300, size = 1024 }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) {
    throw new Error('Invalid latitude/longitude');
  }
  halfSideMeters = Math.max(halfSideMeters, minHalfSide(lat, size));
  const bbox = bboxFor(lat, lon, halfSideMeters).map((v) => v.toFixed(2)).join(',');
  const params = new URLSearchParams({
    bbox,
    bboxSR: '3857',
    imageSR: '3857',
    size: `${size},${size}`,
    format: 'jpg',
    f: 'image',
  });
  const res = await fetch(`${ESRI_EXPORT}?${params}`);
  if (!res.ok) throw new Error(`Satellite imagery request failed: HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('image/')) throw new Error(`Satellite service returned ${type || 'no content type'}, not an image`);
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    dataUrl: `data:${type.split(';')[0]};base64,${buf.toString('base64')}`,
    width: size,
    height: size,
    groundMeters: halfSideMeters * 2,
    attribution: 'Imagery: Esri, Maxar, Earthstar Geographics',
  };
}

// Crops the centre of a square satellite image and enlarges it back to full size.
// Bengal plots are small: at the 600 m view SAM 3.1 reads the whole patchwork as one
// field, but on the centre 225 m enlarged 2.7x it outlines each plot (tested on Bolpur).
export async function zoomCenter(image, { keepPx = 384, outPx = 1024 } = {}) {
  const { default: sharp } = await import('sharp');
  const m = /^data:image\/[a-z+.-]+;base64,(.+)$/i.exec(image.dataUrl || '');
  if (!m) throw new Error('zoomCenter needs an image data URL');
  const keep = Math.min(keepPx, image.width, image.height);
  const left = Math.round((image.width - keep) / 2);
  const top = Math.round((image.height - keep) / 2);
  const buf = await sharp(Buffer.from(m[1], 'base64'))
    .extract({ left, top, width: keep, height: keep })
    .resize(outPx, outPx, { kernel: 'lanczos3' })
    .jpeg({ quality: 92 })
    .toBuffer();
  return {
    dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}`,
    width: outPx,
    height: outPx,
    groundMeters: Math.round(((image.groundMeters * keep) / image.width) * 100) / 100,
    attribution: image.attribution,
  };
}
