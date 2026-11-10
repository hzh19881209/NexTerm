const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Terminal } = require('@xterm/headless');
const { TerminalScreen, SCROLLBACK } = require('../lib/terminal-screen');

const write = (terminal, data) => new Promise((resolve) => terminal.write(data, resolve));
const snapshot = (screen) => new Promise((resolve) => screen.snapshot(resolve));
const feed = (screen, data) => screen.write(Buffer.from(data), () => {});
function terminal(t, cols = 80, rows = 24) {
  const value = new Terminal({ cols, rows, scrollback:SCROLLBACK, convertEol:true, allowProposedApi:true });
  t.after(() => value.dispose()); return value;
}
function screen(t, cols = 80, rows = 24) {
  const value = new TerminalScreen(cols, rows); t.after(() => value.dispose()); return value;
}
function content(terminal, type = 'active') {
  const buffer = terminal.buffer[type];
  return Array.from({ length:buffer.length }, (_, i) => buffer.getLine(i).translateToString(true));
}
async function restore(terminal, frame) {
  terminal.resize(frame.cols, frame.rows);
  await write(terminal, Buffer.concat([Buffer.from('\x1bc'), Buffer.from(frame.data, 'base64')]));
}

test('long sessions restore bounded history, Unicode, colors and cursor', async (t) => {
  const source = screen(t); const destination = terminal(t);
  feed(source, Array.from({ length:2500 }, (_, i) => `line-${i}\r\n`).join(''));
  feed(source, '\x1b[31m当前目录\x1b[0m $ abc\x1b[2D');
  const frame = await snapshot(source);
  await restore(destination, frame);
  assert.deepEqual(content(destination), content(source.terminal));
  assert.equal(destination.buffer.active.length, SCROLLBACK + destination.rows);
  assert.equal(destination.buffer.active.cursorX, source.terminal.buffer.active.cursorX);
  assert.equal(destination.buffer.active.cursorY, source.terminal.buffer.active.cursorY);
  const line = destination.buffer.active.getLine(destination.buffer.active.baseY + destination.buffer.active.cursorY);
  assert.equal(line.getCell(0).getFgColor(), 1);
  assert.ok(!content(destination).includes('line-0'));
  feed(source, 'Z'); await write(destination, 'Z'); await snapshot(source);
  assert.deepEqual(content(destination), content(source.terminal));
});

test('thousands of full-screen redraws become one current frame', async (t) => {
  const source = screen(t); const destination = terminal(t);
  for (let i = 0; i < 6000; i += 1) feed(source, `\x1b[2J\x1b[Hframe-${i}`);
  const frame = await snapshot(source);
  assert.equal(frame.seq, 6000);
  assert.ok(Buffer.byteLength(frame.data, 'base64') < 100);
  await restore(destination, frame);
  assert.equal(content(destination)[0], 'frame-5999');
  assert.deepEqual(content(destination), content(source.terminal));
});

test('alternate screen and input modes survive reconnect and exit', async (t) => {
  const source = screen(t); const destination = terminal(t);
  feed(source, 'shell history\r\n$ editor');
  feed(source, '\x1b[?1049h\x1b[H\x1b[32meditor 中文\x1b[0m\x1b[4;5Hcursor\x1b[?1h\x1b[?2004h');
  await restore(destination, await snapshot(source));
  assert.equal(destination.buffer.active.type, 'alternate');
  assert.equal(destination.modes.bracketedPasteMode, true);
  assert.equal(destination.modes.applicationCursorKeysMode, true);
  assert.deepEqual(content(destination), content(source.terminal));
  const exit = '\x1b[?1049l\r\n$ ';
  feed(source, exit); await write(destination, exit); await snapshot(source);
  assert.deepEqual(content(destination), content(source.terminal));
});

test('snapshot barrier separates earlier output from live output', async (t) => {
  const source = screen(t); const destination = terminal(t); const events = [];
  source.write(Buffer.from('before'), (seq) => events.push(seq));
  const pending = new Promise((resolve) => source.snapshot((frame) => { events.push('snapshot'); resolve(frame); }));
  source.write(Buffer.from('-after'), (seq) => events.push(seq));
  const frame = await pending;
  assert.equal(frame.seq, 1);
  await restore(destination, frame); await write(destination, '-after'); await snapshot(source);
  assert.deepEqual(events, [1, 'snapshot', 2]);
  assert.equal(content(destination)[0], 'before-after');
  assert.deepEqual(content(destination), content(source.terminal));
});

