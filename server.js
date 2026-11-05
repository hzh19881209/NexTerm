const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const { WebSocketServer } = require('ws');
const { Client: SshClient } = require('ssh2');
const SftpClient = require('ssh2-sftp-client');
const { TerminalScreen } = require('./lib/terminal-screen');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const APP_SECRET = process.env.APP_SECRET || '';
const TLS_CERT_FILE = process.env.TLS_CERT_FILE || path.join(__dirname, 'certs', 'your.domain.com.crt');
const TLS_KEY_FILE = process.env.TLS_KEY_FILE || path.join(__dirname, 'certs', 'your.domain.com.key');
// SSH sessions survive a temporarily disconnected browser. Mobile browsers
// routinely suspend tabs, so keep the remote shell alive for a grace period.
const SSH_SESSION_GRACE_MS = Math.max(60_000, Number(process.env.SSH_SESSION_GRACE_MS || 24 * 60 * 60 * 1000));
// VNC desktop sessions share the same detach/reattach grace as SSH shells so a
// suspended browser tab does not drop the Windows desktop.
const VNC_SESSION_GRACE_MS = Math.max(60_000, Number(process.env.VNC_SESSION_GRACE_MS || SSH_SESSION_GRACE_MS));
const WS_HEARTBEAT_MS = Math.max(10_000, Number(process.env.WS_HEARTBEAT_MS || 30_000));
const SERVER_STATUS_CACHE_MS = Math.max(5_000, Number(process.env.SERVER_STATUS_CACHE_MS || 15_000));
const SERVER_STATUS_CONNECT_TIMEOUT_MS = Math.max(3_000, Number(process.env.SERVER_STATUS_CONNECT_TIMEOUT_MS || 12_000));
const SERVER_STATUS_COMMAND_TIMEOUT_MS = Math.max(2_000, Number(process.env.SERVER_STATUS_COMMAND_TIMEOUT_MS || 6_000));
const SERVER_STATUS_CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.SERVER_STATUS_CONCURRENCY) || 4));
const SHELL_PID_MARKER = '__NEXTERM_SHELL_PID__';
const LOGIN_WINDOW_MS = Math.max(60_000, Number(process.env.LOGIN_WINDOW_MS || 15 * 60 * 1000));
const LOGIN_MAX_ATTEMPTS = Math.max(3, Number(process.env.LOGIN_MAX_ATTEMPTS || 5));
const LOGIN_IP_MAX_ATTEMPTS = Math.max(LOGIN_MAX_ATTEMPTS, Number(process.env.LOGIN_IP_MAX_ATTEMPTS || 30));
const LOGIN_ACCOUNT_MAX_ATTEMPTS = Math.max(LOGIN_MAX_ATTEMPTS, Number(process.env.LOGIN_ACCOUNT_MAX_ATTEMPTS || 12));
const LOGIN_LOCKOUT_MS = Math.max(60_000, Number(process.env.LOGIN_LOCKOUT_MS || 15 * 60 * 1000));
const SESSION_TTL_SECONDS = Math.max(60 * 60, Number(process.env.SESSION_TTL_SECONDS || 12 * 60 * 60));
const SESSION_COOKIE = '__Host-nexterm_session';
const SESSION_TOUCH_MS = 5 * 60 * 1000;
const PASSWORD_MIN_LENGTH = Math.max(12, Number(process.env.PASSWORD_MIN_LENGTH || 12));
const TRUSTED_DEVICE_TTL_SECONDS = Math.max(60 * 60, Number(process.env.TRUSTED_DEVICE_TTL_SECONDS || 60 * 60 * 24 * 30));
const TRUSTED_DEVICE_COOKIE = 'nexterm_trusted_device';
const KNOWN_COMPROMISED_PASSWORDS = Object.freeze(['123456']);
const KNOWN_INSECURE_APP_SECRETS = new Set([
  'replace-with-at-least-32-random-characters',
  'termhub-development-secret-change-me'
]);
const SERVER_COLORS = new Set(['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6']);
const SERVER_OS_VALUES = new Set(['windows', 'almalinux', 'centos', 'ubuntu', 'debian', 'rocky', 'fedora', 'arch', 'opensuse', 'rhel', 'alpine', 'kali', 'oracle', 'linux', 'macos', 'freebsd', 'solaris', 'aix', 'esxi', 'unknown']);
const UI_FONT_FAMILIES = new Set(['system', 'modern', 'serif', 'monospace']);
// AI approval assistant: an OpenAI-compatible chat endpoint (TokenMeter gateway,
// LM Studio, vLLM, Ollama, OpenAI, ...) that decides Codex/TUI confirmation
// prompts. Requests are made server-side so the API key never reaches the browser.
const APPROVAL_MODELS_MAX = 8;
const APPROVAL_NAME_MAX = 64;
const APPROVAL_MODEL_MAX = 256;
const APPROVAL_KEY_MAX = 4096;
const APPROVAL_TEST_TIMEOUT_MS = Math.max(3_000, Number(process.env.APPROVAL_TEST_TIMEOUT_MS || 90_000));
const APPROVAL_DECISION_TIMEOUT_MS = Math.max(3_000, Number(process.env.APPROVAL_DECISION_TIMEOUT_MS || 120_000));
// Per-account budget for model calls, so a stuck TUI redraw loop cannot spend
// unbounded upstream tokens.
const APPROVAL_DECISIONS_WINDOW_MS = 60_000;
const APPROVAL_DECISIONS_PER_WINDOW = 24;
const APPROVAL_FAILURE_COOLDOWN_MS = 120_000;
const APPROVAL_FAILURE_LIMIT = 4;
const APPROVAL_SCREEN_CONTEXT_BYTES = 6_000;
const APPROVAL_PROMPT_MAX_BYTES = 12_000;
const APPROVAL_HTTP_BODY_MAX_BYTES = 2 * 1024 * 1024;
// High-risk prompts are never auto-decided; they wait for the human.  Their
// outcomes are kept per account so later similar prompts can cite what the
// human decided before (and the model can lean on that precedent).
const APPROVAL_HIGH_RISK_MAX = 50;
const APPROVAL_HIGH_RISK_CONTEXT_BYTES = 800;
const APPROVAL_HIGH_RISK_HISTORY_LIMIT = 8;
// Reasoning models (e.g. Qwen3 with thinking enabled) burn their whole token
// budget on reasoning_content before emitting the answer, so the decision
// budget must leave room for a long thinking pass and the final JSON object.
const APPROVAL_MAX_TOKENS = 2_000;
// Non-streaming requests to reasoning endpoints are cut off by upstream
// gateways (observed 504 at ~60s) mid-thinking; stream chunks keep the
// connection alive and let the decision budget be spent fully.
const APPROVAL_STREAM = true;
const APPROVAL_CHOICE_VALUES = new Set(['approve_once', 'approve_always', 'deny', 'unsafe', 'unknown']);
// Evolution feedback: one line per suggestion/bug report, capped per submission
// and per account so the store cannot grow without bound.
const EVOLUTION_TEXT_MAX = 500;
const EVOLUTION_LINES_MAX = 40;
const EVOLUTION_TOTAL_MAX = 2_000;
const EVOLUTION_PER_USER_MAX = 300;
const EVOLUTION_NOTE_MAX = 500;
const EVOLUTION_STATUSES = new Set(['pending', 'fixed', 'rejected']);
// A record the AI IDE marked fixed stays unverified until the user confirms it,
// so the loop only closes after the reporter agrees the fix actually landed.
const EVOLUTION_VERIFIED_STATUSES = new Set(['pending', 'fixed', 'rejected', 'verified']);
const EVOLUTION_KINDS = new Set(['suggestion', 'bug']);
const EVOLUTION_WRITE_WINDOW_MS = 60_000;
const EVOLUTION_WRITES_PER_WINDOW = 6;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

if (APP_SECRET.length < 32 || KNOWN_INSECURE_APP_SECRETS.has(APP_SECRET.trim())) {
  console.error('APP_SECRET must be a non-default value with at least 32 characters.');
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });
const usersFile = path.join(DATA_DIR, 'users.json');
const serversFile = path.join(DATA_DIR, 'servers.json');
const sessionsFile = path.join(DATA_DIR, 'sessions.json');
const loginSecurityFile = path.join(DATA_DIR, 'login-security.json');
const auditFile = path.join(DATA_DIR, 'audit.log');
// User-submitted improvement suggestions and bug reports ("进化" feedback).
// The AI IDE reads this store before each development pass and writes back the
// outcome, so the browser can show which items are fixed and which were rejected.
const evolutionsFile = path.join(DATA_DIR, 'evolutions.json');
const key = crypto.createHash('sha256').update(APP_SECRET).digest();
const sessionKey = crypto.createHmac('sha256', key).update('nexterm-session-cookie-v1').digest();

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
const APP_VERSION = String(readJson(path.join(__dirname, 'public', 'version.json'), { version: '26.9.118' }).version || '26.9.118');
const DEPLOYMENT_SERVER_NAME = String(process.env.DEPLOYMENT_SERVER_NAME || os.hostname() || '未知服务器').trim() || '未知服务器';
function cpuSnapshot() {
  return os.cpus().reduce((summary, cpu) => {
    const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
    summary.idle += cpu.times.idle; summary.total += total;
    return summary;
  }, { idle:0, total:0 });
}
let previousCpuSnapshot = cpuSnapshot();
function percentage(value) { return Math.max(0, Math.min(100, Number(value) || 0)); }
function systemStatus() {
  const currentCpu = cpuSnapshot();
  const totalDelta = currentCpu.total - previousCpuSnapshot.total;
  const idleDelta = currentCpu.idle - previousCpuSnapshot.idle;
  previousCpuSnapshot = currentCpu;
  const memoryTotal = os.totalmem(); const memoryUsed = Math.max(0, memoryTotal - os.freemem());
  let disk = { total:0, used:0, usage:0 };
  try {
    const stats = fs.statfsSync(DATA_DIR);
    const total = Number(stats.blocks) * Number(stats.bsize);
    const available = Number(stats.bavail) * Number(stats.bsize);
    const used = Math.max(0, total - available);
    disk = { total, used, usage:total > 0 ? percentage((used / total) * 100) : 0 };
  } catch { /* filesystem metrics are optional on unsupported platforms */ }
  return {
    name:DEPLOYMENT_SERVER_NAME,
    version:APP_VERSION,
    cpu:{ usage:totalDelta > 0 ? percentage(((totalDelta - idleDelta) / totalDelta) * 100) : 0 },
    memory:{ total:memoryTotal, used:memoryUsed, usage:memoryTotal > 0 ? percentage((memoryUsed / memoryTotal) * 100) : 0 },
    disk
  };
}
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(String(password), salt, 32).toString('hex')}`;
}
function base32Encode(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0; let value = 0; let output = '';
  for (const byte of buffer) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { output += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}
function base32Decode(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0; let current = 0; const bytes = [];
  for (const char of String(value || '').toUpperCase().replace(/=+$/, '')) { const index = alphabet.indexOf(char); if (index < 0) continue; current = (current << 5) | index; bits += 5; if (bits >= 8) { bytes.push((current >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(bytes);
}
function totpCode(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 1000 / 30); const counterBuffer = Buffer.alloc(8); counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(counterBuffer).digest(); const offset = digest[digest.length - 1] & 15;
  return String(((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)).padStart(6, '0');
}
function verifyTotp(secret, code) {
  const value = String(code || '').replace(/\s/g, ''); if (!/^\d{6}$/.test(value) || !secret) return false;
  // Allow one adjacent 30-second time-step to accommodate clock drift.
  return [ -30_000, 0, 30_000 ].some((offset) => crypto.timingSafeEqual(Buffer.from(totpCode(secret, Date.now() + offset)), Buffer.from(value)));
}
function verifyPassword(password, encoded) {
  try {
    const [salt, expected] = String(encoded).split(':');
    const actual = crypto.scryptSync(String(password), salt, 32).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
  } catch { return false; }
}
function cookieValue(req, name) {
  for (const item of String(req.headers.cookie || '').split(';')) {
    const separator = item.indexOf('='); if (separator < 0) continue;
    if (item.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(item.slice(separator + 1).trim()); } catch { return ''; }
  }
  return '';
}
function appendSetCookie(res, value) {
  const current = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', current ? [...(Array.isArray(current) ? current : [current]), value] : value);
}
function sessionHash(secret) { return crypto.createHmac('sha256', sessionKey).update(String(secret)).digest('hex'); }
function sessionCookie(value, maxAge = SESSION_TTL_SECONDS) {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAge))}; HttpOnly; Secure; SameSite=Strict`;
}
function trustedDeviceHash(secret) { return crypto.createHash('sha256').update(String(secret)).digest('hex'); }
function trustedDeviceCookie(value, maxAge = TRUSTED_DEVICE_TTL_SECONDS) {
  return `${TRUSTED_DEVICE_COOKIE}=${encodeURIComponent(value)}; Path=/api/auth/login; Max-Age=${Math.max(0, Math.floor(maxAge))}; HttpOnly; Secure; SameSite=Strict`;
}
function pruneTrustedDevices(user) {
  const timestamp = Date.now(); const current = Array.isArray(user.trustedDevices) ? user.trustedDevices : [];
  const active = current.filter((device) => device?.id && device?.tokenHash && new Date(device.expiresAt).getTime() > timestamp);
  user.trustedDevices = active; return active.length !== current.length;
}
function verifyTrustedDevice(req, user) {
  const changed = pruneTrustedDevices(user); const raw = cookieValue(req, TRUSTED_DEVICE_COOKIE);
  const [deviceId, secret] = String(raw || '').split('.');
  if (!deviceId || !secret) { if (changed) writeJson(usersFile, users); return false; }
  const device = user.trustedDevices.find((item) => item.id === deviceId); if (!device) { if (changed) writeJson(usersFile, users); return false; }
  const actual = Buffer.from(trustedDeviceHash(secret), 'hex'); const expected = Buffer.from(String(device.tokenHash), 'hex');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) { if (changed) writeJson(usersFile, users); return false; }
  device.lastUsedAt = now(); writeJson(usersFile, users); return true;
}
function rememberTrustedDevice(req, res, user) {
  pruneTrustedDevices(user);
  const deviceId = id(); const secret = crypto.randomBytes(32).toString('base64url'); const createdAt = now();
  user.trustedDevices.push({ id: deviceId, tokenHash: trustedDeviceHash(secret), createdAt, lastUsedAt: createdAt, expiresAt: new Date(Date.now() + TRUSTED_DEVICE_TTL_SECONDS * 1000).toISOString(), userAgent: String(req.headers['user-agent'] || '').slice(0, 200) });
  user.trustedDevices = user.trustedDevices.slice(-10); writeJson(usersFile, users);
  appendSetCookie(res, trustedDeviceCookie(`${deviceId}.${secret}`));
}
function revokeTrustedDevices(res, user) {
  user.trustedDevices = []; writeJson(usersFile, users);
  appendSetCookie(res, trustedDeviceCookie('', 0));
}
function encrypt(value) {
  if (value === undefined || value === null || value === '') return value || '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`;
}
function decrypt(value) {
  if (!value || !String(value).startsWith('v1:')) return value || '';
  try {
    const [, iv, tag, ciphertext] = String(value).split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch { return ''; }
}
function id() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }
function requestIp(req) { return String(req?.ip || req?.socket?.remoteAddress || 'unknown').slice(0, 128); }
function auditEvent(type, req, user, message, details = {}) {
  const entry = { time: now(), type, message, userId: user?.id || '', username: user?.username || '', ip: requestIp(req), userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 240), details };
  try { if (fs.existsSync(auditFile) && fs.statSync(auditFile).size > 10 * 1024 * 1024) fs.renameSync(auditFile, `${auditFile}.1`); fs.appendFileSync(auditFile, `${JSON.stringify(entry)}\n`, { mode: 0o600 }); } catch (error) { console.error(`Unable to write security audit log: ${error.message}`); }
}
function recentAuditEvents(userId, limit = 8) {
  try {
    const data = fs.readFileSync(auditFile, 'utf8'); const lines = data.trim().split('\n').slice(-300).reverse(); const events = [];
    for (const line of lines) { let item; try { item = JSON.parse(line); } catch { continue; } if (item.userId !== userId) continue; events.push({ time:item.time, type:item.type, message:item.message, ip:item.ip, userAgent:item.userAgent }); if (events.length >= limit) break; }
    return events;
  } catch { return []; }
}

let users = readJson(usersFile, []);
if (!Array.isArray(users)) users = [];
if (!users.length) {
  console.error('No NexTerm administrator exists. Run the one-time scripts/create-admin.js initializer before starting the service.');
  process.exit(1);
}
let compromisedPasswordUsers = 0;
let compromisedPasswordStateChanged = false;
const compromisedPasswordUserIds = new Set();
for (const user of users) {
  if (!user) continue;
  if (user.passwordResetRequired) { compromisedPasswordUserIds.add(user.id); continue; }
  if (!KNOWN_COMPROMISED_PASSWORDS.some((candidate) => verifyPassword(candidate, user.passwordHash))) continue;
  user.passwordResetRequired = true;
  user.mustChangePassword = true;
  compromisedPasswordUserIds.add(user.id);
  compromisedPasswordUsers += 1;
  compromisedPasswordStateChanged = true;
}
if (compromisedPasswordStateChanged) writeJson(usersFile, users);
if (compromisedPasswordUsers) {
  console.error(`${compromisedPasswordUsers} administrator password(s) matched a known compromised bootstrap password. Reset with: NEXTERM_ADMIN_USERNAME=<username> NEXTERM_ADMIN_PASSWORD=<new-password> node scripts/reset-admin.js`);
}
let servers = readJson(serversFile, []);
if (!Array.isArray(servers)) servers = [];
// Backfill protocol so existing (SSH-only) servers keep working after the
// Windows desktop (VNC) feature is introduced. 'ssh' is the historical default.
{
  let migratedServers = false;
  for (const server of servers) {
    if (!server || typeof server !== 'object') continue;
    if (!server.protocol) { server.protocol = 'ssh'; migratedServers = true; }
    // A Windows host cannot be reached over SSH: it exposes the desktop via
    // VNC. Self-heal records saved as ssh (for example imported before the
    // protocol field existed) so the browser is not pointed at the wrong
    // session type and the SSH client is never dialed against a VNC port.
    if (server.os === 'windows' && server.protocol !== 'vnc') { server.protocol = 'vnc'; migratedServers = true; }
    if (server.protocol === 'vnc' && !Number.isFinite(Number(server.vncPort))) { server.vncPort = 5900; migratedServers = true; }
  }
  if (migratedServers) writeJson(serversFile, servers);
}
let sessions = readJson(sessionsFile, []);
if (!Array.isArray(sessions)) sessions = [];
let evolutions = readJson(evolutionsFile, []);
if (!Array.isArray(evolutions)) evolutions = [];
if (compromisedPasswordUserIds.size) {
  const activeSessions = sessions.filter((session) => !compromisedPasswordUserIds.has(session?.userId));
  if (activeSessions.length !== sessions.length) { sessions = activeSessions; writeJson(sessionsFile, sessions); }
}

