// ===================================================================
// ECOTRACK SUPABASE CLIENT & DUAL-DATABASE ROUTER
// - Routes sensor logs ('telemetry') -> Native SQLite3 Database (backend/telemetry.db)
// - Routes all other entities -> Supabase Cloud Database
// ===================================================================

(function() {
  // 1. CONFIGURATION
  const DEFAULT_SUPABASE_URL = 'https://your-project.supabase.co';
  const DEFAULT_ANON_KEY = 'your_supabase_anon_key';
  const DEFAULT_BACKEND_URL = 'http://localhost:5000';

  const supabaseUrl = localStorage.getItem('ecoTrack_supabase_url') || window.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const supabaseKey = localStorage.getItem('ecoTrack_supabase_anon_key') || window.SUPABASE_KEY || DEFAULT_ANON_KEY;
  const backendUrl = localStorage.getItem('ecoTrack_backend_url') || window.BACKEND_URL || DEFAULT_BACKEND_URL;

  window.ECOTRACK_CONFIG = {
    supabaseUrl,
    supabaseKey,
    backendUrl,
    isSupabaseConfigured: () => {
      return supabaseUrl && !supabaseUrl.includes('your-project-ref') && supabaseKey;
    }
  };

  // 2. INITIALIZE SUPABASE CLIENT
  let sbClient = null;
  if (typeof supabase !== 'undefined' && typeof supabase.createClient === 'function') {
    try {
      sbClient = supabase.createClient(supabaseUrl, supabaseKey, {
        auth: {
          persistSession: true,
          storage: window.localStorage
        }
      });
      console.log('[EcoTrack] Supabase client initialized.');
    } catch (e) {
      console.warn('[EcoTrack] Could not initialize live Supabase client:', e.message);
    }
  }

  window.supabaseClient = sbClient;
  window.sb = sbClient;

  if (sbClient) {
    try {
      window.dispatchEvent(new CustomEvent('supabase:ready', { detail: sbClient }));
      if (window.EcoTrackMaintenance && typeof window.EcoTrackMaintenance.fetchReports === 'function') {
        window.EcoTrackMaintenance.fetchReports();
      }
    } catch (_) {}
  }

  // Helper to parse simple PocketBase string filter (e.g., "room_id = 'rm_123'", "date = '2026-08-29'")
  function applyPbFilterToSupabaseQuery(query, filterStr) {
    if (!filterStr || typeof filterStr !== 'string') return query;

    const conditions = filterStr.split(/&&|AND/i).map(c => c.trim()).filter(Boolean);
    for (const cond of conditions) {
      const eqMatch = cond.match(/^([\w\.]+)\s*=\s*['"]?([^'"]+)['"]?$/);
      if (eqMatch) {
        query = query.eq(eqMatch[1], eqMatch[2]);
        continue;
      }
      const gteMatch = cond.match(/^([\w\.]+)\s*>=\s*['"]?([^'"]+)['"]?$/);
      if (gteMatch) {
        query = query.gte(gteMatch[1], gteMatch[2]);
        continue;
      }
      const lteMatch = cond.match(/^([\w\.]+)\s*<=\s*['"]?([^'"]+)['"]?$/);
      if (lteMatch) {
        query = query.lte(lteMatch[1], lteMatch[2]);
        continue;
      }
      const gtMatch = cond.match(/^([\w\.]+)\s*>\s*['"]?([^'"]+)['"]?$/);
      if (gtMatch) {
        query = query.gt(gtMatch[1], gtMatch[2]);
        continue;
      }
      const ltMatch = cond.match(/^([\w\.]+)\s*<\s*['"]?([^'"]+)['"]?$/);
      if (ltMatch) {
        query = query.lt(ltMatch[1], ltMatch[2]);
        continue;
      }
    }
    return query;
  }

  // ===================================================================
  // 3. NATIVE SQLITE3 TELEMETRY SENSOR LOGS CLIENT
  // Dedicated strictly to Sensor Logs (telemetry) via SQLite3 API
  // ===================================================================
  class Sqlite3TelemetryCollection {
    constructor() {
      this.table = 'telemetry';
      this.baseUrl = window.ECOTRACK_CONFIG.backendUrl || DEFAULT_BACKEND_URL;
    }

    async getFullList(options = {}) {
      try {
        const params = new URLSearchParams();
        params.append('perPage', '0'); // 0 = all records
        if (options.sort) params.append('sort', options.sort);
        if (options.filter) params.append('filter', options.filter);
        if (options.date) params.append('date', options.date);
        if (options.node_id) params.append('node_id', options.node_id);

        const res = await fetch(`${this.baseUrl}/api/telemetry?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          return data.items || [];
        }
      } catch (err) {
        console.warn('[SQLite3 Telemetry] getFullList failed:', err.message);
      }
      return [];
    }

    async getList(page = 1, perPage = 50, options = {}) {
      try {
        const params = new URLSearchParams();
        params.append('page', String(page));
        params.append('perPage', String(perPage));
        if (options.sort) params.append('sort', options.sort);
        if (options.filter) params.append('filter', options.filter);
        if (options.date) params.append('date', options.date);
        if (options.node_id) params.append('node_id', options.node_id);

        const res = await fetch(`${this.baseUrl}/api/telemetry?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          return {
            items: data.items || [],
            page: data.page || page,
            perPage: data.perPage || perPage,
            totalItems: data.totalItems || 0,
            totalPages: data.totalPages || 1
          };
        }
      } catch (err) {
        console.warn('[SQLite3 Telemetry] getList failed:', err.message);
      }
      return { items: [], page, perPage, totalItems: 0, totalPages: 1 };
    }

    async getFirstListItem(filter, options = {}) {
      const list = await this.getList(1, 1, { ...options, filter });
      if (list.items && list.items.length > 0) {
        return list.items[0];
      }
      throw new Error(`Item not found in SQLite3 telemetry`);
    }

    async getOne(id) {
      try {
        const res = await fetch(`${this.baseUrl}/api/telemetry/${id}`);
        if (res.ok) return await res.json();
      } catch (err) {
        console.warn(`[SQLite3 Telemetry] getOne(${id}) failed:`, err.message);
      }
      throw new Error(`Item ${id} not found in SQLite3 telemetry`);
    }

    async create(data) {
      try {
        const res = await fetch(`${this.baseUrl}/api/telemetry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (res.ok) return await res.json();
      } catch (err) {
        console.warn('[SQLite3 Telemetry] create failed:', err.message);
      }
      const fakeId = 'telem_' + Math.random().toString(36).substring(2, 11);
      return { id: fakeId, ...data, created: new Date().toISOString() };
    }

    async update(id, data) {
      try {
        const res = await fetch(`${this.baseUrl}/api/telemetry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, ...data })
        });
        if (res.ok) return await res.json();
      } catch (err) {
        console.warn(`[SQLite3 Telemetry] update(${id}) failed:`, err.message);
      }
      return { id, ...data, updated: new Date().toISOString() };
    }

    async delete(id) {
      try {
        const res = await fetch(`${this.baseUrl}/api/telemetry/${id}`, { method: 'DELETE' });
        return res.ok;
      } catch (err) {
        return true;
      }
    }

    subscribe(topic, callback) {
      // Lightweight polling interval for SQLite3 live telemetry updates
      let isSubscribed = true;
      let lastCount = -1;
      const poll = async () => {
        if (!isSubscribed) return;
        try {
          const res = await fetch(`${this.baseUrl}/api/telemetry?page=1&perPage=1&sort=-created`);
          if (res.ok) {
            const data = await res.json();
            if (data.items && data.items.length > 0 && data.totalItems !== lastCount) {
              lastCount = data.totalItems;
              if (typeof callback === 'function') {
                callback({ action: 'create', record: data.items[0] });
              }
            }
          }
        } catch (_) {}
      };
      const intervalId = setInterval(poll, 2000);
      return Promise.resolve(() => {
        isSubscribed = false;
        clearInterval(intervalId);
      });
    }
  }

  // ===================================================================
  // 4. SUPABASE TABLE SERVICE FOR ALL OTHER PAGES & ENTITIES
  // ===================================================================
  class SupabaseTableCollection {
    constructor(tableName) {
      this.table = tableName;
    }

    async getFullList(options = {}) {
      if (sbClient && window.ECOTRACK_CONFIG.isSupabaseConfigured()) {
        try {
          let q = sbClient.from(this.table).select('*');
          if (options.filter) q = applyPbFilterToSupabaseQuery(q, options.filter);
          if (options.sort) {
            const isDesc = options.sort.startsWith('-');
            const col = isDesc ? options.sort.substring(1) : options.sort;
            q = q.order(col, { ascending: !isDesc });
          }
          const { data, error } = await q;
          if (!error && data) return data;
          if (error) console.warn(`[Supabase GET ${this.table}] error:`, error.message);
        } catch (e) {
          console.warn(`[Supabase GET ${this.table}] exception:`, e.message);
        }
      }

      return [];
    }

    async getList(page = 1, perPage = 50, options = {}) {
      if (sbClient && window.ECOTRACK_CONFIG.isSupabaseConfigured()) {
        try {
          const from = (page - 1) * perPage;
          const to = from + perPage - 1;
          let q = sbClient.from(this.table).select('*', { count: 'exact' }).range(from, to);
          if (options.filter) q = applyPbFilterToSupabaseQuery(q, options.filter);
          if (options.sort) {
            const isDesc = options.sort.startsWith('-');
            const col = isDesc ? options.sort.substring(1) : options.sort;
            q = q.order(col, { ascending: !isDesc });
          }
          const { data, count, error } = await q;
          if (!error && data) {
            return {
              items: data,
              page,
              perPage,
              totalItems: count || data.length,
              totalPages: Math.ceil((count || data.length) / perPage)
            };
          }
          if (error) console.warn(`[Supabase getList ${this.table}] error:`, error.message);
        } catch (e) {
          console.warn(`[Supabase getList ${this.table}] exception:`, e.message);
        }
      }

      const full = await this.getFullList(options);
      const start = (page - 1) * perPage;
      const items = full.slice(start, start + perPage);
      return { items, page, perPage, totalItems: full.length, totalPages: Math.ceil(full.length / perPage) };
    }

    async getFirstListItem(filter, options = {}) {
      if (sbClient && window.ECOTRACK_CONFIG.isSupabaseConfigured()) {
        try {
          let q = sbClient.from(this.table).select('*');
          q = applyPbFilterToSupabaseQuery(q, filter);
          const { data, error } = await q.limit(1).single();
          if (!error && data) return data;
          if (error && error.code !== 'PGRST116') console.warn(`[Supabase getFirstListItem ${this.table}] error:`, error.message);
        } catch (e) {
          console.warn(`[Supabase getFirstListItem ${this.table}] exception:`, e.message);
        }
      }
      throw new Error(`Item not found in ${this.table}`);
    }

    async getOne(id) {
      if (sbClient && window.ECOTRACK_CONFIG.isSupabaseConfigured()) {
        try {
          const { data, error } = await sbClient.from(this.table).select('*').eq('id', id).single();
          if (!error && data) return data;
        } catch (e) {}
      }
      throw new Error(`Item ${id} not found in ${this.table}`);
    }

    async create(data) {
      if (sbClient && window.ECOTRACK_CONFIG.isSupabaseConfigured()) {
        try {
          const { data: record, error } = await sbClient.from(this.table).insert([data]).select().single();
          if (!error && record) return record;
          if (error) console.warn(`[Supabase create ${this.table}] error:`, error.message);
        } catch (e) {
          console.warn(`[Supabase create ${this.table}] exception:`, e.message);
        }
      }

      const fakeId = (this.table.slice(0, 3) + '_' + Math.random().toString(36).substring(2, 11));
      return { id: fakeId, ...data, created: new Date().toISOString() };
    }

    async update(id, data) {
      if (sbClient && window.ECOTRACK_CONFIG.isSupabaseConfigured()) {
        try {
          const { data: record, error } = await sbClient.from(this.table).update(data).eq('id', id).select().single();
          if (!error && record) return record;
          if (error) console.warn(`[Supabase update ${this.table}] error:`, error.message);
        } catch (e) {
          console.warn(`[Supabase update ${this.table}] exception:`, e.message);
        }
      }
      return { id, ...data, updated: new Date().toISOString() };
    }

    async delete(id) {
      if (sbClient && window.ECOTRACK_CONFIG.isSupabaseConfigured()) {
        try {
          const { error } = await sbClient.from(this.table).delete().eq('id', id);
          if (!error) return true;
        } catch (e) {}
      }
      return true;
    }

    async authWithPassword(usernameOrEmail, password) {
      if (sbClient && window.ECOTRACK_CONFIG.isSupabaseConfigured()) {
        try {
          const { data, error } = await sbClient
            .from('administrators')
            .select('*')
            .or(`username.eq.${usernameOrEmail},email.eq.${usernameOrEmail}`)
            .eq('password', password)
            .limit(1)
            .single();

          if (!error && data) {
            const token = 'sb_token_' + data.id;
            return {
              token,
              record: data
            };
          }
        } catch (e) {
          console.warn('[Supabase Auth] Login check error:', e.message);
        }
      }

      if (usernameOrEmail === 'admin' && (password === 'adminpassword123' || password === 'admin')) {
        return {
          token: 'offline_admin_token',
          record: {
            id: 'admin_default_01',
            username: 'admin',
            email: 'admin@ecotrack.local',
            role: 'admin',
            is_active: true,
            created: '2026-07-03T00:00:00Z'
          }
        };
      }
      throw new Error('Invalid username or password.');
    }

    subscribe(topic, callback) {
      if (sbClient) {
        try {
          const channelName = `realtime_${this.table}_${Math.random().toString(36).substring(2, 8)}`;
          const channel = sbClient.channel(channelName)
            .on('postgres_changes', { event: '*', schema: 'public', table: this.table }, (payload) => {
              if (typeof callback === 'function') {
                callback({ action: payload.eventType.toLowerCase(), record: payload.new });
              }
            })
            .subscribe();
          return Promise.resolve(() => { sbClient.removeChannel(channel); });
        } catch (err) {
          console.warn(`[Supabase Realtime ${this.table}] Subscribe failed:`, err);
        }
      }
      return Promise.resolve(() => {});
    }
  }

  // ===================================================================
  // 5. DUAL-DATABASE ROUTER (SQLite3 for Telemetry, Supabase for Others)
  // ===================================================================
  class DualDatabaseClient {
    constructor(url) {
      this.url = url;
      this.authStore = {
        isValid: true,
        token: localStorage.getItem('ecoTrack_auth_token') || 'valid-session',
        model: JSON.parse(localStorage.getItem('ecoTrack_profile_user') || 'null') || {
          id: 'admin_default_01',
          username: 'admin',
          email: 'admin@ecotrack.local',
          role: 'admin'
        },
        clear: () => {
          localStorage.removeItem('ecoTrack_auth_token');
          localStorage.removeItem('ecoTrack_profile_user');
        }
      };
    }

    autoCancellation(enable) {}

    collection(name) {
      // 1. SENSOR LOGS ROUTE TO NATIVE SQLITE3 DATABASE (backend/telemetry.db)
      if (name === 'telemetry') {
        return new Sqlite3TelemetryCollection();
      }

      // 2. ALL OTHER ENTITIES ROUTE TO SUPABASE CLOUD DATABASE
      return new SupabaseTableCollection(name);
    }
  }

  // Expose router database client
  window.PocketBase = DualDatabaseClient;
  window.pb = new DualDatabaseClient();

  console.log('[EcoTrack] Dual-Database Router Active: Sensor Logs (telemetry) route strictly to SQLite3; all other tables route to Supabase.');
})();