test('queued resizes apply between writes in the original order', async (t) => {
  const source = screen(t, 40, 10); const reference = terminal(t, 40, 10); const destination = terminal(t);
  const first = '宽字符和长行'.repeat(8) + '\r\n'; const second = 'next line '.repeat(8);
  feed(source, first); source.resize(25, 8); feed(source, second); source.resize(60, 12);
  const frame = await snapshot(source);
  await write(reference, first); reference.resize(25, 8); await write(reference, second); reference.resize(60, 12);
  await restore(destination, frame);
  assert.equal(frame.cols, 60); assert.equal(frame.rows, 12);
  assert.deepEqual(content(destination), content(reference));
});

// Exercise the actual browser restore handler against the same xterm parser,
// with only DOM rendering and layout stubbed out.
const appSource = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const handlerSource = appSource.slice(appSource.indexOf('  function restoreTerminalSnapshot('), appSource.indexOf('  function connectTab('));
test('browser hides intermediate restore frames and orders queued live output', async (t) => {
  const source = screen(t); const destination = terminal(t); const tracked = [];
  destination.element = { style:{} }; destination.refresh = () => {};
  const context = vm.createContext({ atob, Uint8Array, state:{ activeTab:'tab' }, fitTerminal:() => {}, sendResize:() => {}, scrollTerminalToBottom:() => {}, trackTabOutput:() => tracked.push(content(destination)[0]) });
  vm.runInContext(handlerSource, context);
  feed(source, 'current screen'); const frame = await snapshot(source);
  const tab = { id:'tab', terminal:destination, lastSeq:999 };
  destination.write('stale queued output');
  context.restoreTerminalSnapshot(tab, frame, () => true);
  assert.equal(destination.element.style.visibility, 'hidden');
  assert.equal(tab.restoring, true);
  await write(destination, ' + live');
  assert.equal(destination.element.style.visibility, '');
  assert.equal(tab.restoring, false);
  assert.equal(tab.lastSeq, frame.seq);
  assert.equal(content(destination)[0], 'current screen + live');
  assert.deepEqual(tracked, ['current screen']);
});

test('obsolete snapshot callbacks cannot reveal a newer restoration', async (t) => {
  const source = screen(t); const destination = terminal(t);
  destination.element = { style:{} }; destination.refresh = () => {};
  let completed = 0;
  const context = vm.createContext({ atob, Uint8Array, state:{}, scrollTerminalToBottom:() => {}, trackTabOutput:() => { completed += 1; } });
  vm.runInContext(handlerSource, context);
  feed(source, 'current'); const frame = await snapshot(source);
  const tab = { id:'tab', terminal:destination };
  context.restoreTerminalSnapshot(tab, frame, () => false);
  context.restoreTerminalSnapshot(tab, frame, () => true);
  await write(destination, '');
  assert.equal(completed, 1);
  assert.equal(tab.restoring, false);
});

test('large output pauses SSH reads until the screen parser catches up', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const source = serverSource.slice(serverSource.indexOf('function rememberOutput('), serverSource.indexOf('function destroySshSession('));
  const parsed = []; const delivered = []; const flow = [];
  const session = {
    screen:{ write:(_data, callback) => parsed.push(callback) },
    stream:{ pause:() => flow.push('pause'), resume:() => flow.push('resume'), stderr:{ pause:() => flow.push('stderr-pause'), resume:() => flow.push('stderr-resume') } }
  };
  const context = vm.createContext({ Buffer, now:() => '', sendSession:(_session, output) => delivered.push(output.seq) });
  vm.runInContext(source, context);
  for (let i = 0; i < 16; i += 1) context.rememberOutput(session, Buffer.alloc(32 * 1024, 'x'));
  assert.deepEqual(flow, ['pause', 'stderr-pause']);
  assert.deepEqual(delivered, []);
  parsed.forEach((callback, index) => callback(index + 1));
  assert.deepEqual(flow, ['pause', 'stderr-pause', 'resume', 'stderr-resume']);
  assert.equal(session.pendingOutputBytes, 0);
  assert.deepEqual(delivered, Array.from({ length:16 }, (_, index) => index + 1));
});