function userPreferences(value, account = null) {
  const preferences = value && typeof value === 'object' ? value : {};
  const known = account ? approvalModels(account).map((item) => item.id) : [];
  const requested = String(preferences.approvalDefaultModelId || '');
  // A default that no longer exists (model deleted) must not linger in the record.
  const approvalDefaultModelId = requested && known.includes(requested) ? requested : '';
  return { fontFamily: UI_FONT_FAMILIES.has(preferences.fontFamily) ? preferences.fontFamily : 'system', terminalFontSize: Math.max(11, Math.min(24, Number(preferences.terminalFontSize) || 13)), approvalDefaultModelId };
}
// A pasted value can carry percent-encoding (e.g. copied from an address bar or
// a query string: "https%3A//host/v1"). Decode once so we store a clean URL and
// never surface a percent-encoded duplicate in the UI or logs.
function normalizeApprovalText(value) {
  const text = String(value || '');
  try { return decodeURIComponent(text); } catch { return text; }
}
// --- AI approval assistant: stored models ------------------------------------
// Each account owns a small list of OpenAI-compatible chat models. The upstream
// API key is stored encrypted with the app key and is never returned to the
// browser; only a masked hint is exposed.
function approvalBaseUrl(value) {
  const raw = normalizeApprovalText(value).trim();
  if (!raw) throw new Error('Base URL 不能为空');
  if (raw.length > 512) throw new Error('Base URL 过长');
  let url;
  try { url = new URL(raw); } catch { throw new Error('Base URL 格式无效'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Base URL 必须使用 http 或 https');
  if (url.username || url.password) throw new Error('Base URL 不能包含账号密码');
  if (url.search || url.hash) throw new Error('Base URL 不能包含查询参数');
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/+$/, '');
}
function approvalChatEndpoint(baseUrl) {
  // Accept both host roots and versioned bases such as /v1 or /api/v1.
  return /\/chat\/completions$/.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
}
function approvalModels(user) {
  const items = Array.isArray(user?.approvalModels) ? user.approvalModels : [];
  return items.filter((item) => item && typeof item === 'object' && item.id);
}
// The model ID field is a plain display label that is echoed to the browser in
// the auto-approval status/history. Users sometimes paste their upstream API key
// into it by mistake; mask anything that looks like a credential so it is never
// rendered in the UI. The real key still travels only inside the encrypted
// apiKey field.
const APPROVAL_SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-_.~+\/]+={0,2}/gi,
  /\b(?:sk|pk|gsk|tm|key|token)_[A-Za-z0-9]{8,}\b/gi,
  /\b[A-Za-z0-9]{16,}(?:[+\/][A-Za-z0-9]+)*(?:={0,2})\b/g,
  /[+\/]{2,}[A-Za-z0-9+/=]{16,}/g,
  /(?<=[?:=])\s*['\"]?[A-Za-z0-9+/=_\-]{20,}['\"]?/g,
  /[A-Za-z0-9+/=_\-]{16,}(:[A-Za-z0-9+/=_\-]+){2,}/g
];
// Same shapes as above, but for percent-encoded variants of a secret (e.g.
// "tm%5F..." or "sk%2D..."). Only applied on display-time masking; never stored.
const APPROVAL_SECRET_PATTERNS_ENCODED = [
  /Bearer%20[A-Za-z0-9%\-_.~+]{8,}/gi,
  /\b(?:sk|pk|gsk|tm|key|token)%5F[A-Za-z0-9]{8,}\b/gi,
  /\b[A-Za-z0-9]{16,}(?:%2F[0-9A-Za-z]+)*\b/g,
  /%2F{2,}[0-9A-Za-z%]{16,}/g,
  /(?<=[?:=])\s*['\"%5E]?(?:[0-9A-Fa-f]{2}|[A-Za-z0-9+_\-]){20,}/g,
  /(?:[0-9A-Fa-f]{2}|[A-Za-z0-9+_\-]){16,}(%3A(?:[0-9A-Fa-f]{2}|[A-Za-z0-9+_\-]+)){2,}/g
];
function approvalMaskSecrets(value) {
  let masked = String(value || '');
  for (const pattern of APPROVAL_SECRET_PATTERNS) { pattern.lastIndex = 0; masked = masked.replace(pattern, '••••（已隐藏）'); }
  for (const pattern of APPROVAL_SECRET_PATTERNS_ENCODED) { pattern.lastIndex = 0; masked = masked.replace(pattern, '••••（已隐藏）'); }
  return masked;
}
function publicApprovalModel(model) {
  const keyCiphertext = model.apiKey || '';
  const plaintext = keyCiphertext ? decrypt(keyCiphertext) : '';
  return {
    id: model.id,
    name: approvalMaskSecrets(model.name),
    baseUrl: String(model.baseUrl || ''),
    model: approvalMaskSecrets(model.model),
    hasKey: Boolean(plaintext),
    keyHint: plaintext ? `••••${plaintext.slice(-4)}` : '',
    enabled: model.enabled !== false,
    createdAt: model.createdAt || '',
    updatedAt: model.updatedAt || ''
  };
}
function cleanApprovalModelInput(body, old = {}) {
  const name = normalizeApprovalText(body.name ?? old.name ?? '').trim().slice(0, APPROVAL_NAME_MAX);
  const model = normalizeApprovalText(body.model ?? old.model ?? '').trim().slice(0, APPROVAL_MODEL_MAX);
  if (!name) throw new Error('模型名称不能为空');
  if (!model) throw new Error('模型 ID 不能为空');
  const baseUrl = approvalBaseUrl(body.baseUrl ?? old.baseUrl);
  const result = {
    ...old,
    id: old.id || id(),
    name,
    model,
    baseUrl,
    enabled: body.enabled === undefined ? old.enabled !== false : Boolean(body.enabled),
    createdAt: old.createdAt || now(),
    updatedAt: now()
  };
  if (body.apiKey !== undefined && String(body.apiKey) !== '') result.apiKey = encrypt(String(body.apiKey).trim().slice(0, APPROVAL_KEY_MAX));
  else if (!old.id) result.apiKey = '';
  return result;
}
function findApprovalModel(user, modelId) {
  return approvalModels(user).find((item) => item.id === modelId) || null;
}
// --- AI approval assistant: upstream chat call -------------------------------
function approvalHttpRequest(endpoint, apiKey, payload, timeoutMs, stream = false) {
  return new Promise((resolve, reject) => {
    let target;
    try { target = new URL(endpoint); } catch { return reject(new Error('Base URL 格式无效')); }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return reject(new Error('Base URL 必须使用 http 或 https'));
    const transport = target.protocol === 'https:' ? https : require('http');
    const body = JSON.stringify(payload);
    const request = transport.request({
      method: 'POST',
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(apiKey ? { Authorization:`Bearer ${apiKey}` } : {})
      },
      timeout: timeoutMs
    });
    request.on('response', (response) => { approvalReadResponse(response, stream).then(resolve, reject); });
    request.on('timeout', () => { request.destroy(); reject(new Error('模型服务请求超时')); });
    request.on('error', (error) => reject(new Error(error.code === 'ECONNREFUSED' ? '无法连接模型服务' : error.message)));
    request.write(body);
    request.end();
  });
}
// Assembles a chat/completions stream into the non-stream response shape, so
// approvalChatContent can consume both uniformly.
function approvalParseStream(text) {
  let content = '';
  let reasoningContent = '';
  let finishReason = '';
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (data === '[DONE]') continue;
    let frame;
    try { frame = JSON.parse(data); } catch { continue; }
    if (frame?.error) {
      const detail = String(frame.error?.message || frame.error).slice(0, 300).replace(/\s+/g, ' ');
      throw new Error(`模型服务错误：${detail || '未知错误'}`);
    }
    const choice = Array.isArray(frame?.choices) ? frame.choices[0] : null;
    const delta = choice?.delta;
    if (typeof delta?.content === 'string') content += delta.content;
    if (typeof delta?.reasoning_content === 'string') reasoningContent += delta.reasoning_content;
    if (choice?.finish_reason) finishReason = choice.finish_reason;
  }
  if (!content && !reasoningContent && !finishReason) throw new Error('模型流式响应无内容');
  return { choices: [{ finish_reason: finishReason, message: { role:'assistant', content, ...(reasoningContent ? { reasoning_content: reasoningContent } : {}) } }] };
}
// Reads the full response body (kept under APPROVAL_HTTP_BODY_MAX_BYTES) and
// resolves with the parsed result; stream responses are reassembled first.
function approvalReadResponse(response, stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    response.on('data', (chunk) => {
      size += chunk.length;
      if (size > APPROVAL_HTTP_BODY_MAX_BYTES) { response.destroy(); reject(new Error('模型响应过大')); return; }
      chunks.push(chunk);
    });
    response.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (response.statusCode >= 400) {
        const detail = text.slice(0, 300).replace(/\s+/g, ' ');
        return reject(new Error(`模型服务返回 ${response.statusCode}${detail ? `：${detail}` : ''}`));
      }
      try {
        resolve(stream ? approvalParseStream(text) : JSON.parse(text));
      } catch (error) {
        reject(error?.message?.startsWith('模型') ? error : new Error('模型响应不是有效 JSON'));
      }
    });
    response.on('error', reject);
  });
}
function approvalChatContent(result) {
  const choice = Array.isArray(result?.choices) ? result.choices[0] : null;
  const message = choice?.message;
  if (typeof message?.content === 'string' && message.content.trim()) return message.content;
  // Reasoning models sometimes answer through reasoning_content only.
  if (typeof message?.reasoning_content === 'string' && message.reasoning_content.trim()) return message.reasoning_content;
  const text = choice?.text;
  if (typeof text === 'string' && text.trim()) return text;
  throw new Error('模型未返回可用内容');
}
async function approvalChat(model, messages, options = {}) {
  const apiKey = model.apiKey ? decrypt(model.apiKey) : '';
  const stream = options.stream ?? APPROVAL_STREAM;
  const payload = {
    model: model.model,
    messages,
    temperature: options.temperature ?? 0,
    max_tokens: options.maxTokens ?? APPROVAL_MAX_TOKENS,
    stream,
    ...(stream ? { stream_options:{ include_usage:true } } : {})
  };
  // No response_format at all: runtimes are split on it (some reject
  // json_object, others only accept json_schema/text), the system prompt
  // already asks for JSON, and the caller always parses defensively.
  const result = await approvalHttpRequest(approvalChatEndpoint(model.baseUrl), apiKey, payload, options.timeoutMs || APPROVAL_DECISION_TIMEOUT_MS, stream);
  return approvalChatContent(result);
}
async function approvalChatJson(model, messages, options = {}) {
  return approvalChat(model, messages, options);
}
function parseApprovalDecision(content) {
  const text = String(content || '');
  // Tolerate code fences and prose around the JSON object.
  const match = text.match(/\{[\s\S]*\}/);
  const raw = match ? match[0] : text;
  let data;
  try { data = JSON.parse(raw); } catch { return null; }
  const choice = String(data?.choice || data?.decision || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (!APPROVAL_CHOICE_VALUES.has(choice)) return null;
  const reason = String(data?.reason || '').trim().slice(0, 400);
  const risk = String(data?.risk || '').trim().toLowerCase();
  return { choice, reason, risk: ['low', 'medium', 'high', 'critical'].includes(risk) ? risk : '' };
}
function approvalDecisionRateLimit(user) {
  const timestamp = Date.now();
  const state = user.approvalRuntime && typeof user.approvalRuntime === 'object' ? user.approvalRuntime : {};
  const recent = (Array.isArray(state.decisionTimes) ? state.decisionTimes : []).filter((time) => timestamp - Number(time) < APPROVAL_DECISIONS_WINDOW_MS);
  state.decisionTimes = recent;
  user.approvalRuntime = state;
  if (recent.length >= APPROVAL_DECISIONS_PER_WINDOW) return { blocked:true, reason:'rate_limited', retryAfterMs: APPROVAL_DECISIONS_WINDOW_MS - (timestamp - recent[0]) };
  if (Number(state.failureCount || 0) >= APPROVAL_FAILURE_LIMIT && timestamp - Number(state.failureAt || 0) < APPROVAL_FAILURE_COOLDOWN_MS) {
    return { blocked:true, reason:'upstream_failures', retryAfterMs: APPROVAL_FAILURE_COOLDOWN_MS - (timestamp - Number(state.failureAt || 0)) };
  }
  return { blocked:false };
}
function recordApprovalDecision(user) {
  const state = user.approvalRuntime && typeof user.approvalRuntime === 'object' ? user.approvalRuntime : {};
  state.decisionTimes = [...(Array.isArray(state.decisionTimes) ? state.decisionTimes : []), Date.now()].slice(-60);
  user.approvalRuntime = state;
}
function recordApprovalFailure(user) {
  const state = user.approvalRuntime && typeof user.approvalRuntime === 'object' ? user.approvalRuntime : {};
  const timestamp = Date.now();
  state.failureCount = timestamp - Number(state.failureAt || 0) < APPROVAL_FAILURE_COOLDOWN_MS ? Number(state.failureCount || 0) + 1 : 1;
  state.failureAt = timestamp;
  user.approvalRuntime = state;
}
function clearApprovalFailures(user) {
  if (user.approvalRuntime && typeof user.approvalRuntime === 'object') { user.approvalRuntime.failureCount = 0; }
}
function approvalHighRiskHistory(user) {
  const list = user?.approvalHighRisk && Array.isArray(user.approvalHighRisk.items) ? user.approvalHighRisk.items : [];
  return [...list].sort((a, b) => new Date(b.time) - new Date(a.time));
}
function recordApprovalHighRisk(account, { promptBlock, screen, decision, reason }) {
  if (!account) return;
  if (!account.approvalHighRisk || typeof account.approvalHighRisk !== 'object') account.approvalHighRisk = { items: [] };
  const clean = (value) => String(value || '').replace(/\s+\n/g, '\n').trim().slice(-APPROVAL_HIGH_RISK_CONTEXT_BYTES);
  const block = clean(promptBlock);
  account.approvalHighRisk.items = [
    { id: id(), time: now(), sessionId: String(decision?.sessionId || ''), sessionName: String(decision?.sessionName || ''), block, screen: clean(screen), choice: String(decision?.choice || 'unsafe').slice(0, 32), risk: String(decision?.risk || '').slice(0, 16), modelReason: String(decision?.reason || '').slice(0, 400), humanChoice: '', humanChoiceLabel: '', humanChoiceReason: '', resolvedAt: '' },
    ...(account.approvalHighRisk.items || []),
  ].slice(0, APPROVAL_HIGH_RISK_MAX);
  writeJson(usersFile, users);
}
// Drops every high-risk entry that belongs to the given browser terminal tab
// (identified by the client-side tab id sent on the WS connect message), or to
// an older tab whose label no longer exists because it was closed or renamed.
function clearApprovalHighRisk(account, { sessionId, sessionName } = {}) {
  if (!account || !account.approvalHighRisk || !Array.isArray(account.approvalHighRisk.items)) return;
  const byId = String(sessionId || '');
  const byName = String(sessionName || '');
  account.approvalHighRisk.items = account.approvalHighRisk.items.filter((item) => {
    if (byId && item.sessionId === byId) return false;
    // Legacy entries predate sessionId tracking; they carry no name either.
    if (!item.sessionId) return true;
    if (!byName) return false;
    return item.sessionName !== byName;
  });
  writeJson(usersFile, users);
}
function findHighRiskPrecedent(account, block) {
  const target = String(block || '').replace(/\s+/g, ' ').trim().slice(-512);
  if (target.length < 8) return null;
  const words = new Set(target.split(' ').filter((word) => word.length >= 3).slice(-24));
  if (words.size < 3) return null;
  let best = null;
  for (const entry of approvalHighRiskHistory(account)) {
    if (!entry.humanChoice) continue;
    const entryWords = new Set(String(entry.block || '').replace(/\s+/g, ' ').split(' ').filter((word) => word.length >= 3));
    let hits = 0;
    for (const word of words) if (entryWords.has(word)) hits += 1;
    const score = hits / words.size;
    if (score >= 0.5 && (!best || score > best.score)) best = { entry, score };
  }
  return best?.entry || null;
}
function resolveHighRiskEntry(account, promptKey, choice, label, reason) {
  if (!account) return null;
  const items = account.approvalHighRisk && Array.isArray(account.approvalHighRisk.items) ? account.approvalHighRisk.items : [];
  const index = items.findIndex((item) => item.promptKey === promptKey);
  if (index < 0) return null;
  const entry = items[index];
  entry.humanChoice = String(choice || '').slice(0, 32);
  entry.humanChoiceLabel = String(label || '').slice(0, 120);
  entry.humanChoiceReason = String(reason || '').slice(0, 400);
  entry.resolvedAt = now();
  writeJson(usersFile, users);
  return entry;
}
function approvalSystemPrompt() {
  return [
    '你是一个终端命令审批助手。用户在浏览器里的 SSH 终端中运行 Codex 等 AI CLI，CLI 弹出了确认提示，并给出了终端画面片段。',
    '你要判断应当按下哪个选项，只能输出一个 JSON 对象，不要输出任何解释文字或 Markdown。',
    'JSON 字段：choice、risk、reason。',
    'choice 只能是以下五个值之一：',
    'approve_once = 选择 1（Yes, proceed / 仅本次批准）。',
    'approve_always = 选择 2（Yes, and don\'t ask again / 不再询问）。',
    'deny = 选择 3（No, and tell the agent what to do differently / 拒绝）。',
    'unsafe = 命令明显危险或破坏性，必须交回人工，绝不批准。',
    'unknown = 终端片段不足以判断，交回人工。',
    'risk 只能是 low、medium、high、critical。reason 用一句简短中文说明理由。',
    '判定方法（必须按此顺序，先定作用对象，再看命令名）：',
    '1. 命令名本身不是结论，只是触发词。rm、rm -rf、dd、chmod -R、kill、truncate、docker、systemctl、pkill 等出现在画面里时，先看它作用的具体路径或对象，再决定；绝不能只因为画面里出现这些词就判 unsafe。',
    '2. 删除或清理临时、可再生的位置属于低风险日常开发操作，用 approve_once、risk 写 low：/tmp、/var/tmp、/private/tmp、/tmp 下的任意子目录或文件（例如 rm -rf /tmp/x、rm -rf /tmp/nexterm-test、rm -f /tmp/a.log）、~/.cache 与各类缓存目录、构建产物目录（dist、build、target、.next、__pycache__、node_modules）、临时工作目录、测试用的临时文件与一次性容器。这类操作不需要人工审核。',
    '3. 只有删除目标是真实数据或范围看不清时才 unsafe：/ 或 /*、~ 或 $HOME、/home、/root、/etc、/var/lib、/data、项目源码目录、数据库或备份目录、密钥凭据目录、以变量或通配符拼接且取值看不清楚的路径。',
    '4. 同一条命令里既有低风险清理又有真正的危险部分时，按最危险的那部分判定。',
    '5. 明显破坏性、不可逆或安全敏感的操作：unsafe。包括 mkfs、shutdown、reboot、dd 写设备、curl|sh 或 wget|sh、base64 解码后执行、sudo 且作用不明、删除第 3 条列出的真实数据、git push --force、git reset --hard 丢弃未保存改动、docker compose down/stop/restart 影响线上服务、systemctl stop/restart 线上服务、kill -9 生产进程、清空生产日志或数据库、改写 .env 或密钥、上传外传密钥凭据、访问生产网关或生产数据库。',
    '6. 写入项目外路径、修改系统配置、开放端口、创建远端资源、涉及账号凭据、跨主机操作、影响面大或意图不明确：deny。',
    '6a. 为完成当前开发任务而联网获取公开软件或依赖属于正常开发操作，不因“来自外部”而拒绝：用 curl/wget/git clone 从 GitHub、官方镜像、公共包仓库等可识别的公开地址下载源码、发行包或依赖，npm/pip/apt 等包管理器安装，git pull/checkout 拉取远端分支，以及为本地构建或临时验证而 docker pull 公开镜像：approve_once（risk low 或 medium）。',
    '6b. 但以下联网与远端操作仍然 deny 或 unsafe：curl 或 wget 的响应直接管道给解释器执行（curl|sh、wget|sh）；base64 或编码内容解码后执行；下载脚本/二进制后直接运行；访问凭据不明或不可识别的地址；上传或外传密钥、凭据、源码到远端。',
    '7. 只读或低风险操作：查看文件、grep/rg、ls、git status/diff/log、编译构建、跑单元测试、格式化、读取日志、创建项目内普通文件、常规开发命令：approve_once。',
    '8. 只有当同一类低风险操作在片段中反复出现、且明显是重复的同一动作时，才用 approve_always。默认优先 approve_once。',
    '9. 若片段里没有真正的待确认命令，或提示已被新的画面覆盖：unknown。',
    '10. 下载、拉取、安装动作本身只决定“是否拒绝”，不单独升级 risk：按第 6a/6b 条分类后，risk 由最终落盘对象决定（写入 /tmp、项目目录或缓存目录为 low/medium；写入项目外系统路径按第 5、6 条判）。',
    '11. 长命令会被终端折行或截断：只要下载/操作的目标是 /tmp、项目目录、缓存目录等低风险位置、来源是第 6a 条列举的可识别公开地址，就不要因为命令被截断或包含多个步骤而改判 deny 或 unknown；目标位置或来源看不清时才 unknown。',
    'reason 里必须写清被删除或被修改的具体路径。看不清作用对象时宁可 unknown 交回人工，也不要误批准。'
  ].join('\n');
}
function buildApprovalMessages(prompt) {
  return [
    { role:'system', content: approvalSystemPrompt() },
    { role:'user', content: String(prompt).slice(0, APPROVAL_PROMPT_MAX_BYTES) }
  ];
}
function approvalPromptText({ server, tabName, screen, block, note }) {
  const cleanScreen = String(screen || '').replace(/\s+\n/g, '\n').trim().slice(-APPROVAL_SCREEN_CONTEXT_BYTES);
  const cleanBlock = String(block || '').replace(/\s+\n/g, '\n').trim();
  return [
    `服务器：${String(server?.name || '')} (${String(server?.host || '')}:${Number(server?.port || 22)})，用户 ${String(server?.username || '')}`,
    `终端标签：${String(tabName || '')}`,
    note ? `补充说明：${String(note).slice(0, 400)}` : '',
    cleanBlock
      ? ['待确认提示及其要执行的命令（判定只针对这一段，画面里的其他命令与历史输出无关）：', '"""', cleanBlock, '"""', '（参考）终端画面片段：', '"""', cleanScreen, '"""'].join('\n')
      : ['终端画面片段（最后若干行）：', '"""', cleanScreen, '"""'].join('\n'),
    '请只输出 JSON。'
  ].filter(Boolean).join('\n');
}
function publicUser(user) {
  return { id: user.id, username: user.username, role: user.role || 'admin', mustChangePassword: Boolean(user.mustChangePassword), avatar: typeof user.avatar === 'string' ? user.avatar : '', preferences: userPreferences(user.preferences, user), approvalModels: approvalModels(user).map(publicApprovalModel), lastLoginAt: user.lastLoginAt || '', lastLoginIp: user.lastLoginIp || '' };
}
function pruneSessions() {
  const timestamp = Date.now(); const oldLength = sessions.length;
  sessions = sessions.filter((session) => session?.id && session?.tokenHash && session?.userId && new Date(session.expiresAt).getTime() > timestamp);
  if (sessions.length !== oldLength) writeJson(sessionsFile, sessions);
}
function createSession(req, res, user) {
  pruneSessions(); const secret = crypto.randomBytes(32).toString('base64url'); const createdAt = now();
  const session = { id:id(), userId:user.id, tokenHash:sessionHash(secret), csrfToken:crypto.randomBytes(32).toString('base64url'), createdAt, lastSeenAt:createdAt, expiresAt:new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(), ip:requestIp(req), userAgent:String(req.headers['user-agent'] || '').slice(0, 240) };
  sessions = sessions.filter((item) => item.userId !== user.id || new Date(item.expiresAt).getTime() > Date.now()).slice(-1000); sessions.push(session);
  const userSessions = sessions.filter((item) => item.userId === user.id).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  for (const old of userSessions.slice(0, Math.max(0, userSessions.length - 10))) sessions = sessions.filter((item) => item.id !== old.id);
  writeJson(sessionsFile, sessions); appendSetCookie(res, sessionCookie(`${session.id}.${secret}`)); return session;
}
function sessionFromRequest(req, touch = true) {
  pruneSessions(); const [sessionId, secret] = String(cookieValue(req, SESSION_COOKIE) || '').split('.'); if (!sessionId || !secret) return null;
  const session = sessions.find((item) => item.id === sessionId); if (!session) return null;
  const actual = Buffer.from(sessionHash(secret), 'hex'); const expected = Buffer.from(String(session.tokenHash), 'hex');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  if (touch && Date.now() - new Date(session.lastSeenAt).getTime() >= SESSION_TOUCH_MS) { session.lastSeenAt = now(); writeJson(sessionsFile, sessions); }
  return session;
}
function clearSessionCookie(res) { appendSetCookie(res, sessionCookie('', 0)); }
function revokeSessionId(sessionId) { const oldLength = sessions.length; sessions = sessions.filter((item) => item.id !== sessionId); if (sessions.length !== oldLength) writeJson(sessionsFile, sessions); }
function revokeUserSessions(userId) { const oldLength = sessions.length; sessions = sessions.filter((item) => item.userId !== userId); if (sessions.length !== oldLength) writeJson(sessionsFile, sessions); }
function authenticatedResponse(user, session, extra = {}) { return { ...extra, user:publicUser(user), csrfToken:session.csrfToken, sessionExpiresAt:session.expiresAt };
}
function cleanAvatar(value) {
  if (value === '' || value === null) return '';
  const match = String(value || '').match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/); if (!match) throw new Error('头像格式不支持');
  const buffer = Buffer.from(match[2], 'base64'); if (!buffer.length || buffer.length > 512 * 1024) throw new Error('头像不能超过 512 KB');
  return `data:image/${match[1]};base64,${buffer.toString('base64')}`;
}
// --- Evolution feedback: improvement suggestions and bug reports ------------
// Each submitted line becomes one record. The AI IDE reads the store at the
// start of a development pass and marks records fixed/rejected afterwards.
// `fixed` means "the IDE claims it is done"; the record only reaches the closed
// `verified` state once the reporter confirms it in the browser.
function publicEvolution(item) {
  const storedStatus = String(item.status || '');
  const status = EVOLUTION_VERIFIED_STATUSES.has(storedStatus) ? storedStatus : 'pending';
  return {
    id: item.id,
    text: String(item.text || ''),
    kind: EVOLUTION_KINDS.has(item.kind) ? item.kind : 'suggestion',
    status,
    note: String(item.note || ''),
    version: String(item.version || ''),
    fixedVersion: String(item.fixedVersion || ''),
    // Only a user click sets this; it is what closes the feedback loop.
    verifiedAt: status === 'verified' ? String(item.verifiedAt || '') : '',
    reopenCount: Math.max(0, Number(item.reopenCount || 0)),
    createdAt: item.createdAt || '',
    updatedAt: item.updatedAt || ''
  };
}
function evolutionsForUser(userId) {
  return evolutions.filter((item) => item && item.id && item.userId === userId).map(publicEvolution);
}
// The AI IDE records fix/reject outcomes with scripts/evolution-status.js, which
// writes this file from outside the process. Re-read it when the mtime changes
// so the browser sees those marks without a restart.
let evolutionsMtimeMs = -1;
function refreshEvolutions() {
  let mtimeMs = -1;
  try { mtimeMs = fs.statSync(evolutionsFile).mtimeMs; } catch { return; }
  if (mtimeMs === evolutionsMtimeMs) return;
  const stored = readJson(evolutionsFile, []);
  if (Array.isArray(stored)) { evolutions = stored; evolutionsMtimeMs = mtimeMs; }
}
function persistEvolutions() {
  writeJson(evolutionsFile, evolutions);
  try { evolutionsMtimeMs = fs.statSync(evolutionsFile).mtimeMs; } catch { evolutionsMtimeMs = -1; }
}
function findEvolution(evolutionId) { return evolutions.find((item) => item && item.id === evolutionId) || null; }
function evolutionWriteRateLimit(user) {
  const timestamp = Date.now();
  const state = user.evolutionRuntime && typeof user.evolutionRuntime === 'object' ? user.evolutionRuntime : {};
  const recent = (Array.isArray(state.submitTimes) ? state.submitTimes : []).filter((time) => timestamp - Number(time) < EVOLUTION_WRITE_WINDOW_MS);
  state.submitTimes = recent;
  user.evolutionRuntime = state;
  if (recent.length >= EVOLUTION_WRITES_PER_WINDOW) return { blocked:true, retryAfterMs: EVOLUTION_WRITE_WINDOW_MS - (timestamp - recent[0]) };
  return { blocked:false };
}
function recordEvolutionWrite(user) {
  const state = user.evolutionRuntime && typeof user.evolutionRuntime === 'object' ? user.evolutionRuntime : {};
  state.submitTimes = [...(Array.isArray(state.submitTimes) ? state.submitTimes : []), Date.now()].slice(-EVOLUTION_WRITES_PER_WINDOW);
  user.evolutionRuntime = state;
}
// Split the multi-line textarea into one record per non-empty line. A leading
// "bug:" / "bug：" / "缺陷:" marker classifies the line as a bug report.
function parseEvolutionLines(value) {
  const raw = String(value ?? '').replace(/\r/g, '');
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error('请至少输入一条建议或 bug 描述');
  if (lines.length > EVOLUTION_LINES_MAX) throw new Error(`单次最多提交 ${EVOLUTION_LINES_MAX} 条`);
  return lines.map((line) => {
    const kindMatch = line.match(/^(bug|缺陷|错误|故障)\s*[:：]\s*/i);
    const kind = kindMatch ? 'bug' : (/^(建议|需求|feature)\s*[:：]\s*/i.test(line) ? 'suggestion' : '');
    const text = line.replace(/^(bug|缺陷|错误|故障|建议|需求|feature)\s*[:：]\s*/i, '').trim().slice(0, EVOLUTION_TEXT_MAX);
    if (!text) throw new Error('建议或 bug 描述不能为空');
    // A line that mentions a defect explicitly still counts as a bug report.
    const resolvedKind = kind || (/(bug|报错|崩溃|异常|失效|无法|不生效|错误)/i.test(text) ? 'bug' : 'suggestion');
    return { text, kind: EVOLUTION_KINDS.has(resolvedKind) ? resolvedKind : 'suggestion' };
  });
}
function createEvolutions(user, lines) {
  const created = [];
  const timestamp = now();
  for (const line of lines) {
    const record = { id:id(), userId:user.id, username:user.username, text:line.text, kind:line.kind, status:'pending', note:'', version:APP_VERSION, fixedVersion:'', createdAt:timestamp, updatedAt:timestamp };
    evolutions.push(record);
    created.push(record);
  }
  // Keep the newest records when the caps are reached; oldest pending items are
  // pruned first so the store stays bounded without losing triaged history.
  const userRecords = evolutions.filter((item) => item.userId === user.id);
  if (userRecords.length > EVOLUTION_PER_USER_MAX) {
    const overflow = userRecords.slice(0, userRecords.length - EVOLUTION_PER_USER_MAX);
    evolutions = evolutions.filter((item) => !overflow.includes(item));
  }
  if (evolutions.length > EVOLUTION_TOTAL_MAX) evolutions = evolutions.slice(evolutions.length - EVOLUTION_TOTAL_MAX);
  persistEvolutions();
  return created.map(publicEvolution);
}
function serverColor(value) { const color = String(value || '').toLowerCase(); return SERVER_COLORS.has(color) ? color : ''; }
function serverOs(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const aliases = { win:'windows', win10:'windows', win11:'windows', 'windows server':'windows', alma:'almalinux', 'alma linux':'almalinux', 'red hat':'rhel', redhat:'rhel', rocky:'rocky', rockylinux:'rocky', 'rocky linux':'rocky', suse:'opensuse', opensuse:'opensuse', 'open suse':'opensuse', 'mac os':'macos', 'os x':'macos' };
  const candidate = aliases[normalized] || normalized;
  return SERVER_OS_VALUES.has(candidate) ? candidate : '';
}
function normalizeHostFingerprint(value) {
  const fingerprint = String(value || '').trim(); if (!fingerprint) return '';
  if (!/^SHA256:[A-Za-z0-9+/]{43}$/.test(fingerprint)) throw new Error('SSH 主机指纹格式应为 SHA256:...');
  return fingerprint;
}
function fingerprintHostKey(hostKey) { return `SHA256:${crypto.createHash('sha256').update(Buffer.from(hostKey)).digest('base64').replace(/=+$/, '')}`; }
function publicServer(server) {
  const out = { id: server.id, name: server.name, host: server.host, port: server.port, username: server.username, authType: server.authType, group: server.group || '', color: serverColor(server.color), os: serverOs(server.os), protocol: serverProtocol(server), hostFingerprint:server.hostFingerprint || '', hostKeyPinnedAt:server.hostKeyPinnedAt || '', createdAt: server.createdAt, updatedAt: server.updatedAt };
  if (server.os === 'windows') {
    out.sftpBridgeEnabled = server.sftpBridgeEnabled === true;
    out.sftpBridgePort = Number(server.sftpBridgePort || 2222);
    out.sftpBridgeRoot = String(server.sftpBridgeRoot || 'C:\\');
    out.sftpBridgeUser = String(server.sftpBridgeUser || server.username || '');
    out.sftpBridgeAuth = server.sftpBridgeAuth === 'key' ? 'key' : 'password';
    out.sftpFingerprint = server.sftpFingerprint || '';
    out.sftpFingerprintPinnedAt = server.sftpFingerprintPinnedAt || '';
  }
  return out;
}
function serverProtocol(server) {
  const raw = String(typeof server === 'string' ? server : server?.protocol || '').trim().toLowerCase();
  return raw === 'vnc' ? 'vnc' : 'ssh';
}
function sshConfig(server) {
  const config = { host: server.host, port: Number(server.port || 22), username: server.username, readyTimeout: 15000, keepaliveInterval: 10000, keepaliveCountMax: 3, hostVerifier:(hostKey) => {
    const fingerprint = fingerprintHostKey(hostKey);
    if (server.hostFingerprint) { const valid = server.hostFingerprint === fingerprint; if (!valid) auditEvent('ssh.host_key_mismatch', null, null, 'SSH 主机指纹发生变化，连接已拒绝', { serverId:server.id, serverName:server.name, expected:server.hostFingerprint, received:fingerprint }); return valid; }
    server.hostFingerprint = fingerprint; server.hostKeyPinnedAt = now(); writeJson(serversFile, servers); auditEvent('ssh.host_key_pinned', null, null, '已固定 SSH 主机指纹', { serverId:server.id, serverName:server.name, fingerprint }); return true;
  } };
  if (server.authType === 'key') {
    config.privateKey = decrypt(server.privateKey);
    if (server.passphrase) config.passphrase = decrypt(server.passphrase);
  } else config.password = decrypt(server.password);
  return config;
}
function safeSshClient() {
  const client = new SshClient();
  client.on('error', (error) => {
    // Guarantee the fatal error reaches a listener even if a code path forgot
    // to attach one before connect(); an unhandled 'error' event would crash
    // the process (see the uncaughtException guard above).
    if (client.listenerCount('error') <= 1) {
      try { auditEvent('ssh.client_error', null, null, `SSH 连接错误：${error.message}`, { host: client.config?.host, port: client.config?.port }); } catch { /* best-effort */ }
      try { client.end(); } catch { /* already closed */ }
    }
  });
  return client;
}
function sshErrorMessage(error) { const message = String(error?.message || 'SSH 连接失败'); return /host.*(denied|verif)|verification failed/i.test(message) ? 'SSH 主机指纹不匹配，连接已拒绝；请核对服务器指纹后再更新配置' : message; }
const serverStatusCache = new Map();
const serverStatusRequests = new Map();
const SERVER_STATUS_COMMAND = "LC_ALL=C; printf '__NEXTERM_CPU_1__ '; head -n 1 /proc/stat; awk '/^MemTotal:/ { total=$2 } /^MemAvailable:/ { available=$2 } END { printf \"__NEXTERM_MEM__ %s %s\\n\", total, available }' /proc/meminfo; df -Pk / | awk 'NR == 2 { gsub(/%/, \"\", $5); printf \"__NEXTERM_DISK__ %s\\n\", $5 }'; sleep 0.25; printf '__NEXTERM_CPU_2__ '; head -n 1 /proc/stat";
function serverStatusSignature(server) { return [server.host, server.port, server.username, server.authType, server.updatedAt].join('\u0000'); }
function parseCpuLine(line) {
  const values = String(line || '').trim().split(/\s+/).slice(1, 9).map(Number);
  if (values.length < 4 || values.some((value) => !Number.isFinite(value))) return null;
  return { idle:(values[3] || 0) + (values[4] || 0), total:values.reduce((sum, value) => sum + value, 0) };
}
function parseServerStatusOutput(output) {
  const cpu1 = parseCpuLine(String(output).match(/__NEXTERM_CPU_1__\s+(cpu[^\r\n]*)/)?.[1]);
  const cpu2 = parseCpuLine(String(output).match(/__NEXTERM_CPU_2__\s+(cpu[^\r\n]*)/)?.[1]);
  const memory = String(output).match(/__NEXTERM_MEM__\s+(\d+)\s+(\d+)/);
  const disk = String(output).match(/__NEXTERM_DISK__\s+(\d+(?:\.\d+)?)/);
  if (!cpu1 || !cpu2 || !memory || !disk) throw new Error('目标服务器未返回完整的资源信息');
  const totalDelta = cpu2.total - cpu1.total; const idleDelta = cpu2.idle - cpu1.idle;
  const memoryTotal = Number(memory[1]); const memoryAvailable = Number(memory[2]);
  if (totalDelta <= 0 || memoryTotal <= 0) throw new Error('目标服务器返回的资源信息无效');
  return {
    available:true,
    cpu:percentage(((totalDelta - idleDelta) / totalDelta) * 100),
    memory:percentage(((memoryTotal - memoryAvailable) / memoryTotal) * 100),
    disk:percentage(Number(disk[1])),
    updatedAt:now()
  };
}
function executeServerStatusCommand(client) {
  return new Promise((resolve, reject) => {
    let settled = false; let stream; const chunks = []; let size = 0;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(value); };
    const timer = setTimeout(() => { try { stream?.close(); } catch { /* already closed */ } finish(new Error('读取目标服务器状态超时')); }, SERVER_STATUS_COMMAND_TIMEOUT_MS);
    client.exec(SERVER_STATUS_COMMAND, (error, nextStream) => {
      if (error) return finish(error);
      stream = nextStream;
      stream.on('data', (chunk) => { if (size >= 64 * 1024) return; const buffer = Buffer.from(chunk); chunks.push(buffer); size += buffer.length; });
      stream.on('error', (streamError) => finish(streamError));
      stream.on('close', () => {
        try { finish(null, parseServerStatusOutput(Buffer.concat(chunks).toString('utf8'))); }
        catch (parseError) { finish(parseError); }
      });
    });
  });
}
function reusableServerStatusClient(serverId) {
  for (const session of sshSessions.values()) if (session.serverId === serverId && session.connected && !session.destroyed && session.client) return session.client;
  return null;
}
function queryServerStatus(server) {
  const reusableClient = reusableServerStatusClient(server.id);
  if (reusableClient) return executeServerStatusCommand(reusableClient);
  return new Promise((resolve, reject) => {
    const client = safeSshClient(); let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); client.end(); if (error) reject(error); else resolve(value); };
    const timer = setTimeout(() => finish(new Error('连接目标服务器超时')), SERVER_STATUS_CONNECT_TIMEOUT_MS);
    client.once('ready', () => executeServerStatusCommand(client).then((status) => finish(null, status), finish));
    client.once('error', (error) => finish(error));
    try { client.connect(sshConfig(server)); } catch (error) { finish(error); }
  });
}
function getServerStatus(server) {
  const signature = serverStatusSignature(server); const cached = serverStatusCache.get(server.id);
  if (cached?.signature === signature && Date.now() - cached.timestamp < SERVER_STATUS_CACHE_MS) return Promise.resolve(cached.status);
  const current = serverStatusRequests.get(server.id);
  if (current?.signature === signature) return current.promise;
  const promise = queryServerStatus(server).catch(() => ({ available:false, updatedAt:now() })).then((status) => {
    const currentServer = findServer(server.id);
    if (currentServer && serverStatusSignature(currentServer) === signature) serverStatusCache.set(server.id, { signature, timestamp:Date.now(), status });
    return status;
  }).finally(() => { if (serverStatusRequests.get(server.id)?.promise === promise) serverStatusRequests.delete(server.id); });
  serverStatusRequests.set(server.id, { signature, promise });
  return promise;
}
async function getAllServerStatuses() {
  const results = new Array(servers.length); let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < servers.length) {
      const index = nextIndex; nextIndex += 1; const target = servers[index];
      results[index] = { id:target.id, ...(await getServerStatus(target)) };
    }
  };
  await Promise.all(Array.from({ length:Math.min(SERVER_STATUS_CONCURRENCY, servers.length) }, worker));
  return results;
}
function cleanServerInput(body, old = {}) {
  const name = String(body.name || '').trim();
  const host = String(body.host || '').trim();
  const username = String(body.username || '').trim();
  if (!name || !host || !username) throw new Error('名称、主机和用户名不能为空');
  const authType = body.authType === 'key' ? 'key' : 'password';
  const nextHost = host; const nextPort = Math.max(1, Math.min(65535, Number(body.port) || 22)); const endpointChanged = old.id && (old.host !== nextHost || Number(old.port || 22) !== nextPort);
  const requestedOs = body.os !== undefined ? body.os : (body.operatingSystem !== undefined ? body.operatingSystem : old.os);
  const requestedProtocol = body.protocol !== undefined ? body.protocol : old.protocol;
  const result = { ...old, name, host:nextHost, username, authType, port:nextPort, group: String(body.group || '').trim(), color: serverColor(body.color !== undefined ? body.color : old.color), os:serverOs(requestedOs), protocol:serverProtocol(requestedProtocol), hostFingerprint:body.hostFingerprint !== undefined ? normalizeHostFingerprint(body.hostFingerprint) : (endpointChanged ? '' : old.hostFingerprint || ''), hostKeyPinnedAt:endpointChanged ? '' : old.hostKeyPinnedAt || '', updatedAt: now() };
  if (!old.id) { result.id = id(); result.createdAt = now(); }
  if (result.protocol === 'vnc') {
    const vncPort = body.vncPort !== undefined && body.vncPort !== '' ? Number(body.vncPort) : (old.vncPort !== undefined ? Number(old.vncPort) : 5900);
    result.vncPort = Number.isFinite(vncPort) && vncPort >= 1 && vncPort <= 65535 ? vncPort : 5900;
    // Windows SFTP bridge: when enabled, NexTerm dials a local SFTP server on
    // the Windows host so the browser's SFTP panel can manage files.
    result.sftpBridgeEnabled = body.sftpBridgeEnabled === true;
    if (result.sftpBridgeEnabled) {
      const bridgePort = Number(body.sftpBridgePort || 2222);
      result.sftpBridgePort = Number.isFinite(bridgePort) && bridgePort >= 1 && bridgePort <= 65535 ? bridgePort : 2222;
      const root = String(body.sftpBridgeRoot || '').trim();
      result.sftpBridgeRoot = root || 'C:\\';
      result.sftpBridgeUser = String(body.sftpBridgeUser || '').trim() || username;
      result.sftpBridgeAuth = body.sftpBridgeAuth === 'key' ? 'key' : 'password';
      if (result.sftpBridgeAuth === 'key') {
        result.sftpBridgePrivateKey = body.sftpBridgePrivateKey ? encrypt(body.sftpBridgePrivateKey) : (old.sftpBridgePrivateKey || '');
        result.sftpBridgePassphrase = body.sftpBridgePassphrase !== undefined ? encrypt(body.sftpBridgePassphrase) : (old.sftpBridgePassphrase || '');
        result.sftpBridgePassword = '';
        if (!old.sftpBridgePrivateKey && !body.sftpBridgePrivateKey) throw new Error('Windows SFTP 启用私钥认证时需提供私钥');
      } else {
        const pw = body.sftpBridgePassword !== undefined && body.sftpBridgePassword !== '' ? body.sftpBridgePassword : (old.sftpBridgePassword ? decrypt(old.sftpBridgePassword) : '');
        result.sftpBridgePassword = pw ? encrypt(pw) : (old.sftpBridgePassword || '');
        result.sftpBridgePrivateKey = ''; result.sftpBridgePassphrase = '';
        if (!old.sftpBridgePassword && !body.sftpBridgePassword) throw new Error('Windows SFTP 启用密码认证时需提供密码');
      }
    } else {
      result.sftpBridgePort = old.sftpBridgePort || 2222;
      result.sftpBridgeRoot = old.sftpBridgeRoot || 'C:\\';
      result.sftpBridgeUser = old.sftpBridgeUser || username;
      result.sftpBridgeAuth = old.sftpBridgeAuth || 'password';
    }
    // Fingerprint TOFU is kept across endpoint edits but cleared if the SFTP
    // endpoint (host or port) changes.
    const sftpEndpointChanged = old.sftpFingerprint && (old.sftpBridgePort !== result.sftpBridgePort || old.host !== nextHost);
    if (sftpEndpointChanged) { result.sftpFingerprint = ''; result.sftpFingerprintPinnedAt = ''; }
    else if (body.sftpFingerprint !== undefined) { result.sftpFingerprint = normalizeHostFingerprint(body.sftpFingerprint); }
  }
  if (authType === 'key') {
    if (body.privateKey) result.privateKey = encrypt(body.privateKey);
    if (body.passphrase !== undefined) result.passphrase = encrypt(body.passphrase);
    result.password = '';
  } else {
    if (body.password !== undefined && body.password !== '') result.password = encrypt(body.password);
    if (!old.id && !result.password) throw new Error('密码不能为空');
    result.privateKey = ''; result.passphrase = '';
  }
  return result;
}

