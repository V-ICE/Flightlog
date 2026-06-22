// UAVLogBook — Coordinate format conversions
// Supports: DD (decimal degrees), DMS, DDM, MGRS, UTM
import * as mgrsLib from 'mgrs';

// ── DD → other formats ────────────────────────────────────────

function toDMS(dd, isLat) {
  const abs = Math.abs(dd);
  const deg = Math.floor(abs);
  const minFull = (abs - deg) * 60;
  const min = Math.floor(minFull);
  const sec = ((minFull - min) * 60).toFixed(1);
  const dir = isLat ? (dd >= 0 ? 'N' : 'S') : (dd >= 0 ? 'E' : 'W');
  return `${deg}°${String(min).padStart(2,'0')}'${String(sec).padStart(4,'0')}"${dir}`;
}

function toDDM(dd, isLat) {
  const abs = Math.abs(dd);
  const deg = Math.floor(abs);
  const min = ((abs - deg) * 60).toFixed(4);
  const dir = isLat ? (dd >= 0 ? 'N' : 'S') : (dd >= 0 ? 'E' : 'W');
  return `${deg}°${min}'${dir}`;
}

function toUTM(lat, lng) {
  // UTM zone
  const zone = Math.floor((lng + 180) / 6) + 1;
  const latRad = lat * Math.PI / 180;
  const lngRad = lng * Math.PI / 180;
  const lngOrigin = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;

  const a = 6378137, f = 1 / 298.257223563;
  const b = a * (1 - f);
  const e2 = 1 - (b * b) / (a * a);
  const e = Math.sqrt(e2);
  const k0 = 0.9996;
  const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) ** 2);
  const T = Math.tan(latRad) ** 2;
  const C = (e2 / (1 - e2)) * Math.cos(latRad) ** 2;
  const A = Math.cos(latRad) * (lngRad - lngOrigin);
  const e4 = e2 * e2, e6 = e4 * e2;
  const M = a * ((1 - e2/4 - 3*e4/64 - 5*e6/256) * latRad
    - (3*e2/8 + 3*e4/32 + 45*e6/1024) * Math.sin(2*latRad)
    + (15*e4/256 + 45*e6/1024) * Math.sin(4*latRad)
    - (35*e6/3072) * Math.sin(6*latRad));
  const x = k0*N*(A + (1-T+C)*A**3/6 + (5-18*T+T**2+72*C-58*(e2/(1-e2)))*A**5/120) + 500000;
  let y = k0*(M + N*Math.tan(latRad)*(A**2/2 + (5-T+9*C+4*C**2)*A**4/24 + (61-58*T+T**2+600*C-330*(e2/(1-e2)))*A**6/720));
  if (lat < 0) y += 10000000;

  const band = 'CDEFGHJKLMNPQRSTUVWX'[Math.floor((lat + 80) / 8)] || 'Z';
  return `${zone}${band} ${Math.round(x)} ${Math.round(y)}`;
}

export function formatCoord(lat, lng, fmt) {
  if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return { lat: '', lng: '', combined: '' };
  switch (fmt) {
    case 'dms':
      return { lat: toDMS(lat, true), lng: toDMS(lng, false), combined: `${toDMS(lat, true)} ${toDMS(lng, false)}` };
    case 'ddm':
      return { lat: toDDM(lat, true), lng: toDDM(lng, false), combined: `${toDDM(lat, true)} ${toDDM(lng, false)}` };
    case 'mgrs':
      try {
        const m = mgrsLib.forward([lng, lat], 5);
        return { lat: '', lng: '', combined: m };
      } catch { return { lat: '', lng: '', combined: 'Invalid coordinates' }; }
    case 'utm':
      return { lat: '', lng: '', combined: toUTM(lat, lng) };
    default: // dd
      return { lat: lat.toFixed(6), lng: lng.toFixed(6), combined: `${lat.toFixed(6)}, ${lng.toFixed(6)}` };
  }
}

// ── other formats → DD ────────────────────────────────────────

function parseDMS(str) {
  // e.g. 51°30'18.0"N or 51 30 18 N
  const m = str.trim().match(/^(\d+)[°\s]+(\d+)['\s]+(\d+\.?\d*)["\s]*([NSEW])$/i);
  if (!m) return null;
  const dd = parseInt(m[1]) + parseInt(m[2]) / 60 + parseFloat(m[3]) / 3600;
  return /[SW]/i.test(m[4]) ? -dd : dd;
}

function parseDDM(str) {
  // e.g. 51°30.3000'N
  const m = str.trim().match(/^(\d+)[°\s]+(\d+\.?\d*)['\s]*([NSEW])$/i);
  if (!m) return null;
  const dd = parseInt(m[1]) + parseFloat(m[2]) / 60;
  return /[SW]/i.test(m[3]) ? -dd : dd;
}

function parseUTM(str) {
  // e.g. "30U 694500 5745000" — convert via MGRS isn't reliable; return null and let caller handle
  // Basic zone/band parse then reverse project — complex, skip for now
  return null;
}

// Returns { lat, lng } in decimal degrees, or null if parse fails
export function parseCoord(input, fmt) {
  const s = (input || '').trim();
  if (!s) return null;
  switch (fmt) {
    case 'mgrs': {
      try {
        const [lng, lat] = mgrsLib.toPoint(s.replace(/\s+/g, ''));
        if (isNaN(lat) || isNaN(lng)) return null;
        return { lat, lng };
      } catch { return null; }
    }
    case 'dms': {
      // Expect two space-separated DMS strings e.g. "51°30'18.0"N 0°05'24.0"W"
      const parts = s.split(/\s+(?=[0-9])/);
      if (parts.length < 2) return null;
      const lat = parseDMS(parts[0]);
      const lng = parseDMS(parts.slice(1).join(' '));
      if (lat == null || lng == null) return null;
      return { lat, lng };
    }
    case 'ddm': {
      const parts = s.split(/\s+(?=[0-9])/);
      if (parts.length < 2) return null;
      const lat = parseDDM(parts[0]);
      const lng = parseDDM(parts.slice(1).join(' '));
      if (lat == null || lng == null) return null;
      return { lat, lng };
    }
    default: { // dd — "lat, lng" or two separate fields
      const n = parseFloat(s);
      return isNaN(n) ? null : n; // caller handles lat/lng separately
    }
  }
}

export const COORD_FORMATS = [
  { key: 'dd',   label: 'DD',   hint: 'e.g. 51.505000, -0.090000',       twoFields: true  },
  { key: 'dms',  label: 'DMS',  hint: 'e.g. 51°30\'18.0"N 0°05\'24.0"W', twoFields: false },
  { key: 'ddm',  label: 'DDM',  hint: 'e.g. 51°30.3000\'N 0°05.4000\'W', twoFields: false },
  { key: 'mgrs', label: 'MGRS', hint: 'e.g. 30UXC9450074100',             twoFields: false },
  { key: 'utm',  label: 'UTM',  hint: 'UTM display only',                 twoFields: false, displayOnly: true },
];
