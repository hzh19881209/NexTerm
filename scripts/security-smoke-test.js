const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const tls = require('tls');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const { Server: SshServer } = require('ssh2');

const root = path.join(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexterm-security-'));
const port = 33000 + Math.floor(Math.random() * 1000);
const username = 'security-test-admin';
const password = 'Correct-Horse-Battery-Staple-2026!';
let child;
let serverStderr = '';

function hashPassword(value, salt = crypto.randomBytes(16).toString('hex')) { return `${salt}:${crypto.scryptSync(String(value), salt, 32).toString('hex')}`; }
function base32Decode(value) { const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits=0,current=0; const bytes=[]; for(const char of String(value).toUpperCase().replace(/=+$/,'')){const index=alphabet.indexOf(char); if(index<0)continue; current=(current<<5)|index; bits+=5; if(bits>=8){bytes.push((current>>>(bits-8))&255);bits-=8;}} return Buffer.from(bytes); }
function totpCode(secret) { const counter=Math.floor(Date.now()/1000/30); const buffer=Buffer.alloc(8); buffer.writeBigUInt64BE(BigInt(counter)); const digest=crypto.createHmac('sha1',base32Decode(secret)).update(buffer).digest(); const offset=digest[digest.length-1]&15; return String(((digest.readUInt32BE(offset)&0x7fffffff)%1_000_000)).padStart(6,'0'); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function request(urlPath, { method='GET', body, cookie, csrf } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { ...(payload ? { 'Content-Type':'application/json', 'Content-Length':payload.length } : {}), ...(cookie ? { Cookie:cookie } : {}), ...(csrf ? { 'X-CSRF-Token':csrf } : {}) };
    const req = https.request({ hostname:'127.0.0.1', port, path:urlPath, method, headers, rejectUnauthorized:false }, (res) => {
      const chunks = []; res.on('data', (chunk) => chunks.push(chunk)); res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json=null; try { json=JSON.parse(text); } catch { /* empty */ } resolve({ status:res.statusCode, headers:res.headers, json, text }); });
    });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}
