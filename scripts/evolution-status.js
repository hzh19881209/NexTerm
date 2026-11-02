#!/usr/bin/env node
// Record how the AI IDE handled a user's evolution suggestion or bug report.
//
//   node scripts/evolution-status.js list [--status pending|fixed|rejected|verified]
//   node scripts/evolution-status.js show <id>
//   node scripts/evolution-status.js fix <id> [--note "终端滚动已修复"]
//   node scripts/evolution-status.js reject <id> --note "与现有设计冲突"
//   node scripts/evolution-status.js reopen <id>
//
// Run it from the repository root (or set DATA_DIR) so it edits the same
// evolutions.json the running service reads. `fix` only claims the work is done:
// the record stays "待你确认" until the user clicks 确认已修复 in the browser, which
// moves it to verified (the closed state). Re-running `fix` on a verified record
// reopens it, because a fix claim on something the user already signed off means
// the problem is back.
const fs = require('fs');
const path = require('path');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const evolutionsFile = path.join(dataDir, 'evolutions.json');
const noteMax = 500;
const commandStatuses = new Map([['fix', 'fixed'], ['reject', 'rejected'], ['reopen', 'pending']]);
const listStatuses = new Set(['pending', 'fixed', 'rejected', 'verified']);

function fail(message) { console.error(message); process.exit(1); }

const args = process.argv.slice(2);
const command = String(args[0] || 'list').toLowerCase();
const positional = [];
let note = '';
let statusFilter = '';
for (let index = 1; index < args.length; index += 1) {
  const argument = String(args[index]);
  if (argument === '--note') { note = String(args[index + 1] ?? ''); index += 1; continue; }
  if (argument.startsWith('--note=')) { note = argument.slice('--note='.length); continue; }
  if (argument === '--status') { statusFilter = String(args[index + 1] ?? ''); index += 1; continue; }
  if (argument.startsWith('--status=')) { statusFilter = argument.slice('--status='.length); continue; }
  positional.push(argument);
}

let items = [];
try { items = JSON.parse(fs.readFileSync(evolutionsFile, 'utf8')); } catch { items = []; }
if (!Array.isArray(items)) fail('evolutions.json is not a valid list.');

function writeBack() {
  fs.mkdirSync(dataDir, { recursive:true });
  const temporaryFile = `${evolutionsFile}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(items, null, 2), { mode:0o600 });
  fs.renameSync(temporaryFile, evolutionsFile);
}
function describe(item) {
  const mark = item.status === 'verified' ? '[CLOSED ]' : item.status === 'fixed' ? '[FIXED  ]' : item.status === 'rejected' ? '[REJECT ]' : '[PENDING]';
  return `${mark} ${item.id}  (${item.kind}, submitted v${item.version}) ${item.text}${item.note ? `\n           note: ${item.note}` : ''}${item.fixedVersion ? `\n           fixed in: ${item.fixedVersion}` : ''}`;
}

if (command === 'list') {
  if (statusFilter && !listStatuses.has(statusFilter)) fail('--status must be pending, fixed, verified or rejected.');
  const filtered = statusFilter ? items.filter((item) => item.status === statusFilter) : items;
  if (!filtered.length) { console.log('No evolution records.'); process.exit(0); }
  filtered.forEach((item) => console.log(describe(item)));
  const counts = ['pending', 'fixed', 'verified', 'rejected'].map((status) => `${status} ${items.filter((item) => (item.status || 'pending') === status).length}`);
  console.log(`\nTotal ${filtered.length} shown of ${items.length} (${counts.join(', ')})`);
  process.exit(0);
}
if (command === 'show') {
  const item = items.find((entry) => entry.id === positional[0]);
  if (!item) fail('Evolution record not found. Use "list" to see ids.');
  console.log(JSON.stringify(item, null, 2));
  process.exit(0);
}

const status = commandStatuses.get(command);
if (!status) fail('Unknown command. Use: list | show <id> | fix <id> | reject <id> | reopen <id>');
const target = items.find((entry) => entry.id === positional[0]);
if (!target) fail('Evolution record not found. Use "list" to see ids.');
// A verified record was already signed off by the user. Claiming it fixed again
// means the issue resurfaced, so drop it back to the unconfirmed fixed state.
if (status === 'fixed' && target.status === 'verified') target.fixedVersion = '';
target.status = status;
if (note) target.note = note.slice(0, noteMax);
// The version the fix shipped in comes from the release version file so the
// browser can show "修复于 <version>" without the caller repeating it.
let releaseVersion = '';
try { releaseVersion = String(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'version.json'), 'utf8')).version || ''); } catch { /* version file is optional */ }
target.fixedVersion = status === 'fixed' ? (target.fixedVersion || process.env.NEXTERM_VERSION || releaseVersion) : '';
target.verifiedAt = status === 'verified' ? (target.verifiedAt || new Date().toISOString()) : '';
target.updatedAt = new Date().toISOString();
writeBack();
console.log(describe(target));
