const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'public', 'js');
const violations = [];

fs.readdirSync(dir).forEach(file => {
  if (!file.endsWith('.js') || file.includes('.umd.') || file === 'seed-db.js' || file === 'data-schemas.js' || file === 'node-sync.js') return;
  const content = fs.readFileSync(path.join(dir, file), 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    if (line.includes('pb.collection(')) {
      if (!line.includes("'telemetry'") && !line.includes('"telemetry"')) {
        violations.push(`${file}:${index + 1} -> ${line.trim()}`);
      }
    }
  });
});

console.log('=== POCKETBASE SYNTAX AUDIT ===');
if (violations.length === 0) {
  console.log('SUCCESS: Exactly ZERO non-telemetry pb.collection calls found in public/js/*.js!');
} else {
  console.error(`FAILED: Found ${violations.length} non-telemetry pb.collection calls:`);
  violations.forEach(v => console.error('  ' + v));
  process.exit(1);
}
