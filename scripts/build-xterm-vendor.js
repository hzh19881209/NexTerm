// 生成 xterm 前端文件 public/vendor/xterm.js（含 Codex 备用缓冲区 scrollback 补丁）。
//
// 背景：标准 xterm.js 的备用缓冲区（alternate buffer）从不积累 scrollback
// （源码 BufferSet.reset 注释原话 "The alt buffer should never have scrollback"），
// 导致会向上滚动的全屏 TUI 没有本地历史。本脚本从 npm 拉取 @xterm/xterm 5.5.0
// 官方源码，打备用缓冲区 scrollback 与 TUI 退出时的历史落盘补丁后用
// esbuild 重新打包：
//   补丁 1（alt-scrollback）：Buffer 构造时给备用缓冲区保留 scrollback，使
//     会向上滚动的 TUI 留在缓冲区里的行真正保留；
//   补丁 3（alt-history）：TUI 退出、切回主缓冲区时，把会话行一次性写入
//     scrollback，之后可用普通终端历史回看。
//
// 不要在 xterm 的 sendEvent 里拦截备用缓冲区滚轮：Codex 开着鼠标上报，
// 滚轮必须交回 TUI；此前用 this.element 判断的补丁在严格模式下 this 为
// undefined，且会抢走 Codex 自己的上下滚动。
//
// 该文件被 .gitignore 忽略（public/vendor/ 整个目录不入库），每次构建由
// copy-vendor.js 调用本脚本重新生成。需要网络访问 registry.npmjs.org。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const XTERM_VERSION = '5.5.0';
const XTERM_PKG = '@xterm/xterm';
const XTERM_TARBALL = `https://registry.npmjs.org/${XTERM_PKG}/-/xterm-${XTERM_VERSION}.tgz`;
const root = path.resolve(__dirname, '..');
const vendor = path.join(root, 'public', 'vendor');
const outJs = path.join(vendor, 'xterm.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexterm-xterm-'));

function clean() {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
}
function fail(message) {
  clean();
  console.error(`[build-xterm-vendor] ${message}`);
  process.exit(1);
}

// 校验参考实现已经进入产物。Buffer 类会被 esbuild 重命名，因此只匹配构造参数。
function verifyOutput(file) {
  const code = fs.readFileSync(file, 'utf8');
  const hasAltScrollback = /this\._alt = new [\w$]+\(true, this\._optionsService, this\._bufferService\)/.test(code);
  if (!hasAltScrollback) fail('补丁 1（备用缓冲区 scrollback）未进入产物，请核对 BufferSet.ts 锚点');
  const hasAltHistory = code.includes('_nextermAccumAltLine') && code.includes('_nextermFlushAltText');
  if (!hasAltHistory) fail('补丁 3（TUI 退出历史落盘）未进入产物，请核对 BufferService.ts 锚点');
}

