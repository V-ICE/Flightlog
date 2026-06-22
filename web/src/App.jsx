// ============================================================
// UAVLogBook — Main React Web Application
// Full-featured UAV flight log analysis dashboard
// ============================================================
import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceLine, Brush
} from "recharts";
import {
  Map, MountainSnow, Activity, Gauge, Battery, Satellite,
  Radio, Clock, Box, BarChart3, Upload, Settings, ChevronDown,
  ChevronRight, Eye, EyeOff, Menu, X, LogOut, Plane, Plus,
  AlertTriangle, AlertCircle, Info, CheckCircle, Home,
  Share2, Trash2, Edit3, RefreshCw, Download, Search, Filter,
  ArrowLeft, Maximize2, GripVertical, Zap, Rotate3d,
  TrendingUp, Globe, Layers, Video
} from "lucide-react";
import { VideoSyncModule } from "./VideoSync.jsx";
import { useUIStore } from './store.js';
import { themes, applyTheme } from './themes.js';
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, Tooltip as LeafletTooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { formatCoord, parseCoord, COORD_FORMATS } from './coords.js';

// ── Minimal in-memory state (no localStorage) ────────────────
const defaultModules = [
  { key: 'map',         label: 'Flight Map',       enabled: true,  icon: Map,          color: '#3B82F6' },
  { key: 'altitude',    label: 'Altitude Profile', enabled: true,  icon: MountainSnow, color: '#10B981' },
  { key: 'attitude',    label: 'Attitude (R/P/Y)', enabled: true,  icon: Rotate3d,     color: '#8B5CF6' },
  { key: 'speed',       label: 'Speed',            enabled: true,  icon: Gauge,        color: '#F59E0B' },
  { key: 'battery',     label: 'Battery',          enabled: true,  icon: Battery,      color: '#EF4444' },
  { key: 'gps_quality', label: 'GPS Quality',      enabled: true,  icon: Satellite,    color: '#06B6D4' },
  { key: 'imu',         label: 'IMU / Vibration',  enabled: false, icon: Activity,     color: '#EC4899' },
  { key: 'rc_input',    label: 'RC Channels',      enabled: false, icon: Radio,        color: '#84CC16' },
  { key: 'events',      label: 'Event Timeline',   enabled: true,  icon: Clock,        color: '#F97316' },
  { key: 'stats',       label: 'Statistics',       enabled: true,  icon: BarChart3,    color: '#A78BFA' },
  { key: 'video_sync',  label: 'FPV Video',        enabled: true,  icon: Video,        color: '#A78BFA' },
];

// ── Sample flight data for demo ──────────────────────────────
const generateFlightData = () => {
  const pts = 300;
  const gps = [], alt = [], att = [], speed = [], batt = [], gpsQ = [], imu = [];
  let lat = 37.7749, lng = -122.4194, altV = 0, heading = 45;

  for (let i = 0; i < pts; i++) {
    const t = i * 2; // 2 second intervals
    const phase = i / pts;
    // Simulate takeoff → cruise → return
    if (phase < 0.1) altV = phase * 10 * 120; // takeoff
    else if (phase < 0.8) altV = 120 + Math.sin(i * 0.1) * 15;
    else altV = (1 - (phase - 0.8) / 0.2) * 120; // landing

    lat += (Math.cos(heading * Math.PI / 180) * 0.00005);
    lng += (Math.sin(heading * Math.PI / 180) * 0.00005);
    if (i % 30 === 0) heading = (heading + (Math.random() - 0.5) * 60) % 360;

    gps.push({ t_ms: t * 1000, lat, lng, alt_m: Math.max(0, altV), speed_ms: 8 + Math.random() * 4, sats: 14 + Math.floor(Math.random() * 4), hdop: 0.8 + Math.random() * 0.4 });
    alt.push({ t, alt: Math.max(0, altV), alt_gps: Math.max(0, altV + (Math.random() - 0.5) * 3) });
    att.push({ t, roll: Math.sin(i * 0.15) * 15 + (Math.random() - 0.5) * 3, pitch: Math.sin(i * 0.1) * 10 + (Math.random() - 0.5) * 2, yaw: (heading + (Math.random() - 0.5) * 5) % 360 });
    speed.push({ t, ground: (8 + Math.sin(i * 0.08) * 3).toFixed(1), vertical: (phase < 0.1 ? 3 : phase > 0.85 ? -2 : (Math.random() - 0.5) * 1.5).toFixed(2) });
    batt.push({ t, voltage: (16.8 - phase * 2.5 - Math.random() * 0.1).toFixed(2), current: (15 + Math.sin(i * 0.05) * 5).toFixed(1), remaining: Math.max(0, 100 - phase * 55) | 0 });
    gpsQ.push({ t, sats: 14 + Math.floor(Math.random() * 4), hdop: (0.8 + Math.random() * 0.4).toFixed(2), fix: 3 });
    imu.push({ t, ax: (Math.sin(i * 0.3) * 0.5).toFixed(3), ay: (Math.cos(i * 0.25) * 0.4).toFixed(3), az: (-9.81 + Math.sin(i * 0.1) * 0.3).toFixed(3), vx: (Math.abs(Math.sin(i * 0.2) * 20)).toFixed(1), vy: (Math.abs(Math.sin(i * 0.18) * 18)).toFixed(1), vz: (Math.abs(Math.sin(i * 0.22) * 15)).toFixed(1) });
  }

  const events = [
    { t_ms: 0, type: 'arm', severity: 'info', description: 'Motors Armed' },
    { t_ms: 5000, type: 'mode_change', severity: 'info', description: 'Mode → Auto Takeoff' },
    { t_ms: 12000, type: 'mode_change', severity: 'info', description: 'Mode → Loiter' },
    { t_ms: 180000, type: 'warning', severity: 'warning', description: 'Low battery: 30%' },
    { t_ms: 540000, type: 'mode_change', severity: 'info', description: 'Mode → RTL' },
    { t_ms: 590000, type: 'mode_change', severity: 'info', description: 'Mode → Land' },
    { t_ms: 598000, type: 'disarm', severity: 'info', description: 'Motors Disarmed — Landed' },
  ];

  return { gps, alt, att, speed, batt, gpsQ, imu, events };
};

// ── Reusable chart tooltip ────────────────────────────────────
const ChartTooltip = ({ active, payload, label, unit = '' }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--chart-bg)', border: '1px solid var(--border-tooltip)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <p style={{ color: 'var(--text-tertiary)', marginBottom: 4 }}>{`t = ${label}s`}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color, margin: '2px 0' }}>
          {p.name}: <strong>{p.value}{unit}</strong>
        </p>
      ))}
    </div>
  );
};

// ── Coordinate input with format switcher ─────────────────────
const CoordInput = ({ lat, lng, onChange }) => {
  const [fmt, setFmt] = useState('dd');
  const [raw, setRaw] = useState('');
  const [error, setError] = useState('');
  const def = COORD_FORMATS.find(f => f.key === fmt);

  // When lat/lng props change externally (e.g. geolocation), sync raw display
  useEffect(() => {
    if (lat != null && lng != null && !isNaN(parseFloat(lat)) && !isNaN(parseFloat(lng))) {
      const f = formatCoord(parseFloat(lat), parseFloat(lng), fmt);
      setRaw(def?.twoFields ? '' : f.combined);
    }
  }, [lat, lng, fmt]);

  const inp = { background: 'var(--bg-input)', border: '1px solid var(--border-input)', borderRadius: 8, padding: '9px 12px', fontSize: 13, color: 'var(--text-primary)', width: '100%', outline: 'none', boxSizing: 'border-box' };

  const handleChange = (val) => {
    setRaw(val);
    setError('');
    if (!def?.twoFields) {
      const result = parseCoord(val, fmt);
      if (result && result.lat != null) onChange(result.lat.toFixed(6), result.lng.toFixed(6));
    }
  };

  const handleDD = (field, val) => {
    setError('');
    if (field === 'lat') onChange(val, lng);
    else onChange(lat, val);
  };

  return (
    <div>
      {/* Format tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {COORD_FORMATS.map(f => (
          <button key={f.key} onClick={() => { setFmt(f.key); setRaw(''); setError(''); }}
            style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1px solid', borderColor: fmt === f.key ? 'var(--accent)' : 'var(--border)', background: fmt === f.key ? 'var(--accent-bg)' : 'var(--bg-card)', color: fmt === f.key ? 'var(--accent)' : 'var(--text-muted)' }}>
            {f.label}
          </button>
        ))}
      </div>

      {def?.twoFields ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Latitude</div>
            <input style={inp} type="number" step="0.000001" placeholder="e.g. 51.505" value={lat ?? ''} onChange={e => handleDD('lat', e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Longitude</div>
            <input style={inp} type="number" step="0.000001" placeholder="e.g. -0.09" value={lng ?? ''} onChange={e => handleDD('lng', e.target.value)} />
          </div>
        </div>
      ) : (
        <div>
          <input style={{ ...inp, fontFamily: def?.key === 'mgrs' || def?.key === 'utm' ? 'monospace' : 'inherit' }}
            value={def?.displayOnly ? (lat && lng ? formatCoord(parseFloat(lat), parseFloat(lng), fmt).combined : '') : raw}
            readOnly={!!def?.displayOnly}
            onChange={e => handleChange(e.target.value)}
            placeholder={def?.hint} />
        </div>
      )}

      {/* Show current position in all formats when lat/lng are known */}
      {lat && lng && !isNaN(parseFloat(lat)) && (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {COORD_FORMATS.filter(f => f.key !== fmt).map(f => {
            const formatted = formatCoord(parseFloat(lat), parseFloat(lng), f.key);
            return (
              <div key={f.key} style={{ fontSize: 10, color: 'var(--text-faint)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 8px', fontFamily: 'monospace' }}>
                <span style={{ color: 'var(--text-muted)', marginRight: 4 }}>{f.label}:</span>
                {formatted.combined}
              </div>
            );
          })}
        </div>
      )}
      {error && <div style={{ fontSize: 11, color: '#EF4444', marginTop: 4 }}>{error}</div>}
    </div>
  );
};

