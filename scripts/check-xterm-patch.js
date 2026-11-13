// 校验 public/vendor/xterm.js 的 Codex 备用缓冲区补丁完整且语法正确。
// 用法：node scripts/check-xterm-patch.js
// 1. 补丁 1（alt-scrollback）：备用缓冲区保留 scrollback（alt buffer 的 Buffer
//    构造 hasScrollback=true）；
// 2. 补丁 3（alt-history）：TUI 退出时把会话历史刷入主缓冲区 scrollback；
// 3. IIFE 语法解析（优先 esbuild，缺失时回退 node:vm / new Function）。
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'public', 'vendor', 'xterm.js');
if (!fs.existsSync(file)) {
  console.error('[check-xterm-patch] 未找到 public/vendor/xterm.js（应由 build-xterm-vendor.js 生成）');
  process.exit(1);
}
const code = fs.readFileSync(file, 'utf8');
let ok = true;

// 补丁 1：alt buffer 的 Buffer 构造 hasScrollback=true。esbuild 会重命名
// Buffer 类，但属性名和构造参数会保留。
const hasAltScrollback = /this\._alt = new [\w$]+\(true, this\._optionsService, this\._bufferService\)/.test(code);
if (!hasAltScrollback) {
  console.error('[check-xterm-patch] 补丁 1（备用缓冲区 scrollback）未生效：产物中 _alt 仍不是 hasScrollback=true');
  ok = false;
}

// 曾经的自定义 wheel 补丁在 sendEvent 普通函数里读取 this.element，严格模式下
// this 为 undefined，会导致 Codex 下滚时报 "Cannot read properties of undefined
// (reading 'element')"。这里防止该补丁被误加回来。
const buggyWheelPatch = 'this.element && this.element.classList.contains("enable-mouse-events") && this._bufferService.buffer.type === "alternate"';
if (code.includes(buggyWheelPatch) || code.includes('nexterm-wheel-local')) {
  console.error('[check-xterm-patch] 检测到已废弃的 wheel-local 补丁；Codex 的滚轮必须交回 TUI 处理');
  ok = false;
}

// 补丁 3：备用缓冲区历史累积到主缓冲区（Codex 运行中可上翻）。
// 累积方法 _nextermAccumAltLine/_nextermFlushAltText 与 scroll() 钩子应进入产物。
const hasAltAccum = code.includes('_nextermAccumAltLine') && code.includes('_nextermFlushAltText');
if (!hasAltAccum) {
  console.error('[check-xterm-patch] 补丁 3（备用缓冲区历史累积）未进入产物：未发现 _nextermAccumAltLine/_nextermFlushAltText');
  ok = false;
}

// 语法解析：优先 esbuild（若可用），否则用 new Function 粗校验 IIFE 可解析。
if (ok) {
  let parsed = false;
  const localEsbuild = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');
  if (fs.existsSync(localEsbuild)) {
    const r = spawnSync(localEsbuild, [file, '--bundle', '--format=iife', '--outfile=/dev/null', '--log-level=error']);
    parsed = r.status === 0;
  } else if (spawnSync('esbuild', ['--version'], { stdio: 'ignore' }).status === 0) {
    const r = spawnSync('esbuild', [file, '--bundle', '--format=iife', '--outfile=/dev/null', '--log-level=error']);
    parsed = r.status === 0;
  }
  if (!parsed) {
    // 回退：用 new Function 校验整体可解析（IIFE 形式）。
    try { new Function(code); parsed = true; } catch (e) { parsed = false; }
  }
  if (!parsed) {
    console.error('[check-xterm-patch] xterm.js 语法解析失败');
    ok = false;
  }
}

if (!ok) process.exit(1);
console.log('[check-xterm-patch] xterm.js 补丁完整且语法正确（alt-scrollback + alt-history）');
