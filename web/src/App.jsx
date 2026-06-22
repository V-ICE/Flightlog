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
    <div style={{ background: 'rgba(15,20,35,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <p style={{ color: '#94A3B8', marginBottom: 4 }}>{`t = ${label}s`}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color, margin: '2px 0' }}>
          {p.name}: <strong>{p.value}{unit}</strong>
        </p>
      ))}
    </div>
  );
};

// ── Module: Flight Map (Leaflet-style SVG demo) ───────────────
const MapModule = ({ data }) => {
  const gps = data?.gps || [];
  if (!gps.length) return <div style={emptyStyle}>No GPS data available</div>;

  const lats = gps.map(p => p.lat), lngs = gps.map(p => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const pad = 0.0005;
  const W = 600, H = 300;

  const toX = (lng) => ((lng - minLng + pad) / (maxLng - minLng + 2*pad)) * W;
  const toY = (lat) => H - ((lat - minLat + pad) / (maxLat - minLat + 2*pad)) * H;

  const pathD = gps.map((p, i) => `${i===0?'M':'L'}${toX(p.lng).toFixed(1)},${toY(p.lat).toFixed(1)}`).join(' ');

  // Color by altitude
  const maxAlt = Math.max(...gps.map(p => p.alt_m || 0));

  return (
    <div style={{ background: '#0F1729', borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 10, display: 'flex', gap: 6 }}>
        {['Satellite','Terrain','Streets'].map(s => (
          <button key={s} style={{ ...btnSmallStyle, background: s === 'Satellite' ? '#3B82F6' : 'rgba(255,255,255,0.1)' }}>{s}</button>
        ))}
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        {/* Background grid */}
        <rect width={W} height={H} fill="#0D1B2A" />
        {Array.from({length: 8}, (_,i) => (
          <g key={i}>
            <line x1={i*W/7} y1={0} x2={i*W/7} y2={H} stroke="rgba(255,255,255,0.04)" />
            <line x1={0} y1={i*H/7} x2={W} y2={i*H/7} stroke="rgba(255,255,255,0.04)" />
          </g>
        ))}
        {/* Altitude-colored path segments */}
        {gps.slice(0, -1).map((p, i) => {
          const hue = 120 - (p.alt_m / maxAlt) * 120;
          return (
            <line key={i}
              x1={toX(p.lng)} y1={toY(p.lat)}
              x2={toX(gps[i+1].lng)} y2={toY(gps[i+1].lat)}
              stroke={`hsl(${hue},80%,55%)`} strokeWidth={2.5} strokeLinecap="round"
            />
          );
        })}
        {/* Home marker */}
        <circle cx={toX(gps[0].lng)} cy={toY(gps[0].lat)} r={7} fill="#10B981" opacity={0.9} />
        <text x={toX(gps[0].lng)+10} y={toY(gps[0].lat)+4} fill="#10B981" fontSize={11}>HOME</text>
        {/* Last position */}
        <circle cx={toX(gps[gps.length-1].lng)} cy={toY(gps[gps.length-1].lat)} r={7} fill="#EF4444" opacity={0.9} />
        <text x={toX(gps[gps.length-1].lng)+10} y={toY(gps[gps.length-1].lat)+4} fill="#EF4444" fontSize={11}>LAND</text>
      </svg>
      {/* Altitude legend */}
      <div style={{ position: 'absolute', bottom: 8, right: 8, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,0.6)', padding: '4px 10px', borderRadius: 6 }}>
        <span style={{ fontSize: 10, color: '#64748B' }}>0m</span>
        <div style={{ width: 60, height: 8, borderRadius: 4, background: 'linear-gradient(to right, hsl(120,80%,55%), hsl(0,80%,55%))' }} />
        <span style={{ fontSize: 10, color: '#64748B' }}>{maxAlt.toFixed(0)}m</span>
      </div>
    </div>
  );
};

// ── Module: Altitude ─────────────────────────────────────────
const AltitudeModule = ({ data }) => (
  <ResponsiveContainer width="100%" height={200}>
    <AreaChart data={data?.alt || []} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
      <defs>
        <linearGradient id="altGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
          <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
        </linearGradient>
      </defs>
      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
      <XAxis dataKey="t" tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={v => `${v}s`} />
      <YAxis tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={v => `${v}m`} />
      <Tooltip content={<ChartTooltip unit="m" />} />
      <Legend wrapperStyle={{ color: '#94A3B8', fontSize: 12 }} />
      <Area type="monotone" dataKey="alt" name="Baro Alt" stroke="#10B981" fill="url(#altGrad)" strokeWidth={2} dot={false} />
      <Area type="monotone" dataKey="alt_gps" name="GPS Alt" stroke="#06B6D4" fill="none" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
      <Brush dataKey="t" height={20} stroke="#1E293B" fill="#0F172A" travellerWidth={6} />
    </AreaChart>
  </ResponsiveContainer>
);

// ── Module: Attitude ──────────────────────────────────────────
const AttitudeModule = ({ data }) => (
  <ResponsiveContainer width="100%" height={200}>
    <LineChart data={data?.att || []} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
      <XAxis dataKey="t" tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={v => `${v}s`} />
      <YAxis tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={v => `${v}°`} domain={[-180, 180]} />
      <Tooltip content={<ChartTooltip unit="°" />} />
      <Legend wrapperStyle={{ color: '#94A3B8', fontSize: 12 }} />
      <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" />
      <Line type="monotone" dataKey="roll"  name="Roll"  stroke="#8B5CF6" strokeWidth={1.5} dot={false} />
      <Line type="monotone" dataKey="pitch" name="Pitch" stroke="#EC4899" strokeWidth={1.5} dot={false} />
      <Line type="monotone" dataKey="yaw"   name="Yaw"   stroke="#F59E0B" strokeWidth={1.5} dot={false} />
      <Brush dataKey="t" height={20} stroke="#1E293B" fill="#0F172A" travellerWidth={6} />
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
      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
      <XAxis dataKey="t" tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={v => `${v}s`} />
      <YAxis tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={v => `${v}m/s`} />
      <Tooltip content={<ChartTooltip unit="m/s" />} />
      <Legend wrapperStyle={{ color: '#94A3B8', fontSize: 12 }} />
      <Area type="monotone" dataKey="ground"   name="Ground Speed" stroke="#F59E0B" fill="url(#speedGrad)" strokeWidth={2} dot={false} />
      <Line type="monotone" dataKey="vertical" name="Vert Speed"   stroke="#06B6D4" strokeWidth={1.5} dot={false} />
      <Brush dataKey="t" height={20} stroke="#1E293B" fill="#0F172A" travellerWidth={6} />
    </AreaChart>
  </ResponsiveContainer>
);

// ── Module: Battery ───────────────────────────────────────────
const BatteryModule = ({ data }) => (
  <ResponsiveContainer width="100%" height={200}>
    <LineChart data={data?.batt || []} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
      <XAxis dataKey="t" tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={v => `${v}s`} />
      <YAxis yAxisId="left"  tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={v => `${v}V`} domain={[12, 18]} />
      <YAxis yAxisId="right" orientation="right" tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={v => `${v}%`} domain={[0, 100]} />
      <Tooltip content={<ChartTooltip />} />
      <Legend wrapperStyle={{ color: '#94A3B8', fontSize: 12 }} />
      <ReferenceLine yAxisId="left" y={14.8} stroke="#EF4444" strokeDasharray="4 2" label={{ value: 'Low', fill: '#EF4444', fontSize: 10 }} />
      <Line yAxisId="left"  type="monotone" dataKey="voltage"   name="Voltage (V)"    stroke="#EF4444" strokeWidth={2} dot={false} />
      <Line yAxisId="right" type="monotone" dataKey="remaining" name="Remaining (%)"  stroke="#F97316" strokeWidth={1.5} dot={false} />
      <Line yAxisId="left"  type="monotone" dataKey="current"   name="Current (A)"    stroke="#A78BFA" strokeWidth={1.5} dot={false} />
      <Brush dataKey="t" height={20} stroke="#1E293B" fill="#0F172A" travellerWidth={6} />
    </LineChart>
  </ResponsiveContainer>
);

// ── Module: GPS Quality ───────────────────────────────────────
const GPSQualityModule = ({ data }) => (
  <ResponsiveContainer width="100%" height={200}>
    <BarChart data={data?.gpsQ || []} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
      <XAxis dataKey="t" tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={v => `${v}s`} interval="preserveStartEnd" />
      <YAxis yAxisId="left"  tick={{ fill: '#64748B', fontSize: 11 }} label={{ value: 'Sats', fill:'#64748B', fontSize:10, angle:-90, position:'insideLeft' }} />
      <YAxis yAxisId="right" orientation="right" tick={{ fill: '#64748B', fontSize: 11 }} label={{ value: 'HDOP', fill:'#64748B', fontSize:10, angle:90, position:'insideRight' }} domain={[0, 3]} />
      <Tooltip content={<ChartTooltip />} />
      <Legend wrapperStyle={{ color: '#94A3B8', fontSize: 12 }} />
      <Bar     yAxisId="left"  dataKey="sats" name="Satellites" fill="#06B6D4" opacity={0.7} />
      <Line    yAxisId="right" type="monotone" dataKey="hdop" name="HDOP" stroke="#F59E0B" strokeWidth={2} dot={false} />
    </BarChart>
  </ResponsiveContainer>
);

// ── Module: IMU / Vibration ────────────────────────────────────
const IMUModule = ({ data }) => (
  <ResponsiveContainer width="100%" height={200}>
    <LineChart data={data?.imu || []} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
      <XAxis dataKey="t" tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={v => `${v}s`} />
      <YAxis tick={{ fill: '#64748B', fontSize: 11 }} />
      <Tooltip content={<ChartTooltip />} />
      <Legend wrapperStyle={{ color: '#94A3B8', fontSize: 12 }} />
      <Line type="monotone" dataKey="vx" name="Vibe X" stroke="#EC4899" strokeWidth={1.5} dot={false} />
      <Line type="monotone" dataKey="vy" name="Vibe Y" stroke="#8B5CF6" strokeWidth={1.5} dot={false} />
      <Line type="monotone" dataKey="vz" name="Vibe Z" stroke="#06B6D4" strokeWidth={1.5} dot={false} />
      <Brush dataKey="t" height={20} stroke="#1E293B" fill="#0F172A" travellerWidth={6} />
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
            <span style={{ fontSize: 11, color: '#94A3B8', width: 55, flexShrink: 0 }}>{tSec}s</span>
            <span style={{ fontSize: 12, color: '#E2E8F0' }}>{ev.description}</span>
            <span style={{ fontSize: 10, color: color, marginLeft: 'auto', textTransform: 'uppercase', fontWeight: 600 }}>{ev.severity}</span>
          </div>
        );
      })}
      {!events.length && <div style={emptyStyle}>No events recorded</div>}
    </div>
  );
};

