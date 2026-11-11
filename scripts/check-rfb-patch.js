// 校验 public/vendor/rfb-bootstrap.js 的 noVNC 补丁完整且语法正确。
// 用法：node scripts/check-rfb-patch.js
// 1. 补丁 1：H.264 pending 包装对象统一通过 _releasePendingFrame 回收 VideoFrame；
// 2. 补丁 2：断开超时 3 秒放大到 10 秒（var ba=10,）；
// 3. 补丁 3：渲染队列出队处回收 Image/VideoFrame（e.img&&(e.img=null) 与
//    typeof e.frame.frame.close=="function"）；
// 4. 补丁 4：解码上下文与 Display 渲染队列在断开时全量释放（releaseFrames /
//    _vncReleaseVideoFrames）；
// 5. ES module 语法解析（优先 esbuild，缺失时回退 node:vm SourceTextModule）。
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
// 必须用 RegExp 查找：esbuild 压缩产物中方法体末尾 "t={}" 恰以 } 结尾，
// 后续代码若出现 "t={}" 字符串字面量（如 "t={}'"），String.prototype.includes
// 会命中错误位置，把本来完好的产物误判为损坏。
// 兼容源码与 esbuild minify 产物：方法/属性名不会被 esbuild 压缩，因此直接
// 校验本次修复新增的生命周期方法是否进入产物。
const goodPattern = /_handleFrame\([^)]*\)\{[\s\S]*?_releasePendingFrame\(/;
// 历史损坏形态：补丁 1 曾被直接拼接到 minify 产物上，方法体缺少收尾括号
// （"t={}_handleError" 会把 _handleError 解析成对象字面量属性），整文件
// SyntaxError，window.RFB 无法挂载。两种变体：无换行 / 补丁时误加换行。
const badPatterns = [
  /e\.resolve\(\),e\.keep\|\|t\.close\(\),t=\{\}\}\s+_handleError/,
];
for (const bad of badPatterns) {
  if (bad.test(code)) {
    code = code.replace(bad, 'e.resolve(),e.keep||t.close(),t={}}_handleError', 1);
    changed = true;
    console.log('[check-rfb-patch] 修复了补丁 1 损坏（_handleFrame 方法体缺少收尾括号）');
  }
}

// 校验补丁 1 已就位
if (!goodPattern.test(code)) {
  console.error('[check-rfb-patch] 补丁 1 未就位（H.264 VideoFrame 回收缺失），请重新运行 scripts/build-rfb-vendor.js 生成并应用补丁');
  process.exit(1);
}

for (const required of ['releaseFrames()', '_vncReleaseVideoFrames', '_retainedFrames']) {
  if (!code.includes(required)) {
    console.error(`[check-rfb-patch] 补丁 4 未就位（缺少 ${required}），请重新运行 scripts/build-rfb-vendor.js 生成并应用补丁`);
    process.exit(1);
  }
}

// 校验补丁 3 已就位：渲染队列出队处回收 Image / 未关闭的 VideoFrame
if (!code.includes('e.img&&(e.img=null)')) {
  console.error('[check-rfb-patch] 补丁 3 未就位（渲染队列 Image 回收缺失），请重新运行 scripts/build-rfb-vendor.js 生成并应用补丁');
  process.exit(1);
}
if (!code.includes('typeof e.frame.frame.close=="function"')) {
  console.error('[check-rfb-patch] 补丁 3 未就位（渲染队列 VideoFrame 回收缺失），请重新运行 scripts/build-rfb-vendor.js 生成并应用补丁');
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
