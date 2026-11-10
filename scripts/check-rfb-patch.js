// 校验 public/vendor/rfb-bootstrap.js 的 noVNC 补丁完整且语法正确。
// 用法：node scripts/check-rfb-patch.js
// 1. 补丁 1：H.264 解码回调 _handleFrame 末尾回收 VideoFrame（frame = {}）；
// 2. 补丁 2：断开超时 3 秒放大到 10 秒（var ba=10,）；
// 3. ES module 语法解析（优先 esbuild，缺失时回退 node:vm SourceTextModule）。
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'public', 'vendor', 'rfb-bootstrap.js');
if (!fs.existsSync(file)) {
  console.error('[check-rfb-patch] 未找到 public/vendor/rfb-bootstrap.js（应由 build-rfb-vendor.js 生成）');
  process.exit(1);
}

let code = fs.readFileSync(file, 'utf8');
let changed = false;

// 正确形态："t={}" 位于 _handleFrame 方法体末尾，后接 _handleError 方法。
const good = 'e.resolve(),e.keep||t.close(),t={}}_handleError';
// 历史损坏形态：补丁 1 曾被直接拼接到 minify 产物上，方法体缺少收尾括号
// （"t={}_handleError" 会把 _handleError 解析成对象字面量属性），整文件
// SyntaxError，window.RFB 无法挂载。两种变体：无换行 / 补丁时误加换行。
const bads = [
  'e.resolve(),e.keep||t.close(),t={}_handleError',
  'e.resolve(),e.keep||t.close(),t={}\n_handleError',
];
for (const bad of bads) {
  if (code.includes(bad)) {
    code = code.replace(bad, good, 1);
    changed = true;
    console.log('[check-rfb-patch] 修复了补丁 1 损坏（_handleFrame 方法体缺少收尾括号）');
  }
}

// 校验补丁 1 已就位
if (!code.includes(good)) {
  console.error('[check-rfb-patch] 补丁 1 未就位（H.264 VideoFrame 回收缺失），请重新运行 scripts/build-rfb-vendor.js 生成并应用补丁');
  process.exit(1);
}

// 校验补丁 2：断开超时 3 秒 -> 10 秒
if (!code.includes('var ba=10,') || code.includes('var ba=3,')) {
  console.error('[check-rfb-patch] 补丁 2 未就位（断开超时未放大到 10 秒），请重新运行 scripts/build-rfb-vendor.js 生成并应用补丁');
  process.exit(1);
}

// ES module 语法解析：优先 esbuild，缺失时回退 node:vm SourceTextModule。
const localEsbuild = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');
let used = null;
if (fs.existsSync(localEsbuild) || spawnSync('esbuild', ['--version'], { stdio: 'ignore' }).status === 0) {
  const args = [file, '--loader=js', '--format=esm', '--outfile=/dev/null', '--log-level=error'];
  const r = fs.existsSync(localEsbuild) ? spawnSync(localEsbuild, args, { encoding: 'utf8' }) : spawnSync('esbuild', args, { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error('[check-rfb-patch] esbuild 语法检查失败：\n' + (r.stderr || r.error || ''));
    process.exit(1);
  }
  used = 'esbuild';
} else {
  const r2 = spawnSync(process.execPath, ['--experimental-vm-modules', '-e',
    'const fs=require("fs"),vm=require("vm");new vm.SourceTextModule(fs.readFileSync(process.argv[1],"utf8"),{identifier:"rfb-check"});', file],
    { encoding: 'utf8' });
  if (r2.status !== 0) {
    console.error('[check-rfb-patch] 语法检查失败（node:vm）：\n' + (r2.stderr || ''));
    process.exit(1);
  }
  used = 'node:vm';
}

if (changed) {
  fs.writeFileSync(file, code);
  console.log(`[check-rfb-patch] 已写回修复后的 ${path.relative(root, file)}`);
} else {
  console.log('[check-rfb-patch] 补丁完好，无需修改');
}
console.log(`[check-rfb-patch] 语法检查通过（${used}）`);
