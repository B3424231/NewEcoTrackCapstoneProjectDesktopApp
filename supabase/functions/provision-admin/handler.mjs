// Public administrator registration is explicitly enabled for this application.
// Service credentials remain here; existing table access policies are unchanged.
const headers = {
  'Content-Type': 'application/json', 'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const reply = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });
const validId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function createRegistrationHandler({ createClient, env, crypto: cryptoImpl = globalThis.crypto }) {
  async function hash(value) {
    const bytes = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return async request => {
    if (request.method === 'OPTIONS') return new Response(null, { headers });
    if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' });
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > 4096) return reply(400, { error: 'Invalid administrator profile' });
      let input;
      try { input = JSON.parse(raw); } catch (_) { return reply(400, { error: 'Invalid administrator profile' }); }
      const source = input?.profile;
      const username = typeof source?.username === 'string' ? source.username.trim() : '';
      const email = typeof source?.email === 'string' ? source.email.trim().toLowerCase() : '';
      const password = source?.password;
      if (username.length < 3 || username.length > 120 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || password.length < 8 || password.length > 1024) {
        return reply(400, { error: 'Valid name, email and password required' });
      }
      const url = env.get('SUPABASE_URL'), key = env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (!url || !key) return reply(503, { error: 'Administrator registration is temporarily unavailable' });
      const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      // The existing service-only counter permits 10 attempts per 15-minute window.
      // Counters contain only hashes, with separate namespaces from sign-in limits.
      const address = (request.headers.get('x-forwarded-for') || request.headers.get('cf-connecting-ip') || 'unknown').split(',')[0].trim().slice(0, 128);
      for (const scope of ['administrator-registration:ip:' + address, 'administrator-registration:email:' + email]) {
        const limited = await admin.rpc('ecotrack_auth_attempt', { p_key: await hash(scope) });
        if (limited.error) return reply(503, { error: 'Registration is temporarily unavailable. Try again later.' });
        if (limited.data !== true) return reply(429, { error: 'Too many registration attempts. Wait before trying again.' }, { 'Retry-After': '900' });
      }
      const id = 'admin_' + cryptoImpl.randomUUID().replace(/-/g, '');
      const now = new Date().toISOString();
      const inserted = await admin.from('administrators').insert({ id, username, email, role: 'admin', is_active: true, is_archived: false, created: now, updated: now });
      if (inserted.error) return reply(409, { error: 'The name or email is already registered, or the account could not be created.' });
      let created;
      try {
        // Preserve the existing credential contract. The trusted Auth trigger links
        // only the server-generated profile through immutable app_metadata.
        created = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { ecotrack_profile_id: id, ecotrack_account_type: 'admin' } });
      } catch (_) {
        return reply(503, { error: 'Account creation could not be confirmed. Try signing in before submitting again.' });
      }
      if (created.error) {
        if (!created.error.status || created.error.status >= 500) return reply(503, { error: 'Account creation could not be confirmed. Try signing in before submitting again.' });
        // Delete only the just-inserted profile if it is still unlinked, after a
        // definite Auth rejection. An uncertain response may follow a committed write.
        const cleanup = await admin.from('administrators').delete().eq('id', id).is('auth_user_id', null);
        if (cleanup.error) return reply(503, { error: 'Account creation could not be confirmed. Check the account before retrying.' });
        return reply(409, { error: 'Administrator credentials could not be created. Check whether the email is already registered.' });
      }
      if (!validId(created.data?.user?.id)) return reply(503, { error: 'Account creation could not be confirmed. Check the account before retrying.' });
      return reply(200, { adminId: id, authUserId: created.data.user.id });
    } catch (_) {
      return reply(503, { error: 'Administrator registration could not be confirmed. Check your connection and account before retrying.' });
    }
  };
}
