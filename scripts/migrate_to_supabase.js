// ===================================================================
// ECOTRACK SUPABASE DATA MIGRATION SCRIPT
// Migrates non-telemetry tables from PocketBase to Supabase.
// Sensor logs ('telemetry') are intentionally preserved on PocketBase.
//
// Usage: node scripts/migrate_to_supabase.js
// ===================================================================

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables from .env
function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf8');
  const env = {};
  content.split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const idx = line.indexOf('=');
    if (idx !== -1) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      env[key] = val;
    }
  });
  return env;
}

const env = loadEnv();
const SUPABASE_URL = process.env.SUPABASE_URL || env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY;
const PB_URL = process.env.PB_URL || env.PB_URL || 'http://127.0.0.1:8090';

if (!SUPABASE_URL || SUPABASE_URL.includes('your-project-ref') || !SUPABASE_KEY) {
  console.log('⚠️ Supabase URL or Key is not configured in .env yet.');
  console.log('   Please set SUPABASE_URL and SUPABASE_KEY in .env before running migration.');
  process.exit(0);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function fetchPb(collection) {
  try {
    const res = await fetch(`${PB_URL}/api/collections/${collection}/records?perPage=500`);
    if (res.ok) {
      const data = await res.json();
      return data.items || [];
    }
  } catch (e) {
    console.warn(`[PocketBase] Could not reach collection ${collection}:`, e.message);
  }
  return [];
}

async function migrate() {
  console.log('====================================================');
  console.log('🚀 Starting EcoTrack PocketBase -> Supabase Migration');
  console.log('   (Sensor telemetry records remain on PocketBase)');
  console.log('====================================================\n');

  // 1. Administrators
  console.log('👤 Migrating Administrators...');
  const admins = await fetchPb('administrators');
  for (const a of admins) {
    const payload = {
      id: a.id,
      username: a.username,
      email: a.email,
      role: a.role || 'admin',
      is_active: a.is_active !== undefined ? a.is_active : true
    };
    const { error } = await supabase.from('administrators').upsert(payload, { onConflict: 'username' });
    if (error) console.error(`  ❌ Failed admin ${a.username}:`, error.message);
    else console.log(`  ✅ Migrated admin ${a.username}`);
  }

  // 2. Buildings
  console.log('\n🏢 Migrating Buildings...');
  const buildings = await fetchPb('buildings');
  for (const b of buildings) {
    const payload = { id: b.id, name: b.name };
    const { error } = await supabase.from('buildings').upsert(payload, { onConflict: 'id' });
    if (error) console.error(`  ❌ Failed building ${b.name}:`, error.message);
    else console.log(`  ✅ Migrated building ${b.name}`);
  }

  // 3. Floors
  console.log('\n🪜 Migrating Floors...');
  const floors = await fetchPb('floors');
  for (const f of floors) {
    const payload = { id: f.id, name: f.name, building_id: f.building_id || null };
    const { error } = await supabase.from('floors').upsert(payload, { onConflict: 'id' });
    if (error) console.error(`  ❌ Failed floor ${f.name}:`, error.message);
    else console.log(`  ✅ Migrated floor ${f.name}`);
  }

  // 4. Rooms
  console.log('\n🚪 Migrating Rooms...');
  const rooms = await fetchPb('rooms');
  for (const r of rooms) {
    const payload = { id: r.id, name: r.name, node_limit: r.node_limit || 5, floor_id: r.floor_id || null };
    const { error } = await supabase.from('rooms').upsert(payload, { onConflict: 'id' });
    if (error) console.error(`  ❌ Failed room ${r.name}:`, error.message);
    else console.log(`  ✅ Migrated room ${r.name}`);
  }

  // 5. Nodes
  console.log('\n📡 Migrating Sensor Nodes...');
  const nodes = await fetchPb('nodes');
  for (const n of nodes) {
    const payload = {
      id: n.id,
      name: n.name,
      status: n.status || 'offline',
      temp: n.temp || 0,
      pressure: n.pressure || 0,
      rssi: n.rssi || 0,
      battery: n.battery || 0,
      wake_time: n.wake_time || '00:00',
      sleep_time: n.sleep_time || '00:00',
      interval_val: n.interval_val || 15,
      interval_unit: n.interval_unit || 'Minutes',
      room_id: n.room_id || null,
      aircon_type: n.aircon_type || 'Split Type (Inverter)'
    };
    const { error } = await supabase.from('nodes').upsert(payload, { onConflict: 'name' });
    if (error) console.error(`  ❌ Failed node ${n.name}:`, error.message);
    else console.log(`  ✅ Migrated node ${n.name}`);
  }

  // 6. Rules
  console.log('\n⚙️ Migrating Rules...');
  const rules = await fetchPb('rules');
  for (const ru of rules) {
    const payload = {
      id: ru.id,
      type: ru.type,
      condition: ru.condition,
      value: ru.value,
      unit: ru.unit,
      enabled: ru.enabled !== undefined ? ru.enabled : true,
      message: ru.message,
      duration: ru.duration || 5,
      room_id: ru.room_id || null
    };
    const { error } = await supabase.from('rules').upsert(payload, { onConflict: 'id' });
    if (error) console.error(`  ❌ Failed rule ${ru.id}:`, error.message);
    else console.log(`  ✅ Migrated rule ${ru.id}`);
  }

  // 7. Rule Nodes
  console.log('\n🔗 Migrating Rule-Node Associations...');
  const ruleNodes = await fetchPb('rule_nodes');
  for (const rn of ruleNodes) {
    const payload = { id: rn.id, rule_id: rn.rule_id, node_id: rn.node_id };
    const { error } = await supabase.from('rule_nodes').upsert(payload, { onConflict: 'id' });
    if (error) console.error(`  ❌ Failed rule_node ${rn.id}:`, error.message);
    else console.log(`  ✅ Migrated rule_node ${rn.id}`);
  }

  // 8. Notifications
  console.log('\n🔔 Migrating Notifications...');
  const notifs = await fetchPb('notifications');
  for (const nt of notifs) {
    const payload = {
      id: nt.id,
      date: nt.date,
      time: nt.time,
      content: nt.content,
      triggered: nt.triggered || false,
      room_id: nt.room_id || null
    };
    const { error } = await supabase.from('notifications').upsert(payload, { onConflict: 'id' });
    if (error) console.error(`  ❌ Failed notification ${nt.id}:`, error.message);
    else console.log(`  ✅ Migrated notification ${nt.id}`);
  }

  console.log('\n====================================================');
  console.log('✅ Migration to Supabase complete!');
  console.log('   PocketBase remains serving sensor telemetry logs.');
  console.log('====================================================');
}

migrate();
