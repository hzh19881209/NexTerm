// 生成 noVNC 前端启动文件 public/vendor/rfb-bootstrap.js。
//
// noVNC v1.6.0 源码是 ES module（core/rfb.js 等），浏览器无法直接以普通
// <script> 加载。这里从 GitHub 下载官方 tarball，用 esbuild 把 RFB 类打包成
// 单个 ES module 文件（保留 top-level await，现代浏览器支持），并在末尾挂载
// window.RFB，供 index.html 里 type="module" 的 rfb-bootstrap.js 使用。
//
// 该文件被 .gitignore 忽略（public/vendor/ 整个目录不入库），每次构建前由
// copy-vendor.js 调用本脚本重新生成。需要网络访问 codeload.github.com（GitHub 官方 tarball 分发地址，国内直连更稳定）。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const NOVNC_TAG = 'v1.6.0';
const NOVNC_URL = `https://codeload.github.com/novnc/noVNC/tar.gz/refs/tags/${NOVNC_TAG}`;
const root = path.resolve(__dirname, '..');
const vendor = path.join(root, 'public', 'vendor');
const outJs = path.join(vendor, 'rfb-bootstrap.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexterm-rfb-'));

function clean() {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
}

function fail(message) {
  clean();
  console.error(`[build-rfb-vendor] ${message}`);
  process.exit(1);
}

(async () => {
try {
  fs.mkdirSync(vendor, { recursive: true });
  const tarball = path.join(tmp, 'novnc.tar.gz');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  const response = await fetch(NOVNC_URL, { signal: controller.signal, redirect: 'follow' });
  clearTimeout(timer);
  if (!response.ok) fail(`noVNC tarball 下载失败（HTTP ${response.status}）`);
  fs.writeFileSync(tarball, Buffer.from(await response.arrayBuffer()));
  if (fs.statSync(tarball).size < 1000) fail('noVNC tarball 下载异常（文件过小或为空）');
  execFileSync('tar', ['-xzf', tarball, '-C', tmp], { stdio: 'inherit' });
  const source = fs.readdirSync(tmp).find((name) => /^noVNC-/.test(name));
  if (!source) fail('未在 tarball 中找到 noVNC 源码目录');
  const core = path.join(tmp, source, 'core');
  if (!fs.existsSync(path.join(core, 'rfb.js'))) fail('noVNC 源码缺少 core/rfb.js');

  const entry = path.join(tmp, 'rfb-entry.js');
  fs.writeFileSync(entry, `import RFB from '${core.replace(/\\/g, '/')}/rfb.js';\nwindow.RFB = RFB;\n`);

  // 优先使用项目本地 esbuild，其次 PATH，最后回退到 npx 临时下载。
  let esbuildArgs = [entry, '--bundle', '--format=esm', '--minify', `--outfile=${outJs}`];
  const localEsbuild = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');
  let build;
  if (fs.existsSync(localEsbuild)) {
    build = spawnSync(localEsbuild, esbuildArgs, { stdio: 'inherit' });
  } else if (spawnSync('esbuild', ['--version'], { stdio: 'ignore' }).status === 0) {
    build = spawnSync('esbuild', esbuildArgs, { stdio: 'inherit' });
  } else {
    build = spawnSync('npx', ['-y', 'esbuild', ...esbuildArgs], { stdio: 'inherit', shell: process.platform === 'win32' });
  }
  if (build.status !== 0 || !fs.existsSync(outJs) || fs.statSync(outJs).size < 10000) fail('esbuild 打包 rfb-bootstrap.js 失败');

  console.log(`[build-rfb-vendor] 已生成 ${path.relative(root, outJs)}（${fs.statSync(outJs).size} 字节）`);
} catch (error) {
  fail(`生成 rfb-bootstrap.js 失败：${error.message || error}`);
} finally {
  clean();
}
})().catch((error) => fail(`生成 rfb-bootstrap.js 失败：${error.message || error}`));
