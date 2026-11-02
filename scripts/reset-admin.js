const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const usersFile = path.join(dataDir, 'users.json');
const sessionsFile = path.join(dataDir, 'sessions.json');
const username = String(process.env.NEXTERM_ADMIN_USERNAME || '').trim();
const password = String(process.env.NEXTERM_ADMIN_PASSWORD || '');
const minimumLength = Math.max(12, Number(process.env.PASSWORD_MIN_LENGTH || 12));

function fail(message) { console.error(message); process.exit(1); }
function hashPassword(value, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(String(value), salt, 32).toString('hex')}`;
}
function writeJson(file, value) {
  const temporaryFile = `${file}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporaryFile, file);
}

if (!username || !/^[A-Za-z0-9_.@-]{3,64}$/.test(username)) fail('Set NEXTERM_ADMIN_USERNAME to the administrator name to reset.');
if (password.length < minimumLength) fail(`Set NEXTERM_ADMIN_PASSWORD to at least ${minimumLength} characters.`);
if (password.toLowerCase().includes(username.toLowerCase()) || /^(.)\1+$/.test(password)) fail('The administrator password cannot contain the username or use repeated characters.');

let users;
try { users = JSON.parse(fs.readFileSync(usersFile, 'utf8')); } catch { fail(`Unable to read ${usersFile}.`); }
if (!Array.isArray(users)) fail('users.json is not a valid user list.');
const user = users.find((item) => item && item.username === username);
if (!user) fail(`Administrator "${username}" was not found.`);

user.passwordHash = hashPassword(password);
user.mustChangePassword = false;
user.passwordResetRequired = false;
user.trustedDevices = [];
user.totpPendingSecret = '';
user.totpPendingSessionId = '';
user.totpPendingExpiresAt = '';
writeJson(usersFile, users);

// A CLI reset is normally performed while the service is stopped. Clearing
// persisted sessions also makes the reset safe across the next restart.
try {
  const sessions = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
  if (Array.isArray(sessions)) writeJson(sessionsFile, sessions.filter((session) => session?.userId !== user.id));
} catch { /* sessions.json is optional on a fresh or stopped installation */ }

console.log(`Administrator "${username}" password reset. Start/restart NexTerm before logging in, then enable MFA.`);
