const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const vendor = path.join(root, 'public', 'vendor');
fs.mkdirSync(vendor, { recursive: true });

// xterm.js 由 build-xterm-vendor.js 从源码打补丁后生成（备用缓冲区 scrollback +
// 滚轮本地接管，使 Codex 等 TUI 运行中可上翻），不再直接拷贝 node_modules 原文件。
const assets = [
  ['@xterm/xterm/css/xterm.css', 'xterm.css'],
  ['@xterm/addon-fit/lib/addon-fit.js', 'addon-fit.js']
];
// noVNC 前端启动文件不在仓库里（public/vendor/ 被忽略），每次构建重新生成。
// 需要网络；失败会中止构建，避免发布出坏掉的 Windows VNC 功能。
try {
  require('child_process').execFileSync(process.execPath, [path.join(root, 'scripts', 'build-rfb-vendor.js')], { stdio: 'inherit' });
} catch (error) {
  console.error('[copy-vendor] 生成 rfb-bootstrap.js 失败，中止构建');
  process.exit(1);
}
// 二次防线：校验产物补丁完整且语法正确，避免发出 window.RFB 缺失的坏文件。
try {
  require('child_process').execFileSync(process.execPath, [path.join(root, 'scripts', 'check-rfb-patch.js')], { stdio: 'inherit' });
} catch (error) {
  console.error('[copy-vendor] rfb-bootstrap.js 补丁/语法校验失败，中止构建');
  process.exit(1);
}
// xterm 前端启动文件：从源码打补丁后重新打包（Codex 备用缓冲区可上翻）。
// 需要网络（registry.npmjs.org）；失败会中止构建，避免发布出无法上翻的终端。
try {
  require('child_process').execFileSync(process.execPath, [path.join(root, 'scripts', 'build-xterm-vendor.js')], { stdio: 'inherit' });
} catch (error) {
  console.error('[copy-vendor] 生成 xterm.js 失败，中止构建');
  process.exit(1);
}
// 二次防线：校验 xterm.js 补丁完整且语法正确。
try {
  require('child_process').execFileSync(process.execPath, [path.join(root, 'scripts', 'check-xterm-patch.js')], { stdio: 'inherit' });
} catch (error) {
  console.error('[copy-vendor] xterm.js 补丁/语法校验失败，中止构建');
  process.exit(1);
}

for (const [source, destination] of assets) {
  const from = path.join(root, 'node_modules', source);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(vendor, destination));
}
