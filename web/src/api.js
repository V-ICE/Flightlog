// UAVLogBook — API Client
import axios from 'axios';
import { useAuthStore } from './store';

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1';

const api = axios.create({ baseURL: API_BASE });

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle 401 — auto logout
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// ── Auth ─────────────────────────────────────────────────────
export const login     = (email, password) => api.post('/auth/login', { email, password });
export const register  = (email, password, display_name) => api.post('/auth/register', { email, password, display_name });
export const refreshToken = () => api.post('/auth/refresh');

// ── Flights ───────────────────────────────────────────────────
export const getFlights    = (params = {}) => api.get('/flights', { params });
export const getFlight     = (id) => api.get(`/flights/${id}`);
export const getFlightTelemetry = (id, channel) => api.get(`/flights/${id}/${channel}`);
export const uploadFlight  = (formData, onProgress) =>
  api.post('/flights', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => onProgress?.(Math.round((e.loaded * 100) / e.total)),
  });
export const updateFlight  = (id, data) => api.put(`/flights/${id}`, data);
export const deleteFlight  = (id) => api.delete(`/flights/${id}`);
export const shareFlightCreate = (id) => api.post(`/flights/${id}/share`);

// ── Aircraft ─────────────────────────────────────────────────
export const getAircraft   = () => api.get('/aircraft');
export const createAircraft= (data) => api.post('/aircraft', data);
export const updateAircraft= (id, data) => api.put(`/aircraft/${id}`, data);
export const deleteAircraft= (id) => api.delete(`/aircraft/${id}`);

// ── Profile / Prefs ─────────────────────────────────────────
export const getProfile    = () => api.get('/profile');
export const updateProfile = (data) => api.put('/profile', data);
export const getViewPrefs  = () => api.get('/prefs');
export const saveViewPrefs = (prefs) => api.put('/prefs', prefs);

// ── Dashboard ─────────────────────────────────────────────────
export const getDashboardStats = () => api.get('/stats');

// ── Shared ────────────────────────────────────────────────────
export const getSharedFlight = (token) => api.get(`/share/${token}`);

// ── Video Sync ────────────────────────────────────────────────
export const getFlightVideos = (flightId) =>
  api.get(`/videos/${flightId}`);

export const uploadFlightVideo = (flightId, formData, onProgress) =>
  api.post(`/videos/${flightId}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => onProgress?.(Math.round((e.loaded * 100) / e.total)),
  });

export const updateVideoSync = (videoId, data) =>
  api.put(`/videos/${videoId}`, data);

export const deleteVideo = (videoId) =>
  api.delete(`/videos/${videoId}`);

export default api;
