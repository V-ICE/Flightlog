// ============================================================
// UAVLogBook — FPV Video Sync Component
// Handles: video upload, auto-sync display, manual correction,
//          synchronized playback with telemetry timeline.
// ============================================================
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Video, Upload, Clock, AlertTriangle, CheckCircle,
  AlertCircle, Play, Pause, SkipBack, SkipForward,
  ChevronLeft, ChevronRight, Minus, Plus, Trash2,
  RefreshCw, ZapOff, Zap, Info, X, Film
} from 'lucide-react';
import { getFlightVideos, uploadFlightVideo, updateVideoSync, deleteVideo } from './api';

// ── Colour tokens ─────────────────────────────────────────────
const C = {
  bg:      '#060D1A',
  surface: '#0F172A',
  card:    '#0A1628',
  border:  'rgba(255,255,255,0.08)',
  primary: '#3B82F6',
  success: '#10B981',
  warning: '#F59E0B',
  error:   '#EF4444',
  purple:  '#8B5CF6',
  text:    '#E2E8F0',
  muted:   '#64748B',
  subtle:  '#CBD5E1',
};

// ── Sync status badge ─────────────────────────────────────────
const SyncBadge = ({ status, confidence, method }) => {
  const config = {
    auto:    { icon: Zap,          color: C.success, label: 'Auto-synced' },
    manual:  { icon: CheckCircle,  color: C.primary, label: 'Manually synced' },
    failed:  { icon: ZapOff,       color: C.warning, label: 'Sync failed — manual required' },
    pending: { icon: RefreshCw,    color: C.muted,   label: 'Pending sync' },
  };
  const cfg = config[status] || config.pending;
  const Icon = cfg.icon;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px',
                  background: cfg.color + '18', border: `1px solid ${cfg.color}35`,
                  borderRadius: 20, fontSize: 11, fontWeight: 600 }}>
      <Icon size={12} color={cfg.color} />
      <span style={{ color: cfg.color }}>{cfg.label}</span>
      {confidence != null && status === 'auto' &&
        <span style={{ color: C.muted }}>· {confidence}%</span>}
      {method && method !== 'none' &&
        <span style={{ color: C.muted, fontFamily: 'monospace' }}>· {method}</span>}
    </div>
  );
};