const storedLoginSecurity = readJson(loginSecurityFile, {});
const loginSecurity = new Map(storedLoginSecurity && typeof storedLoginSecurity === 'object' ? Object.entries(storedLoginSecurity) : []);
function persistLoginSecurity() { writeJson(loginSecurityFile, Object.fromEntries(loginSecurity)); }
function securityRecord(key) {
  const current = loginSecurity.get(key); const timestamp = Date.now();
  if (!current || timestamp - current.windowStartedAt > LOGIN_WINDOW_MS) { const fresh = { windowStartedAt: timestamp, failures: 0, lockedUntil: 0, lastSeenAt: timestamp }; loginSecurity.set(key, fresh); return fresh; }
  current.lastSeenAt = timestamp; return current;
}
function pruneLoginSecurity() {
  const timestamp = Date.now(); let changed = false;
  for (const [key, record] of loginSecurity) if (timestamp - record.lastSeenAt > LOGIN_WINDOW_MS && record.lockedUntil < timestamp) { loginSecurity.delete(key); changed = true; }
  if (loginSecurity.size <= 10_000) { if (changed) persistLoginSecurity(); return; }
  const entries = [...loginSecurity.entries()].sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
  for (const [key] of entries.slice(0, loginSecurity.size - 10_000)) { loginSecurity.delete(key); changed = true; }
  if (changed) persistLoginSecurity();
}
function loginClientIp(req) { return requestIp(req); }
function loginLimitStatus(req, username) {
  pruneLoginSecurity(); const ipKey = `ip:${loginClientIp(req)}`; const accountKey = `account:${String(username || '').toLowerCase().slice(0, 128)}`;
  const timestamp = Date.now(); const records = [securityRecord(ipKey), securityRecord(accountKey)]; const locked = records.find((record) => record.lockedUntil > timestamp);
  if (!locked) return { ipKey, accountKey, records };
  return { ipKey, accountKey, records, retryAfter: Math.max(1, Math.ceil((locked.lockedUntil - timestamp) / 1000)) };
}
function recordLoginFailure(limit) {
  const [ipRecord, accountRecord] = limit.records; const timestamp = Date.now();
  ipRecord.failures += 1; accountRecord.failures += 1; ipRecord.lastSeenAt = timestamp; accountRecord.lastSeenAt = timestamp;
  if (accountRecord.failures >= LOGIN_ACCOUNT_MAX_ATTEMPTS) accountRecord.lockedUntil = timestamp + LOGIN_LOCKOUT_MS;
  if (ipRecord.failures >= LOGIN_IP_MAX_ATTEMPTS) ipRecord.lockedUntil = timestamp + LOGIN_LOCKOUT_MS;
  persistLoginSecurity();
}
function clearLoginFailures(limit) { loginSecurity.delete(limit.accountKey); loginSecurity.delete(limit.ipKey); persistLoginSecurity(); }

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.use((req, res, next) => {
  const requestHost = String(req.headers.host || '').replace(/[^A-Za-z0-9.:[\]-]/g, '');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  res.setHeader('Content-Security-Policy', `default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'${requestHost ? ` wss://${requestHost}` : ''}; font-src 'self' data:`);
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

function auth(req, res, next) {
  const session = sessionFromRequest(req); const account = session && users.find((item) => item.id === session.userId);
  if (!session || !account) { clearSessionCookie(res); return res.status(401).json({ error: '登录已过期，请重新登录' }); }
  req.session = session; req.account = account; next();
}
function csrf(req, res, next) {
  const value = String(req.headers['x-csrf-token'] || ''); const expected = String(req.session?.csrfToken || '');
  const actualBuffer = Buffer.from(value); const expectedBuffer = Buffer.from(expected);
  if (!value || actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return res.status(403).json({ error: '安全校验失败，请刷新页面后重试', code: 'CSRF_INVALID' });
  next();
}
function passwordChanged(req, res, next) {
  if (req.account.passwordResetRequired) return res.status(403).json({ error: '管理员密码已失效，请先完成安全重置', code: 'PASSWORD_RESET_REQUIRED' });
  if (req.account.mustChangePassword) return res.status(403).json({ error: '请先修改初始密码', code: 'PASSWORD_CHANGE_REQUIRED' });
  next();
}
function findServer(serverId) { return servers.find((server) => server.id === serverId); }
function serverOr404(req, res) {
  const server = findServer(req.params.id);
  if (!server) { res.status(404).json({ error: '服务器不存在' }); return null; }
  return server;
}
function sftpPath(input) {
  const value = String(input || '/');
  return value.startsWith('/') ? path.posix.normalize(value) : path.posix.normalize(`/${value}`);
}
function uploadRelativePath(input, fallbackName) {
  const raw = String(input || fallbackName || '').replace(/\\/g, '/');
  const segments = raw.split('/').filter((segment) => segment && segment !== '.');
  if (!segments.length) throw new Error('无效的上传路径');
  for (const segment of segments) {
    if (segment === '..' || segment.includes('\0') || segment === ':' || segment.startsWith(':')) throw new Error('无效的上传路径');
  }
  return segments.join('/');
}

app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'NexTerm', version: APP_VERSION }));
app.get('/api/version', auth, passwordChanged, (_req, res) => res.json({ name: 'NexTerm', version: APP_VERSION }));
app.get('/api/system/status', auth, passwordChanged, (_req, res) => res.json(systemStatus()));
app.post('/api/auth/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const limit = loginLimitStatus(req, username);
  if (limit.retryAfter) { res.setHeader('Retry-After', String(limit.retryAfter)); return res.status(429).json({ error: `登录尝试过多，请 ${limit.retryAfter} 秒后重试`, code: 'LOGIN_RATE_LIMITED', retryAfter: limit.retryAfter }); }
  const user = users.find((item) => item.username === username);
  if (user?.passwordResetRequired) {
    auditEvent('auth.login_blocked', req, user, '管理员密码需要重置');
    return res.status(403).json({ error: '管理员密码已失效，请先使用安全的管理员重置流程设置新密码', code: 'PASSWORD_RESET_REQUIRED' });
  }
  if (!user || !verifyPassword(password, user.passwordHash)) { recordLoginFailure(limit); auditEvent('auth.login_failed', req, user, '登录失败：用户名或密码错误', { attemptedUsername:username.slice(0, 128) }); const locked = loginLimitStatus(req, username); if (locked.retryAfter) { res.setHeader('Retry-After', String(locked.retryAfter)); return res.status(429).json({ error: `登录失败次数过多，请 ${locked.retryAfter} 秒后重试`, code: 'LOGIN_LOCKED', retryAfter: locked.retryAfter }); } return res.status(401).json({ error: '用户名或密码错误' }); }
  const trustedDevice = user.totpEnabled && verifyTrustedDevice(req, user);
  let totpVerified = false;
  if (user.totpEnabled && !trustedDevice) {
    const otp = String(req.body.otp || '').replace(/\s/g, '');
    const otpError = !otp ? { error: '请输入动态验证码', code: 'TOTP_REQUIRED' } : { error: '动态验证码错误，请重新输入', code: 'TOTP_INVALID' };
    if (!otp || !verifyTotp(decrypt(user.totpSecret), otp)) {
      recordLoginFailure(limit); auditEvent('auth.mfa_failed', req, user, '登录失败：动态验证码无效'); const locked = loginLimitStatus(req, username);
      if (locked.retryAfter) { res.setHeader('Retry-After', String(locked.retryAfter)); return res.status(429).json({ error: `登录失败次数过多，请 ${locked.retryAfter} 秒后重试`, code: 'LOGIN_LOCKED', retryAfter: locked.retryAfter }); }
      return res.status(401).json(otpError);
    }
    totpVerified = true;
  }
  clearLoginFailures(limit);
  if (user.totpEnabled && totpVerified && req.body.rememberDevice === true) rememberTrustedDevice(req, res, user);
  const previousLogin = user.lastLoginAt ? { at:user.lastLoginAt, ip:user.lastLoginIp || '', userAgent:user.lastLoginUserAgent || '' } : null;
  user.lastLoginAt = now(); user.lastLoginIp = requestIp(req); user.lastLoginUserAgent = String(req.headers['user-agent'] || '').slice(0, 240); writeJson(usersFile, users);
  const session = createSession(req, res, user); auditEvent('auth.login_success', req, user, '登录成功', { trustedDevice:Boolean(trustedDevice), mfaVerified:totpVerified });
  res.json(authenticatedResponse(user, session, { trustedDevice:Boolean(trustedDevice || (totpVerified && req.body.rememberDevice === true)), previousLogin }));
});
app.get('/api/auth/me', auth, (req, res) => res.json(authenticatedResponse(req.account, req.session)));
app.post('/api/auth/logout', auth, csrf, (req, res) => {
  revokeSessionId(req.session.id); closeSessionRuntime(req.session.id); clearSessionCookie(res); auditEvent('auth.logout', req, req.account, '已注销当前会话'); res.json({ ok:true });
});
app.put('/api/auth/profile', auth, csrf, passwordChanged, (req, res) => {
  try {
    if (req.body.avatar !== undefined) req.account.avatar = cleanAvatar(req.body.avatar);
    if (req.body.preferences !== undefined) req.account.preferences = userPreferences(req.body.preferences, req.account);
    writeJson(usersFile, users); auditEvent('profile.updated', req, req.account, '个人设置已更新'); res.json(authenticatedResponse(req.account, req.session));
  } catch (error) { res.status(400).json({ error: error.message || '个人设置保存失败' }); }
});
app.post('/api/auth/change-password', auth, csrf, (req, res) => {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');
  if (!verifyPassword(currentPassword, req.account.passwordHash)) return res.status(400).json({ error: '当前密码错误' });
  if (newPassword.length < PASSWORD_MIN_LENGTH) return res.status(400).json({ error: `新密码至少需要 ${PASSWORD_MIN_LENGTH} 位` });
  if (newPassword.toLowerCase().includes(req.account.username.toLowerCase()) || /^(.)\1+$/.test(newPassword)) return res.status(400).json({ error: '新密码不能包含用户名或使用重复字符' });
  if (newPassword !== String(req.body.confirmPassword || '')) return res.status(400).json({ error: '两次输入的新密码不一致' });
  req.account.passwordHash = hashPassword(newPassword); req.account.mustChangePassword = false; req.account.passwordResetRequired = false; revokeTrustedDevices(res, req.account);
  revokeUserSessions(req.account.id); revokeUserRuntime(req.account.id); const session = createSession(req, res, req.account); auditEvent('auth.password_changed', req, req.account, '密码已修改，旧会话已撤销');
  res.json(authenticatedResponse(req.account, session));
});
app.get('/api/auth/2fa/status', auth, passwordChanged, (req, res) => {
  if (pruneTrustedDevices(req.account)) writeJson(usersFile, users);
  res.json({ enabled: Boolean(req.account.totpEnabled), trustedDeviceCount: req.account.trustedDevices.length, recentEvents:recentAuditEvents(req.account.id, 8) });
});
app.post('/api/auth/2fa/setup', auth, csrf, passwordChanged, async (req, res) => {
  if (!verifyPassword(String(req.body.currentPassword || ''), req.account.passwordHash)) return res.status(400).json({ error:'当前密码错误' });
  if (req.account.totpEnabled && !verifyTotp(decrypt(req.account.totpSecret), req.body.currentOtp)) return res.status(400).json({ error:'当前动态验证码错误' });
  const secret = base32Encode(crypto.randomBytes(20));
  req.account.totpPendingSecret = encrypt(secret); req.account.totpPendingSessionId = req.session.id; req.account.totpPendingExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); writeJson(usersFile, users); auditEvent('auth.mfa_setup_started', req, req.account, req.account.totpEnabled ? '已验证身份并开始重新绑定 MFA' : '已验证身份并开始启用 MFA');
  const label = encodeURIComponent(`NexTerm:${req.account.username}`); const issuer = encodeURIComponent('NexTerm');
  // Explicitly include the OATH-TOTP defaults so clients such as FreeOTP can
  // import the URI without having to infer algorithm, digits, or period.
  const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
  try {
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { errorCorrectionLevel: 'M', margin: 2, width: 240 });
    res.json({ secret, otpauthUrl, qrDataUrl });
  } catch (error) {
    res.status(500).json({ error: error.message || '二维码生成失败' });
  }
});
app.post('/api/auth/2fa/enable', auth, csrf, passwordChanged, (req, res) => {
  const secret = decrypt(req.account.totpPendingSecret);
  if (req.account.totpPendingSessionId !== req.session.id || new Date(req.account.totpPendingExpiresAt || 0).getTime() < Date.now()) return res.status(400).json({ error:'MFA 绑定授权已过期，请重新验证身份' });
  if (!secret || !verifyTotp(secret, req.body.otp)) return res.status(400).json({ error: '动态验证码错误或已过期' });
  const rebind = Boolean(req.account.totpEnabled); req.account.totpSecret = req.account.totpPendingSecret; req.account.totpPendingSecret = ''; req.account.totpPendingSessionId = ''; req.account.totpPendingExpiresAt = ''; req.account.totpEnabled = true; revokeTrustedDevices(res, req.account);
  revokeUserSessions(req.account.id); revokeUserRuntime(req.account.id); const session = createSession(req, res, req.account); auditEvent(rebind ? 'auth.mfa_rebound' : 'auth.mfa_enabled', req, req.account, rebind ? 'MFA 已重新绑定，旧会话已撤销' : 'MFA 已启用，旧会话已撤销');
  res.json(authenticatedResponse(req.account, session, { enabled:true }));
});
app.post('/api/auth/2fa/disable', auth, csrf, passwordChanged, (req, res) => {
  if (!verifyPassword(String(req.body.currentPassword || ''), req.account.passwordHash)) return res.status(400).json({ error: '当前密码错误' });
  if (!verifyTotp(decrypt(req.account.totpSecret), req.body.otp)) return res.status(400).json({ error: '动态验证码错误' });
  req.account.totpSecret = ''; req.account.totpPendingSecret = ''; req.account.totpPendingSessionId = ''; req.account.totpPendingExpiresAt = ''; req.account.totpEnabled = false; revokeTrustedDevices(res, req.account);
  revokeUserSessions(req.account.id); revokeUserRuntime(req.account.id); const session = createSession(req, res, req.account); auditEvent('auth.mfa_disabled', req, req.account, 'MFA 已停用，旧会话已撤销'); res.json(authenticatedResponse(req.account, session, { enabled:false }));
});
app.post('/api/auth/2fa/trusted-devices/revoke', auth, csrf, passwordChanged, (req, res) => {
  if (!verifyPassword(String(req.body.currentPassword || ''), req.account.passwordHash)) return res.status(400).json({ error: '当前密码错误' });
  if (!verifyTotp(decrypt(req.account.totpSecret), req.body.otp)) return res.status(400).json({ error: '动态验证码错误' });
  revokeTrustedDevices(res, req.account); revokeUserSessions(req.account.id); revokeUserRuntime(req.account.id); const session = createSession(req, res, req.account); auditEvent('auth.trusted_devices_revoked', req, req.account, '所有受信任设备及旧会话已撤销'); res.json(authenticatedResponse(req.account, session, { trustedDeviceCount:0 }));
});

