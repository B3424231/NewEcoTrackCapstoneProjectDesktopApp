'use strict';
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'artifacts/packaging');
fs.mkdirSync(out, { recursive: true });
const values = require('dotenv').parse(fs.readFileSync(path.join(root, '.env')));
const key = values.SUPABASE_ANON_KEY || values.EXPO_PUBLIC_SUPABASE_ANON_KEY;
let publicKey = key?.startsWith('sb_publishable_');
try { publicKey ||= JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon'; } catch (_) {}
if (!publicKey) throw new Error('A public Supabase key is required; private keys cannot enter an installer.');
const backend = path.join(out, 'backend/ecotrack-backend/ecotrack-backend.exe');
if (!fs.existsSync(backend)) throw new Error('Build the frozen backend before packaging Electron.');
fs.writeFileSync(path.join(out, 'ecotrack-public.json'), JSON.stringify({ SUPABASE_URL: values.SUPABASE_URL, SUPABASE_ANON_KEY: key }, null, 2));
console.log('Public cloud configuration and frozen backend verified. No private configuration copied.');