(async () => {
  try {
    fs.mkdirSync(vendor, { recursive: true });
    const tarball = path.join(tmp, 'xterm.tgz');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180000);
    const response = await fetch(XTERM_TARBALL, { signal: controller.signal, redirect: 'follow' });
    clearTimeout(timer);
    if (!response.ok) fail(`xterm tarball 下载失败（HTTP ${response.status}）`);
    fs.writeFileSync(tarball, Buffer.from(await response.arrayBuffer()));
    if (fs.statSync(tarball).size < 10000) fail('xterm tarball 下载异常（文件过小或为空）');
    execFileSync('tar', ['-xzf', tarball, '-C', tmp], { stdio: 'inherit' });
    const source = path.join(tmp, 'package');
    const bufferSetFile = path.join(source, 'src', 'common', 'buffer', 'BufferSet.ts');
    const bufferServiceFile = path.join(source, 'src', 'common', 'services', 'BufferService.ts');
    if (!fs.existsSync(bufferSetFile) || !fs.existsSync(bufferServiceFile)) fail('xterm 源码缺少 BufferSet.ts / BufferService.ts');

    // ---- 补丁 1：备用缓冲区保留 scrollback ----
    // BufferSet.reset() 中：this._alt = new Buffer(false, ...) 的 false 即
    // hasScrollback。改为 true 后 _getCorrectBufferLength 会给 alt 分配
    // rows+scrollback 的长度，scroll() push 新行时不再触发 trim，ybase 得以
    // 持续增大，Codex 输出往上滚出的行真正保留。普通缓冲区行为不受影响。
    let bufferSet = fs.readFileSync(bufferSetFile, 'utf8');
    const bsAnchor = 'this._alt = new Buffer(false, this._optionsService, this._bufferService);';
    const bsPatch = 'this._alt = new Buffer(true, this._optionsService, this._bufferService); // nexterm-alt-scrollback';
    if (!bufferSet.includes(bsAnchor)) fail('xterm BufferSet.ts 补丁 1 锚点未找到（_alt = new Buffer(false,...)），请核对 xterm 版本');
    bufferSet = bufferSet.replace(bsAnchor, bsPatch, 1);
    fs.writeFileSync(bufferSetFile, bufferSet);

    // ---- 补丁 3：备用缓冲区历史累积到主缓冲区（TUI 退出后可上翻）----
    // 锚点与替换串集中在 scripts/xterm-patch3.js，避免在构建脚本里内联大段 TS 源码。
    const p3 = require(path.join(__dirname, 'xterm-patch3.js'));
    let bufferService = fs.readFileSync(bufferServiceFile, 'utf8');
    for (const [name, anchor] of [['state', p3.stateAnchor], ['ctor', p3.ctorAnchor], ['scroll', p3.scrollAnchor], ['method', p3.methodAnchor]]) {
      if (!bufferService.includes(anchor)) fail('xterm BufferService.ts 补丁 3 ' + name + ' 锚点未找到，请核对 xterm 版本');
    }
    bufferService = bufferService.replace(p3.stateAnchor, p3.statePatch, 1);
    bufferService = bufferService.replace(p3.ctorAnchor, p3.ctorPatch, 1);
    bufferService = bufferService.replace(p3.scrollAnchor, p3.scrollPatch, 1);
    bufferService = bufferService.replace(p3.methodAnchor, p3.methodPatch + p3.methodAnchor, 1);
    fs.writeFileSync(bufferServiceFile, bufferService);

    // ---- 打包 ----
    // 入口直接导出 xterm 的 Terminal，保持与原 <script src=xterm.js> 的
    // UMD/全局 window.Terminal 用法兼容（原 vendor 文件是 IIFE UMD）。
    const srcRoot = source.replace(/\\/g, '/');
    const entry = path.join(tmp, 'xterm-entry.ts');
    fs.writeFileSync(entry, `import { Terminal } from '${srcRoot}/src/browser/public/Terminal';\nwindow.Terminal = Terminal;\n`);

    // 用 esbuild JS API 打包。优先项目本地 esbuild，其次 PATH 上的 esbuild 包，
    // 最后从 npm 拉取 esbuild tarball 到临时目录 require（与 rfb 构建的网络回退一致）。
    let esbuild;
    try { esbuild = require('esbuild'); }
    catch {
      try {
        const localBin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');
        if (fs.existsSync(localBin)) esbuild = require(path.join(root, 'node_modules', 'esbuild'));
      } catch { /* fall through to npm fetch */ }
      if (!esbuild) {
        // 从 npm 拉取 esbuild 主包 + 平台二进制包（@esbuild/<platform>）到
        // node_modules 布局的临时目录，使 esbuild 主包能找到平台子包的二进制。
        const esbVersion = '0.21.5';
        const plat = (process.platform === 'win32' ? 'win32' : process.platform) + '-' + process.arch;
        const esbDir = path.join(tmp, 'esbuild');
        const nm = path.join(esbDir, 'node_modules');
        fs.mkdirSync(nm, { recursive: true });
        const fetchExtract = async (url, destDir) => {
          const ctl = new AbortController();
          const tm = setTimeout(() => ctl.abort(), 180000);
          const resp = await fetch(url, { signal: ctl.signal, redirect: 'follow' });
          clearTimeout(tm);
          if (!resp.ok) fail('esbuild 组件下载失败（HTTP ' + resp.status + '）' + url);
          const tgz = path.join(esbDir, 'dl-' + Math.random().toString(36).slice(2) + '.tgz');
          fs.writeFileSync(tgz, Buffer.from(await resp.arrayBuffer()));
          fs.mkdirSync(destDir, { recursive: true });
          execFileSync('tar', ['-xzf', tgz, '-C', destDir], { stdio: 'inherit' });
          fs.rmSync(tgz, { force: true });
          // tar 解出的顶层是 package/，重命名到 destDir 内容并移除 package 目录
          const inner = path.join(destDir, 'package');
          if (fs.existsSync(inner)) {
            for (const item of fs.readdirSync(inner)) {
              fs.renameSync(path.join(inner, item), path.join(destDir, item));
            }
            fs.rmdirSync(inner);
          }
        };
        await fetchExtract('https://registry.npmjs.org/esbuild/-/esbuild-' + esbVersion + '.tgz', path.join(nm, 'esbuild'));
        await fetchExtract('https://registry.npmjs.org/@esbuild/' + plat + '/-/' + plat + '-' + esbVersion + '.tgz', path.join(nm, '@esbuild', plat));
        esbuild = require(path.join(nm, 'esbuild', 'lib', 'main.js'));
      }
    }

    // 自定义 onResolve 插件：把 xterm 源码里的非相对导入（common/... 、browser/...）
    // 解析到 src/common、src/browser 并补 .ts 扩展名（esbuild --alias 会丢扩展名，故不用）。
    const resolverPlugin = {
      name: 'nexterm-xterm-resolver',
      setup(build) {
        build.onResolve({ filter: /^(common|browser)\// }, (args) => {
          const base = path.join(srcRoot, 'src', args.path);
          if (fs.existsSync(base + '.ts')) return { path: base + '.ts' };
          if (fs.existsSync(base + '.d.ts')) return { path: base + '.d.ts' }; // 仅类型声明，无运行时
          return { path: base + '.ts' };
        });
      },
    };
    await esbuild.build({
      entryPoints: [entry],
      bundle: true, format: 'iife', globalName: 'xtermVendor',
      outfile: outJs, loader: { '.ts': 'ts', '.d.ts': 'ts' }, logLevel: 'warning',
      tsconfigRaw: { compilerOptions: { experimentalDecorators: true, target: 'es2020', module: 'esnext', moduleResolution: 'node' } },
      plugins: [resolverPlugin],
    });
    if (!fs.existsSync(outJs) || fs.statSync(outJs).size < 50000) fail('esbuild 打包 xterm.js 失败（产物过小或缺失）');

    // 兼容原 UMD 全局暴露：原 xterm.js 通过 UMD 暴露 window.Terminal。这里用
    // IIFE + global-name 仅把模块挂到 xtermVendor，再补一行暴露 Terminal。
    const packed = fs.readFileSync(outJs, 'utf8');
    fs.writeFileSync(outJs, packed + '\n;window.Terminal = window.Terminal || (xtermVendor && xtermVendor.Terminal);\n');

    verifyOutput(outJs);
    console.log(`[build-xterm-vendor] 已生成 ${path.relative(root, outJs)}（${fs.statSync(outJs).size} 字节，含 alt-scrollback + alt-history 补丁）`);
  } catch (error) {
    fail(`生成 xterm.js 失败：${error.message || error}`);
  } finally {
    clean();
  }
})().catch((error) => fail(`生成 xterm.js 失败：${error.message || error}`));