// --- AI approval assistant: settings API ------------------------------------
app.get('/api/approval-models', auth, passwordChanged, (req, res) => {
  res.json({ models: approvalModels(req.account).map(publicApprovalModel) });
});
app.post('/api/approval-models', auth, csrf, passwordChanged, (req, res) => {
  try {
    const list = approvalModels(req.account);
    if (list.length >= APPROVAL_MODELS_MAX) throw new Error(`最多保存 ${APPROVAL_MODELS_MAX} 个审批模型`);
    const model = cleanApprovalModelInput(req.body);
    req.account.approvalModels = [...list, model]; writeJson(usersFile, users);
    auditEvent('approval_model.created', req, req.account, '已添加审批模型', { modelId:model.id, modelName:approvalMaskSecrets(model.name), baseUrl:model.baseUrl, model:approvalMaskSecrets(model.model) });
    res.status(201).json({ model: publicApprovalModel(model), models: approvalModels(req.account).map(publicApprovalModel) });
  } catch (error) { res.status(400).json({ error: error.message || '审批模型保存失败' }); }
});
app.put('/api/approval-models/default', auth, csrf, passwordChanged, (req, res) => {
  const requested = String(req.body?.modelId ?? '');
  if (requested && !findApprovalModel(req.account, requested)) return res.status(400).json({ error:'审批模型不存在' });
  req.account.preferences = userPreferences({ ...userPreferences(req.account.preferences, req.account), approvalDefaultModelId:requested }, req.account);
  writeJson(usersFile, users);
  const model = requested ? findApprovalModel(req.account, requested) : null;
  auditEvent('approval_model.default_set', req, req.account, requested ? '已设置默认审批模型' : '已清除默认审批模型', { modelId:requested, modelName:model?.name || '' });
  res.json({ preferences: userPreferences(req.account.preferences, req.account), models: approvalModels(req.account).map(publicApprovalModel) });
});
app.put('/api/approval-models/:id', auth, csrf, passwordChanged, (req, res) => {
  const list = approvalModels(req.account);
  const index = list.findIndex((item) => item.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: '审批模型不存在' });
  try {
    const model = cleanApprovalModelInput(req.body, list[index]);
    req.account.approvalModels = [...list.slice(0, index), model, ...list.slice(index + 1)]; writeJson(usersFile, users);
    auditEvent('approval_model.updated', req, req.account, '已更新审批模型', { modelId:model.id, modelName:approvalMaskSecrets(model.name), baseUrl:model.baseUrl, model:approvalMaskSecrets(model.model) });
    res.json({ model: publicApprovalModel(model), models: approvalModels(req.account).map(publicApprovalModel) });
  } catch (error) { res.status(400).json({ error: error.message || '审批模型保存失败' }); }
});
app.delete('/api/approval-models/:id', auth, csrf, passwordChanged, (req, res) => {
  const list = approvalModels(req.account);
  const removed = list.find((item) => item.id === req.params.id);
  if (!removed) return res.status(404).json({ error: '审批模型不存在' });
  req.account.approvalModels = list.filter((item) => item.id !== req.params.id);
  // The default pointer may reference the model that was just removed.
  req.account.preferences = userPreferences(req.account.preferences, req.account);
  writeJson(usersFile, users);
  auditEvent('approval_model.deleted', req, req.account, '已删除审批模型', { modelId:removed.id, modelName:removed.name });
  res.json({ models: approvalModels(req.account).map(publicApprovalModel), preferences: userPreferences(req.account.preferences, req.account) });
});
app.post('/api/approval-models/:id/test', auth, csrf, passwordChanged, async (req, res) => {
  const model = findApprovalModel(req.account, req.params.id);
  if (!model) return res.status(404).json({ error: '审批模型不存在' });
  const started = Date.now();
  try {
    const content = await approvalChatJson(model, buildApprovalMessages('服务器：test\n终端标签：test\n终端画面片段（最后若干行）：\n"""\nWould you like to run the following command?\nls -la\n1. Yes, proceed (y)\n2. Yes, and don\'t ask again for commands like this (p)\n3. No, and tell Codex what to do differently (esc)\n"""\n请只输出 JSON。'), { timeoutMs: APPROVAL_TEST_TIMEOUT_MS, json:true });
    const decision = parseApprovalDecision(content);
    if (!decision) return res.json({ ok:false, error:'模型返回的内容无法解析为审批决定', raw:String(content).slice(0, 400) });
    clearApprovalFailures(req.account);
    res.json({ ok:true, latencyMs: Date.now() - started, decision, raw: String(content).slice(0, 400) });
  } catch (error) {
    recordApprovalFailure(req.account);
    res.json({ ok:false, latencyMs: Date.now() - started, error: error.message || '模型请求失败' });
  }
});
app.get('/api/servers', auth, passwordChanged, (_req, res) => res.json(servers.map(publicServer)));
// Auto-approval history: every high-risk prompt the human resolved, plus a
// recent window of all AI decisions, so users can audit what the model did.
app.get('/api/approval-history', auth, passwordChanged, (req, res) => {
  const account = req.account;
  // The history is per terminal tab: sessionId is the browser tab id (preferred),
  // sessionName is the tab label for older sessions. Without either, the
  // account-wide history is returned (legacy callers).
  const sessionId = String(req.query.sessionId || '').slice(0, 64);
  const sessionName = String(req.query.sessionName || '').slice(0, 80);
  const scoped = Boolean(sessionId || sessionName);
  const matchesTab = (entry) => {
    if (!scoped) return true;
    if (sessionId && entry.sessionId === sessionId) return true;
    // Legacy entries without a sessionId only match when no id filter is set.
    if (!entry.sessionId && !sessionId) return true;
    if (sessionName && entry.sessionName === sessionName) return true;
    return false;
  };
  const highRisk = approvalHighRiskHistory(account)
    .filter(matchesTab)
    .map((entry) => ({
      id: entry.id, time: entry.time, sessionId: String(entry.sessionId || ''), sessionName: String(entry.sessionName || ''),
      block: entry.block, choice: entry.choice, risk: entry.risk, modelReason: entry.modelReason,
      humanChoice: entry.humanChoice, humanChoiceLabel: entry.humanChoiceLabel, humanChoiceReason: entry.humanChoiceReason, resolvedAt: entry.resolvedAt
    }));
  let decisions = [];
  try {
    const data = fs.readFileSync(auditFile, 'utf8');
    const lines = data.trim().split('\n').slice(-2000).reverse();
    for (const line of lines) {
      let item; try { item = JSON.parse(line); } catch { continue; }
      if (item.userId !== account.id) continue;
      if (item.type !== 'approval.decision') continue;
      const details = item.details && typeof item.details === 'object' ? item.details : {};
      const entrySessionId = String(details.tabId || '');
      const entrySessionName = String(details.tabName || '');
      if (sessionId && entrySessionId !== sessionId) continue;
      if (!sessionId && sessionName && entrySessionName && entrySessionName !== sessionName) continue;
      if (!sessionId && !sessionName) { /* unscoped: keep all */ }
      decisions.push({
        time: item.time, type: item.type, message: item.message,
        choice: String(details.choice || ''), risk: String(details.risk || ''), reason: String(details.reason || ''),
        promptKey: String(details.promptKey || ''), promptBlock: String(details.promptBlock || '').slice(0, 600),
        serverId: String(details.serverId || ''), sessionId: entrySessionId, sessionName: entrySessionName
      });
      if (decisions.length >= 50) break;
    }
  } catch { /* the audit log may not exist yet */ }
  res.json({ highRisk, decisions });
});
// Empties the per-tab approval history: used when a tab is closed or its
// shell exits (the client also detects `/exit` in the terminal output).
app.post('/api/approval-history/clear', auth, csrf, passwordChanged, (req, res) => {
  const sessionId = String(req.body?.sessionId || '').slice(0, 64);
  const sessionName = String(req.body?.sessionName || '').slice(0, 80);
  if (!sessionId && !sessionName) return res.status(400).json({ error: '缺少标签标识' });
  clearApprovalHighRisk(req.account, { sessionId, sessionName });
  auditEvent('approval_history.cleared', req, req.account, '已清空该标签的自动审批记录', { sessionId, sessionName });
  res.json({ ok: true });
});
// --- Evolution feedback API -------------------------------------------------
// The browser submits one line per suggestion/bug and re-reads the store to
// render the fixed/rejected state the AI IDE wrote back.
app.get('/api/evolutions', auth, passwordChanged, (req, res) => {
  refreshEvolutions();
  const items = evolutionsForUser(req.account.id);
  res.json({ items, limits:{ perSubmission:EVOLUTION_LINES_MAX, textLength:EVOLUTION_TEXT_MAX } });
});
app.post('/api/evolutions', auth, csrf, passwordChanged, (req, res) => {
  const limit = evolutionWriteRateLimit(req.account);
  if (limit.blocked) return res.status(429).json({ error:`提交过于频繁，请 ${Math.ceil(limit.retryAfterMs / 1000)} 秒后重试`, code:'EVOLUTION_RATE_LIMITED' });
  try {
    refreshEvolutions();
    const lines = parseEvolutionLines(req.body?.text ?? req.body?.lines);
    const items = createEvolutions(req.account, lines);
    recordEvolutionWrite(req.account); writeJson(usersFile, users);
    auditEvent('evolution.submitted', req, req.account, `已提交 ${items.length} 条进化建议`, { ids:items.map((item) => item.id).join(','), version:APP_VERSION });
    res.status(201).json({ items, count:items.length });
  } catch (error) { res.status(400).json({ error: error.message || '进化建议保存失败' }); }
});
app.delete('/api/evolutions/:id', auth, csrf, passwordChanged, (req, res) => {
  refreshEvolutions();
  const item = findEvolution(req.params.id);
  if (!item || item.userId !== req.account.id) return res.status(404).json({ error: '进化建议不存在' });
  evolutions = evolutions.filter((entry) => entry.id !== item.id);
  persistEvolutions();
  auditEvent('evolution.deleted', req, req.account, '已删除一条进化建议', { evolutionId:item.id });
  res.status(204).end();
});
// Closes the loop: the reporter confirms the AI IDE's fix actually works, which
// moves `fixed` to `verified`. `reopen` puts a still-broken item back to pending
// so the next development pass picks it up again.
app.post('/api/evolutions/:id/verify', auth, csrf, passwordChanged, (req, res) => {
  refreshEvolutions();
  const item = findEvolution(req.params.id);
  if (!item || item.userId !== req.account.id) return res.status(404).json({ error: '进化建议不存在' });
  const action = String(req.body?.action || 'confirm').toLowerCase();
  if (action === 'reopen') {
    if (item.status === 'pending') return res.json({ item: publicEvolution(item) });
    item.status = 'pending'; item.fixedVersion = ''; item.verifiedAt = '';
    // Track how many times the reporter keeps saying "still broken" so the
    // UI can show "n 次仍未修复" on the next pass.
    item.reopenCount = Math.max(0, Number(item.reopenCount || 0)) + 1;
    auditEvent('evolution.reopened', req, req.account, '用户确认未修复，已退回待处理', { evolutionId:item.id, reopenCount:item.reopenCount });
  } else {
    if (item.status !== 'fixed') return res.status(409).json({ error: '只有标记为已修复的记录才能确认' });
    item.status = 'verified'; item.verifiedAt = now();
    auditEvent('evolution.verified', req, req.account, '用户已确认该条进化建议修复完成', { evolutionId:item.id, fixedVersion:item.fixedVersion || '' });
  }
  item.updatedAt = now();
  persistEvolutions();
  res.json({ item: publicEvolution(item) });
});
app.get('/api/servers/status', auth, passwordChanged, async (_req, res) => res.json({ servers:await getAllServerStatuses() }));
app.post('/api/servers', auth, csrf, passwordChanged, (req, res) => {
  try { const server = cleanServerInput(req.body); servers.push(server); writeJson(serversFile, servers); auditEvent('server.created', req, req.account, '已添加服务器', { serverId:server.id, serverName:server.name, host:server.host, port:server.port }); res.status(201).json(publicServer(server)); }
  catch (error) { res.status(400).json({ error: error.message }); }
});
app.post('/api/servers/reorder', auth, csrf, passwordChanged, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((value) => String(value)) : null;
  const known = new Map(servers.map((server) => [server.id, server]));
  if (!ids || ids.length !== servers.length || ids.some((value) => !value || value.length > 128 || !known.has(value)) || new Set(ids).size !== ids.length) return res.status(400).json({ error: '服务器排序数据无效' });
  try {
    servers = ids.map((value) => known.get(value));
    writeJson(serversFile, servers);
    auditEvent('server.reordered', req, req.account, '已调整服务器列表顺序', { serverIds: ids });
    res.json({ ok:true, servers:servers.map(publicServer) });
  } catch (error) { res.status(500).json({ error: error.message || '服务器排序保存失败' }); }
});
app.put('/api/servers/:id', auth, csrf, passwordChanged, (req, res) => {
  const index = servers.findIndex((server) => server.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: '服务器不存在' });
  try { servers[index] = cleanServerInput(req.body, servers[index]); writeJson(serversFile, servers); auditEvent('server.updated', req, req.account, '已更新服务器配置', { serverId:servers[index].id, serverName:servers[index].name, host:servers[index].host, port:servers[index].port }); res.json(publicServer(servers[index])); }
  catch (error) { res.status(400).json({ error: error.message }); }
});
app.delete('/api/servers/:id', auth, csrf, passwordChanged, (req, res) => {
  const removed = findServer(req.params.id); const oldLength = servers.length; servers = servers.filter((server) => server.id !== req.params.id);
  if (servers.length === oldLength) return res.status(404).json({ error: '服务器不存在' });
  writeJson(serversFile, servers); auditEvent('server.deleted', req, req.account, '已删除服务器', { serverId:req.params.id, serverName:removed?.name || '' }); res.status(204).end();
});
app.post('/api/servers/:id/test', auth, csrf, passwordChanged, (req, res) => {
  const server = serverOr404(req, res); if (!server) return;
  const client = safeSshClient(); let finished = false;
  const done = (status, body) => { if (finished) return; finished = true; client.end(); res.status(status).json(body); };
  client.once('ready', () => done(200, { ok: true, message: '连接成功' }));
  client.once('error', (error) => done(400, { ok: false, error:sshErrorMessage(error) }));
  client.connect(sshConfig(server));
});

