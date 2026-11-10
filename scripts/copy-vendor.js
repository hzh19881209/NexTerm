const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const vendor = path.join(root, 'public', 'vendor');
fs.mkdirSync(vendor, { recursive: true });

const assets = [
  ['@xterm/xterm/lib/xterm.js', 'xterm.js'],
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

for (const [source, destination] of assets) {
  const from = path.join(root, 'node_modules', source);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(vendor, destination));
}