// ── Format time helper ────────────────────────────────────────
const fmtTime = (sec) => {
  if (sec == null || isNaN(sec)) return '0:00.0';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = (sec % 60).toFixed(1);
  return h > 0
    ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(4,'0')}`
    : `${m}:${String(s).padStart(4,'0')}`;
};

// ── Upload panel ──────────────────────────────────────────────
const VideoUploadPanel = ({ flightId, onUploaded }) => {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef();

  const handle = async (file) => {
    if (!file) return;
    setError('');
    setUploading(true);
    setProgress(0);
    setStatus('Uploading…');

    const fd = new FormData();
    fd.append('video', file);

    try {
      const res = await uploadFlightVideo(flightId, fd, (pct) => {
        setProgress(pct);
        setStatus(pct < 100 ? `Uploading… ${pct}%` : 'Processing metadata…');
      });
      const data = res.data;
      setStatus(`Done! Sync: ${data.sync_status} via ${data.sync_method || 'unknown'}`);
      setTimeout(() => onUploaded(data), 800);
    } catch (e) {
      setError(e.response?.data?.error || 'Upload failed');
    }
    setUploading(false);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handle(e.dataTransfer.files[0]); }}
      onClick={() => !uploading && inputRef.current.click()}
      style={{
        border: `2px dashed ${dragging ? C.primary : C.border}`,
        borderRadius: 14, padding: '32px 20px', textAlign: 'center',
        cursor: uploading ? 'default' : 'pointer',
        background: dragging ? C.primary + '08' : C.surface,
        transition: 'all 0.2s',
      }}>
      <input ref={inputRef} type="file"
        accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm,.mp4,.mov,.avi,.mkv,.webm,.mpg,.3gp"
        hidden onChange={(e) => handle(e.target.files[0])} />

      <Film size={36} color={C.primary} style={{ margin: '0 auto 10px' }} />
      <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 4 }}>
        {uploading ? status : 'Drop FPV video or click to browse'}
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>
        MP4 · MOV · AVI · MKV · WebM · up to 8 GB
      </div>

      {uploading && (
        <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 8, height: 8,
                      overflow: 'hidden', margin: '0 auto', maxWidth: 300 }}>
          <div style={{ width: `${progress}%`, height: '100%', background: C.primary,
                        borderRadius: 8, transition: 'width 0.3s ease' }} />
        </div>
      )}
      {error && (
        <div style={{ marginTop: 10, fontSize: 12, color: C.error,
                      background: C.error + '15', padding: '6px 12px', borderRadius: 8 }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: 14, fontSize: 11, color: C.muted, lineHeight: 1.7 }}>
        <div style={{ fontWeight: 600, color: C.subtle, marginBottom: 4 }}>Auto time-sync attempts:</div>
        <div>① MP4 creation_time metadata atom (GoPro, DJI, Insta360, RunCam)</div>
        <div>② Timestamp embedded in filename (DJI_20250525_143022.mp4)</div>
        <div>③ Manual correction with frame-accurate slider</div>
      </div>
    </div>
  );
};

// ── Main FPV Video Sync Module ────────────────────────────────
export const VideoSyncModule = ({ flightId, flightDurationSec, playheadMs, onPlayheadChange, onPlay }) => {
  const [videos, setVideos]           = useState([]);
  const [loading, setLoading]         = useState(true);
  const [activeVideo, setActiveVideo] = useState(null);

  // Video playback state
  const videoRef      = useRef();
  const [playing, setPlaying]         = useState(false);
  const [videoTime, setVideoTime]     = useState(0);   // current video position in seconds
  const [videoDur, setVideoDur]       = useState(0);
  const [buffering, setBuffering]     = useState(false);

  // Sync correction state
  const [correction, setCorrection]   = useState(0);  // ms being edited
  const [saving, setSaving]           = useState(false);
  const [showSyncPanel, setShowSyncPanel] = useState(false);
  const [syncNudgeStep, setSyncNudgeStep] = useState(100); // ms per nudge button

  // Load videos for this flight
  useEffect(() => {
    if (!flightId) return;
    setLoading(true);
    getFlightVideos(flightId)
      .then(r => {
        const vids = r.data || [];
        setVideos(vids);
        if (vids.length > 0) {
          setActiveVideo(vids[0]);
          setCorrection(vids[0].manual_correction_ms || 0);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [flightId]);

  // ── Sync: when playhead moves externally, seek video ─────
  useEffect(() => {
    if (!activeVideo || !videoRef.current || playheadMs == null) return;
    const offset = activeVideo.effective_offset_ms || 0;
    // videoTimeSec = (playheadMs - offset) / 1000
    const targetSec = (playheadMs - offset) / 1000;
    if (targetSec < 0 || targetSec > videoDur) return;
    const diff = Math.abs(videoRef.current.currentTime - targetSec);
    // Only seek if drift > 0.3s to avoid constant seeking during live playback
    if (diff > 0.3) {
      videoRef.current.currentTime = targetSec;
    }
  }, [playheadMs, activeVideo, videoDur]);

  // ── Video time update → drive external playhead ───────────
  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current || !activeVideo) return;
    const t = videoRef.current.currentTime;
    setVideoTime(t);
    const offset = activeVideo.effective_offset_ms || 0;
    // log_time_ms = video_time_ms + offset
    const logMs = Math.round(t * 1000) + offset;
    onPlayheadChange?.(logMs);
  }, [activeVideo, onPlayheadChange]);

  const handlePlay  = () => { setPlaying(true);  onPlay?.(true); };
  const handlePause = () => { setPlaying(false); onPlay?.(false); };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (playing) videoRef.current.pause();
    else         videoRef.current.play();
  };

  const skip = (sec) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, Math.min(videoDur, videoRef.current.currentTime + sec));
  };

  // ── Sync correction save ───────────────────────────────────
  const saveSync = async () => {
    if (!activeVideo) return;
    setSaving(true);
    try {
      const res = await updateVideoSync(activeVideo.id, { manual_correction_ms: correction });
      const updated = { ...activeVideo,
        manual_correction_ms: correction,
        effective_offset_ms: res.data.effective_offset_ms,
        sync_status: res.data.sync_status,
      };
      setActiveVideo(updated);
      setVideos(vs => vs.map(v => v.id === updated.id ? updated : v));
    } catch (_) {}
    setSaving(false);
  };

  // ── Delete video ───────────────────────────────────────────
  const handleDelete = async (vid) => {
    if (!window.confirm(`Delete video "${vid.original_filename}"? This cannot be undone.`)) return;
    await deleteVideo(vid.id).catch(() => {});
    const remaining = videos.filter(v => v.id !== vid.id);
    setVideos(remaining);
    if (activeVideo?.id === vid.id) {
      setActiveVideo(remaining[0] || null);
      setCorrection(remaining[0]?.manual_correction_ms || 0);
    }
  };

  // ── Nudge correction by step ──────────────────────────────
  const nudge = (dir) => setCorrection(c => c + dir * syncNudgeStep);

  if (loading) return (
    <div style={emptyStyle}>
      <RefreshCw size={20} color={C.muted} style={{ animation: 'spin 1s linear infinite' }} />
    </div>
  );

  // No videos yet — show upload panel
  if (videos.length === 0) return (
    <VideoUploadPanel flightId={flightId} onUploaded={(data) => {
      getFlightVideos(flightId).then(r => {
        const vids = r.data || [];
        setVideos(vids);
        if (vids.length > 0) {
          setActiveVideo(vids[0]);
          setCorrection(vids[0].manual_correction_ms || 0);
        }
      });
    }} />
  );

  const effOffset = activeVideo?.effective_offset_ms || 0;
  const logTimeSec = videoTime + effOffset / 1000;
  const correctionChanged = correction !== (activeVideo?.manual_correction_ms || 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Video selector tabs (if multiple) */}
      {videos.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {videos.map(v => (
            <button key={v.id}
              onClick={() => { setActiveVideo(v); setCorrection(v.manual_correction_ms || 0); }}
              style={{
                padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                background: activeVideo?.id === v.id ? C.primary + '20' : 'transparent',
                border: `1px solid ${activeVideo?.id === v.id ? C.primary + '50' : C.border}`,
                color: activeVideo?.id === v.id ? C.primary : C.muted,
                cursor: 'pointer',
              }}>
              {v.original_filename.slice(0, 25)}{v.original_filename.length > 25 ? '…' : ''}
            </button>
          ))}
        </div>
      )}

      {/* Video player */}
      {activeVideo && (
        <div style={{ background: '#000', borderRadius: 10, overflow: 'hidden', position: 'relative' }}>
          <video
            ref={videoRef}
            src={activeVideo.web_path}
            style={{ width: '100%', display: 'block', maxHeight: 320, background: '#000' }}
            onTimeUpdate={handleTimeUpdate}
            onPlay={handlePlay}
            onPause={handlePause}
            onLoadedMetadata={(e) => setVideoDur(e.target.duration)}
            onWaiting={() => setBuffering(true)}
            onCanPlay={() => setBuffering(false)}
            crossOrigin="anonymous"
            playsInline
          />

          {/* Buffering overlay */}
          {buffering && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                          justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}>
              <RefreshCw size={28} color="white" style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          )}

          {/* Overlay: current log-time */}
          <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 6 }}>
            <div style={{ background: 'rgba(0,0,0,0.75)', borderRadius: 6, padding: '3px 8px',
                          fontSize: 11, color: 'white', fontFamily: 'monospace' }}>
              📹 {fmtTime(videoTime)}
            </div>
            <div style={{ background: 'rgba(0,0,0,0.75)', borderRadius: 6, padding: '3px 8px',
                          fontSize: 11, color: C.success, fontFamily: 'monospace' }}>
              📡 {fmtTime(logTimeSec)}
            </div>
          </div>

          {/* Overlay: sync indicator */}
          <div style={{ position: 'absolute', top: 8, right: 8 }}>
            <SyncBadge status={activeVideo.sync_status}
                        confidence={activeVideo.sync_confidence}
                        method={activeVideo.sync_method} />
          </div>
        </div>
      )}

      {/* Playback controls */}
      {activeVideo && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Scrubber */}
          <div style={{ position: 'relative' }}>
            <input type="range" min={0} max={videoDur || 1} step={0.1}
              value={videoTime}
              onChange={(e) => {
                const t = parseFloat(e.target.value);
                if (videoRef.current) videoRef.current.currentTime = t;
              }}
              style={{ width: '100%', accentColor: C.primary, cursor: 'pointer', height: 4 }} />
            {/* Log duration indicator overlay (show where log ends relative to video) */}
            {flightDurationSec && effOffset != null && videoDur > 0 && (
              <div style={{
                position: 'absolute', top: 0,
                left: `${Math.max(0, -effOffset/1000/videoDur*100)}%`,
                width: `${Math.min(100, flightDurationSec/videoDur*100)}%`,
                height: 4, background: C.success + '40', borderRadius: 2,
                pointerEvents: 'none',
              }} title="Log coverage" />
            )}
          </div>

          {/* Buttons + time */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => skip(-10)} style={ctrlBtn} title="Back 10s">
              <SkipBack size={14} />
            </button>
            <button onClick={togglePlay} style={{ ...ctrlBtn, background: C.primary + '20',
                                                   border: `1px solid ${C.primary}40`, color: C.primary }}>
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button onClick={() => skip(10)} style={ctrlBtn} title="Forward 10s">
              <SkipForward size={14} />
            </button>

            <span style={{ fontSize: 11, color: C.muted, fontFamily: 'monospace', marginLeft: 4 }}>
              {fmtTime(videoTime)} / {fmtTime(videoDur)}
            </span>

            <div style={{ flex: 1 }} />

            {/* Sync panel toggle */}
            <button onClick={() => setShowSyncPanel(s => !s)}
              style={{ ...ctrlBtn, color: showSyncPanel ? C.primary : C.muted,
                       background: showSyncPanel ? C.primary + '15' : 'transparent',
                       border: `1px solid ${showSyncPanel ? C.primary + '40' : C.border}` }}>
              <Clock size={13} />
              <span style={{ fontSize: 11, marginLeft: 4 }}>Sync</span>
            </button>

            <button onClick={() => handleDelete(activeVideo)}
              style={{ ...ctrlBtn, color: C.error + 'aa' }} title="Delete video">
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      )}

      {/* ── Time Sync Panel ─────────────────────────────────── */}
      {showSyncPanel && activeVideo && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`,
                      borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Clock size={15} color={C.primary} />
            <span style={{ fontSize: 13, fontWeight: 700, color: C.subtle }}>Time Synchronisation</span>
            <div style={{ flex: 1 }} />
            <SyncBadge status={activeVideo.sync_status}
                        confidence={activeVideo.sync_confidence}
                        method={activeVideo.sync_method} />
          </div>

          {/* Auto-sync info */}
          {activeVideo.sync_notes && (
            <div style={{ fontSize: 11, color: C.muted, background: C.surface,
                          padding: '8px 12px', borderRadius: 8, marginBottom: 12,
                          borderLeft: `3px solid ${activeVideo.sync_status === 'auto' ? C.success : C.warning}` }}>
              <Info size={11} style={{ marginRight: 5, verticalAlign: 'middle' }} />
              {activeVideo.sync_notes}
            </div>
          )}

          {/* Offset breakdown */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
            {[
              { label: 'Auto-detected',  value: `${((activeVideo.sync_offset_ms||0)/1000).toFixed(2)}s`,  color: C.success },
              { label: 'Manual correction', value: `${(correction/1000).toFixed(2)}s`, color: C.primary },
              { label: 'Effective offset', value: `${((activeVideo.sync_offset_ms||0)/1000 + correction/1000).toFixed(2)}s`, color: C.purple },
            ].map((row, i) => (
              <div key={i} style={{ background: C.surface, borderRadius: 8, padding: '8px 10px',
                                    border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>{row.label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: row.color,
                               fontFamily: 'monospace' }}>{row.value}</div>
              </div>
            ))}
          </div>

          {/* Manual correction explanation */}
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 10, lineHeight: 1.6 }}>
            <strong style={{ color: C.subtle }}>How to use:</strong> Play the video to a recognisable moment
            (takeoff, sharp turn, landing). Check the 📡 log time overlay above. If the log time shown
            is ahead, add correction (positive). If the log is behind, subtract (negative).
            The correction is applied on top of auto-detected offset.
          </div>

          {/* Nudge step selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: C.muted }}>Step:</span>
            {[33, 100, 500, 1000].map(ms => (
              <button key={ms} onClick={() => setSyncNudgeStep(ms)}
                style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                         background: syncNudgeStep === ms ? C.primary + '20' : 'transparent',
                         border: `1px solid ${syncNudgeStep === ms ? C.primary : C.border}`,
                         color: syncNudgeStep === ms ? C.primary : C.muted, cursor: 'pointer' }}>
                {ms < 1000 ? `${ms}ms` : `${ms/1000}s`}
              </button>
            ))}
          </div>

          {/* Correction controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <button onClick={() => nudge(-10)} style={nudgeBtn} title="-10 steps">
              <ChevronLeft size={12} /><ChevronLeft size={12} />
            </button>
            <button onClick={() => nudge(-1)} style={nudgeBtn} title="-1 step">
              <ChevronLeft size={14} />
            </button>

            <div style={{ flex: 1, position: 'relative' }}>
              <input type="range"
                min={-30000} max={30000} step={syncNudgeStep}
                value={correction}
                onChange={(e) => setCorrection(parseInt(e.target.value))}
                style={{ width: '100%', accentColor: C.primary }} />
              <div style={{ position: 'absolute', top: -20, left: '50%', transform: 'translateX(-50%)',
                             fontSize: 10, color: C.muted }}>0</div>
            </div>

            <button onClick={() => nudge(1)} style={nudgeBtn} title="+1 step">
              <ChevronRight size={14} />
            </button>
            <button onClick={() => nudge(10)} style={nudgeBtn} title="+10 steps">
              <ChevronRight size={12} /><ChevronRight size={12} />
            </button>

            {/* Numeric input for precision */}
            <input type="number"
              value={correction}
              onChange={(e) => setCorrection(parseInt(e.target.value) || 0)}
              style={{ width: 80, background: C.surface, border: `1px solid ${C.border}`,
                       borderRadius: 6, padding: '4px 8px', color: C.text, fontSize: 12,
                       textAlign: 'center', fontFamily: 'monospace' }} />
            <span style={{ fontSize: 11, color: C.muted }}>ms</span>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setCorrection(0)}
              style={{ flex: 1, ...actionBtn, background: 'transparent',
                        border: `1px solid ${C.border}`, color: C.muted }}>
              Reset to 0
            </button>
            <button onClick={() => setCorrection(activeVideo.manual_correction_ms || 0)}
              style={{ flex: 1, ...actionBtn, background: 'transparent',
                        border: `1px solid ${C.border}`, color: C.muted }}>
              Revert
            </button>
            <button onClick={saveSync} disabled={saving || !correctionChanged}
              style={{ flex: 2, ...actionBtn,
                        background: correctionChanged ? C.primary : C.primary + '40',
                        border: 'none', color: 'white',
                        cursor: correctionChanged ? 'pointer' : 'default' }}>
              {saving ? 'Saving…' : correctionChanged ? '✓ Apply Correction' : 'Saved'}
            </button>
          </div>

          <div style={{ marginTop: 10, fontSize: 10, color: C.muted, lineHeight: 1.5 }}>
            <strong>Keyboard shortcuts while video is focused:</strong>
            Space = play/pause · ← → = step 5s · Shift+← → = step 1s
          </div>
        </div>
      )}

      {/* Add another video button */}
      <div style={{ marginTop: 4 }}>
        <VideoUploadPanel flightId={flightId} onUploaded={() => {
          getFlightVideos(flightId).then(r => {
            const vids = r.data || [];
            setVideos(vids);
          });
        }} />
      </div>

      {/* CSS keyframe for spinner */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

// ── Style constants ───────────────────────────────────────────
const emptyStyle = {
  padding: '24px 0', textAlign: 'center', fontSize: 12,
  color: '#475569', display: 'flex', alignItems: 'center',
  justifyContent: 'center', gap: 8,
};

const ctrlBtn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  gap: 4, background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.1)', color: '#94A3B8',
  padding: '5px 10px', borderRadius: 7, cursor: 'pointer', fontSize: 12,
};

const nudgeBtn = {
  display: 'inline-flex', alignItems: 'center',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.1)', color: '#94A3B8',
  padding: '6px 8px', borderRadius: 7, cursor: 'pointer',
};

const actionBtn = {
  padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
  fontSize: 12, fontWeight: 600, display: 'flex',
  alignItems: 'center', justifyContent: 'center', gap: 6,
};
