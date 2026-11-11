// 生成 noVNC 前端启动文件 public/vendor/rfb-bootstrap.js。
//
// noVNC v1.6.0 源码是 ES module（core/rfb.js 等），浏览器无法直接以普通
// <script> 加载。这里从 GitHub 下载官方 tarball，用 esbuild 把 RFB 类打包成
// 单个 ES module 文件（保留 top-level await，现代浏览器支持），并在末尾挂载
// window.RFB，供 index.html 里 type="module" 的 rfb-bootstrap.js 使用。
//
// 该文件被 .gitignore 忽略（public/vendor/ 整个目录不入库），每次构建前由
// copy-vendor.js 调用本脚本重新生成。需要网络访问 codeload.github.com（GitHub 官方 tarball 分发地址，国内直连更稳定）。

// 对 noVNC 打四个补丁（补丁 1、3、4 打包前改源码，补丁 2 压缩产物 token 替换）：
// 1. noVNC v1.6.0 的 H.264 解码器从不回收 VideoFrame，浏览器会反复打印
//    "A VideoFrame was garbage collected without being closed"，长时间
//    连接可能造成卡顿。此补丁在打包前直接修改 core/decoders/h264.js 源码
//    （必须改源码：minify 后压缩器不保留方法之间的分号，事后在压缩产物上
//    拼接代码会产生语法错误，导致 window.RFB 挂载失败）；
// 2. 断开超时 ba 默认 3 秒，本地 ws.close() 之后若 close 事件未能在窗口内
//    送达 noVNC，会误报 "Disconnection timed out."，改为 10 秒兜底。
//    此补丁在打包后的压缩产物上修改（单行 token 替换，安全）；
// 3. 断开/重连/视图重建后，Display 渲染队列里滞留的解码产物不会被回收：
//    img 动作持有已解码的 Image（tight/jpeg 等编码），frame 动作持有
//    H.264 的 pending 包装（close 路径下 VideoFrame 从未被 close）。
//    Windows 远程桌面交互越频繁（点击/移动触发整屏刷新），堆积越多，
//    表现为浏览器控制台 "VideoFrame/Image was garbage collected" 类报错
//    与内存缓慢爬升。此补丁在打包前修改 core/display.js 源码：渲染动作
//    出队时统一丢弃 Image 引用并关闭其中仍打开的 VideoFrame（与
//    _scanRenderQ 'frame' 分支的 close 幂等，仅执行一次）；
// 4. 补丁 1 回收的是"未保留"的帧；decode() 每批最后一条 pending 被标记
//    keep=true（等下一帧到来时 _handleFrame 再 close 上一帧）。断开/重连
//    后不会再有新帧，最后一帧被 GC 回收时浏览器报 "VideoFrame was
//    garbage collected without being closed"。此补丁在打包前修改
//    core/decoders/h264.js：H264Context 新增 unpinLastFrame() 释放 pending
//    队列中残留的最后一帧；core/rfb.js 的 RFB 类新增
//    _vncUnpinVideoFrames() 遍历所有解码上下文调用它，供前端断开时
//    （disposeVnc）调用。
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
// 补丁 1、3 已在打包前以源码方式打入 h264.js / display.js，这里校验产物
// 确实包含补丁语句：
//   - 补丁 1：_handleFrame 方法体末尾，未 minify 时为 "frame = {}"，
//     minify 时 "frame = {}" 被删、以 "e.keep||t.close()" 收尾后紧跟
//     unpinLastFrame（变量名为本构建 esbuild 压缩结果，升级需同步调整）；
//   - 补丁 3：出队处出现 "e.img&&(e.img=null)" 与
//     'typeof e.frame.frame.close=="function"'（变量名 e 为本构建 esbuild
//     压缩结果，升级 esbuild 若导致改名需同步调整）。
// 补丁 2 是单行 token 替换（ba=3 -> ba=10），可直接在压缩产物上进行。
// 注意：必须用 RegExp（带 lastIndex 循环）查找，不能用 String.prototype.includes。
// esbuild 压缩产物中方法体末尾 "t={}" 恰以 } 结尾，后续代码中若出现
// "t={}" 字符串字面量（如 "t={}'"），includes 会命中错误位置导致误判。
function applyNovncPatches(file) {
  let code = fs.readFileSync(file, 'utf8');

  // 校验补丁 1（H.264 VideoFrame 回收）已进入产物。
  // 兼容两种形态：
  //   - 未 minify（开发/调试构建）：方法体以 "frame = {}" 收尾，后接 _handleError；
  //   - esbuild minify（生产构建）：无读取的 "frame = {}" 赋值会被作为死代码
  //     删除，"if (!pending.keep) frame.close()" 压缩为 "e.keep||t.close()"，
  //     此时只需确认 _handleFrame 后紧跟补丁 4 的 unpinLastFrame 方法。
  const patch1Pattern = /frame = \{\}\s*\}\s*_handleError|e\.keep\|\|t\.close\(\)\}\s*unpinLastFrame/;
  if (!patch1Pattern.test(code)) {
    fail('noVNC 补丁 1 未进入产物（H.264 _handleFrame 源码补丁未生效），请检查 core/decoders/h264.js 的锚点');
  }

  // 校验补丁 3（渲染队列出队回收 Image/VideoFrame）已进入产物。
  if (!code.includes('e.img&&(e.img=null)')) {
    fail('noVNC 补丁 3 未进入产物（渲染队列 Image 回收缺失），请检查 core/display.js 的锚点');
  }
  if (!code.includes('typeof e.frame.frame.close=="function"')) {
    fail('noVNC 补丁 3 未进入产物（渲染队列 VideoFrame 回收缺失），请检查 core/display.js 的锚点');
  }

  // 校验补丁 4（断开时释放 H.264 最后一帧）已进入产物。
  if (!code.includes('unpinLastFrame')) {
    fail('noVNC 补丁 4 未进入产物（H264Context.unpinLastFrame 源码补丁未生效），请检查 core/decoders/h264.js 的锚点');
  }
  if (!code.includes('_vncUnpinVideoFrames')) {
    fail('noVNC 补丁 4 未进入产物（RFB._vncUnpinVideoFrames 源码补丁未生效），请检查 core/rfb.js 的锚点');
  }

  // 补丁 2：断开超时 ba 从 3 秒放大到 10 秒。
  const timeoutAnchor = 'var ba=3,';
  if (!code.includes(timeoutAnchor)) fail('noVNC 补丁 2 锚点未找到（断开超时 ba），产物未打补丁');
  code = code.replace(timeoutAnchor, 'var ba=10,', 1);

  fs.writeFileSync(file, code);
  console.log('[build-rfb-vendor] 已校验 H.264 回收补丁与渲染队列回收补丁，并应用断开超时补丁');
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
  // 补丁 3：渲染动作出队（_scanRenderQ 的 ready 分支）时回收 img/frame
  // 动作持有的解码资源。两处都在打包前修改源码，避免事后对 minify 产物
  // 拼接代码导致语法错误（esbuild 压缩后相邻 class 方法之间没有分号/换行，
  // "t={}" 后直接拼接方法名会被解析为对象字面量属性）。
  // 注意：不要在 case 分支内做 "a.img = null" 式清理——变量随后不再被读取
  // 时 esbuild 会把它当死代码删掉；放在出队处（赋值后紧跟 shift() 读取）
  // 才能稳定保留。
  const h264File = path.join(core, 'decoders', 'h264.js');
  let h264Source = fs.readFileSync(h264File, 'utf8');
  const h264Anchor = '        pending.frame = frame;\n        pending.ready = true;\n        pending.resolve();\n\n        if (!pending.keep) {\n            frame.close();\n        }\n    }';
  const h264Patched = '        pending.frame = frame;\n        pending.ready = true;\n        pending.resolve();\n\n        if (!pending.keep) {\n            frame.close();\n        }\n        // NexTerm patch: drop the local reference after close so the VideoFrame can be GCed.\n        frame = {};\n    }';
  if (!h264Source.includes(h264Anchor)) fail('noVNC h264.js 补丁 1 锚点未找到（_handleFrame），请核对 noVNC 版本');
  h264Source = h264Source.replace(h264Anchor, h264Patched, 1);
  fs.writeFileSync(h264File, h264Source);

  // 补丁 3：渲染动作出队时回收解码资源（Image / 未关闭的 VideoFrame）。
  // 渲染队列只随动作出队释放，而断开/重连/视图重建不会清空它：
  //  - img 动作（tight/jpeg 等）里的 Image 已画到 canvas，解码缓冲却挂在
  //    队列对象上，只能等 GC（Firefox 尤其明显，内存可爬到 GB 级）；
  //  - frame 动作的 pending 包装在 _handleFrame 不保留分支已 close 过
  //    VideoFrame，这里再 close 是幂等的；close 路径（无解码回调）下
  //    队列里的帧从未被 close，这里兜底。
  const displayFile = path.join(core, 'display.js');
  let displaySource = fs.readFileSync(displayFile, 'utf8');
  const displayAnchor = '            if (ready) {\n                this._renderQ.shift();\n            }';
  const displayPatched = [
    '            if (ready) {',
    '                // NexTerm patch: release resources held by the finished render',
    '                // action (decoded images and H.264 VideoFrames) so they do not',
    '                // linger in the queue waiting for GC.',
    "                if (a.img) {",
    '                    a.img = null;',
    '                }',
    '                if (a.frame) {',
    "                    if (a.frame.frame && typeof a.frame.frame.close === 'function') {",
    '                        a.frame.frame.close();',
    '                    }',
    '                    a.frame = null;',
    '                }',
    '                this._renderQ.shift();',
    '            }',
  ].join('\n');
  if (!displaySource.includes(displayAnchor)) fail('noVNC display.js 补丁 3 锚点未找到（_scanRenderQ 出队处），请核对 noVNC 版本');
  displaySource = displaySource.replace(displayAnchor, displayPatched, 1);
  fs.writeFileSync(displayFile, displaySource);

  // 补丁 4：H264Context 新增 unpinLastFrame()。decode() 每批最后一条
  // pending 被 keep=true 保留（等下一帧到来时 _handleFrame 再 close 上一
  // 帧），断开后不会再有新帧，残留 VideoFrame 被 GC 时浏览器报
  // "VideoFrame was garbage collected without being closed"。这里取出
  // pending 队列中残留的最后一帧并 close；若帧未到达（ready=false）则
  // 丢弃 promise 的 resolve，避免后续回调访问已释放对象。
  const h264Anchor2 = '            frame.close();\n        }\n        // NexTerm patch: drop the local reference after close so the VideoFrame can be GCed.\n        frame = {};\n    }';
  const h264Patched2 = [
    '            frame.close();',
    '        }',
    '    }',
    '',
    '    // NexTerm patch: release the last kept frame (keep=true) so it is',
    '    // not GCed while still open after the connection goes away.',
    '    unpinLastFrame() {',
    '        const pending = this._pendingFrames.shift();',
    '        if (pending === undefined) {',
    '            return;',
    '        }',
    "        if (pending.frame && typeof pending.frame.close === 'function') {",
    '            pending.frame.close();',
    '        }',
    '        if (!pending.ready) {',
    '            pending.resolve = () => {};',
    '        }',
    '        pending.frame = null;',
    '    }',
  ].join('\n');
  if (!h264Source.includes(h264Anchor2)) fail('noVNC h264.js 补丁 4 锚点未找到（_handleFrame 收尾），请核对 noVNC 版本');
  h264Source = h264Source.replace(h264Anchor2, h264Patched2, 1);
  fs.writeFileSync(h264File, h264Source);

  // 补丁 4（续）：RFB 类新增 _vncUnpinVideoFrames()，遍历所有 H.264 解码
  // 上下文（_contexts 按 (x,y,w,h) 键控，最多 64 个）释放各自最后一帧，
  // 供前端断开 VNC（disposeVnc）时调用。
  const rfbFile = path.join(core, 'rfb.js');
  let rfbSource = fs.readFileSync(rfbFile, 'utf8');
  const rfbAnchor = '    static genDES(password, challenge) {';
  const rfbPatched = [
    '    // NexTerm patch: close the last pending H.264 VideoFrame in every',
    '    // decode context on disconnect; without this the frames are only',
    '    // released when the next frame arrives, which never happens after',
    '    // the connection ends.',
    '    _vncUnpinVideoFrames() {',
    '        const decoder = this._decoders && this._decoders[encodings.encodingH264];',
    '        if (!decoder) {',
    '            return;',
    '        }',
    '        for (const context of Object.values(decoder._contexts || {})) {',
    "            if (typeof context.unpinLastFrame === 'function') {",
    '                context.unpinLastFrame();',
    '            }',
    '        }',
    '    }',
    '',
    '    static genDES(password, challenge) {',
  ].join('\n');
  if (!rfbSource.includes(rfbAnchor)) fail('noVNC rfb.js 补丁 4 锚点未找到（static genDES），请核对 noVNC 版本');
  rfbSource = rfbSource.replace(rfbAnchor, rfbPatched, 1);
  fs.writeFileSync(rfbFile, rfbSource);

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
