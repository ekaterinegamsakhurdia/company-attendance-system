import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../services/supabase';
import { fetchAppSettings, fetchHeadedDepartment, fetchMyEmployee, signOut } from '../services/api';
import { FALLBACK_TZ } from '../lib/time';

const AuthContext = createContext(null);

const DEFAULT_SETTINGS = {
  company_name: 'Looper Agency',
  work_start_time: '11:00:00',
  work_end_time: '19:00:00',
  timezone: FALLBACK_TZ,
  require_company_network: false,
  require_biometric: false,
};

export function AuthProvider({ children }) {
  // undefined = still checking, null = signed out
  const [session, setSession] = useState(undefined);
  const [employee, setEmployee] = useState(null);
  const [headDepartment, setHeadDepartment] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');

  // Auth events are handled synchronously: awaiting Supabase calls inside
  // onAuthStateChange can deadlock the client, so data loading happens in an effect.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => setSession(next ?? null));
    return () => subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id ?? null;

  const loadProfile = useCallback(async (id) => {
    setProfileLoading(true);
    setProfileError('');
    try {
      const emp = await fetchMyEmployee(id);
      const [s, head] = await Promise.all([
        fetchAppSettings().catch(() => null),
        fetchHeadedDepartment(emp.id).catch(() => null),
      ]);
      setEmployee(emp);
      setHeadDepartment(head);
      if (s) setSettings({ ...DEFAULT_SETTINGS, ...s });
    } catch (err) {
      setEmployee(null);
      setHeadDepartment(null);
      setProfileError(err.message || String(err));
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!userId) {
      setEmployee(null);
      setHeadDepartment(null);
      setProfileError('');
      return;
    }
    loadProfile(userId);
  }, [userId, loadProfile]);

  const refreshSettings = useCallback(async () => {
    const s = await fetchAppSettings().catch(() => null);
    if (s) setSettings({ ...DEFAULT_SETTINGS, ...s });
  }, []);

  const value = useMemo(
    () => ({
      session,
      employee,
      headDepartment,
      settings,
      timezone: settings.timezone || FALLBACK_TZ,
      loading: session === undefined || (Boolean(userId) && profileLoading && !employee),
      profileError,
      refreshSettings,
      signOut,
    }),
    [session, employee, headDepartment, settings, userId, profileLoading, profileError, refreshSettings],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
}
