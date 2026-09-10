// ===================================================================
// ECOTRACK SENSOR LOGS MIGRATION: PocketBase -> Supabase
// Migrates all historical sensor telemetry records from local PocketBase
// directly into the Supabase 'telemetry' table.
//
// Usage: node scripts/migrate_telemetry_to_supabase.js
// ===================================================================

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

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
      env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  });
  return env;
}

const env = loadEnv();
const SUPABASE_URL = process.env.SUPABASE_URL || env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY || '';
const PB_URL = process.env.PB_URL || env.PB_URL || 'http://127.0.0.1:8090';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function migrateTelemetry() {
  console.log('====================================================');
  console.log('ðŸš€ Migrating Sensor Logs: PocketBase -> Supabase');
  console.log(`   Supabase: ${SUPABASE_URL}`);
  console.log(`   PocketBase: ${PB_URL}`);
  console.log('====================================================\n');

  // 1. Verify Supabase telemetry table exists
  const check = await supabase.from('telemetry').select('*').limit(1);
  if (check.error) {
    console.error('âŒ Supabase table "telemetry" was not found!');
    console.error(`   Error message: ${check.error.message}\n`);
    console.log('ðŸ“‹ ACTION REQUIRED:');
    console.log('   Please run the SQL file in your Supabase Dashboard:');
    console.log('   1. Open: https://supabase.com/dashboard/project/_/sql/new');
    console.log('   2. Paste the contents of "create_telemetry_table.sql"');
    console.log('   3. Click "Run"');
    console.log('   4. Then re-run this migration script: node scripts/migrate_telemetry_to_supabase.js\n');
    return;
  }

  console.log('âœ… Supabase "telemetry" table is ready.');

  // 2. Fetch all telemetry records from PocketBase
  let pbRecords = [];
  try {
    const res = await fetch(`${PB_URL}/api/collections/telemetry/records?perPage=500&sort=created`);
    if (res.ok) {
      const data = await res.json();
      pbRecords = data.items || [];
    }
  } catch (err) {
    console.warn('âš ï¸ Could not connect to local PocketBase:', err.message);
  }

  console.log(`ðŸ“¦ Found ${pbRecords.length} records in PocketBase telemetry collection.`);
  if (!pbRecords.length) {
    console.log('No historical records to migrate.');
    return;
  }

  // 3. Batch insert into Supabase
  const batch = pbRecords.map(r => ({
    id: 'telem_' + (r.id.length === 15 ? r.id : r.id.padStart(15, '0')),
    node_id: r.node_id,
    sensor_name: r.sensor_name || r.node_id,
    room_name: r.room_name || 'Server Room A',
    floor_name: r.floor_name || '2nd Floor - IT Wing',
    building_name: r.building_name || 'Main Campus Building',
    aircon_type: r.aircon_type || 'Split Type (Inverter)',
    temperature: Number(r.temperature) || 24.0,
    pressure: Number(r.pressure) || 0.45,
    battery: Number(r.battery) || 4.0,
    rssi: Number(r.rssi) || -60,
    status: r.status || 'online',
    created: r.created ? new Date(r.created).toISOString() : new Date().toISOString()
  }));

  console.log(`â³ Inserting ${batch.length} telemetry records into Supabase...`);
  const { data: inserted, error: insertErr } = await supabase.from('telemetry').upsert(batch, { onConflict: 'id' });

  if (insertErr) {
    console.error('âŒ Failed to insert records into Supabase:', insertErr.message);
  } else {
    console.log(`âœ… Successfully migrated ${batch.length} sensor log records to Supabase!`);
  }

  // 4. Verify count in Supabase
  const { count } = await supabase.from('telemetry').select('*', { count: 'exact', head: true });
  console.log(`ðŸ“Š Total telemetry records now in Supabase: ${count}`);
}

migrateTelemetry();

