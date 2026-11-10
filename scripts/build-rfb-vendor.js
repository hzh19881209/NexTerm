// 生成 noVNC 前端启动文件 public/vendor/rfb-bootstrap.js。
//
// noVNC v1.6.0 源码是 ES module（core/rfb.js 等），浏览器无法直接以普通
// <script> 加载。这里从 GitHub 下载官方 tarball，用 esbuild 把 RFB 类打包成
// 单个 ES module 文件（保留 top-level await，现代浏览器支持），并在末尾挂载
// window.RFB，供 index.html 里 type="module" 的 rfb-bootstrap.js 使用。
//
// 该文件被 .gitignore 忽略（public/vendor/ 整个目录不入库），每次构建前由
// copy-vendor.js 调用本脚本重新生成。需要网络访问 codeload.github.com（GitHub 官方 tarball 分发地址，国内直连更稳定）。

// 对 noVNC 打两个补丁：
// 1. noVNC v1.6.0 的 H.264 解码器从不回收 VideoFrame，浏览器会反复打印
//    "A VideoFrame was garbage collected without being closed"，长时间
//    连接可能造成卡顿。此补丁在打包前直接修改 core/decoders/h264.js 源码
//    （必须改源码：minify 后压缩器不保留方法之间的分号，事后在压缩产物上
//    拼接代码会产生语法错误，导致 window.RFB 挂载失败）；
// 2. 断开超时 ba 默认 3 秒，本地 ws.close() 之后若 close 事件未能在窗口内
//    送达 noVNC，会误报 "Disconnection timed out."，改为 10 秒兜底。
//    此补丁在打包后的压缩产物上修改（单行 token 替换，安全）。
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

// 对 esbuild 压缩产物校验/打补丁。
// 补丁 1 已在打包前以源码方式打入 h264.js，这里只校验产物确实包含补丁语句
// （"t={}" 位于 _handleFrame 方法体末尾，后接 _handleError 方法）；
// 补丁 2 是单行 token 替换（ba=3 -> ba=10），可直接在压缩产物上进行。
// 注意：必须用 RegExp（带 lastIndex 循环）查找，不能用 String.prototype.includes。
// esbuild 压缩产物中方法体末尾 "t={}" 恰以 } 结尾，后续代码中若出现
// "t={}" 字符串字面量（如 "t={}'"），includes 会命中错误位置导致误判。
function applyNovncPatches(file) {
  let code = fs.readFileSync(file, 'utf8');

  // 校验补丁 1（H.264 VideoFrame 回收）已进入产物。
  const patch1Pattern = /t=\{\}\}\s*_handleError/;
  if (!patch1Pattern.test(code)) {
    fail('noVNC 补丁 1 未进入产物（H.264 _handleFrame 源码补丁未生效），请检查 core/decoders/h264.js 的锚点');
  }

  // 补丁 2：断开超时 ba 从 3 秒放大到 10 秒。
  const timeoutAnchor = 'var ba=3,';
  if (!code.includes(timeoutAnchor)) fail('noVNC 补丁 2 锚点未找到（断开超时 ba），产物未打补丁');
  code = code.replace(timeoutAnchor, 'var ba=10,', 1);

  fs.writeFileSync(file, code);
  console.log('[build-rfb-vendor] 已校验 H.264 VideoFrame 回收补丁，并应用断开超时补丁');
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

  // 补丁 1：H.264 解码回调 _handleFrame 中，pending 帧不保留时回收 VideoFrame。
  // 在打包前修改源码，避免事后对 minify 产物拼接代码导致语法错误
  // （esbuild 压缩后相邻 class 方法之间没有分号/换行，"t={}" 后直接拼接
  //   方法名会被解析为对象字面量属性）。
  const h264File = path.join(core, 'decoders', 'h264.js');
  let h264Source = fs.readFileSync(h264File, 'utf8');
  const h264Anchor = '        pending.frame = frame;\n        pending.ready = true;\n        pending.resolve();\n\n        if (!pending.keep) {\n            frame.close();\n        }\n    }';
  const h264Patched = '        pending.frame = frame;\n        pending.ready = true;\n        pending.resolve();\n\n        if (!pending.keep) {\n            frame.close();\n        }\n        // NexTerm patch: drop the local reference after close so the VideoFrame can be GCed.\n        frame = {};\n    }';
  if (!h264Source.includes(h264Anchor)) fail('noVNC h264.js 补丁 1 锚点未找到（_handleFrame），请核对 noVNC 版本');
  h264Source = h264Source.replace(h264Anchor, h264Patched, 1);
  fs.writeFileSync(h264File, h264Source);

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
  applyNovncPatches(outJs);

  console.log(`[build-rfb-vendor] 已生成 ${path.relative(root, outJs)}（${fs.statSync(outJs).size} 字节）`);
} catch (error) {
  fail(`生成 rfb-bootstrap.js 失败：${error.message || error}`);
} finally {
  clean();
}
})().catch((error) => fail(`生成 rfb-bootstrap.js 失败：${error.message || error}`));
