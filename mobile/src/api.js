// Flightlog Mobile — API Client + Auth Store
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

// ── Config ────────────────────────────────────────────────────
// Edit this to your cPanel API URL before building
export const API_BASE_URL = 'https://yourdomain.com/api/v1';

// ── Auth Store (persisted to SecureStore) ─────────────────────
export const useAuthStore = create((set, get) => ({
  token: null,
  user: null,
  isAuthenticated: false,
  isLoading: true,

  init: async () => {
    try {
      const token = await SecureStore.getItemAsync('auth_token');
      const userStr = await SecureStore.getItemAsync('auth_user');
      if (token && userStr) {
        set({ token, user: JSON.parse(userStr), isAuthenticated: true });
      }
    } catch (_) {}
    set({ isLoading: false });
  },

  login: async (token, user) => {
    await SecureStore.setItemAsync('auth_token', token);
    await SecureStore.setItemAsync('auth_user', JSON.stringify(user));
    set({ token, user, isAuthenticated: true });
  },

  logout: async () => {
    await SecureStore.deleteItemAsync('auth_token');
    await SecureStore.deleteItemAsync('auth_user');
    set({ token: null, user: null, isAuthenticated: false });
  },
}));

// ── Axios Instance ─────────────────────────────────────────────
const api = axios.create({ baseURL: API_BASE_URL, timeout: 30000 });

api.interceptors.request.use(async (config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err.response?.status === 401) {
      await useAuthStore.getState().logout();
    }
    return Promise.reject(err);
  }
);

// ── API Functions ─────────────────────────────────────────────
export const authLogin    = (email, password) => api.post('/auth/login', { email, password });
export const authRegister = (email, password, name) => api.post('/auth/register', { email, password, display_name: name });
export const getFlights   = (params) => api.get('/flights', { params });
export const getFlight    = (id) => api.get(`/flights/${id}`);
export const getFlightTelemetry = (id, ch) => api.get(`/flights/${id}/${ch}`);
export const getDashStats = () => api.get('/stats');
export const getAircraft  = () => api.get('/aircraft');
export const getProfile   = () => api.get('/profile');
export const deleteFlightApi = (id) => api.delete(`/flights/${id}`);
export const updateFlightApi = (id, data) => api.put(`/flights/${id}`, data);

export const uploadFlightLog = async (fileUri, fileName, aircraftId, notes, onProgress) => {
  const formData = new FormData();
  formData.append('log', { uri: fileUri, name: fileName, type: 'application/octet-stream' });
  if (aircraftId) formData.append('aircraft_id', aircraftId);
  if (notes) formData.append('notes', notes);

  return api.post('/flights', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (e.total) onProgress?.(Math.round((e.loaded * 100) / e.total));
    },
  });
};

export default api;