// Windows hosts have no built-in SSH/SFTP daemon. When a Windows server has
// the SFTP bridge enabled, it runs a local SFTP server (Win32-OpenSSH's
// sftp-server.exe, FileZilla Server, WinSCP, etc.) on a LAN port; we reach it
// as a plain SFTP client and expose the same /files API, so the browser's
// SFTP panel works identically to Linux/SSH hosts.
function windowsSftpEnabled(server) {
  return server?.os === 'windows' && server?.sftpBridgeEnabled === true;
}
function windowsSftpConfig(server) {
  const port = Number(server.sftpBridgePort || 2222);
  if (port < 1 || port > 65535) throw new Error('Windows SFTP 端口无效');
  const config = {
    host: server.host, port, username: server.sftpBridgeUser || server.username,
    readyTimeout: 15000, keepaliveInterval: 10000, keepaliveCountMax: 3,
    hostVerifier: (hostKey) => {
      const fingerprint = fingerprintHostKey(hostKey);
      const pinned = String(server.sftpFingerprint || '').trim();
      if (pinned) return pinned === fingerprint;
      server.sftpFingerprint = fingerprint; server.sftpFingerprintPinnedAt = now();
      writeJson(serversFile, servers);
      auditEvent('sftp.host_key_pinned', null, null, '已固定 Windows SFTP 主机指纹', { serverId: server.id, serverName: server.name, fingerprint });
      return true;
    },
  };
  if (server.sftpBridgeAuth === 'key') {
    config.privateKey = decrypt(server.sftpBridgePrivateKey);
    if (server.sftpBridgePassphrase) config.passphrase = decrypt(server.sftpBridgePassphrase);
  } else {
    config.password = decrypt(server.sftpBridgePassword);
  }
  return config;
}
// A browser path is rooted at the Windows SFTP root. Join it onto the Windows
// side while keeping the existing containment check (which operates on the
// browser-relative path). Returns the Windows absolute path.
function windowsSftpResolve(server, browserPath) {
  const root = String(server.sftpBridgeRoot || 'C:\\').replace(/\\/g, '/').replace(/\/+$/, '');
  const rel = String(browserPath || '/').replace(/^\/+/, '');
  return rel ? `${root}/${rel}` : root;
}
function winSftpPath(p) { return String(p).replace(/\//g, '\\'); }
function withSftp(server, action) {
  const client = new SftpClient();
  const run = async () => {
    if (windowsSftpEnabled(server)) {
      await client.connect(windowsSftpConfig(server));
      // Wrap the SFTP client so path arguments are translated browser-root →
      // Windows-root. The rest of the /files handlers stay unchanged.
      const wrap = (arg) => (typeof arg === 'string' ? winSftpPath(windowsSftpResolve(server, arg)) : arg);
      const proxy = new Proxy(client, {
        get(target, prop) {
          const value = target[prop];
          if (typeof value !== 'function') return value;
          if (prop === 'list') return (p, opts) => value.call(target, wrap(p), opts);
          if (prop === 'stat') return (p) => value.call(target, wrap(p));
          if (prop === 'get') return (p, dest) => value.call(target, wrap(p), dest);
          if (prop === 'put') return (src, p) => value.call(target, src, wrap(p));
          if (prop === 'mkdir') return (p, recursive) => value.call(target, wrap(p), recursive);
          if (prop === 'rename') return (from, to) => value.call(target, wrap(from), wrap(to));
          if (prop === 'delete') return (p, recursive) => value.call(target, wrap(p), recursive);
          if (prop === 'rmdir') return (p, recursive) => value.call(target, wrap(p), recursive);
          return value.bind(target);
        },
      });
      return await action(proxy);
    }
    await client.connect(sshConfig(server));
    return await action(client);
  };
  return (async () => {
    try { return await run(); } finally { await client.end().catch(() => {}); }
  })();
}
app.get('/api/servers/:id/files', auth, passwordChanged, async (req, res) => {
  const server = serverOr404(req, res); if (!server) return;
  try {
    const directory = sftpPath(req.query.path || '/');
    const items = await withSftp(server, (sftp) => sftp.list(directory));
    res.json({ path: directory, items: items.map((item) => ({ name: item.name, type: item.type, size: item.size, modifyTime: item.modifyTime, permissions: item.rights && item.rights.user ? item.rights.user : '' })) });
  } catch (error) { res.status(400).json({ error: error.message || '目录读取失败' }); }
});
app.post('/api/servers/:id/files/mkdir', auth, csrf, passwordChanged, async (req, res) => {
  const server = serverOr404(req, res); if (!server) return;
  try { const remote = path.posix.join(sftpPath(req.body.path), String(req.body.name || '').trim()); if (!remote || remote === '/') throw new Error('目录名不能为空'); await withSftp(server, (sftp) => sftp.mkdir(remote, true)); auditEvent('sftp.mkdir', req, req.account, '已创建远程目录', { serverId:server.id, path:remote }); res.json({ ok: true }); }
  catch (error) { res.status(400).json({ error: error.message || '创建目录失败' }); }
});
app.post('/api/servers/:id/files/rename', auth, csrf, passwordChanged, async (req, res) => {
  const server = serverOr404(req, res); if (!server) return;
  try { const from=sftpPath(req.body.from); const to=sftpPath(req.body.to); await withSftp(server, (sftp) => sftp.rename(from, to)); auditEvent('sftp.rename', req, req.account, '已重命名远程文件', { serverId:server.id, from, to }); res.json({ ok: true }); }
  catch (error) { res.status(400).json({ error: error.message || '重命名失败' }); }
});
app.delete('/api/servers/:id/files', auth, csrf, passwordChanged, async (req, res) => {
  const server = serverOr404(req, res); if (!server) return;
  try {
    const remote = sftpPath(req.query.path); if (remote === '/') throw new Error('不能删除根目录');
    if (windowsSftpEnabled(server)) {
      // Windows SFTP servers (Win32-OpenSSH sftp-server.exe) do not implement
      // recursive RMDIR, so probe the target and only rmdir when it is a
      // directory. The browser only offers "delete" on individual files/dirs
      // the user can see, so a non-recursive rmdir is sufficient.
      await withSftp(server, async (sftp) => {
        let stat = null; try { stat = await sftp.stat(remote); } catch { return sftp.delete(remote); }
        return stat.isDirectory ? sftp.rmdir(remote) : sftp.delete(remote);
      });
    } else {
      await withSftp(server, async (sftp) => { const stat = await sftp.stat(remote); return stat.isDirectory ? sftp.rmdir(remote, true) : sftp.delete(remote); });
    }
    auditEvent('sftp.delete', req, req.account, '已删除远程文件或目录', { serverId:server.id, path:remote }); res.status(204).end();
  }
  catch (error) { res.status(400).json({ error: error.message || '删除失败' }); }
});
app.post('/api/servers/:id/files/upload', auth, csrf, passwordChanged, upload.single('file'), async (req, res) => {
  const server = serverOr404(req, res); if (!server) return;
  if (!req.file) return res.status(400).json({ error: '请选择文件' });
  try {
    const root = sftpPath(req.body.path || '/'); const relativePath = uploadRelativePath(req.body.relativePath, req.file.originalname); const remote = path.posix.join(root, relativePath);
    const rootPrefix = root === '/' ? '/' : `${root.replace(/\/$/, '')}/`; if (!remote.startsWith(rootPrefix)) throw new Error('无效的上传路径');
    await withSftp(server, async (sftp) => { const parent = path.posix.dirname(remote); if (parent !== root) await sftp.mkdir(parent, true); await sftp.put(req.file.buffer, remote); });
    auditEvent('sftp.upload', req, req.account, '已上传远程文件', { serverId:server.id, path:remote, size:req.file.size }); res.json({ ok: true, name: req.file.originalname, relativePath });
  }
  catch (error) { res.status(400).json({ error: error.message || '上传失败' }); }
});
app.get('/api/servers/:id/files/download', auth, passwordChanged, async (req, res) => {
  const server = serverOr404(req, res); if (!server) return;
  try { const remote = sftpPath(req.query.path); const filename = path.posix.basename(remote); const buffer = await withSftp(server, (sftp) => sftp.get(remote)); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`); res.send(buffer); }
  catch (error) { res.status(400).json({ error: error.message || '下载失败' }); }
});

// The browser keeps the visual tab state locally, but the SSH shell itself is
// owned by the account on the server. Expose live shell identities before the
// static-site fallback so another device can discover and reattach to them.
app.get('/api/ssh-sessions', auth, passwordChanged, (req, res) => {
  const result = [...sshSessions.values()]
    .filter((session) => session && !session.destroyed && session.ownerId === req.account.id && findServer(session.serverId))
    .map((session) => ({
      id: session.id,
      serverId: session.serverId,
      initialCwd: session.initialCwd || '',
      currentDirectory: session.currentDirectory || session.initialCwd || '',
      connected: Boolean(session.connected),
      detached: !session.ws,
      approvalEnabled: Boolean(session.approval?.enabled),
      approvalModelId: session.approval?.modelId || '',
      approvalRememberAll: Boolean(session.approval?.rememberAll),
      createdAt: session.createdAt || '',
      lastOutputAt: session.lastOutputAt || ''
    }));
  const vncResult = [...vncSessions.values()]
    .filter((session) => session && !session.destroyed && session.ownerId === req.account.id && findServer(session.serverId))
    .map((session) => ({
      id: session.id,
      serverId: session.serverId,
      kind: 'vnc',
      connected: Boolean(session.connected),
      detached: !session.ws,
      createdAt: session.createdAt || '',
      lastOutputAt: session.lastByteAt || ''
    }));
  res.json({ sessions: [...result, ...vncResult] });
});

// Serve JS/CSS with no-store so a release always picks up the newest code in the
// browser (the fixed ?v= cache-buster in index.html can otherwise serve stale bundles).
app.use((req, res, next) => {
  if (req.method === 'GET' && req.path !== '/' && (req.path.endsWith('.js') || req.path.endsWith('.css'))) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

let tlsOptions;
try {
  tlsOptions = { key: fs.readFileSync(TLS_KEY_FILE), cert: fs.readFileSync(TLS_CERT_FILE) };
} catch (error) {
  console.error(`Unable to load HTTPS certificate. Run: bash scripts/generate-cert.sh your.domain.com (${error.message})`);
  process.exit(1);
}
const server = https.createServer(tlsOptions, app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
const sshSessions = new Map();

function closeSessionRuntime(sessionId) {
  for (const ws of wss.clients) if (ws.authSessionId === sessionId) { try { ws.close(4401, 'Session revoked'); } catch { /* ignore */ } }
}
function revokeUserRuntime(userId) {
  for (const ws of wss.clients) if (ws.authUserId === userId) { try { ws.close(4402, 'Security settings changed'); } catch { /* ignore */ } }
  for (const session of sshSessions.values()) if (session.ownerId === userId) destroySshSession(session, 'security-reset');
  for (const session of vncSessions.values()) if (session.ownerId === userId) destroyVncSession(session, 'security-reset');
}
// ssh2 emits fatal protocol errors (e.g. a RST before the handshake) as an
// asynchronous 'error' event. Every client created by this process is wrapped
// by safeSshClient, so this is a last line of defense: a stray error must log
// and close the connection, never crash the whole platform and drop all
// sessions with ECONNRESET.
process.on('uncaughtException', (error, origin) => {
  if (origin === 'error') {
    const source = error && error.source;
    try { if (source && typeof source.end === 'function' && !source._endEmitted) source.end(); } catch { /* already gone */ }
    try { auditEvent('ssh.uncaught_error', null, null, `捕获未处理的连接错误：${error.message}`, { host: source?.config?.host, port: source?.config?.port }); } catch { /* logging is best-effort */ }
    return;
  }
  console.error('Uncaught exception:', error);
  process.exit(1);
});
const wsHeartbeat = setInterval(() => {
  pruneSessions(); const activeSessionIds = new Set(sessions.map((item) => item.id));
  for (const ws of wss.clients) {
    if (ws.readyState !== ws.OPEN) continue;
    if (!activeSessionIds.has(ws.authSessionId)) { ws.close(4401, 'Session expired'); continue; }
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, WS_HEARTBEAT_MS);
server.on('upgrade', (request, socket, head) => {
  let url;
  let origin;
  let requestHost;
  try {
    const rawHost = String(request.headers.host || '').trim();
    if (!rawHost || rawHost.length > 255) return socket.destroy();
    const hostUrl = new URL(`https://${rawHost}`);
    if (hostUrl.pathname !== '/' || hostUrl.search || hostUrl.hash || hostUrl.username || hostUrl.password) return socket.destroy();
    requestHost = hostUrl.host.toLowerCase();
    url = new URL(String(request.url || '/'), 'https://nexterm.invalid');
    origin = new URL(String(request.headers.origin || ''));
  } catch {
    return socket.destroy();
  }
  const validOrigin = origin.protocol === 'https:' && origin.host.toLowerCase() === requestHost;
  const session = sessionFromRequest(request, false); const account = session && users.find((item) => item.id === session.userId);
  if (url.pathname !== '/ws' || url.search || !validOrigin || !session || !account || account.mustChangePassword || account.passwordResetRequired) return socket.destroy();
  try {
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, { session, account }));
  } catch {
    socket.destroy();
  }
});