// ── Manual home position picker (shown when no GPS track exists) ──
const HomePositionPicker = ({ flightId, onConfirm }) => {
  const stored = (() => { try { return JSON.parse(localStorage.getItem(`uavlogbook-home-${flightId}`) || 'null'); } catch { return null; } })();
  const [lat, setLat] = useState(stored?.lat ?? '');
  const [lng, setLng] = useState(stored?.lng ?? '');
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (stored) onConfirm(stored); }, []); // auto-restore saved position

  const useMyLocation = () => {
    if (!navigator.geolocation) { setError('Geolocation not available in this browser'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLat(pos.coords.latitude.toFixed(6)); setLng(pos.coords.longitude.toFixed(6)); setLocating(false); },
      ()    => { setError('Could not get location — check browser permissions'); setLocating(false); }
    );
  };

  const confirm = () => {
    const la = parseFloat(lat), ln = parseFloat(lng);
    if (isNaN(la) || isNaN(ln) || la < -90 || la > 90 || ln < -180 || ln > 180) {
      setError('Enter a valid position in any format'); return;
    }
    const pos = { lat: la, lng: ln };
    localStorage.setItem(`uavlogbook-home-${flightId}`, JSON.stringify(pos));
    onConfirm(pos);
  };

  return (
    <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      <div style={{ textAlign: 'center' }}>
        <Globe size={32} color="var(--text-faint)" style={{ marginBottom: 10 }} />
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>No GPS track in this log</div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>Set a home position to show the map</div>
      </div>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <CoordInput lat={lat} lng={lng} onChange={(la, ln) => { setLat(la); setLng(ln); }} />
      </div>
      {error && <div style={{ fontSize: 12, color: '#EF4444' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={useMyLocation} disabled={locating}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', padding: '9px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
          <Globe size={13} />{locating ? 'Locating…' : 'Use My Location'}
        </button>
        <button onClick={confirm}
          style={{ background: 'var(--accent)', border: 'none', color: '#fff', padding: '9px 20px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
          Set Home Position
        </button>
      </div>
    </div>
  );
};

// Bearing in degrees between two lat/lng points
const calcBearing = (lat1, lng1, lat2, lng2) => {
  const dL = (lng2 - lng1) * Math.PI / 180;
  const r1 = lat1 * Math.PI / 180, r2 = lat2 * Math.PI / 180;
  const y = Math.sin(dL) * Math.cos(r2);
  const x = Math.cos(r1) * Math.sin(r2) - Math.sin(r1) * Math.cos(r2) * Math.cos(dL);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};

const arrowIcon = (bearing, color) => L.divIcon({
  className: '',
  html: `<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg"
           style="transform:rotate(${bearing}deg);transform-origin:center">
    <polygon points="9,1 15,16 9,12 3,16" fill="${color}" stroke="rgba(0,0,0,0.5)" stroke-width="1"/>
  </svg>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

// ── Tile layer definitions ────────────────────────────────────
const TILE_LAYERS = {
  Satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    maxZoom: 19,
  },
  Terrain: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> contributors',
    maxZoom: 17,
  },
  Streets: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
};

// Fits map to GPS bounds on mount
const FitBounds = ({ positions, homeOnly }) => {
  const map = useMap();
  useEffect(() => {
    if (homeOnly && positions.length === 1) {
      map.setView(positions[0], 14);
    } else if (positions.length > 1) {
      map.fitBounds(positions, { padding: [24, 24] });
    }
  }, []);
  return null;
};

// ── Module: Flight Map ────────────────────────────────────────
const MapModule = ({ data, flightData }) => {
  const [manualHome, setManualHome] = useState(null);
  const [tileStyle, setTileStyle] = useState('Satellite');
  const [fullscreen, setFullscreen] = useState(false);
  const mapWrapRef = useRef(null);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      mapWrapRef.current?.requestFullscreen();
      setFullscreen(true);
    } else {
      document.exitFullscreen();
      setFullscreen(false);
    }
  };
  useEffect(() => {
    const onExit = () => { if (!document.fullscreenElement) setFullscreen(false); };
    document.addEventListener('fullscreenchange', onExit);
    return () => document.removeEventListener('fullscreenchange', onExit);
  }, []);
  const rawGps = data?.gps || [];
  const gps = rawGps.filter(p => p.lat != null && p.lng != null && !isNaN(p.lat) && !isNaN(p.lng));

  if (!gps.length && !manualHome) return (
    <HomePositionPicker flightId={flightData?.id} onConfirm={setManualHome} />
  );

  const homeOnly = gps.length < 2;
  const positions = gps.length
    ? gps.map(p => [p.lat, p.lng])
    : [[manualHome.lat, manualHome.lng]];

  // Build altitude-colored polyline segments (max ~100 segments for perf)
  const maxAlt = Math.max(...gps.map(p => p.alt_m || 0)) || 1;
  const step = Math.max(1, Math.floor(gps.length / 100));
  const segments = [];
  for (let i = 0; i < gps.length - step; i += step) {
    const p = gps[i];
    const q = gps[Math.min(i + step, gps.length - 1)];
    const hue = Math.round(120 - ((p.alt_m || 0) / maxAlt) * 120);
    segments.push({ pts: [[p.lat, p.lng], [q.lat, q.lng]], color: `hsl(${hue},85%,55%)` });
  }

  const tile = TILE_LAYERS[tileStyle];

  return (
    <div ref={mapWrapRef} style={{ position: 'relative', borderRadius: fullscreen ? 0 : 10, overflow: 'hidden', background: '#0D1B2A' }}>
      {/* Style switcher */}
      <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 1000, display: 'flex', gap: 5 }}>
        {Object.keys(TILE_LAYERS).map(s => (
          <button key={s} onClick={() => setTileStyle(s)}
            style={{ ...btnSmallStyle, background: tileStyle === s ? 'var(--accent)' : 'rgba(10,10,20,0.85)', color: tileStyle === s ? '#fff' : 'var(--text-secondary)', borderColor: tileStyle === s ? 'var(--accent)' : 'rgba(255,255,255,0.15)', backdropFilter: 'blur(4px)' }}>
            {s}
          </button>
        ))}
      </div>

      {/* Top-right controls */}
      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000, display: 'flex', gap: 5 }}>
        {homeOnly && (
          <button onClick={() => { localStorage.removeItem(`uavlogbook-home-${flightData?.id}`); setManualHome(null); }}
            style={{ ...btnSmallStyle, background: 'rgba(10,10,20,0.85)', backdropFilter: 'blur(4px)' }}>
            <Edit3 size={11} /> Change Home
          </button>
        )}
        <button onClick={toggleFullscreen} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          style={{ ...btnSmallStyle, background: 'rgba(10,10,20,0.85)', backdropFilter: 'blur(4px)', padding: '5px 8px' }}>
          <Maximize2 size={13} />
        </button>
      </div>

      <MapContainer
        style={{ height: fullscreen ? '100vh' : 340, width: '100%' }}
        center={positions[0]}
        zoom={14}
        zoomControl={true}
        scrollWheelZoom={true}
        attributionControl={true}
      >
        <TileLayer key={tileStyle} url={tile.url} attribution={tile.attribution} maxZoom={tile.maxZoom} />
        <FitBounds positions={positions} homeOnly={homeOnly} />

        {/* Flight path — altitude-colored segments */}
        {!homeOnly && segments.map((seg, i) => (
          <Polyline key={i} positions={seg.pts} color={seg.color} weight={3} opacity={0.9} />
        ))}

        {/* Direction arrows — one every ~5% of the track */}
        {!homeOnly && (() => {
          const interval = Math.max(1, Math.floor(gps.length / 20));
          return gps.slice(0, -interval).filter((_, i) => i % interval === 0).map((p, i) => {
            const next = gps[Math.min((i + 1) * interval, gps.length - 1)];
            const bearing = calcBearing(p.lat, p.lng, next.lat, next.lng);
            const hue = Math.round(120 - ((p.alt_m || 0) / maxAlt) * 120);
            return (
              <Marker key={i} position={[p.lat, p.lng]} icon={arrowIcon(bearing, `hsl(${hue},85%,65%)`)} />
            );
          });
        })()}

        {/* Home marker */}
        <CircleMarker center={positions[0]} radius={8} pathOptions={{ color: '#10B981', fillColor: '#10B981', fillOpacity: 0.9, weight: 2 }}>
          <LeafletTooltip permanent direction="right" offset={[10, 0]} className="map-label">HOME</LeafletTooltip>
        </CircleMarker>

        {/* Landing marker */}
        {!homeOnly && (
          <CircleMarker center={positions[positions.length - 1]} radius={8} pathOptions={{ color: '#EF4444', fillColor: '#EF4444', fillOpacity: 0.9, weight: 2 }}>
            <LeafletTooltip permanent direction="right" offset={[10, 0]} className="map-label">LAND</LeafletTooltip>
          </CircleMarker>
        )}
      </MapContainer>

      {/* Altitude legend */}
      {!homeOnly && (
        <div style={{ position: 'absolute', bottom: 24, right: 10, zIndex: 1000, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(10,10,20,0.85)', padding: '4px 10px', borderRadius: 6, backdropFilter: 'blur(4px)' }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>0m</span>
          <div style={{ width: 60, height: 7, borderRadius: 3, background: 'linear-gradient(to right, hsl(120,85%,55%), hsl(0,85%,55%))' }} />
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{maxAlt.toFixed(0)}m</span>
        </div>
      )}
    </div>
  );
};

// ── Module: Altitude ─────────────────────────────────────────
const AltitudeModule = ({ data, flightData }) => {
  const altData = data?.alt || [];
  const gpsData = data?.gps || [];
  if (!altData.length) return <div style={emptyStyle}>No altitude data available</div>;

  const altVals = altData.map(p => p.alt).filter(v => v != null);
  const maxAlt  = Math.max(...altVals);
  const minAlt  = Math.min(...altVals);

  // Compute vertical speed from consecutive GPS points
  const enriched = altData.map((p, i) => {
    if (i === 0) return { ...p, vspeed: 0 };
    const prev = altData[i - 1];
    const dt = p.t - prev.t;
    const da = (p.alt ?? 0) - (prev.alt ?? 0);
    return { ...p, vspeed: dt > 0 ? parseFloat((da / dt).toFixed(2)) : 0 };
  });

  // Takeoff / landing time markers (seconds into flight)
  const takeoffSec = flightData?.takeoff_ms != null ? Math.round(parseFloat(flightData.takeoff_ms) / 1000) : null;
  const landingSec = flightData?.landing_ms  != null ? Math.round(parseFloat(flightData.landing_ms)  / 1000) : null;

  const fmtTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const AltTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const alt   = payload.find(p => p.dataKey === 'alt');
    const vs    = payload.find(p => p.dataKey === 'vspeed');
    const altG  = payload.find(p => p.dataKey === 'alt_gps');
    return (
      <div style={{ background: 'var(--chart-bg)', border: '1px solid var(--border-tooltip)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
        <div style={{ color: 'var(--text-tertiary)', marginBottom: 4 }}>t = {fmtTime(label)}</div>
        {alt  && <div style={{ color: '#10B981' }}>Altitude: <strong>{alt.value?.toFixed(1)}m</strong></div>}
        {altG && altG.value != null && <div style={{ color: '#06B6D4' }}>GPS Alt: <strong>{altG.value?.toFixed(1)}m</strong></div>}
        {vs   && <div style={{ color: vs.value >= 0 ? '#34D399' : '#F87171' }}>V-Speed: <strong>{vs.value > 0 ? '+' : ''}{vs.value?.toFixed(1)} m/s</strong></div>}
      </div>
    );
  };

  return (
    <div>
      {/* Summary bar */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 12, fontSize: 12 }}>
        {[
          { label: 'Max Alt',  value: `${maxAlt.toFixed(1)}m`,         color: '#10B981' },
          { label: 'Min Alt',  value: `${minAlt.toFixed(1)}m`,         color: '#64748B' },
          { label: 'AGL Range', value: `${(maxAlt - minAlt).toFixed(1)}m`, color: '#F59E0B' },
          takeoffSec != null && { label: 'Takeoff', value: fmtTime(takeoffSec), color: '#06B6D4' },
          landingSec != null && { label: 'Landing', value: fmtTime(landingSec), color: '#EF4444' },
        ].filter(Boolean).map((s, i) => (
          <div key={i}>
            <span style={{ color: 'var(--text-faint)', marginRight: 4 }}>{s.label}</span>
            <span style={{ color: s.color, fontWeight: 700 }}>{s.value}</span>
          </div>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={enriched} margin={{ top: 10, right: 10, bottom: 5, left: 0 }}>
          <defs>
            <linearGradient id="altGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#10B981" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#10B981" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="altGpsGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#06B6D4" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#06B6D4" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
          <XAxis dataKey="t" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickFormatter={fmtTime} label={{ value: 'Time (m:ss)', position: 'insideBottomRight', offset: -8, fill: 'var(--text-faint)', fontSize: 10 }} />
          <YAxis yAxisId="alt" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickFormatter={v => `${v}m`} domain={[dataMin => Math.min(0, dataMin - 2), dataMax => Math.ceil(dataMax * 1.05)]} />
          <YAxis yAxisId="vs" orientation="right" tick={{ fill: 'var(--text-faint)', fontSize: 10 }} tickFormatter={v => `${v}m/s`} domain={[-10, 10]} width={48} />
          <Tooltip content={<AltTooltip />} />
          <ReferenceLine yAxisId="alt" y={0} stroke="var(--border-tooltip)" strokeDasharray="4 2" label={{ value: 'Home', fill: 'var(--text-faint)', fontSize: 10, position: 'insideTopLeft' }} />
          {takeoffSec != null && <ReferenceLine yAxisId="alt" x={takeoffSec} stroke="#06B6D4" strokeDasharray="4 2" label={{ value: '↑ Takeoff', fill: '#06B6D4', fontSize: 10, position: 'insideTopRight' }} />}
          {landingSec != null && <ReferenceLine yAxisId="alt" x={landingSec} stroke="#EF4444" strokeDasharray="4 2" label={{ value: '↓ Land', fill: '#EF4444', fontSize: 10, position: 'insideTopRight' }} />}
          <Area yAxisId="alt" type="monotone" dataKey="alt"     name="Altitude" stroke="#10B981" fill="url(#altGrad)"    strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: '#10B981' }} />
          {enriched.some(p => p.alt_gps != null) && (
            <Area yAxisId="alt" type="monotone" dataKey="alt_gps" name="GPS Alt"  stroke="#06B6D4" fill="url(#altGpsGrad)" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
          )}
          <Area yAxisId="vs" type="monotone" dataKey="vspeed" name="V-Speed" stroke="#A78BFA" fill="none" strokeWidth={1} dot={false} strokeDasharray="2 2" />
          <Legend wrapperStyle={{ color: 'var(--text-tertiary)', fontSize: 12 }} />
          <Brush dataKey="t" height={20} stroke="var(--brush-stroke)" fill="var(--bg-card)" travellerWidth={6} tickFormatter={fmtTime} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

// ── Module: Attitude ──────────────────────────────────────────
const AttitudeModule = ({ data }) => (
  <ResponsiveContainer width="100%" height={200}>
    <LineChart data={data?.att || []} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
      <XAxis dataKey="t" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickFormatter={v => `${v}s`} />
      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickFormatter={v => `${v}°`} domain={[-180, 180]} />
      <Tooltip content={<ChartTooltip unit="°" />} />
      <Legend wrapperStyle={{ color: 'var(--text-tertiary)', fontSize: 12 }} />
      <ReferenceLine y={0} stroke="var(--border-tooltip)" />
      <Line type="monotone" dataKey="roll"  name="Roll"  stroke="#8B5CF6" strokeWidth={1.5} dot={false} />
      <Line type="monotone" dataKey="pitch" name="Pitch" stroke="#EC4899" strokeWidth={1.5} dot={false} />
      <Line type="monotone" dataKey="yaw"   name="Yaw"   stroke="#F59E0B" strokeWidth={1.5} dot={false} />
      <Brush dataKey="t" height={20} stroke="var(--brush-stroke)" fill="var(--bg-card)" travellerWidth={6} />
    </LineChart>
  </ResponsiveContainer>
);

// ── Module: Speed ─────────────────────────────────────────────
const SpeedModule = ({ data }) => (
  <ResponsiveContainer width="100%" height={200}>
    <AreaChart data={data?.speed || []} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
      <defs>
        <linearGradient id="speedGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.3} />
          <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
        </linearGradient>
      </defs>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
      <XAxis dataKey="t" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickFormatter={v => `${v}s`} />
      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickFormatter={v => `${v}m/s`} />
      <Tooltip content={<ChartTooltip unit="m/s" />} />
      <Legend wrapperStyle={{ color: 'var(--text-tertiary)', fontSize: 12 }} />
      <Area type="monotone" dataKey="ground"   name="Ground Speed" stroke="#F59E0B" fill="url(#speedGrad)" strokeWidth={2} dot={false} />
      <Line type="monotone" dataKey="vertical" name="Vert Speed"   stroke="#06B6D4" strokeWidth={1.5} dot={false} />
      <Brush dataKey="t" height={20} stroke="var(--brush-stroke)" fill="var(--bg-card)" travellerWidth={6} />
    </AreaChart>
  </ResponsiveContainer>
);

// ── Module: Battery ───────────────────────────────────────────
const BatteryModule = ({ data }) => (
  <ResponsiveContainer width="100%" height={200}>
    <LineChart data={data?.batt || []} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
      <XAxis dataKey="t" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickFormatter={v => `${v}s`} />
      <YAxis yAxisId="left"  tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickFormatter={v => `${v}V`} domain={[12, 18]} />
      <YAxis yAxisId="right" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickFormatter={v => `${v}%`} domain={[0, 100]} />
      <Tooltip content={<ChartTooltip />} />
      <Legend wrapperStyle={{ color: 'var(--text-tertiary)', fontSize: 12 }} />
      <ReferenceLine yAxisId="left" y={14.8} stroke="#EF4444" strokeDasharray="4 2" label={{ value: 'Low', fill: '#EF4444', fontSize: 10 }} />
      <Line yAxisId="left"  type="monotone" dataKey="voltage"   name="Voltage (V)"    stroke="#EF4444" strokeWidth={2} dot={false} />
      <Line yAxisId="right" type="monotone" dataKey="remaining" name="Remaining (%)"  stroke="#F97316" strokeWidth={1.5} dot={false} />
      <Line yAxisId="left"  type="monotone" dataKey="current"   name="Current (A)"    stroke="#A78BFA" strokeWidth={1.5} dot={false} />
      <Brush dataKey="t" height={20} stroke="var(--brush-stroke)" fill="var(--bg-card)" travellerWidth={6} />
    </LineChart>
  </ResponsiveContainer>
);

// ── Module: GPS Quality ───────────────────────────────────────
const GPSQualityModule = ({ data }) => (
  <ResponsiveContainer width="100%" height={200}>
    <BarChart data={data?.gpsQ || []} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
      <XAxis dataKey="t" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickFormatter={v => `${v}s`} interval="preserveStartEnd" />
      <YAxis yAxisId="left"  tick={{ fill: 'var(--text-muted)', fontSize: 11 }} label={{ value: 'Sats', fill:'var(--text-muted)', fontSize:10, angle:-90, position:'insideLeft' }} />
      <YAxis yAxisId="right" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} label={{ value: 'HDOP', fill:'var(--text-muted)', fontSize:10, angle:90, position:'insideRight' }} domain={[0, 3]} />
      <Tooltip content={<ChartTooltip />} />
      <Legend wrapperStyle={{ color: 'var(--text-tertiary)', fontSize: 12 }} />
      <Bar     yAxisId="left"  dataKey="sats" name="Satellites" fill="#06B6D4" opacity={0.7} />
      <Line    yAxisId="right" type="monotone" dataKey="hdop" name="HDOP" stroke="#F59E0B" strokeWidth={2} dot={false} />
    </BarChart>
  </ResponsiveContainer>
);

// ── Module: IMU / Vibration ────────────────────────────────────
const IMUModule = ({ data }) => (
  <ResponsiveContainer width="100%" height={200}>
    <LineChart data={data?.imu || []} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
      <XAxis dataKey="t" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickFormatter={v => `${v}s`} />
      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
      <Tooltip content={<ChartTooltip />} />
      <Legend wrapperStyle={{ color: 'var(--text-tertiary)', fontSize: 12 }} />
      <Line type="monotone" dataKey="vx" name="Vibe X" stroke="#EC4899" strokeWidth={1.5} dot={false} />
      <Line type="monotone" dataKey="vy" name="Vibe Y" stroke="#8B5CF6" strokeWidth={1.5} dot={false} />
      <Line type="monotone" dataKey="vz" name="Vibe Z" stroke="#06B6D4" strokeWidth={1.5} dot={false} />
      <Brush dataKey="t" height={20} stroke="var(--brush-stroke)" fill="var(--bg-card)" travellerWidth={6} />
    </LineChart>
  </ResponsiveContainer>
);

// ── Module: Events Timeline ───────────────────────────────────
const EventsModule = ({ data }) => {
  const events = data?.events || [];
  const iconMap = { warning: AlertTriangle, error: AlertCircle, info: Info, critical: AlertCircle };
  const colorMap = { warning: '#F59E0B', error: '#EF4444', info: '#3B82F6', critical: '#DC2626' };

  return (
    <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {events.map((ev, i) => {
        const Icon = iconMap[ev.severity] || Info;
        const color = colorMap[ev.severity] || '#3B82F6';
        const tSec = (ev.t_ms / 1000).toFixed(1);
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', background: `${color}10`, borderLeft: `3px solid ${color}`, borderRadius: '0 6px 6px 0' }}>
            <Icon size={14} color={color} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', width: 55, flexShrink: 0 }}>{tSec}s</span>
            <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{ev.description}</span>
            <span style={{ fontSize: 10, color: color, marginLeft: 'auto', textTransform: 'uppercase', fontWeight: 600 }}>{ev.severity}</span>
          </div>
        );
      })}
      {!events.length && <div style={emptyStyle}>No events recorded</div>}
    </div>
  );
};

// ── Layout helpers ────────────────────────────────────────────
const useLayout = () => {
  const { theme } = useUIStore();
  return themes[theme]?.layout || 'default';
};

// SVG radial gauge for HUD layout
const RadialGauge = ({ value, max, label, unit, color, size = 110 }) => {
  const pct = Math.min(1, Math.max(0, (value || 0) / (max || 1)));
  const r = 40, cx = size / 2, cy = size / 2;
  const arc = (p) => {
    const a = Math.PI * (0.75 + p * 1.5);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const [sx, sy] = arc(0), [ex, ey] = arc(pct);
  const large = pct > 0.5 ? 1 : 0;
  const trackD = `M ${arc(0)[0]} ${arc(0)[1]} A ${r} ${r} 0 1 1 ${arc(1)[0]} ${arc(1)[1]}`;
  const fillD  = pct > 0.01 ? `M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}` : '';
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <path d={trackD} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={7} strokeLinecap="round" />
      {fillD && <path d={fillD} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" style={{ filter: `drop-shadow(0 0 4px ${color})` }} />}
      <text x={cx} y={cy - 4} textAnchor="middle" fill={color} fontSize={13} fontWeight="700" fontFamily="monospace">{value ?? '—'}{unit}</text>
      <text x={cx} y={cy + 12} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize={8} fontFamily="monospace">{label}</text>
    </svg>
  );
};

// ── Dashboard stat panels by layout ──────────────────────────
const DashboardStats = ({ totals, byFormat }) => {
  const layout = useLayout();
  const flights  = totals.flights ?? 0;
  const airH     = totals.total_time ? (parseFloat(totals.total_time) / 3600).toFixed(1) : 0;
  const distKm   = totals.total_dist ? (parseFloat(totals.total_dist) / 1000).toFixed(0) : 0;
  const formats  = byFormat.length || 0;

  if (layout === 'hud') return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'center', justifyContent: 'center', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 30px', gridColumn: '1 / -1' }}>
      <RadialGauge value={flights}  max={Math.max(flights, 20)} label="FLIGHTS"  unit=""   color="#00D4FF" size={120} />
      <RadialGauge value={airH}     max={Math.max(airH, 10)}    label="AIR HRS"  unit="h"  color="#00FF88" size={120} />
      <RadialGauge value={distKm}   max={Math.max(distKm, 100)} label="DIST KM"  unit="km" color="#FF6B35" size={120} />
      <RadialGauge value={formats}  max={8}                     label="FORMATS"  unit=""   color="#A855F7" size={120} />
    </div>
  );

  if (layout === 'terminal') return (
    <div style={{ gridColumn: '1 / -1', fontFamily: 'monospace', background: 'var(--bg-card)', border: '1px solid var(--accent)', borderRadius: 4, padding: '16px 20px', fontSize: 13, lineHeight: 1.8 }}>
      <div style={{ color: 'var(--accent)', marginBottom: 8 }}>$ uavlogbook --stats --summary</div>
      <div style={{ color: 'var(--text-secondary)' }}>┌{'─'.repeat(38)}┐</div>
      <div style={{ color: 'var(--text-secondary)' }}>│ {'TOTAL FLIGHTS'.padEnd(20)}<span style={{ color: 'var(--accent)' }}>{String(flights).padStart(6)}</span>        │</div>
      <div style={{ color: 'var(--text-secondary)' }}>│ {'AIR TIME'.padEnd(20)}<span style={{ color: '#00FF88' }}>{String(airH + 'h').padStart(6)}</span>        │</div>
      <div style={{ color: 'var(--text-secondary)' }}>│ {'TOTAL DISTANCE'.padEnd(20)}<span style={{ color: '#FF6B35' }}>{String(distKm + 'km').padStart(6)}</span>        │</div>
      <div style={{ color: 'var(--text-secondary)' }}>│ {'LOG FORMATS'.padEnd(20)}<span style={{ color: '#A855F7' }}>{String(formats).padStart(6)}</span>        │</div>
      <div style={{ color: 'var(--text-secondary)' }}>└{'─'.repeat(38)}┘</div>
    </div>
  );

  if (layout === 'magazine') return (
    <>
      {[
        { label: 'Flights',  value: flights,         suffix: '',   grad: 'linear-gradient(135deg,#6366F1,#8B5CF6)', icon: Plane },
        { label: 'Air Time', value: airH,            suffix: 'h',  grad: 'linear-gradient(135deg,#059669,#10B981)', icon: Clock },
        { label: 'Distance', value: distKm,          suffix: 'km', grad: 'linear-gradient(135deg,#D97706,#F59E0B)', icon: Globe },
        { label: 'Formats',  value: formats,         suffix: '',   grad: 'linear-gradient(135deg,#DC2626,#EF4444)', icon: Layers },
      ].map((c, i) => (
        <div key={i} style={{ background: c.grad, borderRadius: 16, padding: '22px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 130 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{c.label}</span>
            <c.icon size={18} color="rgba(255,255,255,0.6)" />
          </div>
          <div>
            <span style={{ fontSize: 42, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{c.value}</span>
            <span style={{ fontSize: 20, fontWeight: 700, color: 'rgba(255,255,255,0.7)', marginLeft: 4 }}>{c.suffix}</span>
          </div>
        </div>
      ))}
    </>
  );

  // default
  return (
    <>
      {[
        { label: 'Total Flights', value: flights,  icon: Plane,   color: '#3B82F6' },
        { label: 'Air Time',      value: airH+'h', icon: Clock,   color: '#10B981' },
        { label: 'Formats',       value: formats,  icon: Layers,  color: '#8B5CF6' },
        { label: 'Distance',      value: distKm+'km', icon: Globe, color: '#F59E0B' },
      ].map((c, i) => (
        <div key={i} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c.label}</span>
            <c.icon size={16} color={c.color} />
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-bright)', fontFamily: "'JetBrains Mono', monospace" }}>{c.value}</div>
        </div>
      ))}
    </>
  );
};

// ── Flight list item by layout ────────────────────────────────
const FlightRow = ({ f, onSelect, fmtColors }) => {
  const layout = useLayout();

  if (layout === 'hud') {
    const altM = f.max_altitude_m ? parseFloat(f.max_altitude_m).toFixed(0) : null;
    const spd  = f.max_speed_ms  ? parseFloat(f.max_speed_ms).toFixed(1)  : null;
    const col  = fmtColors[f.log_format] || 'var(--text-muted)';
    return (
      <div onClick={() => onSelect(f)} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', display: 'grid', gridTemplateColumns: '1fr auto auto auto auto', alignItems: 'center', gap: 16, transition: 'border-color 0.15s' }}
        onMouseEnter={e => e.currentTarget.style.borderColor = '#00D4FF50'}
        onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{f.original_filename}</div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'monospace' }}>{f.flight_date?.slice(0, 10) || '—'}</div>
        </div>
        {[
          { label: 'FLT', value: formatDuration(f.flight_duration_sec || f.duration_sec), color: '#00D4FF' },
          { label: 'ALT', value: altM ? altM + 'm' : '—', color: '#00FF88' },
          { label: 'SPD', value: spd  ? spd  + 'm/s' : '—', color: '#FF6B35' },
        ].map((s, i) => (
          <div key={i} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: s.color, fontFamily: 'monospace', textShadow: `0 0 8px ${s.color}` }}>{s.value}</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em' }}>{s.label}</div>
          </div>
        ))}
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: col, boxShadow: `0 0 6px ${col}` }} />
      </div>
    );
  }

  if (layout === 'terminal') {
    const dur  = formatDuration(f.flight_duration_sec || f.duration_sec) || '—';
    const alt  = f.max_altitude_m ? parseFloat(f.max_altitude_m).toFixed(0) + 'm' : '---';
    const date = f.flight_date?.slice(0, 10) || '----------';
    const fmt  = (f.log_format || 'unknown').replace(/_/g, '-');
    const warn = f.warning_count > 0 ? ` [W:${f.warning_count}]` : '';
    return (
      <div onClick={() => onSelect(f)} style={{ fontFamily: 'monospace', fontSize: 12, padding: '5px 12px', cursor: 'pointer', borderRadius: 3, color: 'var(--text-secondary)', display: 'flex', gap: 12, transition: 'background 0.1s' }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-bg)'; e.currentTarget.style.color = 'var(--accent)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}>
        <span style={{ color: 'var(--accent)', minWidth: 90 }}>{date}</span>
        <span style={{ minWidth: 60 }}>{dur}</span>
        <span style={{ color: '#FF6B35', minWidth: 50 }}>{alt}</span>
        <span style={{ color: 'rgba(0,255,65,0.5)', minWidth: 120 }}>{fmt}</span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-faint)' }}>{f.original_filename}</span>
        {warn && <span style={{ color: '#F59E0B' }}>{warn}</span>}
      </div>
    );
  }

  if (layout === 'magazine') {
    const dur = formatDuration(f.flight_duration_sec || f.duration_sec);
    const date = f.flight_date?.slice(0, 10) || '—';
    const col = fmtColors[f.log_format] || '#8B5CF6';
    return (
      <div onClick={() => onSelect(f)} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px', cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s', display: 'flex', gap: 16, alignItems: 'center' }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 8px 24px ${col}25`; }}
        onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}>
        <div style={{ width: 48, height: 48, borderRadius: 12, background: `${col}25`, border: `1px solid ${col}50`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Plane size={22} color={col} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.original_filename}</div>
          <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text-muted)' }}>
            <span>{date}</span>
            <span style={{ color: col, fontWeight: 600 }}>{dur}</span>
            {f.max_altitude_m && <span>↑ {parseFloat(f.max_altitude_m).toFixed(0)}m</span>}
          </div>
        </div>
        {f.warning_count > 0 && <div style={{ fontSize: 11, background: '#F59E0B20', color: '#F59E0B', padding: '4px 10px', borderRadius: 20, fontWeight: 700 }}>{f.warning_count} ⚠</div>}
        <div style={{ fontSize: 10, color: col, background: `${col}20`, padding: '4px 10px', borderRadius: 20, fontWeight: 700, textTransform: 'uppercase' }}>{(f.log_format || '?').replace(/_/g, ' ')}</div>
      </div>
    );
  }

  // default
  return (
    <div onClick={() => onSelect(f)} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', cursor: 'pointer', transition: 'border-color 0.15s' }}
      onMouseEnter={e => e.currentTarget.style.borderColor = '#3B82F650'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Plane size={13} color={fmtColors[f.log_format] || 'var(--text-muted)'} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.original_filename}</span>
        {f.warning_count > 0 && <span style={{ fontSize: 10, background: '#F59E0B20', color: '#F59E0B', padding: '2px 7px', borderRadius: 10, fontWeight: 600 }}>{f.warning_count}⚠</span>}
        {f.parse_status !== 'complete' && <span style={{ fontSize: 10, background: '#3B82F620', color: '#3B82F6', padding: '2px 7px', borderRadius: 10 }}>{f.parse_status}</span>}
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-faint)' }}>
        <span>{f.flight_date?.slice(0, 10) || '—'}</span>
        <span>{formatDuration(f.flight_duration_sec || f.duration_sec)}{f.idle_before_sec > 0 && <span style={{ color: 'var(--text-faint)', fontSize: 10, marginLeft: 3 }}>+{formatDuration(f.idle_before_sec)} idle</span>}</span>
        <span>{f.max_altitude_m ? `${parseFloat(f.max_altitude_m).toFixed(0)}m` : '—'}</span>
        <span style={{ color: fmtColors[f.log_format] || 'var(--text-muted)', fontWeight: 600, marginLeft: 'auto' }}>{(f.log_format || '?').replace(/_/g, ' ').toUpperCase()}</span>
      </div>
    </div>
  );
};