// ── Module: Statistics ────────────────────────────────────────
const StatsModule = ({ flightData }) => {
  const stats = flightData || {};
  const cards = [
    { label: 'Duration',       value: formatDuration(stats.duration_sec || 598), icon: Clock,     color: '#3B82F6' },
    { label: 'Max Altitude',   value: `${stats.max_altitude_m?.toFixed(1) || '120.0'}m`, icon: MountainSnow, color: '#10B981' },
    { label: 'Max Speed',      value: `${stats.max_speed_ms?.toFixed(1) || '12.4'} m/s`, icon: Gauge,    color: '#F59E0B' },
    { label: 'Max Distance',   value: `${stats.max_distance_m?.toFixed(0) || '380'}m`,  icon: Globe,    color: '#8B5CF6' },
    { label: 'Total Distance', value: `${((stats.total_distance_m || 1850)/1000).toFixed(2)}km`, icon: TrendingUp, color: '#06B6D4' },
    { label: 'Min Battery',    value: `${stats.min_battery_v?.toFixed(2) || '14.2'}V`,  icon: Battery,  color: '#EF4444' },
    { label: 'Warnings',       value: stats.warning_count ?? 1, icon: AlertTriangle, color: '#F97316' },
    { label: 'Errors',         value: stats.error_count ?? 0,   icon: AlertCircle,   color: '#EF4444' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
      {cards.map((c, i) => (
        <div key={i} style={{ background: `${c.color}15`, border: `1px solid ${c.color}30`, borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <c.icon size={16} color={c.color} />
          <div style={{ fontSize: 18, fontWeight: 700, color: '#E2E8F0', fontFamily: "'JetBrains Mono', monospace" }}>{c.value}</div>
          <div style={{ fontSize: 11, color: '#64748B' }}>{c.label}</div>
        </div>
      ))}
    </div>
  );
};

// ── Module Registry ───────────────────────────────────────────
const ModuleComponents = {
  map:         ({ data }) => <MapModule data={data} />,
  altitude:    ({ data }) => <AltitudeModule data={data} />,
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
    <div style={{ background: '#0F172A', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden', transition: 'all 0.2s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'rgba(255,255,255,0.02)', cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setCollapsed(c => !c)}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: mod.color, flexShrink: 0 }} />
        <Icon size={15} color={mod.color} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#CBD5E1' }}>{mod.label}</span>
        <button onClick={(e) => { e.stopPropagation(); onToggle(mod.key); }} title="Hide module"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#475569' }}>
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
  <div style={{ background: '#0F172A', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 16 }}>
    <h3 style={{ fontSize: 13, fontWeight: 700, color: '#94A3B8', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>View Modules</h3>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {modules.map((mod) => {
        const Icon = mod.icon;
        return (
          <label key={mod.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 8, cursor: 'pointer', background: mod.enabled ? `${mod.color}12` : 'transparent', transition: 'background 0.15s' }}>
            <input type="checkbox" checked={mod.enabled} onChange={() => onToggle(mod.key)}
              style={{ accentColor: mod.color, width: 14, height: 14 }} />
            <Icon size={13} color={mod.enabled ? mod.color : '#475569'} />
            <span style={{ fontSize: 12, color: mod.enabled ? '#CBD5E1' : '#475569' }}>{mod.label}</span>
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

  const handle = (file) => {
    if (!file) return;
    setProgress(0);
    setStatus({ type: 'analyzing', msg: '🤖 AI analyzing log format…' });
    // Simulate AI detection
    setTimeout(() => setStatus({ type: 'detecting', msg: `✅ Detected: ArduPilot BIN (98% confidence)` }), 800);
    setTimeout(() => { setProgress(35); setStatus({ type: 'parsing', msg: '⚙️ Parsing telemetry data…' }); }, 1200);
    setTimeout(() => { setProgress(70); setStatus({ type: 'storing', msg: '💾 Storing flight data…' }); }, 2200);
    setTimeout(() => { setProgress(100); setStatus({ type: 'done', msg: `✅ Import complete! ${file.name}` }); onUpload?.(); }, 3500);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handle(e.dataTransfer.files[0]); }}
      onClick={() => inputRef.current.click()}
      style={{ border: `2px dashed ${dragging ? '#3B82F6' : 'rgba(255,255,255,0.1)'}`, borderRadius: 16, padding: '40px 20px', textAlign: 'center', cursor: 'pointer', background: dragging ? 'rgba(59,130,246,0.05)' : '#0F172A', transition: 'all 0.2s' }}>
      <input ref={inputRef} type="file" accept=".bin,.tlog,.ulg,.ulog,.csv,.txt,.log,.gpx,.kml,.kmz,.bbl,.bfl,.skylog" hidden onChange={(e) => handle(e.target.files[0])} />
      <Upload size={36} color="#3B82F6" style={{ margin: '0 auto 12px' }} />
      <div style={{ fontSize: 15, fontWeight: 600, color: '#E2E8F0', marginBottom: 6 }}>Drop flight log or click to browse</div>
      <div style={{ fontSize: 12, color: '#64748B', marginBottom: 16 }}>
        ArduPilot .BIN · MAVLink .TLOG · PX4 .ULG · DJI .TXT/.CSV · GPX · KML · Betaflight .BBL · Skyline .SKYLOG
      </div>
      {status && (
        <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: '10px 16px', marginTop: 12 }}>
          <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 8 }}>{status.msg}</div>
          {progress !== null && (
            <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
              <div style={{ background: '#3B82F6', height: '100%', width: `${progress}%`, transition: 'width 0.5s ease', borderRadius: 4 }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Flight List ───────────────────────────────────────────────
const FlightList = ({ onSelect }) => {
  const flights = [
    { id: 1, name: 'DJIFlightRecord_2025-05-15.txt', format: 'dji_txt', date: '2025-05-15', duration: 598, altitude: 120, status: 'complete', warnings: 1 },
    { id: 2, name: '2025-05-10-ArduCopter.BIN', format: 'ardupilot_bin', date: '2025-05-10', duration: 1240, altitude: 85, status: 'complete', warnings: 0 },
    { id: 3, name: 'px4_log_2025-05-01.ulg', format: 'px4_ulog', date: '2025-05-01', duration: 445, altitude: 60, status: 'complete', warnings: 2 },
    { id: 4, name: 'survey_mission.tlog', format: 'mavlink_tlog', date: '2025-04-28', duration: 3600, altitude: 110, status: 'complete', warnings: 0 },
    { id: 5, name: 'betaflight_session.bbl', format: 'betaflight_bbl', date: '2025-04-22', duration: 180, altitude: 25, status: 'complete', warnings: 3 },
  ];

  const fmtColors = { ardupilot_bin: '#10B981', mavlink_tlog: '#3B82F6', px4_ulog: '#8B5CF6', dji_txt: '#F59E0B', dji_csv: '#F97316', skyline_skylog: '#A78BFA', betaflight_bbl: '#EC4899', generic_csv: '#64748B' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {flights.map(f => (
        <div key={f.id} onClick={() => onSelect(f)}
          style={{ background: '#0F172A', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '12px 14px', cursor: 'pointer', transition: 'border-color 0.15s' }}
          onMouseEnter={e => e.currentTarget.style.borderColor = '#3B82F650'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Plane size={13} color={fmtColors[f.format] || '#64748B'} />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#CBD5E1', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
            {f.warnings > 0 && <span style={{ fontSize: 10, background: '#F59E0B20', color: '#F59E0B', padding: '2px 7px', borderRadius: 10, fontWeight: 600 }}>{f.warnings}⚠</span>}
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#475569' }}>
            <span>{f.date}</span>
            <span>{formatDuration(f.duration)}</span>
            <span>{f.altitude}m</span>
            <span style={{ color: fmtColors[f.format] || '#64748B', fontWeight: 600, marginLeft: 'auto' }}>{f.format.replace('_', ' ').toUpperCase()}</span>
          </div>
        </div>
      ))}
    </div>
  );
};

// ── Main App ──────────────────────────────────────────────────
export default function App() {
  const [modules, setModules] = useState(defaultModules);
  const [selectedFlight, setSelectedFlight] = useState(null);
  const [flightData, setFlightData] = useState(null);
  const [view, setView] = useState('dashboard'); // dashboard | flight | upload | settings
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [uploadRefresh, setUploadRefresh] = useState(0);
  // Shared playhead: ms from log start — drives all modules + video sync in sync
  const [playheadMs, setPlayheadMs] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const enabledModules = modules.filter(m => m.enabled).sort((a, b) => modules.indexOf(a) - modules.indexOf(b));

  const handleSelectFlight = (flight) => {
    setSelectedFlight(flight);
    setFlightData(generateFlightData());
    setPlayheadMs(0);
    setView('flight');
  };

  const toggleModule = (key) => {
    setModules(prev => prev.map(m => m.key === key ? { ...m, enabled: !m.enabled } : m));
  };

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#060D1A', color: '#E2E8F0', fontFamily: "'Inter', system-ui, sans-serif", overflow: 'hidden' }}>

      {/* Sidebar */}
      <div style={{ width: sidebarOpen ? 260 : 0, minWidth: sidebarOpen ? 260 : 0, background: '#0A1628', borderRight: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden', transition: 'width 0.25s ease, min-width 0.25s ease', display: 'flex', flexDirection: 'column' }}>
        {/* Logo */}
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Plane size={18} color="white" />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#F1F5F9', letterSpacing: '-0.02em' }}>UAVLogBook</div>
              <div style={{ fontSize: 10, color: '#475569' }}>Flight Analysis Platform</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ padding: '12px 10px', flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {[
            { key: 'dashboard', icon: Home,   label: 'Dashboard' },
            { key: 'upload',    icon: Upload,  label: 'Import Log' },
            { key: 'aircraft',  icon: Plane,   label: 'Aircraft' },
            { key: 'settings',  icon: Settings,label: 'Settings' },
          ].map(item => (
            <button key={item.key} onClick={() => setView(item.key)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, background: view === item.key ? 'rgba(59,130,246,0.15)' : 'none', border: view === item.key ? '1px solid rgba(59,130,246,0.2)' : '1px solid transparent', color: view === item.key ? '#60A5FA' : '#64748B', cursor: 'pointer', width: '100%', textAlign: 'left', fontSize: 13, fontWeight: 500, transition: 'all 0.15s' }}>
              <item.icon size={15} />
              {item.label}
            </button>
          ))}
        </nav>

        {/* Module toggles in sidebar */}
        <div style={{ padding: '0 10px 12px' }}>
          <ModuleTogglePanel modules={modules} onToggle={toggleModule} />
        </div>

        {/* User */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>P</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#CBD5E1' }}>Pilot</div>
            <div style={{ fontSize: 10, color: '#475569' }}>admin@uavlog.com</div>
          </div>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', padding: 4 }} title="Logout"><LogOut size={14} /></button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Topbar */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: 12, background: '#0A1628' }}>
          <button onClick={() => setSidebarOpen(s => !s)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: 4 }}>
            <Menu size={18} />
          </button>

          {view === 'flight' && selectedFlight && (
            <>
              <button onClick={() => setView('dashboard')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: 4, display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                <ArrowLeft size={14} />
              </button>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#CBD5E1' }}>{selectedFlight.name}</span>
              <span style={{ fontSize: 11, color: '#F59E0B', background: '#F59E0B15', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>{selectedFlight.format?.replace('_',' ').toUpperCase()}</span>
            </>
          )}

          {view === 'dashboard' && (
            <>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#CBD5E1' }}>Dashboard</span>
              <div style={{ flex: 1 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { label: '47 Flights', color: '#3B82F6' },
                  { label: '38.5h Air', color: '#10B981' },
                  { label: '214 km', color: '#8B5CF6' },
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
              {/* Summary cards */}
              {[
                { label: 'Total Flights', value: 47, icon: Plane, color: '#3B82F6' },
                { label: 'Air Time',      value: '38.5h', icon: Clock, color: '#10B981' },
                { label: 'Formats',       value: '6',    icon: Layers, color: '#8B5CF6' },
                { label: 'Distance',      value: '214km', icon: Globe, color: '#F59E0B' },
              ].map((c, i) => (
                <div key={i} style={{ background: '#0F172A', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 11, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c.label}</span>
                    <c.icon size={16} color={c.color} />
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: '#F1F5F9', fontFamily: "'JetBrains Mono', monospace" }}>{c.value}</div>
                </div>
              ))}

              {/* Flight list — spans full width */}
              <div style={{ gridColumn: '1 / -1', background: '#0F172A', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <h2 style={{ fontSize: 14, fontWeight: 700, color: '#CBD5E1', margin: 0 }}>Recent Flights</h2>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => setView('upload')} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#3B82F6', border: 'none', color: 'white', padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                    <Upload size={13} /> Import Log
                  </button>
                </div>
                <FlightList onSelect={handleSelectFlight} />
              </div>

              {/* Mini charts */}
              <div style={{ gridColumn: '1 / span 2', background: '#0F172A', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px' }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: '#94A3B8', marginBottom: 12 }}>Flights per Month</h3>
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={[{m:'Jan',n:3},{m:'Feb',n:5},{m:'Mar',n:4},{m:'Apr',n:8},{m:'May',n:12},{m:'Jun',n:6}]}>
                    <XAxis dataKey="m" tick={{ fill: '#64748B', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#64748B', fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: '#0F172A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                    <Bar dataKey="n" fill="#3B82F6" opacity={0.8} radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div style={{ gridColumn: 'span 2', background: '#0F172A', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px' }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: '#94A3B8', marginBottom: 12 }}>Log Formats</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { fmt: 'ArduPilot BIN', pct: 38, color: '#10B981' },
                    { fmt: 'DJI TXT',       pct: 28, color: '#F59E0B' },
                    { fmt: 'PX4 ULog',      pct: 18, color: '#8B5CF6' },
                    { fmt: 'MAVLink TLOG',  pct: 10, color: '#3B82F6' },
                    { fmt: 'Betaflight',    pct: 6,  color: '#EC4899' },
                  ].map((f, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                      <span style={{ width: 100, color: '#94A3B8', flexShrink: 0 }}>{f.fmt}</span>
                      <div style={{ flex: 1, background: 'rgba(255,255,255,0.05)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                        <div style={{ width: `${f.pct}%`, height: '100%', background: f.color, borderRadius: 4 }} />
                      </div>
                      <span style={{ width: 32, color: '#64748B', textAlign: 'right' }}>{f.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* FLIGHT ANALYSIS VIEW */}
          {view === 'flight' && selectedFlight && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Flight summary bar */}
              <div style={{ background: '#0F172A', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 11, color: '#64748B' }}>Format</div>
                  <div style={{ fontSize: 13, color: '#F59E0B', fontWeight: 700 }}>{selectedFlight.format?.replace('_',' ').toUpperCase()}</div>
                </div>
                {[
                  { label: 'Date', value: selectedFlight.date },
                  { label: 'Duration', value: formatDuration(selectedFlight.duration) },
                  { label: 'Max Alt', value: `${selectedFlight.altitude}m` },
                  { label: 'Warnings', value: selectedFlight.warnings, color: selectedFlight.warnings > 0 ? '#F59E0B' : '#10B981' },
                ].map((s, i) => (
                  <div key={i}>
                    <div style={{ fontSize: 11, color: '#64748B' }}>{s.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: s.color || '#CBD5E1' }}>{s.value}</div>
                  </div>
                ))}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button style={{ ...btnSmallStyle }}><Share2 size={13} /> Share</button>
                  <button style={{ ...btnSmallStyle }}><Download size={13} /> Export</button>
                </div>
              </div>

              {/* Enabled modules */}
              {enabledModules.map((mod) => (
                <ModuleCard key={mod.key} module={mod} data={flightData} flightData={selectedFlight} onToggle={toggleModule}
                  playheadMs={playheadMs} onPlayheadChange={setPlayheadMs} onPlay={setIsPlaying} />
              ))}

              {!enabledModules.length && (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: '#475569' }}>
                  <EyeOff size={40} style={{ margin: '0 auto 12px' }} />
                  <div>All modules hidden. Enable modules in the sidebar.</div>
                </div>
              )}
            </div>
          )}

          {/* UPLOAD VIEW */}
          {view === 'upload' && (
            <div style={{ maxWidth: 600, margin: '0 auto' }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#E2E8F0', marginBottom: 6 }}>Import Flight Log</h2>
              <p style={{ fontSize: 13, color: '#64748B', marginBottom: 20 }}>AI automatically detects the log format and maps all fields — no manual configuration needed.</p>
              <UploadZone onUpload={() => setTimeout(() => setView('dashboard'), 1000)} />

              <div style={{ marginTop: 24, background: '#0F172A', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 18 }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: '#94A3B8', marginBottom: 12 }}>Supported Formats</h3>
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
                    { name: 'Generic CSV',         ext: '.CSV',    color: '#64748B', detail: 'Any CSV — AI maps columns' },
                  ].map((f, i) => (
                    <div key={i} style={{ padding: '10px 12px', background: `${f.color}0D`, border: `1px solid ${f.color}25`, borderRadius: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: f.color, fontFamily: 'monospace' }}>{f.ext}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#CBD5E1' }}>{f.name}</span>
                      </div>
                      <div style={{ fontSize: 11, color: '#475569' }}>{f.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* SETTINGS */}
          {view === 'settings' && (
            <div style={{ maxWidth: 500 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20, color: '#E2E8F0' }}>Settings</h2>
              {[
                { label: 'API Server URL', placeholder: 'https://yourdomain.com/api/v1', type: 'url' },
                { label: 'Anthropic API Key (for AI import)', placeholder: 'sk-ant-...', type: 'password' },
              ].map((f, i) => (
                <div key={i} style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 12, color: '#94A3B8', marginBottom: 6, fontWeight: 600 }}>{f.label}</label>
                  <input type={f.type} placeholder={f.placeholder} style={{ width: '100%', background: '#0F172A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '9px 12px', color: '#E2E8F0', fontSize: 13, boxSizing: 'border-box' }} />
                </div>
              ))}
              <button style={{ background: '#3B82F6', border: 'none', color: 'white', padding: '10px 24px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Save Settings</button>
            </div>
          )}
        </div>
      </div>
    </div>
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

const emptyStyle = { padding: '24px 0', textAlign: 'center', fontSize: 12, color: '#475569' };
const btnSmallStyle = { display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#94A3B8', padding: '5px 10px', borderRadius: 7, cursor: 'pointer', fontSize: 12 };