// The approval model must judge the pending command, not the whole TUI dump:
// a 48-line screen full of `rm -rf` mentions elsewhere made every tmp cleanup
// come back `unsafe`.
test('approval prompt block isolates the pending command', async (t) => {
  const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const source = serverSource.slice(serverSource.indexOf('function approvalPromptBlock('), serverSource.indexOf('function sessionPromptState('));
  const regexSource = serverSource.slice(serverSource.indexOf('const CODEX_ACTIVE_RE'), serverSource.indexOf('const APPROVAL_SETTLE_MS'));
  const context = vm.createContext({ APPROVAL_BLOCK_MAX_LINES:28, APPROVAL_BLOCK_MAX_BYTES:8_000 });
  vm.runInContext(regexSource, context);
  vm.runInContext(source, context);
  const screen = [
    '$ rm -rf /var/lib/postgresql/data',
    'removed /var/lib/postgresql/data/base/1',
    '',
    '• Ran rm -rf /tmp/nexterm-test &&',
    '  bash /tmp/nexterm-test/run.sh',
    '',
    'Would you like to run this command?',
    '  1. Yes, proceed',
    '  2. Yes, and don\'t ask again',
    '  3. No, and tell Codex what to do differently'
  ].join('\n');
  const block = context.approvalPromptBlock(screen);
  assert.match(block, /rm -rf \/tmp\/nexterm-test/);
  assert.match(block, /Would you like to run this command\?/);
  assert.ok(!block.includes('/var/lib/postgresql'), 'older unrelated output must stay out of the block');
  assert.equal(context.approvalPromptBlock('no prompt here'), '');
});

// Long one-liners (dependency downloads, installs) must survive the block
// budget, and the system prompt must let the model approve them when the
// destination and source are clearly low-risk public locations.
test('approval handles long download commands and approves public downloads', async (t) => {
  const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const source = serverSource.slice(serverSource.indexOf('function approvalPromptBlock('), serverSource.indexOf('function sessionPromptState('));
  const regexSource = serverSource.slice(serverSource.indexOf('const CODEX_ACTIVE_RE'), serverSource.indexOf('const APPROVAL_SETTLE_MS'));
  const context = vm.createContext({ APPROVAL_BLOCK_MAX_LINES:28, APPROVAL_BLOCK_MAX_BYTES:8_000 });
  vm.runInContext(regexSource, context);
  vm.runInContext(source, context);
  const longCommand = 'cd /tmp && rm -rf novnc-dl && mkdir novnc-dl && cd novnc-dl && curl -sSL --max-time 120 -o novnc.tar.gz https://github.com/novnc/noVNC/archive/refs/tags/v1.6.0.tar.gz && tar xzf novnc.tar.gz && ls noVNC-1.6.0/core | head -30';
  const filler = Array.from({ length: 12 }, (_, index) => `output line ${index} from a previous step`).join('\n');
  const screen = [
    filler,
    '',
    `Would you like to run this command?`,
    `  1. Yes, proceed (y)`,
    `  2. Yes, and don't ask again for commands that start with \`${longCommand.slice(0, 200)}...${longCommand.slice(-80)}\` (p)`,
    `  3. No, and tell Codex what to do differently (esc)`,
    '',
    ' Press enter to confirm or esc to cancel'
  ].join('\n');
  const block = context.approvalPromptBlock(screen);
  assert.match(block, /curl -sSL --max-time 120/, 'the command head must survive truncation');
  assert.match(block, /github.com\/novnc\/noVNC/, 'the public download source must be visible');
  assert.match(block, /Would you like to run this command\?/, 'the prompt line must stay in the block');
  const prompt = serverSource.slice(serverSource.indexOf('function approvalSystemPrompt()'), serverSource.indexOf('function buildApprovalMessages('));
  assert.match(prompt, /6a\./, 'public downloads must be explicitly approvable');
  assert.match(prompt, /curl\|sh/, 'pipe-to-shell handling must stay documented');
  assert.match(prompt, /不因“来自外部”而拒绝/, 'external origin alone must not trigger deny');
});

// The user asked for a deliberately permissive approval model: ordinary file,
// container and service operations should be approved, while only clearly
// catastrophic system-wide destruction is handed back to the human.
test('approval prompt only rejects catastrophic system-wide destruction', async (t) => {
  const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const prompt = serverSource.slice(serverSource.indexOf('function approvalSystemPrompt()'), serverSource.indexOf('function buildApprovalMessages('));
  assert.match(prompt, /默认尽量放行/);
  assert.match(prompt, /删除或清理某个具体目录中的文件属于普通操作/);
  assert.match(prompt, /docker rm\/rmi/);
  assert.match(prompt, /只有命令明确会造成大范围、不可逆的系统级破坏/);
  assert.match(prompt, /不要用 deny、unsafe 或 unknown 代替判断/);
  assert.match(prompt, /即使命令较长、参数复杂、含有变量\/通配符或无法完全看清影响/);
  assert.doesNotMatch(prompt, /写入项目外路径、修改系统配置、开放端口、创建远端资源、涉及账号凭据、跨主机操作、影响面大或意图不明确：deny/);
});