function sendSocket(ws, message) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  try { ws.send(JSON.stringify(message)); } catch { /* the peer may be closing */ }
}
function sendSession(session, message) { sendSocket(session.ws, message); }
function rememberOutput(session, data) {
  session.lastOutputAt = now();
  const bytes = Buffer.from(data);
  session.pendingOutputBytes = (session.pendingOutputBytes || 0) + bytes.length;
  if (!session.outputPaused && session.pendingOutputBytes >= 512 * 1024) {
    session.outputPaused = true;
    session.stream?.pause(); session.stream?.stderr?.pause();
  }
  session.screen.write(bytes, (seq) => {
    session.seq = seq;
    session.pendingOutputBytes -= bytes.length;
    // Earlier writes are included in the pending snapshot. Writes queued after
    // its barrier are delivered live, after the snapshot, exactly once.
    if (!session.snapshotPending) sendSession(session, { type:'output', seq, data:bytes.toString('base64') });
    if (session.outputPaused && session.pendingOutputBytes <= 128 * 1024) {
      session.outputPaused = false;
      session.stream?.resume(); session.stream?.stderr?.resume();
    }
    if (session.approval?.enabled) scheduleApprovalScan(session);
    // A high-risk / deny prompt may still be waiting on the human. If the
    // terminal has moved past the input prompt for a few stable frames, mark
    // the record resolved so it does not linger forever (the user either
    // cancelled or the prompt was answered without a recognizable key).
    if (session.approvalHighRiskPrompt && !sessionPromptState(session).inputRequired) {
      session.approvalHumanGoneFrames = (session.approvalHumanGoneFrames || 0) + 1;
      if (session.approvalHumanGoneFrames >= 3) {
        const account = users.find((item) => item.id === session.ownerId);
        const userTyped = String(session.highRiskInput || '').trim();
        const hadUserInput = userTyped.length > 0;
        const resolvedChoice = hadUserInput ? 'other' : '';
        const resolvedLabel = hadUserInput ? `按键 ${userTyped.replace(/\x1b\[[A-Za-z]/g, '↑↓←→').replace(/\s+/g, ' ').trim()}` : '提示已消失';
        const resolvedReason = hadUserInput ? '用户在终端中操作后提示消失' : '用户未在终端选择，提示已消失';
        resolveHighRiskEntry(account, session.approvalHighRiskPrompt.promptKey, resolvedChoice, resolvedLabel, resolvedReason);
        auditEvent(hadUserInput ? 'approval.high_risk_resolved' : 'approval.high_risk_unresolved', null, account || null, hadUserInput ? `高危提示人工处理：${resolvedLabel}` : '提示已消失：用户未选择', { sessionId:session.id, promptKey:session.approvalHighRiskPrompt.promptKey, choice: resolvedChoice });
        approvalSend(session, { action: hadUserInput ? 'high_risk_resolved' : 'resolved', promptKey:session.approvalHighRiskPrompt.promptKey, choice: resolvedChoice, label: resolvedLabel, reason: hadUserInput ? '' : 'prompt-gone' });
        session.approvalHighRiskPrompt = null;
        session.highRiskInput = '';
        session.approvalHumanGoneFrames = 0;
      }
    } else {
      session.approvalHumanGoneFrames = 0;
    }
  });
}
// --- AI approval assistant: server-side prompt detection --------------------
// The headless screen already mirrors every PTY byte, so approval decisions work
// even while the browser is closed. Patterns mirror the client-side matchers in
// public/app.js; keep both in sync.
const CODEX_ACTIVE_RE = /(?:^|\n)\s*[•●]\s+.+\(\s*\d+(?:s|m|h).*?esc\s+to\s+interr/i;
const CODEX_IDLE_RE = /(?:^|\n)\s*›\s*Ask Codex to do anything\s*(?:\n|$)/i;
const CODEX_COMPLETE_RE = /(?:^|\n)\s*[─━-]+\s*Worked for\s+\d[^\n]*/i;
const INPUT_REQUIRED_RE = /(?:Would you like to (?:run|apply|execute)|Press enter to confirm or esc to|Question\s+\d+\/\d+\s+\(\d+\s+unanswered\)|enter to submit answer|needs your approval|Approval requested|main needs input|请确认|需要确认|是否继续(?:执行)?|等待(?:用户)?确认)/i;
const APPROVAL_SETTLE_MS = 450;
const APPROVAL_STABLE_FRAMES = 2;
const APPROVAL_MAX_ATTEMPTS = 3;
// A small model judging a 48-line TUI dump latches onto command names it sees
// anywhere on screen. Hand it the pending prompt block on its own instead.
// Codex wraps long commands across many rows (its "don't ask again" option
// repeats the whole prefix), so the block budget must survive a full download
// or install one-liner; truncate tail-first to keep the command head readable.
const APPROVAL_BLOCK_MAX_LINES = 28;
const APPROVAL_BLOCK_MAX_BYTES = 8_000;

function screenTailText(session, maxLines = 48) {
  const screen = session?.screen;
  if (!screen || screen.disposed) return '';
  const terminal = screen.terminal;
  const buffer = terminal?.buffer?.active;
  if (!buffer) return '';
  const end = buffer.length;
  const start = Math.max(0, end - Math.max(60, Number(terminal.rows || 1) * 4));
  const lines = [];
  for (let index = start; index < end; index += 1) {
    const line = buffer.getLine(index);
    if (!line) continue;
    const text = line.translateToString(true) || '';
    if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
    else lines.push(text);
  }
  return lines.slice(-maxLines).join('\n');
}
function lastPatternIndex(text, pattern) {
  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  let match; let index = -1;
  while ((match = global.exec(text))) { index = match.index; if (!match[0]) global.lastIndex += 1; }
  return index;
}
// The pending prompt plus the command it is asking to run. Codex prints the
// command right above the confirmation line, but a long one wraps across
// several screen lines, so the block walks backwards until the shell prompt
// that issued it. Without this the model only sees a truncated tail and has to
// guess which paths a delete touches.
function approvalPromptBlock(text) {
  const lines = String(text || '').split('\n');
  const anchor = lines.reduce((found, line, index) => (INPUT_REQUIRED_RE.test(line) ? index : found), -1);
  if (anchor < 0) return '';
  let start = anchor;
  // Codex separates the action line from the menu with a blank line, and long
  // commands wrap over several rows, so blanks are skipped until the line that
  // starts the action (a shell prompt or a known command) is found.
  for (let index = anchor - 1; index >= 0 && anchor - index <= APPROVAL_BLOCK_MAX_LINES; index -= 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    // Continuation rows are indented; anything flush-left (a `$` prompt, a `•`
    // action line, a bare command) begins the block.
    if (!/^\s+\S/.test(line)) { start = index; break; }
    start = index;
  }
  const block = lines.slice(start, Math.min(lines.length, anchor + APPROVAL_BLOCK_MAX_LINES)).join('\n').trim();
  if (block.length <= APPROVAL_BLOCK_MAX_BYTES) return block;
  return `…（已截断）${block.slice(block.length - APPROVAL_BLOCK_MAX_BYTES)}`;
}
function sessionPromptState(session) {
  const text = screenTailText(session);
  const input = lastPatternIndex(text, INPUT_REQUIRED_RE);
  if (input < 0) return { inputRequired:false, screen:text, block:'' };
  const active = lastPatternIndex(text, CODEX_ACTIVE_RE);
  const idle = lastPatternIndex(text, CODEX_IDLE_RE);
  const complete = lastPatternIndex(text, CODEX_COMPLETE_RE);
  // A newer Working/idle frame means the prompt was redrawn away.
  if (active > input || idle > Math.max(input, complete)) return { inputRequired:false, screen:text, block:'' };
  return { inputRequired:true, screen:text, block:approvalPromptBlock(text) };
}
function approvalSend(session, message) { sendSession(session, { type:'approval', ...message }); }
function approvalWriteKeys(session, keys, label) {
  if (!session || session.destroyed || !session.stream) return false;
  try { session.stream.write(Buffer.from(keys, 'utf8')); } catch { return false; }
  session.lastApprovalAt = now();
  session.lastApprovalKeys = keys;
  auditEvent('approval.auto_key', null, users.find((item) => item.id === session.ownerId) || null, `自动审批已按键：${label}`, { sessionId:session.id, serverId:session.serverId, keys:JSON.stringify(keys) });
  return true;
}
// Human-readable explanations for every reason that can end auto-approval.
// The key is the internal code; the value tells the user *why* it stopped, so
// a silent stop (e.g. "the model refused") is never a mystery again.
const APPROVAL_STOP_REASONS = {
  deny: '模型判定为「拒绝」，已停止自动审批并交回人工，请在终端中自行选择（按 1/2/3 等）。',
  unsafe: '模型判定该操作为高危/危险，已停止自动审批并交回人工，请在终端手动选择。',
  unknown: '模型无法判断该操作是否安全，已停止自动审批并交回人工处理。',
  model_error: '审批模型调用失败（网络/超时/返回内容无法解析），重试达到上限后已停止，已交回人工处理。',
  no_model: '未配置可用的审批模型，已停止自动审批。请先在「设置 → 自动审批模型」中配置。',
  rate_limited: '审批模型调用过于频繁，触发限流保护，已暂停并交回人工处理。',
  upstream_failures: '审批模型连续多次调用失败，已暂停自动审批进入冷却保护，请稍后重试。',
  write_failed: '向终端写入按键失败（终端可能已断开），已停止自动审批。',
  client_disabled: '已按你的操作关闭自动审批。',
  stopped: '自动审批已停止。'
};
function approvalStopReasonLabel(reason) {
  return APPROVAL_STOP_REASONS[reason] || '自动审批已停止，已交回人工处理。';
}
function stopSessionApproval(session, reason = 'stopped') {
  if (!session) return;
  session.approvalGeneration = Number(session.approvalGeneration || 0) + 1;
  session.approval = { enabled:false, modelId: String(session.approval?.modelId || ''), rememberAll: Boolean(session.approval?.rememberAll) };
  session.approvalStopReason = reason;
  if (session.approvalTimer) { clearTimeout(session.approvalTimer); session.approvalTimer = null; }
  session.approvalPending = null;
  session.approvalFrames = 0;
  session.approvalLastScreen = '';
  session.approvalResolving = false;
  // A high-risk / deny prompt is still waiting on the human, so keep the
  // terminal key watcher armed: record whichever menu option the user actually
  // presses (or mark it resolved later when the prompt disappears). Do not
  // resolve the entry or drop the prompt here.
  if (session.ownerId) {
    const stopAccount = users.find((item) => item.id === session.ownerId);
    auditEvent('approval.stopped', null, stopAccount || null, `自动审批已停止：${approvalStopReasonLabel(reason)}`, { sessionId: session.id, serverId: session.serverId, reason });
  }
  approvalSend(session, { action:'state', enabled:false, reason, message: approvalStopReasonLabel(reason) });
}
function approvalStateMessage(session, requestId = '') {
  const account = users.find((item) => item.id === session.ownerId) || {};
  const model = findApprovalModel(account, String(session.approval?.modelId || '')) || null;
  const stopReason = String(session.approvalStopReason || '');
  const message = {
    type:'approval', action:'state', enabled:Boolean(session.approval?.enabled),
    modelId:String(session.approval?.modelId || ''),
    modelName:model ? approvalMaskSecrets(model.name) : '',
    model:model ? approvalMaskSecrets(model.model) : '',
    rememberAll:Boolean(session.approval?.rememberAll), stopReason,
    reason:stopReason, message:stopReason ? approvalStopReasonLabel(stopReason) : ''
  };
  if (requestId) message.requestId = requestId;
  return message;
}
function scheduleApprovalScan(session, delay = APPROVAL_SETTLE_MS) {
  if (!session || session.destroyed || !session.approval?.enabled) return;
  if (session.approvalTimer) clearTimeout(session.approvalTimer);
  session.approvalTimer = setTimeout(() => { session.approvalTimer = null; evaluateSessionApproval(session); }, delay);
}
async function evaluateSessionApproval(session) {
  if (!session || session.destroyed || !session.approval?.enabled) return;
  const approvalGeneration = Number(session.approvalGeneration || 0);
  const state = sessionPromptState(session);
  if (!state.inputRequired) {
    session.approvalFrames = 0; session.approvalLastScreen = ''; session.approvalPending = null;
    return;
  }
  const screen = state.screen;
  // Codex redraws its TUI repeatedly; wait for a stable frame so the model does
  // not read a half-painted prompt.
  if (screen === session.approvalLastScreen) session.approvalFrames += 1;
  else { session.approvalFrames = 1; session.approvalLastScreen = screen; }
  if (session.approvalFrames < APPROVAL_STABLE_FRAMES) return scheduleApprovalScan(session, APPROVAL_SETTLE_MS);
  if (session.approvalResolving) return scheduleApprovalScan(session, 1200);

  const account = users.find((item) => item.id === session.ownerId);
  if (!account) return stopSessionApproval(session, 'account-missing');
  const modelId = session.approval.modelId || account.preferences?.approvalDefaultModelId || '';
  const model = findApprovalModel(account, modelId) || approvalModels(account).find((item) => item.enabled !== false) || null;
  if (!model) {
    approvalSend(session, { action:'need_human', reason:'no_model', message:'未配置可用的审批模型，已交回人工处理' });
    return stopSessionApproval(session, 'no-model');
  }
  const limit = approvalDecisionRateLimit(account);
  if (limit.blocked) {
    approvalSend(session, { action:'need_human', reason:limit.reason, message:'审批模型调用过于频繁，已暂停自动审批并交回人工处理' });
    return stopSessionApproval(session, limit.reason);
  }

  session.approvalResolving = true;
  const promptKey = crypto.createHash('sha256').update(screen).digest('hex').slice(0, 16);
  session.approvalPending = { key: promptKey, screen };
  approvalSend(session, { action:'evaluating', promptKey, modelName:approvalMaskSecrets(model.name), model:approvalMaskSecrets(model.model) });
  const server = findServer(session.serverId);
  const notes = [];
  if (session.approval.rememberAll) notes.push('用户已开启“同类操作不再询问”，若确属重复的低风险操作可用 approve_always。');
  const precedent = findHighRiskPrecedent(account, state.block);
  if (precedent) notes.push(`历史高危参考：用户此前遇到类似待确认内容（“${String(precedent.block || '').slice(-160)}”）时选择了「${precedent.humanChoiceLabel || precedent.humanChoice}」。若本次与那次确实同类且当时选择了放行，可参考放行；若仍有破坏性不确定，请判 unsafe 交回人工。`);
  const prompt = approvalPromptText({ server, tabName:session.tabName || '', screen, block: state.block, note: notes.join(' ') });
  let decision = null; let failure = '';
  try {
    const content = await approvalChatJson(model, buildApprovalMessages(prompt), { timeoutMs: APPROVAL_DECISION_TIMEOUT_MS, json:true });
    decision = parseApprovalDecision(content);
    if (!decision) failure = '模型返回内容无法解析';
  } catch (error) { failure = error.message || '模型请求失败'; }
  // Reconnects and model changes can start a new approval generation while
  // this request is still in flight. Do not let an old reply clear the new
  // generation's in-flight guard or apply a stale decision.
  if (approvalGeneration !== Number(session.approvalGeneration || 0)) return;
  session.approvalResolving = false;

  if (session.destroyed || !session.approval?.enabled) return;
  // The prompt may have been answered by the user while the model was thinking.
  const latest = sessionPromptState(session);
  if (!latest.inputRequired) {
    session.approvalFrames = 0; session.approvalLastScreen = ''; session.approvalPending = null;
    approvalSend(session, { action:'resolved', promptKey, reason:'prompt-gone' });
    return;
  }

  if (!decision) {
    recordApprovalFailure(account);
    session.approval.attempts = Number(session.approval.attempts || 0) + 1;
    approvalSend(session, { action:'need_human', promptKey, reason:'model_error', message:`自动审批失败（${failure}），已交回人工处理` });
    if (session.approval.attempts >= APPROVAL_MAX_ATTEMPTS) return stopSessionApproval(session, 'model_error');
    return scheduleApprovalScan(session, 4000);
  }

  recordApprovalDecision(account); clearApprovalFailures(account);
  session.approval.attempts = 0;
  const label = decision.choice === 'approve_once' ? '1 Yes, proceed'
    : decision.choice === 'approve_always' ? '2 Yes, and don\'t ask again'
    : decision.choice === 'deny' ? '3 No, tell it what to do differently'
    : decision.choice === 'unsafe' ? '交回人工（判定为危险）' : '交回人工（无法判断）';
  // `deny` also hands the prompt to the human (it no longer presses "No"), so
  // it records a high-risk entry and arms the key watcher to store whatever the
  // user actually presses.
  if (decision.choice === 'unsafe' || decision.choice === 'deny' || decision.risk === 'high' || decision.risk === 'critical') {
    const entry = { id: id(), time: now(), sessionId: session.tabId || '', sessionName: session.tabName || '', block: String(state.block || '').replace(/\s+\n/g, '\n').trim().slice(-APPROVAL_HIGH_RISK_CONTEXT_BYTES), screen: String(screen || '').replace(/\s+\n/g, '\n').trim().slice(-APPROVAL_HIGH_RISK_CONTEXT_BYTES), choice: decision.choice, risk: decision.risk, modelReason: String(decision.reason || '').slice(0, 400), promptKey, humanChoice: '', humanChoiceLabel: '', humanChoiceReason: '', resolvedAt: '' };
    if (!account.approvalHighRisk || typeof account.approvalHighRisk !== 'object') account.approvalHighRisk = { items: [] };
    account.approvalHighRisk.items = [entry, ...(account.approvalHighRisk.items || [])].slice(0, APPROVAL_HIGH_RISK_MAX);
    writeJson(usersFile, users);
    session.approvalHighRiskPrompt = { promptKey, entryId: entry.id };
  }
  auditEvent('approval.decision', null, account, `审批模型 ${model.name} 决定：${label}`, {
    sessionId:session.id, serverId:session.serverId, tabId:session.tabId || '', tabName:session.tabName || '', choice:decision.choice, risk:decision.risk, reason:decision.reason, promptKey,
    // Without the pending command in the log, a wrong `unsafe` verdict cannot be
    // traced back to what the model actually saw.
    promptBlock: String(state.block || '').slice(0, 1_000)
  });

  if (decision.choice === 'approve_once') {
    if (!approvalWriteKeys(session, '\r', label)) return stopSessionApproval(session, 'write-failed');
    approvalSend(session, { action:'acted', promptKey, choice:decision.choice, risk:decision.risk, reason:decision.reason, label });
    session.approvalLastScreen = ''; session.approvalFrames = 0;
    return scheduleApprovalScan(session, 1500);
  }
  if (decision.choice === 'approve_always') {
    if (!approvalWriteKeys(session, '\r', label)) return stopSessionApproval(session, 'write-failed');
    session.approval.rememberAll = true;
    approvalSend(session, { action:'acted', promptKey, choice:decision.choice, risk:decision.risk, reason:decision.reason, label, rememberAll:true });
    session.approvalLastScreen = ''; session.approvalFrames = 0;
    return scheduleApprovalScan(session, 1500);
  }
  if (decision.choice === 'deny') {
    // The model recommends refusing. Do NOT press the "No" key on the user's
    // behalf: that would end the Codex turn and remove the user's chance to
    // proceed or answer (the user would have to start the session over).
    // Instead hand the prompt back to the human and let the key watcher record
    // whichever option they actually press (approvalHighRiskPrompt was armed
    // above for the `deny` case).
    approvalSend(session, { action:'need_human', promptKey, choice:decision.choice, risk:decision.risk, reason:decision.reason, highRisk:true, pending: Boolean(session.approvalHighRiskPrompt), message:'模型建议拒绝，已交回人工处理，请在终端中自行选择（如按 1/2/3）' });
    return stopSessionApproval(session, 'deny');
  }
  // unsafe / unknown: never press a key; hand control back to the human.
  const highRisk = decision.choice === 'unsafe' || decision.risk === 'high' || decision.risk === 'critical';
  approvalSend(session, { action:'need_human', promptKey, choice:decision.choice, risk:decision.risk, reason:decision.reason, highRisk: Boolean(highRisk), pending: Boolean(session.approvalHighRiskPrompt), message: highRisk ? `模型判定为${decision.choice === 'unsafe' ? '高危操作' : '风险操作'}，已停止自动审批，请在终端中手动选择` : `模型判定为${decision.choice === 'unsafe' ? '危险操作' : '无法判断'}，已交回人工处理` });
  return stopSessionApproval(session, decision.choice);
}
function startSessionApproval(session, modelId) {
  const account = users.find((item) => item.id === session.ownerId);
  if (!account) return { error:'账户不存在' };
  const model = findApprovalModel(account, String(modelId || '')) || approvalModels(account).find((item) => item.enabled !== false) || null;
  if (!model) return { error:'请先在设置中添加审批模型' };
  // Reconnects (including browser refreshes) re-send "enable". Treat an
  // already-running identical configuration as a state query, not a reset:
  // resetting approvalResolving here would launch a second model request while
  // the first one is still in flight.
  if (session.approval?.enabled && String(session.approval.modelId || '') === model.id) {
    session.approvalStopReason = '';
    approvalSend(session, { action:'state', enabled:true, modelId:model.id, modelName:approvalMaskSecrets(model.name), model:approvalMaskSecrets(model.model), rememberAll:Boolean(session.approval.rememberAll), stopReason:'' });
    if (!session.approvalTimer && !session.approvalResolving) scheduleApprovalScan(session, 300);
    return { model: publicApprovalModel(model) };
  }
  session.approvalGeneration = Number(session.approvalGeneration || 0) + 1;
  session.approval = { enabled:true, modelId:model.id, rememberAll:false, attempts:0 };
  session.approvalStopReason = '';
  if (session.approvalTimer) clearTimeout(session.approvalTimer);
  session.approvalFrames = 0; session.approvalLastScreen = ''; session.approvalPending = null; session.approvalResolving = false;
  auditEvent('approval.enabled', null, account, '已开启终端自动审批', { sessionId:session.id, serverId:session.serverId, modelId:model.id, modelName:model.name });
  approvalSend(session, { action:'state', enabled:true, modelId:model.id, modelName:approvalMaskSecrets(model.name), model:approvalMaskSecrets(model.model) });
  scheduleApprovalScan(session, 300);
  return { model: publicApprovalModel(model) };
}
function destroySshSession(session, reason = 'closed') {
  if (!session || session.destroyed) return;
  session.destroyed = true;
  if (session.approvalTimer) { clearTimeout(session.approvalTimer); session.approvalTimer = null; }
  session.approvalResolving = false;
  session.screen?.dispose();
  if (session.detachTimer) clearTimeout(session.detachTimer);
  sshSessions.delete(session.id);
  try { session.stream?.end(); } catch { /* already closed */ }
  try { session.client?.end(); } catch { /* already closed */ }
  if (reason && session.ws) sendSession(session, { type: 'closed', reason });
  session.ws = null;
}
function detachSshSession(session) {
  if (!session || session.destroyed) return;
  session.ws = null;
  session.detachedAt = now();
  if (session.detachTimer) clearTimeout(session.detachTimer);
  session.detachTimer = setTimeout(() => destroySshSession(session, 'idle-timeout'), SSH_SESSION_GRACE_MS);
}
function resizeSshSession(session, cols, rows) {
  const columnCount = Number(cols); const rowCount = Number(rows);
  // The server now allocates a screen at these dimensions; bound its size.
  const nextCols = Number.isFinite(columnCount) && columnCount >= 2 ? Math.min(1000, Math.floor(columnCount)) : session.cols || 100;
  const nextRows = Number.isFinite(rowCount) && rowCount >= 1 ? Math.min(500, Math.floor(rowCount)) : session.rows || 30;
  const changed = session.cols !== nextCols || session.rows !== nextRows;
  // Retain resizes received while SSH is connecting, before a stream exists.
  session.cols = nextCols; session.rows = nextRows;
  if (changed) session.screen?.resize(nextCols, nextRows);
  if (changed && session.stream) session.stream.setWindow(nextRows, nextCols, 0, 0);
}
function attachSshSession(session, ws, cols, rows) {
  if (session.detachTimer) { clearTimeout(session.detachTimer); session.detachTimer = null; }
  if (session.ws && session.ws !== ws) {
    try { session.ws.close(4000, 'Session reattached'); } catch { /* ignore */ }
  }
  session.ws = ws;
  session.detachedAt = '';
  const pending = Symbol('snapshot');
  session.snapshotPending = pending;
  resizeSshSession(session, cols, rows);
  session.screen.snapshot((snapshot) => {
    if (session.ws !== ws || session.snapshotPending !== pending) return;
    sendSocket(ws, { type:'snapshot', ...snapshot });
    session.snapshotPending = null;
  });
}
function normalizeInitialCwd(value) {
  const directory = String(value || '');
  if (!directory.startsWith('/') || directory.includes('\0') || Buffer.byteLength(directory) > 4096) return '';
  return directory;
}
function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\"'\"'") + "'";
}
function consumeShellOutput(session, data) {
  if (session.startupParsed) return rememberOutput(session, data);
  session.startupBuffer = Buffer.concat([session.startupBuffer, Buffer.from(data)]);
  const marker = Buffer.from(SHELL_PID_MARKER);
  const markerIndex = session.startupBuffer.indexOf(marker);
  if (markerIndex >= 0) {
    const lineEnd = session.startupBuffer.indexOf(0x0a, markerIndex + marker.length);
    if (lineEnd < 0 && session.startupBuffer.length <= 8192) return;
    if (lineEnd >= 0) {
      const pidText = session.startupBuffer.subarray(markerIndex + marker.length, lineEnd).toString('utf8').replace(/\r/g, '');
      const shellPid = Number(pidText);
      if (Number.isSafeInteger(shellPid) && shellPid > 0) session.shellPid = shellPid;
      const before = session.startupBuffer.subarray(0, markerIndex);
      const after = session.startupBuffer.subarray(lineEnd + 1);
      session.startupParsed = true;
      session.startupBuffer = Buffer.alloc(0);
      if (before.length) rememberOutput(session, before);
      if (after.length) rememberOutput(session, after);
      return;
    }
  }
  if (session.startupBuffer.length > 8192) {
    session.startupParsed = true;
    const buffered = session.startupBuffer;
    session.startupBuffer = Buffer.alloc(0);
    rememberOutput(session, buffered);
  }
}
function querySessionCwd(session, callback) {
  const fallback = session?.currentDirectory || session?.initialCwd || '';
  if (!session?.client || session.destroyed || !Number.isSafeInteger(session.shellPid) || session.shellPid <= 0) return callback(fallback);
  let settled = false;
  const finish = (directory = fallback) => {
    if (settled) return;
    settled = true;
    const normalized = normalizeInitialCwd(String(directory || '').replace(/\r?\n$/, '').replace(/ \(deleted\)$/, ''));
    if (normalized) session.currentDirectory = normalized;
    callback(normalized || fallback);
  };
  session.client.exec(`readlink /proc/${session.shellPid}/cwd`, (error, stream) => {
    if (error) return finish();
    const chunks = [];
    let size = 0;
    const timer = setTimeout(() => { try { stream.close(); } catch { /* already closed */ } finish(); }, 3000);
    stream.on('data', (chunk) => {
      if (size >= 8192) return;
      const buffer = Buffer.from(chunk); chunks.push(buffer); size += buffer.length;
    });
    stream.on('close', () => { clearTimeout(timer); finish(Buffer.concat(chunks).toString('utf8')); });
    stream.on('error', () => { clearTimeout(timer); finish(); });
  });
}
// --- Windows remote desktop (VNC bridge) ------------------------------------
// Roadmap item 0: the browser speaks RFB to this Node process (noVNC on the
// front end), and this process dials the VNC server on the Windows host over
// the LAN. Raw RFB bytes are relayed both directions so standard noVNC clients
// can drive UltraVNC / TightVNC / TigerVNC without a Guacamole stack.
const vncSessions = new Map();
const net = require('net');
const VNC_CONNECT_TIMEOUT_MS = 12_000;
// The bridge has no protocol-level keepalive of its own; if the Windows side
// or an intermediate NAT drops the connection without a RST, the socket stays
// half-open and the desktop appears frozen. Reap such sockets after idle time.
const VNC_IDLE_TIMEOUT_MS = Math.max(60_000, Number(process.env.VNC_IDLE_TIMEOUT_MS || 10 * 60 * 1000));