// ── Module: Statistics ────────────────────────────────────────
const StatsModule = ({ flightData }) => {
  const layout = useLayout();
  const stats = flightData || {};
  const cards = [
    { label: 'Flight Time',    value: stats.flight_duration_sec ? formatDuration(stats.flight_duration_sec) : formatDuration(stats.duration_sec), icon: Clock,         color: '#3B82F6', num: parseFloat(stats.flight_duration_sec || stats.duration_sec || 0), max: 7200 },
    { label: 'Idle Before',    value: stats.idle_before_sec > 0 ? formatDuration(stats.idle_before_sec) : '—', icon: Clock,                          color: '#64748B',    num: parseFloat(stats.idle_before_sec || 0), max: 3600 },
    { label: 'Total Duration', value: formatDuration(stats.duration_sec), icon: Clock,                                                                color: '#475569',    num: parseFloat(stats.duration_sec || 0), max: 7200 },
    { label: 'Max Altitude',   value: stats.max_altitude_m ? `${parseFloat(stats.max_altitude_m).toFixed(1)}m` : '—', icon: MountainSnow,            color: '#10B981',    num: parseFloat(stats.max_altitude_m || 0), max: 400 },
    { label: 'Max Speed',      value: stats.max_speed_ms ? `${parseFloat(stats.max_speed_ms).toFixed(1)} m/s` : '—', icon: Gauge,                    color: '#F59E0B',    num: parseFloat(stats.max_speed_ms || 0), max: 30 },
    { label: 'Max Distance',   value: stats.max_distance_m ? `${parseFloat(stats.max_distance_m).toFixed(0)}m` : '—', icon: Globe,                   color: '#8B5CF6',    num: parseFloat(stats.max_distance_m || 0), max: 2000 },
    { label: 'Total Distance', value: stats.total_distance_m ? `${(parseFloat(stats.total_distance_m)/1000).toFixed(2)}km` : '—', icon: TrendingUp,  color: '#06B6D4',    num: parseFloat(stats.total_distance_m || 0) / 1000, max: 10 },
    { label: 'Min Battery',    value: stats.min_battery_v ? `${parseFloat(stats.min_battery_v).toFixed(2)}V` : '—', icon: Battery,                   color: '#EF4444',    num: parseFloat(stats.min_battery_v || 0), max: 25 },
    { label: 'Warnings',       value: stats.warning_count ?? 0, icon: AlertTriangle,                                                                  color: '#F97316',    num: stats.warning_count ?? 0, max: 10 },
    { label: 'Errors',         value: stats.error_count ?? 0,   icon: AlertCircle,                                                                    color: '#EF4444',    num: stats.error_count ?? 0, max: 5 },
  ];

  if (layout === 'hud') return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'center' }}>
      {cards.map((c, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <RadialGauge value={c.num} max={c.max} label={c.label.toUpperCase()} unit="" color={c.color} size={100} />
          <div style={{ fontSize: 11, color: c.color, fontFamily: 'monospace', marginTop: -4, fontWeight: 700 }}>{c.value}</div>
        </div>
      ))}
    </div>
  );

  if (layout === 'terminal') return (
    <div style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 2 }}>
      <div style={{ color: 'var(--accent)', marginBottom: 4 }}>$ cat flight_{stats.id}.stats</div>
      {cards.map((c, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, color: 'var(--text-secondary)' }}>
          <span style={{ color: 'var(--accent)', minWidth: 160 }}>{c.label.toLowerCase().replace(/ /g,'_')}</span>
          <span style={{ color: 'rgba(255,255,255,0.3)' }}>=</span>
          <span style={{ color: c.color, fontWeight: 700 }}>{c.value}</span>
        </div>
      ))}
    </div>
  );

  if (layout === 'magazine') return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
      {cards.map((c, i) => (
        <div key={i} style={{ borderRadius: 14, padding: '16px 18px', background: `linear-gradient(135deg, ${c.color}20, ${c.color}08)`, border: `1px solid ${c.color}30` }}>
          <c.icon size={20} color={c.color} style={{ marginBottom: 10 }} />
          <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--text-bright)', lineHeight: 1, marginBottom: 4 }}>{c.value}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c.label}</div>
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
      {cards.map((c, i) => (
        <div key={i} style={{ background: `${c.color}15`, border: `1px solid ${c.color}30`, borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <c.icon size={16} color={c.color} />
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace" }}>{c.value}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.label}</div>
        </div>
      ))}
    </div>
  );
};

// ── Module Registry ───────────────────────────────────────────
const ModuleComponents = {
  map:         ({ data, flightData }) => <MapModule data={data} flightData={flightData} />,
  altitude:    ({ data, flightData }) => <AltitudeModule data={data} flightData={flightData} />,
  attitude:    ({ data }) => <AttitudeModule data={data} />,
  speed:       ({ data }) => <SpeedModule data={data} />,
  battery:     ({ data }) => <BatteryModule data={data} />,
  gps_quality: ({ data }) => <GPSQualityModule data={data} />,
  imu:         ({ data }) => <IMUModule data={data} />,
  events:      ({ data }) => <EventsModule data={data} />,
  stats:       ({ data, flightData }) => <StatsModule flightData={flightData} />,
  rc_input:    () => <div style={emptyStyle}>RC data not available for this log</div>,
  replay_3d:   () => <div style={emptyStyle}>3D Replay — requires WebGL</div>,
  video_sync:  ({ flightData, playheadMs, onPlayheadChange, onPlay }) => (
    <VideoSyncModule
      flightId={flightData?.id}
      flightDurationSec={flightData?.duration_sec}
      playheadMs={playheadMs}
      onPlayheadChange={onPlayheadChange}
      onPlay={onPlay}
    />
  ),
};

// ── Module Card ───────────────────────────────────────────────
const ModuleCard = ({ module: mod, data, flightData, onToggle, playheadMs, onPlayheadChange, onPlay }) => {
  const [collapsed, setCollapsed] = useState(false);
  const Comp = ModuleComponents[mod.key];
  const Icon = mod.icon;

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', transition: 'all 0.2s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg-module-header)', cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setCollapsed(c => !c)}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: mod.color, flexShrink: 0 }} />
        <Icon size={15} color={mod.color} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>{mod.label}</span>
        <button onClick={(e) => { e.stopPropagation(); onToggle(mod.key); }} title="Hide module"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-faint)' }}>
          <EyeOff size={13} />
        </button>
        {collapsed ? <ChevronRight size={14} color="#475569" /> : <ChevronDown size={14} color="#475569" />}
      </div>
      {!collapsed && (
        <div style={{ padding: '12px 14px 14px' }}>
          {Comp ? <Comp data={data} flightData={flightData} playheadMs={playheadMs} onPlayheadChange={onPlayheadChange} onPlay={onPlay} /> : <div style={emptyStyle}>Module loading…</div>}
        </div>
      )}
    </div>
  );
};

