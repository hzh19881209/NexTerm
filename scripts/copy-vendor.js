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
for (const [source, destination] of assets) {
  const from = path.join(root, 'node_modules', source);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(vendor, destination));
}
