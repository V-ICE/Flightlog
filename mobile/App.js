// UAVLogBook Mobile App — Main Application
// React Native + Expo with full flight log viewing
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  FlatList, ActivityIndicator, Alert, TextInput,
  Dimensions, SafeAreaView, StatusBar, Platform
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { LineChart, BarChart } from 'react-native-chart-kit';
import {
  useAuthStore, authLogin, authRegister, getFlights,
  getFlight, getFlightTelemetry, getDashStats,
  uploadFlightLog, getAircraft, deleteFlightApi
} from './api';

const { width: W } = Dimensions.get('window');
const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

// ── Theme ─────────────────────────────────────────────────────
const T = {
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

const chartCfg = {
  backgroundGradientFrom: '#0F172A',
  backgroundGradientTo: '#0F172A',
  color: (opacity = 1) => `rgba(59,130,246,${opacity})`,
  labelColor: () => T.muted,
  strokeWidth: 2,
  propsForDots: { r: '0' },
  propsForBackgroundLines: { strokeDasharray: '', stroke: 'rgba(255,255,255,0.05)' },
};

const fmt = (sec) => {
  if (!sec) return '—';
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 60 ? `${Math.floor(m/60)}h ${m%60}m` : `${m}m ${s}s`;
};
const fmtColors = {
  ardupilot_bin: T.success, mavlink_tlog: T.primary, px4_ulog: T.purple,
  dji_txt: T.warning, dji_csv: '#F97316', betaflight_bbl: '#EC4899',
  generic_csv: T.muted, gpx: '#06B6D4',
};

// ── Login Screen ──────────────────────────────────────────────
function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const { login } = useAuthStore();

  const submit = async () => {
    setLoading(true);
    try {
      let res;
      if (mode === 'login') {
        res = await authLogin(email, pass);
      } else {
        res = await authRegister(email, pass, name);
      }
      await login(res.data.token, res.data.user);
    } catch (e) {
      Alert.alert('Error', e.response?.data?.error || 'Connection failed');
    }
    setLoading(false);
  };

  return (
    <SafeAreaView style={[s.flex, { background: T.bg }]}>
      <StatusBar barStyle="light-content" backgroundColor={T.bg} />
      <ScrollView contentContainerStyle={s.loginContainer}>
        <View style={s.loginLogo}>
          <Ionicons name="airplane" size={40} color={T.primary} />
          <Text style={s.loginTitle}>UAVLogBook</Text>
          <Text style={s.loginSub}>Flight Analysis Platform</Text>
        </View>

        <View style={s.loginCard}>
          {mode === 'register' && (
            <TextInput style={s.input} placeholder="Display Name" placeholderTextColor={T.muted}
              value={name} onChangeText={setName} />
          )}
          <TextInput style={s.input} placeholder="Email" placeholderTextColor={T.muted}
            value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          <TextInput style={s.input} placeholder="Password" placeholderTextColor={T.muted}
            value={pass} onChangeText={setPass} secureTextEntry />

          <TouchableOpacity style={s.btn} onPress={submit} disabled={loading}>
            {loading ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{mode === 'login' ? 'Sign In' : 'Create Account'}</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setMode(mode === 'login' ? 'register' : 'login')} style={{ marginTop: 16, alignItems: 'center' }}>
            <Text style={{ color: T.primary, fontSize: 13 }}>
              {mode === 'login' ? "Don't have an account? Register" : 'Already have an account? Sign in'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Dashboard Screen ──────────────────────────────────────────
function DashboardScreen({ navigation }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuthStore();

  useEffect(() => {
    getDashStats().then(r => { setStats(r.data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  return (
    <SafeAreaView style={s.screen}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <View>
            <Text style={s.headerTitle}>Dashboard</Text>
            <Text style={s.headerSub}>Welcome back, {user?.display_name || 'Pilot'}</Text>
          </View>
          <Ionicons name="airplane-outline" size={28} color={T.primary} />
        </View>

        {loading ? <ActivityIndicator color={T.primary} style={{ marginTop: 40 }} /> : (
          <>
            <View style={s.statsGrid}>
              {[
                { label: 'Total Flights', value: stats?.totals?.flights || 0, icon: 'airplane', color: T.primary },
                { label: 'Flight Time', value: fmt(stats?.totals?.total_time || 0), icon: 'time', color: T.success },
                { label: 'Total Distance', value: `${((stats?.totals?.total_dist || 0)/1000).toFixed(1)}km`, icon: 'navigate', color: T.purple },
                { label: 'Max Altitude', value: `${(stats?.totals?.max_alt || 0).toFixed(0)}m`, icon: 'trending-up', color: T.warning },
              ].map((c, i) => (
                <View key={i} style={[s.statCard, { borderColor: c.color + '30' }]}>
                  <Ionicons name={c.icon} size={18} color={c.color} />
                  <Text style={[s.statVal, { color: T.text }]}>{c.value}</Text>
                  <Text style={s.statLabel}>{c.label}</Text>
                </View>
              ))}
            </View>

            <Text style={s.sectionTitle}>Recent Flights</Text>
            {(stats?.recent || []).slice(0, 5).map((f) => (
              <TouchableOpacity key={f.id} style={s.flightCard} onPress={() => navigation.navigate('FlightDetail', { id: f.id, name: f.original_filename })}>
                <View style={{ flex: 1 }}>
                  <Text style={s.flightName} numberOfLines={1}>{f.original_filename}</Text>
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                    <Text style={s.flightMeta}>{f.flight_date?.slice(0,10)}</Text>
                    <Text style={s.flightMeta}>{fmt(f.duration_sec)}</Text>
                    <Text style={s.flightMeta}>{f.max_altitude_m?.toFixed(0)}m</Text>
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={[s.fmtBadge, { color: fmtColors[f.log_format] || T.muted }]}>{f.log_format?.replace('_',' ').toUpperCase()}</Text>
                  <Ionicons name="chevron-forward" size={16} color={T.muted} />
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Flights List Screen ───────────────────────────────────────
function FlightsScreen({ navigation }) {
  const [flights, setFlights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const load = async (p = 1, q = '') => {
    setLoading(true);
    try {
      const r = await getFlights({ page: p, search: q, limit: 20 });
      setFlights(p === 1 ? r.data.data : [...flights, ...r.data.data]);
      setPage(p);
    } catch (_) {}
    setLoading(false);
  };

  useEffect(() => { load(1, search); }, [search]);

  const renderFlight = ({ item: f }) => (
    <TouchableOpacity style={s.flightCard} onPress={() => navigation.navigate('FlightDetail', { id: f.id, name: f.original_filename })}>
      <View style={[s.fmtDot, { backgroundColor: fmtColors[f.log_format] || T.muted }]} />
      <View style={{ flex: 1 }}>
        <Text style={s.flightName} numberOfLines={1}>{f.original_filename}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
          <Text style={s.flightMeta}>{f.flight_date?.slice(0,10)}</Text>
          <Text style={s.flightMeta}>{fmt(f.duration_sec)}</Text>
          <Text style={s.flightMeta}>↑{f.max_altitude_m?.toFixed(0)}m</Text>
          <Text style={s.flightMeta}>⚡{f.max_speed_ms?.toFixed(1)}m/s</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={T.muted} />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Flight Logs</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Upload')}>
          <Ionicons name="add-circle" size={28} color={T.primary} />
        </TouchableOpacity>
      </View>
      <View style={s.searchBar}>
        <Ionicons name="search" size={16} color={T.muted} style={{ marginRight: 8 }} />
        <TextInput style={{ flex: 1, color: T.text, fontSize: 14 }} placeholder="Search flights…"
          placeholderTextColor={T.muted} value={search} onChangeText={setSearch} />
      </View>
      <FlatList
        data={flights}
        keyExtractor={(f) => String(f.id)}
        renderItem={renderFlight}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        onEndReached={() => load(page + 1, search)}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={!loading && <Text style={{ color: T.muted, textAlign: 'center', marginTop: 40 }}>No flights found</Text>}
        ListFooterComponent={loading && <ActivityIndicator color={T.primary} style={{ margin: 16 }} />}
      />
    </SafeAreaView>
  );
}

// ── Flight Detail Screen ──────────────────────────────────────
function FlightDetailScreen({ route, navigation }) {
  const { id, name } = route.params;
  const [flight, setFlight] = useState(null);
  const [telemetry, setTelemetry] = useState({});
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    navigation.setOptions({ title: name?.slice(0, 30) + (name?.length > 30 ? '…' : '') });
    Promise.all([
      getFlight(id),
      getFlightTelemetry(id, 'gps'),
      getFlightTelemetry(id, 'attitude'),
      getFlightTelemetry(id, 'battery'),
    ]).then(([f, gps, att, batt]) => {
      setFlight(f.data);
      setTelemetry({ gps: gps.data.telemetry, att: att.data.telemetry, batt: batt.data.telemetry });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  if (loading) return <SafeAreaView style={s.screen}><ActivityIndicator color={T.primary} style={{ marginTop: 60 }} /></SafeAreaView>;
  if (!flight) return <SafeAreaView style={s.screen}><Text style={{ color: T.muted, textAlign: 'center', marginTop: 60 }}>Flight not found</Text></SafeAreaView>;

  const tabs = ['overview', 'altitude', 'attitude', 'battery', 'events'];

  // Prepare chart data (downsample to 50 points for mobile performance)
  const ds = (arr, n = 50) => {
    if (!arr?.length) return [];
    const step = Math.max(1, Math.floor(arr.length / n));
    return arr.filter((_, i) => i % step === 0).slice(0, n);
  };

  const altData = ds(telemetry.gps);
  const attData = ds(telemetry.att);
  const battData = ds(telemetry.batt);

  return (
    <SafeAreaView style={s.screen}>
      <ScrollView>
        {/* Header stats */}
        <View style={{ padding: 16, gap: 10 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {[
              { l: 'Duration', v: fmt(flight.duration_sec) },
              { l: 'Max Alt', v: `${flight.max_altitude_m?.toFixed(1)}m` },
              { l: 'Max Speed', v: `${flight.max_speed_ms?.toFixed(1)}m/s` },
              { l: 'Distance', v: `${((flight.total_distance_m||0)/1000).toFixed(2)}km` },
              { l: 'Min Batt', v: `${flight.min_battery_v?.toFixed(2)}V` },
              { l: 'Warnings', v: flight.warning_count || 0, color: flight.warning_count > 0 ? T.warning : T.success },
            ].map((c, i) => (
              <View key={i} style={s.detailStat}>
                <Text style={[s.detailStatVal, c.color && { color: c.color }]}>{c.v}</Text>
                <Text style={s.statLabel}>{c.l}</Text>
              </View>
            ))}
          </View>

          <View style={{ flexDirection: 'row', gap: 4 }}>
            <Text style={[s.fmtBadge, { color: fmtColors[flight.log_format] || T.muted }]}>{flight.log_format?.replace('_', ' ').toUpperCase()}</Text>
            {flight.format_confidence && <Text style={[s.fmtBadge, { color: T.muted }]}>{flight.format_confidence}% confidence</Text>}
          </View>
        </View>

        {/* Tab bar */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingHorizontal: 16, marginBottom: 8 }}>
          {tabs.map(t => (
            <TouchableOpacity key={t} onPress={() => setActiveTab(t)}
              style={[s.tab, activeTab === t && s.tabActive]}>
              <Text style={[s.tabText, activeTab === t && { color: T.primary }]}>{t.charAt(0).toUpperCase() + t.slice(1)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={{ paddingHorizontal: 16, paddingBottom: 32 }}>
          {/* Overview */}
          {activeTab === 'overview' && (
            <View style={{ gap: 12 }}>
              <View style={s.card}>
                <Text style={s.cardTitle}>Flight Info</Text>
                {[
                  ['Date', flight.flight_date?.slice(0,16)?.replace('T',' ')],
                  ['File', flight.original_filename],
                  ['Format', flight.log_format],
                  ['Status', flight.parse_status],
                  ['Location', flight.location_name || 'Not set'],
                ].map(([l, v]) => (
                  <View key={l} style={{ flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: T.border }}>
                    <Text style={{ color: T.muted, fontSize: 12, width: 80 }}>{l}</Text>
                    <Text style={{ color: T.subtle, fontSize: 12, flex: 1 }} numberOfLines={1}>{v || '—'}</Text>
                  </View>
                ))}
              </View>
              {flight.pilot_notes && (
                <View style={s.card}>
                  <Text style={s.cardTitle}>Pilot Notes</Text>
                  <Text style={{ color: T.subtle, fontSize: 13 }}>{flight.pilot_notes}</Text>
                </View>
              )}
            </View>
          )}

          {/* Altitude chart */}
          {activeTab === 'altitude' && altData.length > 0 && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Altitude Profile</Text>
              <LineChart
                data={{ labels: [], datasets: [{ data: altData.map(p => p.alt_m || 0), color: () => T.success }] }}
                width={W - 64} height={200} chartConfig={{ ...chartCfg, color: () => T.success }}
                withDots={false} withInnerLines bezier style={{ borderRadius: 8, marginLeft: -16 }} />
              <Text style={{ color: T.muted, fontSize: 11, marginTop: 8, textAlign: 'center' }}>Altitude (m) over flight time</Text>
            </View>
          )}

          {/* Attitude chart */}
          {activeTab === 'attitude' && attData.length > 0 && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Roll / Pitch / Yaw</Text>
              <LineChart
                data={{ labels: [], datasets: [
                  { data: attData.map(p => p.roll_deg || 0), color: () => T.purple },
                  { data: attData.map(p => p.pitch_deg || 0), color: () => '#EC4899' },
                ]}}
                width={W - 64} height={200} chartConfig={chartCfg}
                withDots={false} withInnerLines style={{ borderRadius: 8, marginLeft: -16 }} />
              <View style={{ flexDirection: 'row', gap: 16, marginTop: 8 }}>
                {[['Roll', T.purple], ['Pitch', '#EC4899']].map(([l, c]) => (
                  <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <View style={{ width: 10, height: 3, backgroundColor: c, borderRadius: 2 }} />
                    <Text style={{ color: T.muted, fontSize: 11 }}>{l}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Battery chart */}
          {activeTab === 'battery' && battData.length > 0 && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Battery Voltage</Text>
              <LineChart
                data={{ labels: [], datasets: [{ data: battData.map(p => parseFloat(p.voltage_v) || 0), color: () => T.error }] }}
                width={W - 64} height={200} chartConfig={{ ...chartCfg, color: () => T.error }}
                withDots={false} withInnerLines style={{ borderRadius: 8, marginLeft: -16 }} />
              <Text style={{ color: T.muted, fontSize: 11, marginTop: 8, textAlign: 'center' }}>Voltage (V) over flight time</Text>
            </View>
          )}

          {/* Events */}
          {activeTab === 'events' && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Event Timeline</Text>
              {(flight.events || []).map((ev, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: T.border }}>
                  <Ionicons name={ev.severity === 'warning' ? 'warning' : ev.severity === 'error' ? 'alert-circle' : 'information-circle'}
                    size={16} color={ev.severity === 'warning' ? T.warning : ev.severity === 'error' ? T.error : T.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: T.subtle, fontSize: 12 }}>{ev.description}</Text>
                    <Text style={{ color: T.muted, fontSize: 10, marginTop: 2 }}>{(ev.t_ms / 1000).toFixed(1)}s</Text>
                  </View>
                </View>
              ))}
              {!flight.events?.length && <Text style={{ color: T.muted, fontSize: 12, textAlign: 'center', padding: 20 }}>No events recorded</Text>}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Upload Screen ─────────────────────────────────────────────
function UploadScreen({ navigation }) {
  const [file, setFile] = useState(null);
  const [notes, setNotes] = useState('');
  const [progress, setProgress] = useState(null);
  const [status, setStatus] = useState('');
  const [uploading, setUploading] = useState(false);

  const pick = async () => {
    const r = await DocumentPicker.getDocumentAsync({
      type: '*/*', copyToCacheDirectory: true,
    });
    if (!r.canceled && r.assets?.[0]) setFile(r.assets[0]);
  };

  const upload = async () => {
    if (!file) return Alert.alert('No file', 'Please select a log file first');
    setUploading(true); setProgress(0);
    setStatus('🤖 AI analyzing log format…');
    try {
      const res = await uploadFlightLog(file.uri, file.name, null, notes, (p) => {
        setProgress(p);
        if (p < 30) setStatus('🤖 Detecting format…');
        else if (p < 60) setStatus('⚙️ Parsing telemetry…');
        else if (p < 90) setStatus('💾 Storing data…');
        else setStatus('✅ Complete!');
      });
      Alert.alert('Success', `Flight imported!\nFormat: ${res.data.format}\nConfidence: ${res.data.format_confidence}%`, [
        { text: 'View Flight', onPress: () => navigation.navigate('Flights') },
        { text: 'Import Another', onPress: () => { setFile(null); setProgress(null); setStatus(''); } },
      ]);
    } catch (e) {
      Alert.alert('Import Failed', e.response?.data?.error || 'Upload failed');
    }
    setUploading(false);
  };

  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <Text style={s.headerTitle}>Import Flight Log</Text>
        <Text style={{ color: T.muted, fontSize: 13 }}>AI automatically detects your log format and maps all telemetry fields.</Text>

        <TouchableOpacity style={s.dropZone} onPress={pick}>
          <Ionicons name="cloud-upload-outline" size={40} color={T.primary} />
          <Text style={{ color: T.text, fontSize: 15, fontWeight: '600', marginTop: 10 }}>
            {file ? file.name : 'Tap to select log file'}
          </Text>
          {file && <Text style={{ color: T.success, fontSize: 12, marginTop: 4 }}>✓ {(file.size / 1024).toFixed(0)} KB</Text>}
          <Text style={{ color: T.muted, fontSize: 12, marginTop: 8, textAlign: 'center' }}>
            .BIN · .TLOG · .ULG · .SKYLOG · .TXT · .CSV · .GPX · .BBL
          </Text>
        </TouchableOpacity>

        {file && (
          <>
            <TextInput style={[s.input, { height: 80, textAlignVertical: 'top' }]}
              placeholder="Pilot notes (optional)" placeholderTextColor={T.muted}
              value={notes} onChangeText={setNotes} multiline />

            {progress !== null && (
              <View style={s.card}>
                <Text style={{ color: T.subtle, fontSize: 13, marginBottom: 8 }}>{status}</Text>
                <View style={{ height: 8, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 4, overflow: 'hidden' }}>
                  <View style={{ width: `${progress}%`, height: '100%', backgroundColor: T.primary, borderRadius: 4 }} />
                </View>
                <Text style={{ color: T.muted, fontSize: 11, marginTop: 6, textAlign: 'right' }}>{progress}%</Text>
              </View>
            )}

            <TouchableOpacity style={[s.btn, uploading && { opacity: 0.6 }]} onPress={upload} disabled={uploading}>
              {uploading ? <ActivityIndicator color="white" /> : (
                <><Ionicons name="cloud-upload" size={18} color="white" style={{ marginRight: 8 }} />
                  <Text style={s.btnText}>Import Log</Text></>
              )}
            </TouchableOpacity>
          </>
        )}

        <View style={s.card}>
          <Text style={s.cardTitle}>Supported Formats</Text>
          {[
            { name: 'ArduPilot DataFlash', ext: '.BIN', color: T.success },
            { name: 'MAVLink Telemetry',   ext: '.TLOG', color: T.primary },
            { name: 'PX4 ULog',            ext: '.ULG / .ULOG', color: T.purple },
            { name: 'Skyline',             ext: '.SKYLOG', color: '#A78BFA' },
            { name: 'DJI Flight Record',   ext: '.TXT', color: T.warning },
            { name: 'DJI / Litchi CSV',    ext: '.CSV', color: '#F97316' },
            { name: 'Betaflight Blackbox', ext: '.BBL / .BFL', color: '#EC4899' },
            { name: 'GPX Track',           ext: '.GPX', color: '#06B6D4' },
            { name: 'Generic CSV (AI)',     ext: '.CSV', color: T.muted },
          ].map((f, i) => (
            <View key={i} style={{ flexDirection: 'row', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: T.border }}>
              <Text style={{ color: f.color, fontSize: 12, fontWeight: '700', width: 90, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>{f.ext}</Text>
              <Text style={{ color: T.subtle, fontSize: 12 }}>{f.name}</Text>
            </View>
          ))}
        </View>

        {/* FPV Video section */}
        <View style={[s.card, { borderColor: '#A78BFA30' }]}>
          <Text style={[s.cardTitle, { color: '#A78BFA' }]}>📹 FPV Video Sync</Text>
          <Text style={{ color: T.muted, fontSize: 12, marginBottom: 10, lineHeight: 18 }}>
            After importing a flight log, open the flight and use the FPV Video module to attach and sync your camera footage.
          </Text>
          {[
            { step: '1', text: 'Open any flight from the Flights tab' },
            { step: '2', text: 'Go to the FPV Video section' },
            { step: '3', text: 'Upload your MP4/MOV/AVI/MKV file (up to 8 GB)' },
            { step: '4', text: 'Auto-sync reads MP4 creation_time or filename timestamp' },
            { step: '5', text: 'Use the correction slider for fine-tuning (33ms precision)' },
          ].map((item, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 10, paddingVertical: 5 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#A78BFA', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: 'white', fontSize: 11, fontWeight: '700' }}>{item.step}</Text>
              </View>
              <Text style={{ color: T.subtle, fontSize: 12, flex: 1, lineHeight: 18 }}>{item.text}</Text>
            </View>
          ))}
          <View style={{ marginTop: 10, padding: 10, backgroundColor: T.bg, borderRadius: 8 }}>
            <Text style={{ color: T.muted, fontSize: 11, fontWeight: '600', marginBottom: 4 }}>Supported video formats:</Text>
            <Text style={{ color: '#A78BFA', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
              .MP4 · .MOV · .AVI · .MKV · .WebM · .MPG · .3GP
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Profile Screen ────────────────────────────────────────────
function ProfileScreen() {
  const { user, logout } = useAuthStore();
  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View style={s.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: T.primary, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: 'white', fontSize: 22, fontWeight: '800' }}>{user?.display_name?.[0] || 'P'}</Text>
            </View>
            <View>
              <Text style={{ color: T.text, fontSize: 16, fontWeight: '700' }}>{user?.display_name}</Text>
              <Text style={{ color: T.muted, fontSize: 13 }}>{user?.email}</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity style={[s.btn, { backgroundColor: T.error + '20', borderWidth: 1, borderColor: T.error }]} onPress={() => logout()}>
          <Ionicons name="log-out-outline" size={18} color={T.error} style={{ marginRight: 8 }} />
          <Text style={[s.btnText, { color: T.error }]}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Navigation ────────────────────────────────────────────────
function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: { backgroundColor: T.card, borderTopColor: T.border, height: 60 },
        tabBarActiveTintColor: T.primary,
        tabBarInactiveTintColor: T.muted,
        tabBarLabelStyle: { fontSize: 11, marginBottom: 4 },
        tabBarIcon: ({ color, size }) => {
          const icons = { Dashboard: 'grid', Flights: 'list', Upload: 'cloud-upload', Profile: 'person' };
          return <Ionicons name={icons[route.name]} size={size} color={color} />;
        },
      })}>
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="Flights" component={FlightsScreen} />
      <Tab.Screen name="Upload" component={UploadScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

function RootNavigator() {
  const { isAuthenticated, isLoading, init } = useAuthStore();
  useEffect(() => { init(); }, []);
  if (isLoading) return <View style={[s.flex, { justifyContent: 'center', alignItems: 'center', backgroundColor: T.bg }]}><ActivityIndicator color={T.primary} size="large" /></View>;
  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: T.card }, headerTintColor: T.text, headerTitleStyle: { fontWeight: '700' } }}>
      {isAuthenticated ? (
        <>
          <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
          <Stack.Screen name="FlightDetail" component={FlightDetailScreen} options={{ title: 'Flight Details' }} />
        </>
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar barStyle="light-content" backgroundColor={T.bg} />
      <RootNavigator />
    </NavigationContainer>
  );
}

// ── Styles ────────────────────────────────────────────────────
const s = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: T.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 10 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: T.text },
  headerSub: { fontSize: 13, color: T.muted, marginTop: 2 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: T.subtle, marginLeft: 16, marginTop: 8, marginBottom: 4 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 16, gap: 10 },
  statCard: { width: (W - 52) / 2, backgroundColor: T.surface, borderRadius: 12, padding: 14, borderWidth: 1, gap: 4 },
  statVal: { fontSize: 22, fontWeight: '800', color: T.text, marginTop: 6 },
  statLabel: { fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },
  flightCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: T.surface, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: T.border },
  flightName: { fontSize: 13, fontWeight: '600', color: T.subtle },
  flightMeta: { fontSize: 11, color: T.muted },
  fmtDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  fmtBadge: { fontSize: 10, fontWeight: '700', backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  card: { backgroundColor: T.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: T.border },
  cardTitle: { fontSize: 13, fontWeight: '700', color: T.subtle, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  detailStat: { backgroundColor: T.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: T.border, minWidth: (W - 52) / 2 - 5 },
  detailStatVal: { fontSize: 18, fontWeight: '800', color: T.text },
  tab: { paddingHorizontal: 16, paddingVertical: 8, marginRight: 4, borderRadius: 20, backgroundColor: T.surface, borderWidth: 1, borderColor: T.border },
  tabActive: { backgroundColor: T.primary + '20', borderColor: T.primary + '40' },
  tabText: { fontSize: 13, color: T.muted, fontWeight: '600' },
  input: { backgroundColor: T.surface, borderRadius: 10, padding: 13, color: T.text, fontSize: 14, borderWidth: 1, borderColor: T.border },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: T.primary, borderRadius: 10, padding: 14 },
  btnText: { color: 'white', fontSize: 15, fontWeight: '700' },
  dropZone: { backgroundColor: T.surface, borderRadius: 16, padding: 40, alignItems: 'center', borderWidth: 2, borderColor: T.border, borderStyle: 'dashed' },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: T.surface, borderRadius: 10, marginHorizontal: 16, marginBottom: 8, padding: 10, borderWidth: 1, borderColor: T.border },
  loginContainer: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  loginLogo: { alignItems: 'center', marginBottom: 32 },
  loginTitle: { fontSize: 28, fontWeight: '800', color: T.text, marginTop: 12 },
  loginSub: { fontSize: 13, color: T.muted, marginTop: 4 },
  loginCard: { backgroundColor: T.surface, borderRadius: 16, padding: 24, gap: 12, borderWidth: 1, borderColor: T.border },
});
