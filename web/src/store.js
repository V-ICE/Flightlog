// UAVLogBook — Global State Store (Zustand)
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ── Auth Store ───────────────────────────────────────────────
export const useAuthStore = create(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      isAuthenticated: false,

      login: (token, user) => set({ token, user, isAuthenticated: true }),
      logout: () => set({ token: null, user: null, isAuthenticated: false }),
      updateUser: (user) => set({ user }),
    }),
    { name: 'uavlogbook-auth', partialize: (s) => ({ token: s.token, user: s.user, isAuthenticated: s.isAuthenticated }) }
  )
);

// ── View Preferences Store ────────────────────────────────────
// Defines all available modules and their default state
const DEFAULT_MODULES = [
  { key: 'map',        label: 'Flight Map',       enabled: true,  position: 0, icon: 'Map' },
  { key: 'altitude',   label: 'Altitude Profile', enabled: true,  position: 1, icon: 'MountainSnow' },
  { key: 'attitude',   label: 'Attitude (RPY)',   enabled: true,  position: 2, icon: 'Rotate3d' },
  { key: 'speed',      label: 'Speed',            enabled: true,  position: 3, icon: 'Gauge' },
  { key: 'battery',    label: 'Battery',          enabled: true,  position: 4, icon: 'Battery' },
  { key: 'gps_quality',label: 'GPS Quality',      enabled: true,  position: 5, icon: 'Satellite' },
  { key: 'imu',        label: 'IMU / Vibration',  enabled: false, position: 6, icon: 'Activity' },
  { key: 'rc_input',   label: 'RC Channels',      enabled: false, position: 7, icon: 'Radio' },
  { key: 'events',     label: 'Event Timeline',   enabled: true,  position: 8, icon: 'Clock' },
  { key: 'replay_3d',  label: '3D Replay',        enabled: false, position: 9, icon: 'Box' },
  { key: 'stats',      label: 'Statistics',       enabled: true,  position: 10, icon: 'BarChart3' },
  { key: 'video_sync', label: 'FPV Video',         enabled: true,  position: 11, icon: 'Video' },
];

export const useModuleStore = create(
  persist(
    (set, get) => ({
      modules: DEFAULT_MODULES,

      toggleModule: (key) => set((state) => ({
        modules: state.modules.map((m) =>
          m.key === key ? { ...m, enabled: !m.enabled } : m
        ),
      })),

      reorderModules: (newOrder) => set({
        modules: newOrder.map((key, i) => {
          const m = get().modules.find((x) => x.key === key);
          return { ...m, position: i };
        }),
      }),

      syncFromServer: (serverPrefs) => set((state) => ({
        modules: state.modules.map((m) => {
          const sp = serverPrefs.find((p) => p.view_key === m.key);
          return sp ? { ...m, enabled: !!sp.enabled, position: sp.position ?? m.position } : m;
        }),
      })),

      getEnabled: () => get().modules.filter((m) => m.enabled).sort((a,b) => a.position - b.position),
    }),
    { name: 'uavlogbook-modules' }
  )
);

// ── Flight Data Store ────────────────────────────────────────
export const useFlightStore = create((set, get) => ({
  flights: [],
  currentFlight: null,
  telemetry: {},        // { gps: [], attitude: [], battery: [], imu: [], rc: [], events: [] }
  isLoading: false,
  error: null,
  pagination: { total: 0, page: 1, per_page: 20 },
  filters: { search: '', format: '' },

  setFlights: (flights, pagination) => set({ flights, pagination }),
  setCurrentFlight: (flight) => set({ currentFlight: flight }),
  setTelemetry: (channel, data) => set((state) => ({
    telemetry: { ...state.telemetry, [channel]: data }
  })),
  clearTelemetry: () => set({ telemetry: {} }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setFilters: (filters) => set((state) => ({ filters: { ...state.filters, ...filters } })),
}));

// ── UI Store ─────────────────────────────────────────────────
export const useUIStore = create(
  persist(
    (set) => ({
      sidebarOpen: true,
      theme: 'dark',
      mapStyle: 'satellite',
      playheadMs: null,
      isPlaying: false,

      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setTheme: (theme) => set({ theme }),
      setMapStyle: (mapStyle) => set({ mapStyle }),
      setPlayhead: (playheadMs) => set({ playheadMs }),
      setPlaying: (isPlaying) => set({ isPlaying }),
    }),
    { name: 'uavlogbook-ui', partialize: (s) => ({ theme: s.theme }) }
  )
);
