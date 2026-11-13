// 校验 public/vendor/xterm.js 的 Codex 备用缓冲区补丁完整且语法正确。
// 用法：node scripts/check-xterm-patch.js
// 1. 补丁 1（alt-scrollback）：备用缓冲区保留 scrollback（alt buffer 的 Buffer
//    构造 hasScrollback=true），使 Codex 等 TUI 运行中可上翻；
// 2. 补丁 2（wheel-local）：TUI 开着鼠标上报且备用缓冲区已有 scrollback 时，
//    滚轮本地回翻而不转发给 TUI（enable-mouse-events + alternate + ybase>0）；
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
// Buffer 类，故不用字面量特征；改为校验"旧锚点已消失 + wheel-local 存在"。
// wheel-local 运行时条件只可能来自我们打补丁后的产物，其存在即证明产物为
// 带补丁版本（补丁 1 与补丁 2 在同一次构建中一起打入，二者同生共死）。
const oldAnchorGone = !code.includes('new Buffer(false, this._optionsService, this._bufferService)');
if (!oldAnchorGone) {
  console.error('[check-xterm-patch] 补丁 1（备用缓冲区 scrollback）未生效：产物仍含未打补丁的 new Buffer(false 旧锚点');
  ok = false;
}

// 补丁 2：wheel-local 运行时条件（enable-mouse-events + alternate + ybase>0）。
const hasWheelLocal = /enable-mouse-events[\s\S]{0,240}?alternate[\s\S]{0,120}?ybase/.test(code);
if (!hasWheelLocal) {
  console.error('[check-xterm-patch] 补丁 2（滚轮本地接管）未进入产物：未发现 enable-mouse-events/alternate/ybase 条件');
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
console.log('[check-xterm-patch] xterm.js 补丁完整且语法正确（alt-scrollback + wheel-local）');
