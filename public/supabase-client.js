/**
 * Cliente Supabase partilhado — uma única instância GoTrue por separador.
 * Requer: @supabase/supabase-js (CDN), supabase-config.js
 */
(function (global) {
  'use strict';

  const CLIENT_KEY = '__reinoSupabaseClient';
  let initPromise = null;

  function getConfig() {
    const cfg = global.SUPABASE_CONFIG || {};
    return {
      url: (cfg.url || '').trim(),
      anonKey: (cfg.anonKey || '').trim(),
    };
  }

  function isConfigured() {
    const { url, anonKey } = getConfig();
    return !!(url && anonKey && global.supabase?.createClient);
  }

  function getAuthStorage() {
    try {
      if (global.sessionStorage) return global.sessionStorage;
    } catch { /* ignore */ }
    return undefined;
  }

  function getClient() {
    return global[CLIENT_KEY] || null;
  }

  function createClient() {
    const { url, anonKey } = getConfig();
    const authStorage = getAuthStorage();
    return global.supabase.createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        ...(authStorage ? { storage: authStorage } : {}),
      },
      realtime: { params: { eventsPerSecond: 8 } },
    });
  }

  async function ensureClient() {
    if (!isConfigured()) return null;
    if (global[CLIENT_KEY]) return global[CLIENT_KEY];
    if (!initPromise) {
      initPromise = (async () => {
        const client = createClient();
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        if (!data.session) {
          const signIn = await client.auth.signInAnonymously();
          if (signIn.error) throw signIn.error;
        }
        global[CLIENT_KEY] = client;
        return client;
      })();
    }
    try {
      return await initPromise;
    } catch (err) {
      initPromise = null;
      global[CLIENT_KEY] = null;
      throw err;
    }
  }

  global.ReinoSupabase = {
    isConfigured,
    ensureClient,
    getClient,
  };
})(typeof window !== 'undefined' ? window : globalThis);