// ── Module Toggle Panel ───────────────────────────────────────
const ModuleTogglePanel = ({ modules, onToggle }) => (
  <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-input)', borderRadius: 12, padding: 16 }}>
    <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>View Modules</h3>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {modules.map((mod) => {
        const Icon = mod.icon;
        return (
          <label key={mod.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 8, cursor: 'pointer', background: mod.enabled ? `${mod.color}12` : 'transparent', transition: 'background 0.15s' }}>
            <input type="checkbox" checked={mod.enabled} onChange={() => onToggle(mod.key)}
              style={{ accentColor: mod.color, width: 14, height: 14 }} />
            <Icon size={13} color={mod.enabled ? mod.color : 'var(--text-faint)'} />
            <span style={{ fontSize: 12, color: mod.enabled ? 'var(--text-secondary)' : 'var(--text-faint)' }}>{mod.label}</span>
          </label>
        );
      })}
    </div>
  </div>
);

// ── Upload Drop Zone ──────────────────────────────────────────
const UploadZone = ({ onUpload }) => {
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(null);
  const [status, setStatus] = useState(null);
  const inputRef = useRef();
  const { token } = useAuthStore();

  const handle = async (file) => {
    if (!file) return;
    setProgress(0);
    setStatus({ type: 'uploading', msg: 'Uploading log file…' });
    try {
      const fd = new FormData();
      fd.append('log', file);
      const res = await fetch('/api/v1/flights', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const json = await res.json();
      if (json.error) {
        setStatus({ type: 'error', msg: `Error: ${json.error}` });
        return;
      }
      setProgress(50);
      setStatus({ type: 'processing', msg: `Detected: ${json.format || 'unknown'} (${json.format_confidence || '?'}% confidence) — parsing…` });
      // Poll until parse_status is complete or error
      const flightId = json.flight_id;
      let attempts = 0;
      const poll = async () => {
        const r = await fetch(`/api/v1/flights/${flightId}`, { headers: { Authorization: `Bearer ${token}` } });
        const f = await r.json();
        if (f.parse_status === 'complete') {
          setProgress(100);
          setStatus({ type: 'done', msg: `Import complete! ${f.original_filename}` });
          onUpload?.();
        } else if (f.parse_status === 'error') {
          setStatus({ type: 'error', msg: `Parse error: ${f.parse_error || 'unknown'}` });
        } else if (attempts++ < 30) {
          setProgress(50 + attempts * 1.5);
          setTimeout(poll, 1000);
        } else {
          setStatus({ type: 'error', msg: 'Timed out waiting for parse result' });
        }
      };
      if (json.status === 'complete') {
        setProgress(100);
        setStatus({ type: 'done', msg: `Import complete! ${file.name}` });
        onUpload?.();
      } else {
        setTimeout(poll, 1000);
      }
    } catch (e) {
      setStatus({ type: 'error', msg: `Upload failed: ${e.message}` });
    }
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handle(e.dataTransfer.files[0]); }}
      onClick={() => inputRef.current.click()}
      style={{ border: `2px dashed ${dragging ? '#3B82F6' : 'var(--border-tooltip)'}`, borderRadius: 16, padding: '40px 20px', textAlign: 'center', cursor: 'pointer', background: dragging ? 'rgba(59,130,246,0.05)' : 'var(--bg-card)', transition: 'all 0.2s' }}>
      <input ref={inputRef} type="file" accept=".bin,.tlog,.ulg,.ulog,.csv,.txt,.log,.gpx,.kml,.kmz,.bbl,.bfl,.skylog" hidden onChange={(e) => handle(e.target.files[0])} />
      <Upload size={36} color="#3B82F6" style={{ margin: '0 auto 12px' }} />
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>Drop flight log or click to browse</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
        ArduPilot .BIN · MAVLink .TLOG · PX4 .ULG · DJI .TXT/.CSV · GPX · KML · Betaflight .BBL · Skyline .SKYLOG
      </div>
      {status && (
        <div style={{ background: 'var(--border-subtle)', borderRadius: 10, padding: '10px 16px', marginTop: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 8 }}>{status.msg}</div>
          {progress !== null && (
            <div style={{ background: 'var(--border-tooltip)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
              <div style={{ background: '#3B82F6', height: '100%', width: `${progress}%`, transition: 'width 0.5s ease', borderRadius: 4 }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Auth Store (Zustand) ──────────────────────────────────────
import { useAuthStore } from './store.js';

// ── Flight List ───────────────────────────────────────────────
const FlightList = ({ onSelect, refresh }) => {
  const layout = useLayout();
  const [flights, setFlights] = useState([]);
  const [loading, setLoading] = useState(true);
  const { token } = useAuthStore();

  useEffect(() => {
    setLoading(true);
    fetch('/api/v1/flights?limit=50', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setFlights(d.data || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [token, refresh]);

  const fmtColors = { ardupilot_bin: '#10B981', mavlink_tlog: '#3B82F6', px4_ulog: '#8B5CF6', dji_txt: '#F59E0B', dji_csv: '#F97316', skyline_skylog: '#A78BFA', betaflight_bbl: '#EC4899', generic_csv: 'var(--text-muted)' };

  if (loading) return <div style={emptyStyle}>Loading flights…</div>;
  if (!flights.length) return (
    <div style={{ textAlign: 'center', padding: '32px 20px', color: 'var(--text-faint)' }}>
      <Plane size={32} style={{ margin: '0 auto 12px', display: 'block', opacity: 0.3 }} />
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>No flights yet</div>
      <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>Import a log file to get started</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: layout === 'terminal' ? 0 : 6 }}>
      {layout === 'terminal' && (
        <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-faint)', padding: '4px 12px 8px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12 }}>
          <span style={{ minWidth: 90 }}>DATE</span>
          <span style={{ minWidth: 60 }}>DURATION</span>
          <span style={{ minWidth: 50 }}>MAX ALT</span>
          <span style={{ minWidth: 120 }}>FORMAT</span>
          <span>FILENAME</span>
        </div>
      )}
      {flights.map(f => (
        <FlightRow key={f.id} f={f} onSelect={onSelect} fmtColors={fmtColors} />
      ))}
    </div>
  );
};

// ── Auth Screen ───────────────────────────────────────────────
const AuthScreen = () => {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const url = mode === 'login' ? '/api/v1/auth/login' : '/api/v1/auth/register';
      const body = mode === 'login' ? { email, password } : { email, password, display_name: name };
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (json.error) { setError(json.error); return; }
      login(json.token, json.user);
    } catch (e) {
      setError('Connection failed — is the server running?');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--bg-app)', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 380, background: 'var(--bg-panel)', border: '1px solid var(--border-input)', borderRadius: 16, padding: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <div style={{ width: 36, height: 36, background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Plane size={20} color="white" />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-bright)' }}>UAVLogBook</div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>Flight Analysis Platform</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: 'var(--bg-card)', borderRadius: 10, padding: 4 }}>
          {['login','register'].map(m => (
            <button key={m} onClick={() => { setMode(m); setError(''); }}
              style={{ flex: 1, padding: '7px 0', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                background: mode === m ? '#3B82F6' : 'transparent', color: mode === m ? 'white' : 'var(--text-muted)' }}>
              {m === 'login' ? 'Sign In' : 'Register'}
            </button>
          ))}
        </div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mode === 'register' && (
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Display name" required
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-tooltip)', borderRadius: 8, padding: '10px 12px', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }} />
          )}
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" required
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-tooltip)', borderRadius: 8, padding: '10px 12px', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }} />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" required
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-tooltip)', borderRadius: 8, padding: '10px 12px', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }} />
          {error && <div style={{ fontSize: 12, color: '#EF4444', background: '#EF444415', borderRadius: 8, padding: '8px 12px' }}>{error}</div>}
          <button type="submit" disabled={loading}
            style={{ background: '#3B82F6', border: 'none', color: 'white', padding: '11px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700, opacity: loading ? 0.6 : 1 }}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  );
};

// ── Flight Edit Panel ─────────────────────────────────────────
const FlightEditPanel = ({ flight, token, onClose, onSaved }) => {
  const [form, setForm] = useState({
    display_name:  flight.display_name  || '',
    location_name: flight.location_name || '',
    flight_date:   flight.flight_date   ? flight.flight_date.slice(0, 16) : '',
    home_lat:      flight.home_lat      != null ? String(parseFloat(flight.home_lat)) : '',
    home_lng:      flight.home_lng      != null ? String(parseFloat(flight.home_lng)) : '',
    pilot_notes:   flight.pilot_notes   || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const [locating, setLocating] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const useMyLocation = () => {
    if (!navigator.geolocation) { setError('Geolocation not available'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { set('home_lat', pos.coords.latitude.toFixed(6)); set('home_lng', pos.coords.longitude.toFixed(6)); setLocating(false); },
      ()    => { setError('Could not get location'); setLocating(false); }
    );
  };

  const save = async () => {
    setSaving(true); setError('');
    const body = { ...form };
    if (body.home_lat) body.home_lat = parseFloat(body.home_lat);
    if (body.home_lng) body.home_lng = parseFloat(body.home_lng);
    if (!body.home_lat) body.home_lat = null;
    if (!body.home_lng) body.home_lng = null;
    try {
      const r = await fetch(`/api/v1/flights/${flight.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (j.error) { setError(j.error); return; }
      onSaved({ ...flight, ...form, home_lat: body.home_lat, home_lng: body.home_lng });
    } catch { setError('Save failed'); } finally { setSaving(false); }
  };

  const inp = { background: 'var(--bg-input)', border: '1px solid var(--border-input)', borderRadius: 8, padding: '9px 12px', fontSize: 13, color: 'var(--text-primary)', width: '100%', outline: 'none', boxSizing: 'border-box' };
  const label = (text) => <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{text}</div>;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
      {/* Panel */}
      <div style={{ position: 'relative', width: 380, background: 'var(--bg-panel)', borderLeft: '1px solid var(--border-panel)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Edit3 size={16} color="var(--accent)" />
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>Edit Flight</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: 4 }}><X size={18} /></button>
        </div>
        {/* Fields */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            {label('Display Name')}
            <input style={inp} value={form.display_name} onChange={e => set('display_name', e.target.value)} placeholder={flight.original_filename} />
          </div>
          <div>
            {label('Flight Date')}
            <input style={inp} type="datetime-local" value={form.flight_date} onChange={e => set('flight_date', e.target.value)} />
          </div>
          <div>
            {label('Location Name')}
            <input style={inp} value={form.location_name} onChange={e => set('location_name', e.target.value)} placeholder="e.g. My Airfield, Back garden…" />
          </div>
          <div>
            {label('Home Position (GPS)')}
            <CoordInput
              lat={form.home_lat}
              lng={form.home_lng}
              onChange={(la, ln) => { set('home_lat', la); set('home_lng', ln); }}
            />
            <button onClick={useMyLocation} disabled={locating}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12, marginTop: 8 }}>
              <Globe size={13} />{locating ? 'Locating…' : 'Use My Location'}
            </button>
          </div>
          <div>
            {label('Pilot Notes')}
            <textarea style={{ ...inp, resize: 'vertical', minHeight: 80 }} value={form.pilot_notes} onChange={e => set('pilot_notes', e.target.value)} placeholder="Any notes about this flight…" />
          </div>
          {error && <div style={{ fontSize: 12, color: '#EF4444', background: '#EF444415', padding: '8px 12px', borderRadius: 8 }}>{error}</div>}
        </div>
        {/* Footer */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', padding: '10px', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ flex: 2, background: 'var(--accent)', border: 'none', color: '#fff', padding: '10px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main App ──────────────────────────────────────────────────
export default function App() {
  const { isAuthenticated, user, logout, token } = useAuthStore();
  const { theme, setTheme } = useUIStore();
  const [modules, setModules] = useState(defaultModules);
  const [selectedFlight, setSelectedFlight] = useState(null);
  const [flightData, setFlightData] = useState(null);
  const [flightLoading, setFlightLoading] = useState(false);
  const [view, setView] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [uploadRefresh, setUploadRefresh] = useState(0);
  const [dashStats, setDashStats] = useState(null);
  const [playheadMs, setPlayheadMs] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [editingFlight, setEditingFlight] = useState(false);

  const enabledModules = modules.filter(m => m.enabled).sort((a, b) => modules.indexOf(a) - modules.indexOf(b));

  useEffect(() => { applyTheme(theme); }, [theme]);

  // Load dashboard stats
  useEffect(() => {
    if (!isAuthenticated) return;
    fetch('/api/v1/stats', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setDashStats(d))
      .catch(() => {});
  }, [isAuthenticated, token, uploadRefresh]);

  const handleSelectFlight = async (flight) => {
    setSelectedFlight(flight);
    setFlightData(null);
    setPlayheadMs(0);
    setView('flight');
    setFlightLoading(true);
    try {
      const [gpsR, attR, battR, imuR, evR] = await Promise.all([
        fetch(`/api/v1/flights/${flight.id}/gps`,      { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
        fetch(`/api/v1/flights/${flight.id}/attitude`,  { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
        fetch(`/api/v1/flights/${flight.id}/battery`,   { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
        fetch(`/api/v1/flights/${flight.id}/imu`,       { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
        fetch(`/api/v1/flights/${flight.id}/events`,    { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      ]);
      const n = v => (v === null || v === undefined) ? null : parseFloat(v);
      const gps  = (gpsR.telemetry  || []).map(p => ({ t: Math.round(p.t_ms/1000), lat: n(p.lat), lng: n(p.lng), alt_m: n(p.alt_m), alt_amsl_m: n(p.alt_amsl_m), speed_ms: n(p.speed_ms), hdop: n(p.hdop), sats: p.sats, fix_type: p.fix_type }));
      const att  = (attR.telemetry  || []).map(p => ({ t: Math.round(p.t_ms/1000), roll: n(p.roll_deg), pitch: n(p.pitch_deg), yaw: n(p.yaw_deg) }));
      const batt = (battR.telemetry || []).map(p => ({ t: Math.round(p.t_ms/1000), voltage: n(p.voltage_v), current: n(p.current_a), remaining: n(p.remaining_pct) }));
      const imu  = (imuR.telemetry  || []).map(p => ({ t: Math.round(p.t_ms/1000), vx: n(p.vibe_x), vy: n(p.vibe_y), vz: n(p.vibe_z), ax: n(p.accel_x), ay: n(p.accel_y), az: n(p.accel_z) }));
      const alt   = gps.map(p => ({ t: p.t, alt: p.alt_m, alt_gps: p.alt_amsl_m }));
      const speed = gps.map(p => ({ t: p.t, ground: p.speed_ms, vertical: 0 }));
      const gpsQ  = gps.map(p => ({ t: p.t, sats: p.sats, hdop: p.hdop, fix: p.fix_type }));
      const events = (evR.events || evR.telemetry || []).map(e => ({ ...e }));
      setFlightData({ gps, alt, att, speed, batt, gpsQ, imu, events });
    } catch (e) {
      console.error('Failed to load telemetry', e);
    } finally {
      setFlightLoading(false);
    }
  };

  const toggleModule = (key) => {
    setModules(prev => prev.map(m => m.key === key ? { ...m, enabled: !m.enabled } : m));
  };

  if (!isAuthenticated) return <AuthScreen />;

  const totals = dashStats?.totals || {};
  const monthly = (dashStats?.monthly || []).map(m => ({ m: m.m?.slice(0, 7), n: Number(m.cnt) })).reverse();
  const byFormat = dashStats?.byFormat || [];
  const totalFmtCount = byFormat.reduce((s, f) => s + Number(f.cnt), 0) || 1;
  const fmtColors2 = { ardupilot_bin: '#10B981', mavlink_tlog: '#3B82F6', px4_ulog: '#8B5CF6', dji_txt: '#F59E0B', dji_csv: '#F97316', skyline_skylog: '#A78BFA', betaflight_bbl: '#EC4899', generic_csv: 'var(--text-muted)' };

  const layout = themes[theme]?.layout || 'default';

  return (
    <>
    <div style={{ display: 'flex', height: '100vh', background: 'var(--bg-app)', color: 'var(--text-primary)', fontFamily: layout === 'terminal' ? "'JetBrains Mono', 'Fira Code', monospace" : "'Inter', system-ui, sans-serif", overflow: 'hidden' }}>

      {/* Sidebar */}
      <div style={{ width: sidebarOpen ? 260 : 0, minWidth: sidebarOpen ? 260 : 0, background: 'var(--bg-panel)', borderRight: '1px solid var(--border-panel)', overflow: 'hidden', transition: 'width 0.25s ease, min-width 0.25s ease', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Plane size={18} color="white" />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-bright)', letterSpacing: '-0.02em' }}>UAVLogBook</div>
              <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>Flight Analysis Platform</div>
            </div>
          </div>
        </div>
        <nav style={{ padding: '12px 10px', flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {[
            { key: 'dashboard', icon: Home,    label: 'Dashboard' },
            { key: 'upload',    icon: Upload,  label: 'Import Log' },
            { key: 'settings',  icon: Settings,label: 'Settings' },
          ].map(item => (
            <button key={item.key} onClick={() => setView(item.key)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, background: view === item.key ? 'rgba(59,130,246,0.15)' : 'none', border: view === item.key ? '1px solid rgba(59,130,246,0.2)' : '1px solid transparent', color: view === item.key ? '#60A5FA' : 'var(--text-muted)', cursor: 'pointer', width: '100%', textAlign: 'left', fontSize: 13, fontWeight: 500, transition: 'all 0.15s' }}>
              <item.icon size={15} />
              {item.label}
            </button>
          ))}
        </nav>
        <div style={{ padding: '0 10px 12px' }}>
          <ModuleTogglePanel modules={modules} onToggle={toggleModule} />
        </div>
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>
            {(user?.display_name || 'P')[0].toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.display_name || 'Pilot'}</div>
            <div style={{ fontSize: 10, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email}</div>
          </div>
          <button onClick={logout} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: 4 }} title="Logout"><LogOut size={14} /></button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Topbar */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg-panel)' }}>
          <button onClick={() => setSidebarOpen(s => !s)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
            <Menu size={18} />
          </button>
          {view === 'flight' && selectedFlight && (
            <>
              <button onClick={() => setView('dashboard')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                <ArrowLeft size={14} />
              </button>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedFlight.display_name || selectedFlight.original_filename}
              </span>
              <span style={{ fontSize: 11, color: '#F59E0B', background: '#F59E0B15', padding: '2px 8px', borderRadius: 10, fontWeight: 600, flexShrink: 0 }}>{selectedFlight.log_format?.replace(/_/g,' ').toUpperCase()}</span>
              <button onClick={() => setEditingFlight(true)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>
                <Edit3 size={13} /> Edit
              </button>
            </>
          )}
          {view === 'dashboard' && (
            <>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>Dashboard</span>
              <div style={{ flex: 1 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { label: `${totals.flights || 0} Flights`, color: '#3B82F6' },
                  { label: totals.total_time ? `${(parseFloat(totals.total_time)/3600).toFixed(1)}h Air` : '0h Air', color: '#10B981' },
                  { label: totals.total_dist ? `${(parseFloat(totals.total_dist)/1000).toFixed(0)}km` : '0km', color: '#8B5CF6' },
                ].map((s, i) => (
                  <div key={i} style={{ fontSize: 11, color: s.color, background: `${s.color}15`, padding: '4px 10px', borderRadius: 8, fontWeight: 600 }}>{s.label}</div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Content area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

          {/* DASHBOARD VIEW */}
          {view === 'dashboard' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
              <DashboardStats totals={totals} byFormat={byFormat} />

              {/* Flight list */}
              <div style={{ gridColumn: '1 / -1', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)', margin: 0 }}>Recent Flights</h2>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => setView('upload')} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#3B82F6', border: 'none', color: 'white', padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                    <Upload size={13} /> Import Log
                  </button>
                </div>
                <FlightList onSelect={handleSelectFlight} refresh={uploadRefresh} />
              </div>

              {/* Monthly chart */}
              {monthly.length > 0 && (
                <div style={{ gridColumn: '1 / span 2', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px' }}>
                  <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 12 }}>Flights per Month</h3>
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={monthly}>
                      <XAxis dataKey="m" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                      <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-tooltip)', borderRadius: 8 }} />
                      <Bar dataKey="n" fill="#3B82F6" opacity={0.8} radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Format breakdown */}
              {byFormat.length > 0 && (
                <div style={{ gridColumn: monthly.length > 0 ? 'span 2' : '1 / -1', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px' }}>
                  <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 12 }}>Log Formats</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {byFormat.map((f, i) => {
                      const pct = Math.round((Number(f.cnt) / totalFmtCount) * 100);
                      const color = fmtColors2[f.log_format] || 'var(--text-muted)';
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                          <span style={{ width: 120, color: 'var(--text-tertiary)', flexShrink: 0 }}>{(f.log_format || '?').replace(/_/g,' ')}</span>
                          <div style={{ flex: 1, background: 'var(--border-subtle)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4 }} />
                          </div>
                          <span style={{ width: 32, color: 'var(--text-muted)', textAlign: 'right' }}>{f.cnt}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* FLIGHT ANALYSIS VIEW */}
          {view === 'flight' && selectedFlight && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Format</div>
                  <div style={{ fontSize: 13, color: '#F59E0B', fontWeight: 700 }}>{selectedFlight.log_format?.replace(/_/g,' ').toUpperCase()}</div>
                </div>
                {[
                  { label: 'Date',     value: selectedFlight.flight_date?.slice(0,10) || '—' },
                  { label: 'Flight Time', value: formatDuration(selectedFlight.flight_duration_sec || selectedFlight.duration_sec) },
                  { label: 'Idle Before', value: selectedFlight.idle_before_sec > 0 ? formatDuration(selectedFlight.idle_before_sec) : '—' },
                  { label: 'Max Alt',  value: selectedFlight.max_altitude_m ? `${parseFloat(selectedFlight.max_altitude_m).toFixed(0)}m` : '—' },
                  { label: 'Max Speed',value: selectedFlight.max_speed_ms ? `${parseFloat(selectedFlight.max_speed_ms).toFixed(1)}m/s` : '—' },
                  { label: 'Warnings', value: selectedFlight.warning_count ?? 0, color: selectedFlight.warning_count > 0 ? '#F59E0B' : '#10B981' },
                ].map((s, i) => (
                  <div key={i}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: s.color || 'var(--text-secondary)' }}>{s.value}</div>
                  </div>
                ))}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button style={{ ...btnSmallStyle }}><Share2 size={13} /> Share</button>
                </div>
              </div>

              {flightLoading && (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-faint)' }}>
                  <RefreshCw size={24} style={{ margin: '0 auto 12px', display: 'block', animation: 'spin 1s linear infinite' }} />
                  <div>Loading telemetry…</div>
                </div>
              )}

              {!flightLoading && enabledModules.map((mod) => (
                <ModuleCard key={mod.key} module={mod} data={flightData} flightData={selectedFlight} onToggle={toggleModule}
                  playheadMs={playheadMs} onPlayheadChange={setPlayheadMs} onPlay={setIsPlaying} />
              ))}

              {!flightLoading && !enabledModules.length && (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-faint)' }}>
                  <EyeOff size={40} style={{ margin: '0 auto 12px' }} />
                  <div>All modules hidden. Enable modules in the sidebar.</div>
                </div>
              )}
            </div>
          )}

          {/* UPLOAD VIEW */}
          {view === 'upload' && (
            <div style={{ maxWidth: 600, margin: '0 auto' }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>Import Flight Log</h2>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>AI automatically detects the log format and maps all fields — no manual configuration needed.</p>
              <UploadZone onUpload={() => { setUploadRefresh(r => r + 1); setTimeout(() => setView('dashboard'), 1200); }} />
              <div style={{ marginTop: 24, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 18 }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 12 }}>Supported Formats</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[
                    { name: 'ArduPilot DataFlash', ext: '.BIN',    color: '#10B981', detail: 'Self-describing binary, FMT messages' },
                    { name: 'MAVLink Telemetry',   ext: '.TLOG',   color: '#3B82F6', detail: 'Binary MAVLink packet stream' },
                    { name: 'PX4 ULog',            ext: '.ULG',    color: '#8B5CF6', detail: 'Binary ULog v1/v2 format' },
                    { name: 'Skyline',             ext: '.SKYLOG', color: '#A78BFA', detail: 'Skyline GCS — GPS, battery, SBUS, statustext' },
                    { name: 'DJI Flight Record',   ext: '.TXT',    color: '#F59E0B', detail: 'Reverse-engineered binary' },
                    { name: 'DJI/Litchi CSV',      ext: '.CSV',    color: '#F97316', detail: 'DJI GO, Litchi, Map Pilot' },
                    { name: 'Betaflight Blackbox', ext: '.BBL',    color: '#EC4899', detail: 'Betaflight / INAV blackbox' },
                    { name: 'GPX Track',           ext: '.GPX',    color: '#06B6D4', detail: 'GPS Exchange Format XML' },
                    { name: 'Generic CSV',         ext: '.CSV',    color: 'var(--text-muted)', detail: 'Any CSV — AI maps columns' },
                  ].map((f, i) => (
                    <div key={i} style={{ padding: '10px 12px', background: `${f.color}0D`, border: `1px solid ${f.color}25`, borderRadius: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: f.color, fontFamily: 'monospace' }}>{f.ext}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{f.name}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{f.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* SETTINGS */}
          {view === 'settings' && (
            <div style={{ maxWidth: 540 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20, color: 'var(--text-primary)' }}>Settings</h2>

              {/* Account card */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 4 }}>Signed in as</div>
                <div style={{ fontSize: 15, color: 'var(--text-primary)', fontWeight: 700 }}>{user?.display_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{user?.email}</div>
              </div>

              {/* Theme picker */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 14 }}>Theme</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                  {Object.entries(themes).map(([key, t]) => (
                    <button key={key} onClick={() => setTheme(key)}
                      style={{ background: theme === key ? 'var(--accent-bg)' : 'var(--bg-input)', border: `2px solid ${theme === key ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                        {t.preview.map((c, i) => (
                          <div key={i} style={{ width: 22, height: 22, background: c, borderRadius: 5, border: '1px solid rgba(255,255,255,0.15)' }} />
                        ))}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: theme === key ? 'var(--accent)' : 'var(--text-primary)', marginBottom: 2 }}>{t.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{t.description}</div>
                    </button>
                  ))}
                </div>
              </div>

              <button onClick={logout} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#EF444415', border: '1px solid #EF444430', color: '#EF4444', padding: '10px 20px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                <LogOut size={14} /> Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </div>

    {/* Flight edit panel (slide-in overlay) */}
    {editingFlight && selectedFlight && (
      <FlightEditPanel
        flight={selectedFlight}
        token={token}
        onClose={() => setEditingFlight(false)}
        onSaved={(updated) => {
          setSelectedFlight(updated);
          setEditingFlight(false);
        }}
      />
    )}
    </>
  );
}

// ── Helpers ───────────────────────────────────────────────────
function formatDuration(sec) {
  if (!sec) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

const emptyStyle = { padding: '24px 0', textAlign: 'center', fontSize: 12, color: 'var(--text-faint)' };
const btnSmallStyle = { display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--border-panel)', border: '1px solid var(--border-tooltip)', color: 'var(--text-tertiary)', padding: '5px 10px', borderRadius: 7, cursor: 'pointer', fontSize: 12 };