function vncAddress(server) {
  const host = String(server.host || '');
  const port = Number(server.vncPort || 5900);
  if (!host || port < 1 || port > 65535) return null;
  return { host, port };
}
function createVncSession({ sessionId, ownerId, serverId, ws }) {
  const target = findServer(serverId);
  const session = {
    id: sessionId, ownerId, serverId, ws, sock: null, connected: false, destroyed: false,
    pendingClose: false, detachTimer: null, createdAt: now(), lastByteAt: '', detachedAt: ''
  };
  vncSessions.set(session.id, session);
  const address = vncAddress(target);
  if (!address) {
    sendSession(session, { type: 'error', message: 'VNC 地址配置无效', fatal: true });
    return destroyVncSession(session, 'invalid-address');
  }
  const sock = net.connect({ host: address.host, port: address.port, timeout: VNC_CONNECT_TIMEOUT_MS });
  session.sock = sock;
  let settled = false;
  sock.once('error', (error) => {
    const friendly = /ECONNREFUSED/.test(error?.code || '') ? '无法连接到 Windows VNC 服务（ECONNREFUSED），请确认 UltraVNC/TightVNC 已启动'
      : /timeout|ETIMEDOUT/.test(String(error?.code || '') + String(error?.message || '')) ? '连接 Windows VNC 服务超时'
      : (error?.message || 'VNC 连接失败');
    if (!settled) { settled = true; sendSession(session, { type: 'error', message: friendly, fatal: true }); destroyVncSession(session, 'vnc-error'); return; }
    if (!session.destroyed) destroyVncSession(session, 'vnc-error');
  });
  sock.once('timeout', () => {
    try { sock.destroy(); } catch { /* already gone */ }
    if (!settled) { settled = true; sendSession(session, { type: 'error', message: '连接 Windows VNC 服务超时', fatal: true }); destroyVncSession(session, 'vnc-timeout'); }
  });
  sock.once('connect', () => {
    if (settled || session.destroyed) return;
    settled = true;
    session.connected = true;
    session.lastByteAt = now();
    auditEvent('vnc.connect', null, null, `VNC 桌面连接建立：${target.name} (${address.host}:${address.port})`, { sessionId:session.id, serverId:target.id, host:address.host, port:address.port });
    sendSession(session, { type: 'connected', sessionId:session.id, resumed:false, width:0, height:0 });
  });
  sock.on('data', (data) => {
    if (!session.sockIdleTimer) {
      session.sockIdleTimer = setInterval(() => {
        if (session.destroyed || !session.connected) return;
        if (session.lastByteAt && Date.now() - Date.parse(session.lastByteAt) > VNC_IDLE_TIMEOUT_MS) {
          try { sock.destroy(); } catch { /* already gone */ }
          if (!session.destroyed) destroyVncSession(session, 'vnc-idle-timeout');
        }
      }, 60_000);
    }
    session.lastByteAt = now();
    if (session.ws) sendSocket(session.ws, { type: 'vnc-data', data: data.toString('base64') });
  });
  sock.on('close', () => { if (!session.destroyed) destroyVncSession(session, 'vnc-closed'); });
  return session;
}
function destroyVncSession(session, reason = 'closed') {
  if (!session || session.destroyed) return;
  session.destroyed = true;
  if (session.detachTimer) { clearTimeout(session.detachTimer); session.detachTimer = null; }
  vncSessions.delete(session.id);
  if (session.sock) {
    try { session.sock.removeAllListeners(); } catch { /* already gone */ }
    try { session.sock.end(); } catch { /* already closed */ }
    try { session.sock.destroy(); } catch { /* already closed */ }
  }
  if (reason && session.ws) sendSession(session, { type: 'closed', reason });
  auditEvent('vnc.disconnect', null, null, `VNC 桌面连接结束：${reason}`, { sessionId:session.id, serverId:session.serverId, reason });
  session.ws = null;
  if (session.sockIdleTimer) { clearInterval(session.sockIdleTimer); session.sockIdleTimer = null; }
}
function detachVncSession(session) {
  if (!session || session.destroyed) return;
  session.ws = null;
  session.detachedAt = now();
  if (session.detachTimer) clearTimeout(session.detachTimer);
  session.detachTimer = setTimeout(() => destroyVncSession(session, 'idle-timeout'), VNC_SESSION_GRACE_MS);
}
function attachVncSession(session, ws) {
  if (session.detachTimer) { clearTimeout(session.detachTimer); session.detachTimer = null; }
  if (session.ws && session.ws !== ws) { try { session.ws.close(4000, 'VNC session reattached'); } catch { /* ignore */ } }
  session.ws = ws;
  session.detachedAt = '';
  sendSession(session, { type: 'connected', sessionId:session.id, resumed: true, width:0, height:0 });
}

