const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const usersFile = path.join(dataDir, 'users.json');
const username = String(process.env.NEXTERM_ADMIN_USERNAME || '').trim();
const password = String(process.env.NEXTERM_ADMIN_PASSWORD || '');
const minimumLength = Math.max(12, Number(process.env.PASSWORD_MIN_LENGTH || 12));

function fail(message) { console.error(message); process.exit(1); }
function hashPassword(value, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(String(value), salt, 32).toString('hex')}`;
}

if (!username || !/^[A-Za-z0-9_.@-]{3,64}$/.test(username)) fail('Set NEXTERM_ADMIN_USERNAME to a 3-64 character administrator name.');
if (password.length < minimumLength) fail(`Set NEXTERM_ADMIN_PASSWORD to at least ${minimumLength} characters.`);
if (password.toLowerCase().includes(username.toLowerCase()) || /^(.)\1+$/.test(password)) fail('The administrator password cannot contain the username or use repeated characters.');

fs.mkdirSync(dataDir, { recursive:true });
let users = [];
try { users = JSON.parse(fs.readFileSync(usersFile, 'utf8')); } catch { users = []; }
if (!Array.isArray(users)) fail('users.json is not a valid user list.');
if (users.length) fail('An administrator already exists; initialization was not performed.');

users.push({ id:crypto.randomUUID(), username, role:'admin', passwordHash:hashPassword(password), mustChangePassword:false, passwordResetRequired:false, totpEnabled:false, trustedDevices:[], createdAt:new Date().toISOString() });
const temporaryFile = `${usersFile}.tmp`;
fs.writeFileSync(temporaryFile, JSON.stringify(users, null, 2), { mode:0o600 });
fs.renameSync(temporaryFile, usersFile);
console.log(`NexTerm administrator "${username}" created. Remove NEXTERM_ADMIN_PASSWORD from your shell history and environment now.`);
