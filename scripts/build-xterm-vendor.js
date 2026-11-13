// 生成 xterm 前端文件 public/vendor/xterm.js（含 Codex 备用缓冲区 scrollback 补丁）。
//
// 背景：标准 xterm.js 的备用缓冲区（alternate buffer）从不积累 scrollback
// （源码 BufferSet.reset 注释原话 "The alt buffer should never have scrollback"），
// 导致 Codex 等全屏 TUI 运行中无法上翻。Tabby 能翻是因为它的终端核心放开了
// 这一限制。本脚本从 npm 拉取 @xterm/xterm 5.5.0 官方源码，打两个补丁后用
// esbuild 重新打包：
//   补丁 1（alt-scrollback）：Buffer 构造时给备用缓冲区保留 scrollback，使
//     Codex 往上滚出的行真正保留、ybase 持续增大；
//   补丁 2（wheel-local）：TUI 开着鼠标上报（enable-mouse-events）且备用
//     缓冲区已有 scrollback 时，滚轮不再转发给 TUI，而是本地回翻备用
//     缓冲区（否则 xterm 把滚轮当 SGR 鼠标事件发给 Codex，上翻失效）。
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

// 校验 esbuild 压缩产物确实包含两个补丁的标记字符串（字符串字面量 minify 后保留）。
function verifyOutput(file) {
  const code = fs.readFileSync(file, 'utf8');
  // 补丁 2（wheel-local）：运行时条件 enable-mouse-events + alternate + ybase>0。
  // 该条件只可能来自打补丁后的产物，其存在即证明产物为带补丁版本。
  const hasWheelLocal = /enable-mouse-events[\s\S]{0,240}?alternate[\s\S]{0,120}?ybase/.test(code);
  if (!hasWheelLocal) fail('补丁 2（滚轮本地接管）运行时条件未进入产物，请核对 Terminal.ts 锚点');
  // 补丁 1（alt-scrollback）与补丁 2 同一次构建一起打入；wheel-local 存在即
  // 代表二者均在产物中（esbuild 会重命名 Buffer 类，无法用字面量特征校验）。
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
    const terminalFile = path.join(source, 'src', 'browser', 'Terminal.ts');
    const bufferServiceFile = path.join(source, 'src', 'common', 'services', 'BufferService.ts');
    if (!fs.existsSync(bufferSetFile) || !fs.existsSync(terminalFile) || !fs.existsSync(bufferServiceFile)) fail('xterm 源码缺少 BufferSet.ts / Terminal.ts / BufferService.ts');

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

    // ---- 补丁 3：备用缓冲区历史累积到主缓冲区（Codex 运行中可上翻）----
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

        // ---- 补丁 2：TUI 鼠标上报且有 alt scrollback 时，滚轮本地接管 ----
    // Terminal 的 wheel 处理里，若 _customWheelEventHandler 拒绝（返回 false）
    // 或 amount===0 会 return false，事件继续冒泡到 Viewport 的 onwheel，由
    // 其执行本地 scrollLines（xterm 自身"滚轮翻页"路径）。Codex 开着鼠标上报
    // 时默认会把滚轮转成 SGR 鼠标事件发给 TUI；这里在补丁处提前把"备用缓冲
    // 区已有 scrollback"的情况交给 Viewport 本地回翻，用户即可上翻会话。
    // 用 data-nexterm-wheel-local 作为可被 check 脚本识别的标记。
    let terminal = fs.readFileSync(terminalFile, 'utf8');
    const termAnchor = [
      "        case 'wheel':",
      '          if (self._customWheelEventHandler && self._customWheelEventHandler(ev as WheelEvent) === false) {',
      '            return false;',
      '          }',
      '          const amount = self.viewport!.getLinesScrolled(ev as WheelEvent);',
    ].join('\n');
    const termPatch = [
      "        case 'wheel':",
      '          if (self._customWheelEventHandler && self._customWheelEventHandler(ev as WheelEvent) === false) {',
      '            return false;',
      '          }',
      '          const amount = self.viewport!.getLinesScrolled(ev as WheelEvent);',
      '          // nexterm-wheel-local: 备用缓冲区有 scrollback 时（Codex 等 TUI 已往上滚出历史），',
      '          // 滚轮不再转发给 TUI（返回 false 使事件继续冒泡到 Viewport 的 onwheel 本地回翻）。',
      "          if (this.element && this.element.classList.contains('enable-mouse-events') &&",
      "          this._bufferService.buffer.type === 'alternate' && this._bufferService.buffer.ybase > 0) {",
      '            return false; // nexterm-wheel-local-active',
      '          }',
    ].join('\n');
    if (!terminal.includes(termAnchor)) fail('xterm Terminal.ts 补丁 2 锚点未找到（wheel case），请核对 xterm 版本');
    terminal = terminal.replace(termAnchor, termPatch, 1);
    fs.writeFileSync(terminalFile, terminal);

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
    console.log(`[build-xterm-vendor] 已生成 ${path.relative(root, outJs)}（${fs.statSync(outJs).size} 字节，含 alt-scrollback + wheel-local 补丁）`);
  } catch (error) {
    fail(`生成 xterm.js 失败：${error.message || error}`);
  } finally {
    clean();
  }
})().catch((error) => fail(`生成 xterm.js 失败：${error.message || error}`));
