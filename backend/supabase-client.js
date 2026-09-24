/* Optional live Supabase adapter. The storefront works in empty/local mode until these values are configured. */
window.nuvoraSupabase = null;
window.initNuvoraSupabase = async function () {
  const c = window.NUVORA_CONFIG || {};
  if (!c.supabaseUrl || !c.supabaseAnonKey || !window.supabase) return null;
  window.nuvoraSupabase = window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey);
  return window.nuvoraSupabase;
};