function createSshSession({ sessionId, ownerId, serverId, ws, cols, rows, initialCwd }) {
  const target = findServer(serverId);
  const directory = normalizeInitialCwd(initialCwd);
  const session = { id: sessionId, ownerId, serverId, ws, client: null, stream: null, connected: false, destroyed: false, seq: 0, screen: null, snapshotPending: null, detachTimer: null, tabId: String(ws?.tabId || '').slice(0, 64), tabName: String(ws?.tabName || '').slice(0, 80), approval: { enabled:false, modelId:'', rememberAll:false, attempts:0 }, approvalGeneration: 0, approvalStopReason: '', approvalTimer: null, approvalFrames: 0, approvalLastScreen: '', approvalPending: null, approvalResolving: false, approvalHighRiskPrompt: null, highRiskInput: '', lastApprovalAt: '', lastApprovalKeys: '', initialCwd: directory, currentDirectory: directory, shellPid: null, startupParsed: false, startupBuffer: Buffer.alloc(0), createdAt: now(), lastOutputAt: '', detachedAt: '' };
  resizeSshSession(session, cols, rows);
  session.screen = new TerminalScreen(session.cols, session.rows);
  sshSessions.set(session.id, session);
  const ssh = safeSshClient(); session.client = ssh;
  ssh.on('ready', () => {
    if (session.destroyed) return;
    const changeDirectory = directory ? `cd ${shellQuote(directory)} 2>/dev/null || cd; ` : '';
    const command = `${changeDirectory}printf '${SHELL_PID_MARKER}%s\\n' "$$"; exec "\${SHELL:-/bin/sh}" -l`;
    const pty = { term: 'xterm-256color', cols: session.cols, rows: session.rows };
    ssh.exec(command, { pty }, (error, stream) => {
      if (error) { sendSession(session, { type: 'error', message: error.message || '终端创建失败', fatal: true }); return destroySshSession(session, 'shell-error'); }
      session.stream = stream;
      if (pty.cols !== session.cols || pty.rows !== session.rows) stream.setWindow(session.rows, session.cols, 0, 0);
      session.connected = true;
      stream.on('data', (data) => consumeShellOutput(session, data));
      stream.on('close', () => { if (!session.destroyed) destroySshSession(session, 'remote-closed'); });
      if (stream.stderr) stream.stderr.on('data', (data) => rememberOutput(session, data));
      sendSession(session, { type: 'connected', sessionId: session.id, resumed: false });
    });
  });
  ssh.on('error', (error) => {
    if (session.destroyed) return;
    sendSession(session, { type: 'error', message:sshErrorMessage(error), fatal: true });
    destroySshSession(session, 'ssh-error');
  });
  ssh.on('close', () => { if (!session.destroyed) destroySshSession(session, 'ssh-closed'); });
  try { ssh.connect(sshConfig(target)); } catch (error) { sendSession(session, { type: 'error', message: error.message, fatal: true }); destroySshSession(session, 'connect-error'); }
  return session;
}

wss.on('connection', (ws, authContext) => {
  ws.isAlive = true;
  ws.authSessionId = authContext.session.id; ws.authUserId = authContext.account.id;
  ws.on('pong', () => { ws.isAlive = true; });
  let boundSessionId = null;
  // The ws package reports protocol/parser failures through the error event.
  // Always consume it so malformed client frames cannot become an uncaught
  // exception that terminates the whole NexTerm process.
  ws.on('error', () => {
    const vncSession = vncSessions.get(boundSessionId);
    if (vncSession && vncSession.ws === ws) { detachVncSession(vncSession); return; }
    const session = sshSessions.get(boundSessionId);
    if (session && session.ws === ws) detachSshSession(session);
  });
  const ownerId = authContext.account.id;
  const send = (message) => {
    if (ws.readyState !== ws.OPEN) return;
    try { ws.send(JSON.stringify(message)); } catch { /* the peer may be closing */ }
  };
  ws.on('message', (raw, isBinary) => {
    try {
      // noVNC 在 WebSocket 上发送的是原始 RFB 二进制帧。VNC 会话一旦
      // 绑定，就必须把这些帧原样转给 Windows 端的 VNC 服务；否则它们
      // 会被下面的 JSON 协议解析丢弃，握手会一直停在 Security 阶段。
      if (isBinary) {
        const vncSession = vncSessions.get(boundSessionId);
        if (!vncSession || vncSession.ownerId !== ownerId || vncSession.ws !== ws || !vncSession.sock || !vncSession.connected) return;
        const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        if (data.length > 512 * 1024) {
          send({ type: 'error', message: 'VNC 数据过大' });
          return ws.close(1009, 'VNC binary message too large');
        }
        vncSession.sock.write(data);
        return;
      }
      const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
      if (Buffer.byteLength(text, 'utf8') > 512 * 1024) {
        send({ type: 'error', message: '消息过大' });
        return ws.close(1009, 'Message too large');
      }
      let message;
      try { message = JSON.parse(text); } catch { return send({ type: 'error', message: '无效消息' }); }
      if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.type !== 'string') return send({ type: 'error', message: '无效消息' });

      if (message.type === 'connect') {
        const serverId = typeof message.serverId === 'string' ? message.serverId.trim() : '';
        if (!serverId || serverId.length > 128) return send({ type: 'error', message: '服务器参数无效' });
        const target = findServer(serverId);
        if (!target) return send({ type: 'error', message: '服务器不存在' });
        const suppliedSessionId = message.sessionId;
        if (suppliedSessionId !== undefined && suppliedSessionId !== null && (typeof suppliedSessionId !== 'string' || suppliedSessionId.length > 128)) return send({ type: 'error', message: '会话参数无效' });
        const requestedId = suppliedSessionId ? suppliedSessionId : id();
        // A browser tab owns one WebSocket and one SSH shell. Reusing that
        // same session ID is the normal reconnect path; binding a different
        // ID would orphan the first shell when this socket closes.
        if (boundSessionId && boundSessionId !== requestedId) return send({ type: 'error', message: '此终端连接已绑定其他会话' });
        const useVnc = message.kind === 'vnc' || (serverProtocol(target) === 'vnc' && message.kind !== 'ssh');
        let session = useVnc ? vncSessions.get(requestedId) : sshSessions.get(requestedId);
        if (session && (session.ownerId !== ownerId || session.serverId !== target.id)) return send({ type: 'error', message: '会话归属不匹配', fatal: true });
        ws.tabName = typeof message.tabName === 'string' ? message.tabName.slice(0, 80) : '';
        ws.tabId = typeof message.tabId === 'string' ? message.tabId.slice(0, 64) : '';
        if (useVnc) {
          if (!session) session = createVncSession({ sessionId: requestedId, ownerId, serverId: target.id, ws });
          else attachVncSession(session, ws);
          boundSessionId = session.id;
          if (session.connected) send({ type: 'connected', sessionId: session.id, resumed: true, width: 0, height: 0 });
        } else {
          if (!session) session = createSshSession({ sessionId: requestedId, ownerId, serverId: target.id, ws, cols: message.cols, rows: message.rows, initialCwd: message.initialCwd });
          else { attachSshSession(session, ws, message.cols, message.rows); if (ws.tabName) session.tabName = ws.tabName; if (ws.tabId) session.tabId = ws.tabId; }
          boundSessionId = session.id;
          if (session.connected) {
            // Always send the authoritative state on resume. A page reload must
            // not silently restart approval that the server has already stopped,
            // and it must not need a second "enable" request when it is running.
            // Send it before "connected": the client's connected handler may
            // schedule an enable in the next animation frame, and the state must
            // win that race so a stopped approval stays stopped.
            send(approvalStateMessage(session));
            send({ type: 'connected', sessionId: session.id, resumed: true });
          }
        }
      } else if (message.type === 'input') {
        if (typeof message.data !== 'string' || message.data.length > 512 * 1024) return send({ type: 'error', message: '输入数据无效' });
        const session = sshSessions.get(boundSessionId);
        if (session?.ownerId === ownerId && session.ws === ws && session.stream) session.stream.write(Buffer.from(message.data, 'base64'));
        // While a high-risk prompt is waiting for the human, remember which
        // menu option was chosen so the history record can store the outcome.
        const watched = sshSessions.get(boundSessionId);
        if (watched && watched.ownerId === ownerId && watched.ws === ws && watched.approvalHighRiskPrompt) {
          let text = '';
          try { text = Buffer.from(message.data, 'base64').toString('utf8'); } catch { text = ''; }
          for (const char of text) {
            if (char === '\r') {
              const rawBuffer = watched.highRiskInput || '';
              const buffer = rawBuffer.toLowerCase().replace(/\s+/g, ' ').trim();
              watched.highRiskInput = '';
              if (!buffer) continue;
              // Detect arrow-key TUI navigation (ESC [ A/B/C/D) as a menu selection
              const arrowMatch = rawBuffer.match(/\x1b\[([ABCD])/);
              let choice, label;
              if (arrowMatch) {
                const dir = { A:'↑', B:'↓', C:'→', D:'←' }[arrowMatch[1]] || arrowMatch[1];
                choice = 'other';
                label = `方向键 ${dir} + 确认`;
              } else {
                choice = buffer === '1' ? 'approve_once' : buffer === '2' ? 'approve_always' : buffer === '3' ? 'deny' : (/^(y|yes|p|esc|q|n|no|u|unknown)$/i.test(buffer) ? 'other' : '');
                if (!choice) continue;
                label = choice === 'approve_once' ? '1 Yes, proceed' : choice === 'approve_always' ? "2 Yes, and don't ask again" : choice === 'deny' ? '3 No, tell it what to do differently' : `按键 ${buffer.charAt(0).toUpperCase()}`;
              }
              const account = users.find((item) => item.id === watched.ownerId);
              resolveHighRiskEntry(account, watched.approvalHighRiskPrompt.promptKey, choice, label, '用户在终端中手动按键');
              auditEvent('approval.high_risk_resolved', null, account || null, `高危提示人工处理：${label}`, { sessionId:watched.id, promptKey:watched.approvalHighRiskPrompt.promptKey, choice });
              approvalSend(watched, { action:'high_risk_resolved', promptKey:watched.approvalHighRiskPrompt.promptKey, choice, label });
              watched.approvalHighRiskPrompt = null;
              continue;
            }
            if (/^[\x00-\x1f]$/.test(char) && char !== '\x1b') continue;
            watched.highRiskInput = `${(watched.highRiskInput || '').slice(-15)}${char}`;
            if (!/[1-9a-zA-Z]/.test(char) && watched.highRiskInput.length > 32) watched.highRiskInput = '';
          }
        }
      } else if (message.type === 'resize') {
        const session = sshSessions.get(boundSessionId);
        if (session?.ownerId === ownerId && session.ws === ws) resizeSshSession(session, message.cols, message.rows);
      } else if (message.type === 'cwd') {
        const session = sshSessions.get(boundSessionId);
        const requestId = typeof message.requestId === 'string' ? message.requestId.slice(0, 128) : '';
        if (session?.ownerId === ownerId && session.ws === ws && requestId) querySessionCwd(session, (directory) => send({ type:'cwd', requestId, path:directory }));
      } else if (message.type === 'approval') {
        const session = sshSessions.get(boundSessionId);
        if (!session || session.ownerId !== ownerId || session.ws !== ws) return send({ type:'error', message:'会话不存在' });
        const action = message.action;
        if (action === 'enable') {
          const result = startSessionApproval(session, message.modelId);
          if (result.error) return send({ type:'approval', action:'error', reason:'enable_failed', message:result.error });
        } else if (action === 'disable') {
          stopSessionApproval(session, 'client-disabled');
        } else if (action === 'status') {
          const requestId = typeof message.requestId === 'string' ? message.requestId.slice(0, 128) : '';
          send(approvalStateMessage(session, requestId));
        } else {
          send({ type:'approval', action:'error', reason:'unsupported', message:'不支持的审批操作' });
        }
      } else if (message.type === 'vnc-data') {
        if (typeof message.data !== 'string' || message.data.length > 512 * 1024) return send({ type: 'error', message: 'VNC 数据无效' });
        const session = vncSessions.get(boundSessionId);
        if (session?.ownerId === ownerId && session.ws === ws && session.sock && session.connected) session.sock.write(Buffer.from(message.data, 'base64'));
      } else if (message.type === 'close') {
        const vncSession = vncSessions.get(boundSessionId);
        if (vncSession?.ownerId === ownerId && vncSession.ws === ws) { destroyVncSession(vncSession, 'client-closed'); boundSessionId = null; return; }
        const session = sshSessions.get(boundSessionId);
        if (session?.ownerId === ownerId && session.ws === ws) destroySshSession(session, 'client-closed');
        boundSessionId = null;
      } else {
        send({ type: 'error', message: '不支持的消息类型' });
      }
    } catch {
      // Keep malformed or unexpected client input isolated to this socket.
      send({ type: 'error', message: '无效消息' });
    }
  });
  ws.on('close', () => {
    const vncSession = vncSessions.get(boundSessionId);
    if (vncSession && vncSession.ws === ws) { detachVncSession(vncSession); return; }
    const session = sshSessions.get(boundSessionId);
    // A browser background/suspend is a detach, not a user-requested close.
    if (session && session.ws === ws) detachSshSession(session);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`NexTerm listening on https://0.0.0.0:${PORT}`);
});

process.on('SIGTERM', () => { clearInterval(wsHeartbeat); server.close(() => process.exit(0)); });
process.on('SIGINT', () => { clearInterval(wsHeartbeat); server.close(() => process.exit(0)); });