function sendRawTls(payload) {
  return new Promise((resolve) => {
    let settled = false;
    const socket = tls.connect({ hostname:'127.0.0.1', port, rejectUnauthorized:false }, () => socket.write(payload));
    const finish = () => { if (settled) return; settled = true; try { socket.destroy(); } catch { /* ignore */ } resolve(); };
    socket.setTimeout(1000, finish); socket.on('error', finish); socket.on('close', finish);
  });
}
function websocketMessage(urlPath, cookie, message) {
  return new Promise((resolve) => {
    let response = null;
    let settled = false;
    const ws = new WebSocket(`wss://127.0.0.1:${port}${urlPath}`, { rejectUnauthorized:false, headers:{ Cookie:cookie, Origin:`https://127.0.0.1:${port}` } });
    const finish = () => { if (settled) return; settled = true; clearTimeout(timer); try { ws.terminate(); } catch { /* ignore */ } resolve(response); };
    const timer = setTimeout(finish, 3000);
    ws.on('open', () => ws.send(message));
    ws.on('message', (data) => { try { response = JSON.parse(data.toString()); } catch { response = null; } try { ws.close(); } catch { /* ignore */ } });
    ws.on('close', finish); ws.on('error', finish); ws.on('unexpected-response', finish);
  });
}
function sendMalformedWebSocketFrame(cookie) {
  return new Promise((resolve) => {
    let settled = false;
    let response = '';
    const socket = tls.connect({ hostname:'127.0.0.1', port, rejectUnauthorized:false }, () => {
      socket.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nOrigin: https://127.0.0.1:${port}\r\nCookie: ${cookie}\r\n\r\n`);
    });
    const finish = () => { if (settled) return; settled = true; try { socket.destroy(); } catch { /* ignore */ } resolve(response); };
    socket.on('data', (chunk) => {
      response += chunk.toString('binary');
      if (response.includes('\r\n\r\n')) {
        // Deliberately omit the client mask. ws must reject this frame and
        // report it to the socket without taking down the parent process.
        socket.write(Buffer.from([0x81, 0x01, 0x41]));
        setTimeout(finish, 100);
      }
    });
    socket.setTimeout(1500, finish); socket.on('error', finish); socket.on('close', finish);
  });
}
function websocketRejectsSecondSession(urlPath, cookie, serverId) {
  return new Promise((resolve) => {
    const messages = [];
    let settled = false;
    const ws = new WebSocket(`wss://127.0.0.1:${port}${urlPath}`, { rejectUnauthorized:false, headers:{ Cookie:cookie, Origin:`https://127.0.0.1:${port}` } });
    const finish = () => { if (settled) return; settled = true; clearTimeout(timer); try { ws.terminate(); } catch { /* ignore */ } resolve(messages); };
    const timer = setTimeout(finish, 3000);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type:'connect', serverId, sessionId:'security-session-a' }));
      ws.send(JSON.stringify({ type:'connect', serverId, sessionId:'security-session-b' }));
    });
    ws.on('message', (data) => {
      let message; try { message = JSON.parse(data.toString()); } catch { return; }
      messages.push(message);
      if (message.type === 'error' && String(message.message || '').includes('绑定其他会话')) {
        try { ws.send(JSON.stringify({ type:'close' })); } catch { /* ignore */ }
        setTimeout(finish, 25);
      }
    });
    ws.on('close', finish); ws.on('error', finish); ws.on('unexpected-response', finish);
  });
}
function websocketResult(urlPath, cookie) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`wss://127.0.0.1:${port}${urlPath}`, { rejectUnauthorized:false, headers:{ Cookie:cookie, Origin:`https://127.0.0.1:${port}` } });
    const timer = setTimeout(() => { try { ws.terminate(); } catch { /* ignore */ } resolve(false); }, 3000);
    ws.on('open', () => { clearTimeout(timer); ws.close(); resolve(true); });
    ws.on('error', () => { clearTimeout(timer); resolve(false); });
    ws.on('unexpected-response', () => { clearTimeout(timer); resolve(false); });
  });
}
function sessionCookieFrom(headers) { const values = Array.isArray(headers['set-cookie']) ? headers['set-cookie'] : [headers['set-cookie']]; return values.filter(Boolean).map((item) => item.split(';')[0]).find((item) => item.startsWith('__Host-nexterm_session=')) || ''; }
async function checkTerminalResize(cookie, csrf) {
  const hostKey = crypto.generateKeyPairSync('rsa', { modulusLength:2048 }).privateKey.export({ type:'pkcs1', format:'pem' });
  const sockets = []; const clients = [];
  let authenticate; let openStream; let dimensions; let shellCount = 0; let shellStream; let receivedInput = '';
  const sshServer = new SshServer({ hostKeys:[hostKey] }, (client) => {
    clients.push(client); client.on('error', () => {});
    client.on('authentication', (context) => { authenticate = () => context.accept(); });
    client.on('ready', () => client.on('session', (accept) => {
      const session = accept();
      session.on('pty', (accept, reject, info) => { dimensions = { cols:info.cols, rows:info.rows }; accept(); });
      session.on('window-change', (accept, reject, info) => { dimensions = { cols:info.cols, rows:info.rows }; accept?.(); });
      session.on('exec', (accept) => {
        openStream = () => {
          shellCount += 1;
          const stream = accept(); shellStream = stream; stream.on('data', (data) => { receivedInput += data.toString(); });
          stream.write('__NEXTERM_SHELL_PID__123\r\n');
        };
      });
    }));
  });
  const waitFor = async (condition, message) => {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(message);
  };
  const connectSocket = async (sessionCookie = cookie) => {
    const ws = new WebSocket(`wss://127.0.0.1:${port}/ws`, { rejectUnauthorized:false, headers:{ Cookie:sessionCookie, Origin:`https://127.0.0.1:${port}` } });
    sockets.push(ws); ws.messages = [];
    ws.on('message', (data) => ws.messages.push(JSON.parse(data.toString())));
    ws.on('error', () => {});
    await waitFor(() => ws.readyState === WebSocket.OPEN, 'Terminal test WebSocket did not open');
    return ws;
  };
  const send = (ws, message) => ws.send(JSON.stringify(message));
  const resizeBeforeReady = async (ws, cols, rows) => {
    send(ws, { type:'resize', cols, rows });
    const requestId = crypto.randomUUID();
    // The reply establishes that the preceding resize reached the server.
    send(ws, { type:'cwd', requestId });
    await waitFor(() => ws.messages.some((item) => item.type === 'cwd' && item.requestId === requestId), 'Resize was not processed before SSH became ready');
  };
  try {
    await new Promise((resolve, reject) => { sshServer.once('error', reject); sshServer.listen(0, '127.0.0.1', resolve); });
    const result = await request('/api/servers', { method:'POST', cookie, csrf, body:{ name:'terminal-resize-test', host:'127.0.0.1', port:sshServer.address().port, username:'test', authType:'password', password:'test' } });
    assert(result.status === 201, 'Could not create the terminal resize test target');
    const serverId = result.json.id; const sessionId = crypto.randomUUID();
    const ws = await connectSocket();
    send(ws, { type:'connect', serverId, sessionId, cols:120, rows:40 });
    await waitFor(() => authenticate, 'SSH authentication did not start');
    await resizeBeforeReady(ws, 80, 24);
    authenticate();
    await waitFor(() => openStream, 'SSH PTY was not requested');
    assert(dimensions.cols === 80 && dimensions.rows === 24, 'Resize during SSH authentication was lost');
    await resizeBeforeReady(ws, 60, 20);
    openStream();
    await waitFor(() => ws.messages.some((item) => item.type === 'connected'), 'SSH terminal did not connect');
    await waitFor(() => dimensions.cols === 60 && dimensions.rows === 20, 'Resize while the SSH channel was opening was lost');
    send(ws, { type:'resize', cols:75, rows:22 });
    await waitFor(() => dimensions.cols === 75 && dimensions.rows === 22, 'Connected PTY did not resize');
    shellStream.write(Array.from({ length:2000 }, (_, i) => `\x1b[2J\x1b[Hframe-${i}`).join(''));
    await waitFor(() => ws.messages.filter((item) => item.type === 'output').map((item) => Buffer.from(item.data, 'base64').toString()).join('').includes('frame-1999'), 'Live terminal output did not arrive');
    ws.close();
    await waitFor(() => ws.readyState === WebSocket.CLOSED, 'First terminal WebSocket did not detach');
    shellStream.write('\x1b[2J\x1b[Hoffline-current 中文');
    // A fresh login has no browser output sequence or terminal buffer.
    const login = await request('/api/auth/login', { method:'POST', body:{ username, password } });
    assert(login.status === 200, 'Terminal restore login failed');
    const resumed = await connectSocket(sessionCookieFrom(login.headers));
    send(resumed, { type:'connect', serverId, sessionId, lastSeq:0, cols:50, rows:18 });
    await waitFor(() => resumed.messages.some((item) => item.type === 'connected' && item.resumed), 'SSH terminal did not resume');
    await waitFor(() => dimensions.cols === 50 && dimensions.rows === 18, 'Resumed PTY did not use the new browser dimensions');
    await waitFor(() => resumed.messages.some((item) => item.type === 'snapshot'), 'Fresh login did not receive a terminal snapshot');
    const frame = resumed.messages.find((item) => item.type === 'snapshot');
    const frameText = Buffer.from(frame.data, 'base64').toString();
    assert(frameText.includes('offline-current 中文') && !frameText.includes('frame-'), 'Snapshot replayed obsolete frames or lost disconnected output');
    assert(frame.cols === 50 && frame.rows === 18, 'Snapshot dimensions differ from the resized PTY');
    assert(!resumed.messages.some((item) => item.type === 'output'), 'Historical output was replayed alongside the snapshot');
    assert(receivedInput === '', 'Restoring the screen wrote historical data to the SSH shell');
    shellStream.write(' live-after-restore');
    await waitFor(() => resumed.messages.some((item) => item.type === 'output' && item.seq > frame.seq && Buffer.from(item.data, 'base64').toString().includes('live-after-restore')), 'Live output after the snapshot was lost');
    send(resumed, { type:'input', data:Buffer.from('echo still-alive\r').toString('base64') });
    await waitFor(() => receivedInput === 'echo still-alive\r', 'Input after restore did not reach the original shell');
    const transient = await connectSocket();
    send(transient, { type:'connect', serverId, sessionId, lastSeq:frame.seq, cols:50, rows:18 });
    await waitFor(() => transient.messages.some((item) => item.type === 'snapshot'), 'Transient reconnect did not receive a current snapshot');
    await waitFor(() => resumed.readyState === WebSocket.CLOSED, 'Taking over the restored terminal left the old socket attached');
    assert(Buffer.from(transient.messages.find((item) => item.type === 'snapshot').data, 'base64').toString().includes('live-after-restore'), 'Transient reconnect lost the latest screen');
    assert(shellCount === 1, 'Terminal resize unexpectedly replaced the remote shell');
    send(transient, { type:'close' });
    console.log('Terminal PTY resize, snapshot restore, reconnect and input checks passed');
  } finally {
    for (const ws of sockets) ws.terminate();
    for (const client of clients) client.end();
    await new Promise((resolve) => sshServer.close(resolve));
  }
}
async function waitForServer() {
  for (let attempt=0; attempt<50; attempt += 1) { try { const result=await request('/api/health'); if (result.status===200) return; } catch { /* starting */ } await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error('NexTerm test server did not start');
}

async function checkVncBinaryBridge(cookie, csrf) {
  let received = Buffer.alloc(0);
  let vncSocket;
  let ws;
  const vncServer = net.createServer((socket) => {
    vncSocket = socket;
    socket.on('error', () => {});
    socket.on('data', (data) => { received = Buffer.concat([received, data]); });
    socket.write('RFB 003.008\n');
  });
  const waitFor = async (condition, message) => {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(message);
  };
  try {
    await new Promise((resolve, reject) => { vncServer.once('error', reject); vncServer.listen(0, '127.0.0.1', resolve); });
    const result = await request('/api/servers', { method:'POST', cookie, csrf, body:{ name:'vnc-binary-test', host:'127.0.0.1', username:'desktop', authType:'password', password:'temporary', protocol:'vnc', os:'windows', vncPort:vncServer.address().port } });
    assert(result.status === 201, `VNC test target creation failed: ${result.text}`);
    ws = new WebSocket(`wss://127.0.0.1:${port}/ws`, { rejectUnauthorized:false, headers:{ Cookie:cookie, Origin:`https://127.0.0.1:${port}` } });
    const messages = [];
    ws.on('message', (data) => { try { messages.push(JSON.parse(data.toString())); } catch { /* ignore */ } });
    ws.on('error', () => {});
    await waitFor(() => ws.readyState === WebSocket.OPEN, 'VNC test WebSocket did not open');
    ws.send(JSON.stringify({ type:'connect', kind:'vnc', serverId:result.json.id, sessionId:crypto.randomUUID() }));
    await waitFor(() => messages.some((item) => item.type === 'connected'), `VNC target did not connect: ${JSON.stringify(messages)}`);
    const clientVersion = Buffer.from('RFB 003.008\n');
    ws.send(clientVersion);
    await waitFor(() => received.includes(clientVersion), 'Binary RFB frame from the browser did not reach the VNC target');
    await waitFor(() => messages.some((item) => item.type === 'vnc-data' && Buffer.from(item.data, 'base64').toString().includes('RFB 003.008')), 'VNC target handshake did not reach the browser');
    ws.send(JSON.stringify({ type:'close' }));
    ws.close();
    console.log('VNC binary bridge handshake check passed');
  } finally {
    try { ws?.terminate(); } catch { /* ignore */ }
    try { vncSocket?.destroy(); } catch { /* ignore */ }
    await new Promise((resolve) => vncServer.close(resolve));
  }
}

async function main() {
  fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify([{ id:crypto.randomUUID(), username, role:'admin', passwordHash:hashPassword(password), mustChangePassword:false, totpEnabled:false, trustedDevices:[], createdAt:new Date().toISOString() }], null, 2), { mode:0o600 });
  child = spawn(process.execPath, ['server.js'], { cwd:root, env:{ ...process.env, DATA_DIR:dataDir, PORT:String(port), APP_SECRET:'security-smoke-test-secret-which-is-long-enough', TLS_CERT_FILE:path.join(root, 'certs', 'your.domain.com.crt'), TLS_KEY_FILE:path.join(root, 'certs', 'your.domain.com.key'), TRUST_PROXY:'0' }, stdio:['ignore','pipe','pipe'] });
  child.stderr.on('data', (data) => { serverStderr += data.toString(); });
  await waitForServer();

  await sendRawTls('GET /ws HTTP/1.1\r\nHost: foo:bad\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert(child.exitCode === null, 'Malformed WebSocket Host header terminated the server');

  const anonymous = await request('/api/servers'); assert(anonymous.status === 401, 'Anonymous server access was not rejected');
  const anonymousStatus = await request('/api/system/status'); assert(anonymousStatus.status === 401, 'Anonymous system status access was not rejected');
  const anonymousServerStatus = await request('/api/servers/status'); assert(anonymousServerStatus.status === 401, 'Anonymous target server status access was not rejected');
  const legacyBearer = await new Promise((resolve, reject) => { const req=https.request({ hostname:'127.0.0.1', port, path:'/api/servers', method:'GET', rejectUnauthorized:false, headers:{ Authorization:'Bearer legacy-token' } }, (res) => { res.resume(); res.on('end',()=>resolve(res.statusCode)); }); req.on('error',reject); req.end(); }); assert(legacyBearer === 401, 'Legacy bearer token authentication is still accepted');

  const login = await request('/api/auth/login', { method:'POST', body:{ username, password } }); assert(login.status === 200, `Login failed: ${login.text}`); assert(login.json?.csrfToken, 'Login did not return a CSRF token');
  const cookie = sessionCookieFrom(login.headers); let activeCookie=cookie; let activeCsrf=login.json.csrfToken;
  assert(cookie.includes('__Host-nexterm_session='), 'Secure session cookie was not issued'); assert(String(login.headers['content-security-policy'] || '').includes("frame-ancestors 'none'"), 'CSP security header is missing');

  const authenticated = await request('/api/servers', { cookie }); assert(authenticated.status === 200, 'Cookie session was not accepted');
  const serverStatuses = await request('/api/servers/status', { cookie }); assert(serverStatuses.status === 200 && Array.isArray(serverStatuses.json?.servers), 'Target server status endpoint did not return a server list');
  const malformedMessage = await websocketMessage('/ws', cookie, 'null');
  assert(malformedMessage?.type === 'error' && child.exitCode === null, 'Malformed WebSocket JSON terminated the server or was not rejected');
  await sendMalformedWebSocketFrame(cookie);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert(child.exitCode === null, 'Malformed WebSocket frame terminated the server');
  const systemStatus = await request('/api/system/status', { cookie }); assert(systemStatus.status === 200 && typeof systemStatus.json?.cpu?.usage === 'number' && typeof systemStatus.json?.memory?.usage === 'number' && typeof systemStatus.json?.disk?.usage === 'number' && systemStatus.json?.version, 'System status endpoint did not return resource metrics');
  const noCsrf = await request('/api/servers', { method:'POST', cookie, body:{ name:'test', host:'127.0.0.1', port:22, username:'root', authType:'password', password:'temporary' } }); assert(noCsrf.status === 403, 'Mutating request without CSRF was not rejected');
  const withCsrf = await request('/api/servers', { method:'POST', cookie, csrf:login.json.csrfToken, body:{ name:'test', host:'127.0.0.1', port:22, username:'root', authType:'password', password:'temporary' } }); assert(withCsrf.status === 201, `Mutating request with CSRF failed: ${withCsrf.text}`);
  const duplicateSessions = await websocketRejectsSecondSession('/ws', cookie, withCsrf.json.id); assert(duplicateSessions.some((message) => message.type === 'error' && String(message.message || '').includes('绑定其他会话')) && child.exitCode === null, 'A WebSocket was allowed to bind multiple SSH sessions');
  const secondServer = await request('/api/servers', { method:'POST', cookie, csrf:login.json.csrfToken, body:{ name:'test-2', host:'127.0.0.2', port:22, username:'root', authType:'password', password:'temporary' } }); assert(secondServer.status === 201, `Second server creation failed: ${secondServer.text}`);
  const reordered = await request('/api/servers/reorder', { method:'POST', cookie, csrf:login.json.csrfToken, body:{ ids:[secondServer.json.id, withCsrf.json.id] } }); assert(reordered.status === 200, `Server reorder failed: ${reordered.text}`);
  const listedAfterReorder = await request('/api/servers', { cookie }); assert(listedAfterReorder.status === 200 && listedAfterReorder.json?.[0]?.id === secondServer.json.id && listedAfterReorder.json?.[1]?.id === withCsrf.json.id, 'Server order was not persisted');
  assert(await websocketResult('/ws', cookie), 'Authenticated same-origin WebSocket was rejected'); assert(!(await websocketResult('/ws?token=legacy', cookie)), 'WebSocket query token URL was accepted');

  await checkTerminalResize(cookie, login.json.csrfToken);
  await checkVncBinaryBridge(cookie, login.json.csrfToken);

  const unauthorizedSetup = await request('/api/auth/2fa/setup', { method:'POST', cookie:activeCookie, csrf:activeCsrf, body:{} }); assert(unauthorizedSetup.status === 400, 'MFA setup did not require the current password');
  const setup = await request('/api/auth/2fa/setup', { method:'POST', cookie:activeCookie, csrf:activeCsrf, body:{ currentPassword:password } }); assert(setup.status === 200 && setup.json?.secret, `Initial MFA setup failed: ${setup.text}`);
  const enabled = await request('/api/auth/2fa/enable', { method:'POST', cookie:activeCookie, csrf:activeCsrf, body:{ otp:totpCode(setup.json.secret) } }); const firstMfaCookie=sessionCookieFrom(enabled.headers); assert(enabled.status === 200 && firstMfaCookie && enabled.json?.csrfToken, `MFA enable failed: ${enabled.text}`); assert((await request('/api/servers', { cookie:activeCookie })).status === 401, 'Old session survived MFA enable'); activeCookie=firstMfaCookie; activeCsrf=enabled.json.csrfToken;
  const unsafeRebind = await request('/api/auth/2fa/setup', { method:'POST', cookie:activeCookie, csrf:activeCsrf, body:{ currentPassword:password } }); assert(unsafeRebind.status === 400, 'MFA rebind did not require the old OTP');
  const rebind = await request('/api/auth/2fa/setup', { method:'POST', cookie:activeCookie, csrf:activeCsrf, body:{ currentPassword:password, currentOtp:totpCode(setup.json.secret) } }); assert(rebind.status === 200 && rebind.json?.secret, `MFA rebind authorization failed: ${rebind.text}`);
  const rebound = await request('/api/auth/2fa/enable', { method:'POST', cookie:activeCookie, csrf:activeCsrf, body:{ otp:totpCode(rebind.json.secret) } }); const reboundCookie=sessionCookieFrom(rebound.headers); assert(rebound.status === 200 && reboundCookie && rebound.json?.csrfToken, `MFA rebind failed: ${rebound.text}`); activeCookie=reboundCookie; activeCsrf=rebound.json.csrfToken;

  const secondLogin = await request('/api/auth/login', { method:'POST', body:{ username, password, otp:totpCode(rebind.json.secret) } }); const secondCookie = sessionCookieFrom(secondLogin.headers); assert(secondLogin.status === 200 && secondCookie, 'Second MFA session was not created');
  const newPassword = 'Another-Correct-Horse-Battery-Staple-2026!'; const changed = await request('/api/auth/change-password', { method:'POST', cookie:activeCookie, csrf:activeCsrf, body:{ currentPassword:password, newPassword, confirmPassword:newPassword } }); const rotatedCookie = sessionCookieFrom(changed.headers); assert(changed.status === 200 && rotatedCookie && changed.json?.csrfToken, `Password rotation failed: ${changed.text}`);
  assert((await request('/api/servers', { cookie:activeCookie })).status === 401, 'Original session survived password rotation'); assert((await request('/api/servers', { cookie:secondCookie })).status === 401, 'Other session survived password rotation'); assert((await request('/api/servers', { cookie:rotatedCookie })).status === 200, 'Rotated session was not accepted');

  const logout = await request('/api/auth/logout', { method:'POST', cookie:rotatedCookie, csrf:changed.json.csrfToken, body:{} }); assert(logout.status === 200, 'Logout failed');
  const revoked = await request('/api/servers', { cookie:rotatedCookie }); assert(revoked.status === 401, 'Revoked session remained valid after logout');
  console.log('NexTerm security smoke test passed');
}

main().catch((error) => { console.error(error.stack || error.message); if (serverStderr) console.error('Server stderr:', serverStderr); process.exitCode=1; }).finally(() => { if (child && !child.killed) child.kill('SIGTERM'); fs.rmSync(dataDir, { recursive:true, force:true }); });
