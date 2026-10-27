// Picks the farmer's own plot out of SAM 3.1's field outlines and measures it.
// The satellite image is centred on the farmer's GPS point, so the plot is the
// field whose mask covers the image centre (or, failing that, the nearest one).

export const SQ_M_PER_ACRE = 4046.86;

export function acresFromPx(areaPx, groundMeters, imagePx) {
  if (!areaPx || !groundMeters || !imagePx) return null;
  const mPerPx = groundMeters / imagePx;
  return Math.round(((areaPx * mPerPx * mPerPx) / SQ_M_PER_ACRE) * 100) / 100;
}

export function pickPlot(objects, { width, height }) {
  if (!objects?.length) return null;
  const inside = objects.filter((o) => o.containsPoint);
  if (inside.length) {
    // If masks overlap at the centre, the smallest one is the most specific field.
    return inside.reduce((a, b) => ((a.areaPx ?? Infinity) <= (b.areaPx ?? Infinity) ? a : b));
  }
  const cx = width / 2;
  const cy = height / 2;
  const dist = (o) => {
    const bx = (o.box.left + o.box.right) / 2;
    const by = (o.box.top + o.box.bottom) / 2;
    return Math.hypot(bx - cx, by - cy);
  };
  return objects.reduce((a, b) => (dist(a) <= dist(b) ? a : b));
}

// Adds acres to every object so the farmer can tap a different field later.
export function withAcres(objects, groundMeters, imagePx) {
  return objects.map((o) => ({ ...o, acres: acresFromPx(o.areaPx, groundMeters, imagePx) }));
}

// Demo villages used when GPS is unavailable or outside South Asia.
export const DEMO_PLACES = {
  bolpur: { lat: 23.64, lon: 87.73, label: { bn: 'বোলপুর, পশ্চিমবঙ্গ', hi: 'बोलपुर, पश्चिम बंगाल', en: 'Bolpur, West Bengal' } },
  bogura: { lat: 24.88, lon: 89.33, label: { bn: 'বগুড়া, বাংলাদেশ', hi: 'बोगुड़ा, बांग्लादेश', en: 'Bogura, Bangladesh' } },
  punjab: { lat: 30.91, lon: 75.62, label: { bn: 'লুধিয়ানা, পাঞ্জাব', hi: 'लुधियाना, पंजाब', en: 'Ludhiana, Punjab' } },
};

export function inSouthAsia(lat, lon) {
  return lat >= 5 && lat <= 37 && lon >= 60 && lon <= 98;
}
