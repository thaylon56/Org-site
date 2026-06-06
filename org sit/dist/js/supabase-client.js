/**
 * Cliente Supabase singleton
 */
let _client = null;

function getSupabase() {
  if (_client) return _client;

  const { url, anonKey } = window.SUPABASE_CONFIG || {};
  if (!url || !anonKey || url.includes('seu-projeto')) {
    console.warn('Configure SUPABASE_CONFIG em js/config.js');
    return null;
  }

  _client = supabase.createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  return _client;
}
