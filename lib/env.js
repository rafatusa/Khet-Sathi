// Reads an environment variable with stray whitespace and invisible characters removed.
// Values pasted through Railway's Raw editor on Windows can carry a trailing \r,
// which turned "sam-3.1" into an unknown model name in v0.3.0.
const INVISIBLE = /[​-‍⁠﻿]/g;

export function env(name, fallback = '') {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const clean = String(raw).replace(INVISIBLE, '').trim();
  return clean === '' ? fallback : clean;
}
