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
//    keep=true，交给 Display 渲染队列绘制后再 close。断开/重连/隐藏页面
//    时不会再扫描渲染队列，包装对象及其 VideoFrame 会随整棵对象树被 GC，
//    浏览器随即报 "VideoFrame was garbage collected without being closed"。
//    旧补丁只从 _pendingFrames 取帧，但解码完成的帧早已被 shift 出该队列，
//    因此实际没有关到目标帧。此补丁在打包前修改 h264.js / display.js /
//    rfb.js：每个 pending 包装对象持有幂等 release()，H264Context 跟踪所有
//    未释放包装对象；Display 新增渲染队列全量释放入口；RFB 的
//    _vncUnpinVideoFrames() 在断开时同时清理解码上下文与渲染队列。
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
// 补丁 1、3、4 已在打包前以源码方式打入 h264.js / display.js / rfb.js，
// 这里校验产物确实包含补丁语句：
//   - 补丁 1：_handleFrame 方法体调用 _releasePendingFrame；
//   - 补丁 4：H264Context.releaseFrames() 与 Display._vncReleaseVideoFrames；
//   - 补丁 3：出队处出现 "e.img&&(e.img=null)" 与
//     'typeof e.frame.frame.close=="function"'（变量名 e 为本构建 esbuild
//     压缩结果，升级 esbuild 若导致改名需同步调整）。
// 补丁 2 是单行 token 替换（ba=3 -> ba=10），可直接在压缩产物上进行。
// 注意：必须用 RegExp（带 lastIndex 循环）查找，不能用 String.prototype.includes。
// esbuild 压缩产物中方法体末尾 "t={}" 恰以 } 结尾，后续代码中若出现
// "t={}" 字符串字面量（如 "t={}'"），includes 会命中错误位置导致误判。
function applyNovncPatches(file) {
  let code = fs.readFileSync(file, 'utf8');

  // 校验补丁 1（H.264 VideoFrame 回收）已进入产物。esbuild 不压缩方法名
  // 和属性名，因此可直接确认 _handleFrame 内调用了统一释放方法。
  const patch1Pattern = /_handleFrame\([^)]*\)\{[\s\S]*?_releasePendingFrame\(/;
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

  // 校验补丁 3b（img 尺寸不匹配不再 return 卡死队列）已进入产物：该分支的
  // 错误文案带 "(dropping)" 后缀，minify 后字符串字面量保留。
  if (!code.includes('(dropping)')) {
    fail('noVNC 补丁 3b 未进入产物（img 尺寸不匹配仍会卡死渲染队列），请检查 core/display.js 的锚点');
  }

  // 校验补丁 4（断开时全量释放解码上下文与渲染队列中的帧）已进入产物。
  for (const required of ['releaseFrames()', '_vncUnpinVideoFrames', '_vncReleaseVideoFrames', '_retainedFrames']) {
    if (!code.includes(required)) {
      fail(`noVNC 补丁 4 未进入产物（缺少 ${required}），请检查 core/decoders/h264.js 与 core/display.js 的锚点`);
    }
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
  const h264StateAnchor = '        this._decoder = null;\n        this._pendingFrames = [];';
  const h264StatePatched = '        this._decoder = null;\n        this._pendingFrames = [];\n        this._retainedFrames = new Set();';
  if (!h264Source.includes(h264StateAnchor)) fail('noVNC h264.js 补丁 1 锚点未找到（H264Context 构造函数），请核对 noVNC 版本');
  h264Source = h264Source.replace(h264StateAnchor, h264StatePatched, 1);

  const h264Anchor = '    _handleFrame(frame) {\n        let pending = this._pendingFrames.shift();\n        if (pending === undefined) {\n            throw new Error("Pending frame queue empty when receiving frame from decoder");\n        }\n\n        if (pending.timestamp != frame.timestamp) {\n            throw new Error("Video frame timestamp mismatch. Expected " +\n                frame.timestamp + " but but got " + pending.timestamp);\n        }\n\n        pending.frame = frame;\n        pending.ready = true;\n        pending.resolve();\n\n        if (!pending.keep) {\n            frame.close();\n        }\n    }';
  const h264Patched = [
    '    _handleFrame(frame) {',
    '        let pending = this._pendingFrames.shift();',
    '        if (pending === undefined) {',
    '            // NexTerm patch: a decoder may still emit an output after its',
    '            // context was reset/released. There is no renderer left to own',
    '            // this frame, so close it instead of throwing and leaking it.',
    '            frame.close();',
    '            return;',
    '        }',
    '',
    '        if (pending.timestamp != frame.timestamp) {',
    '            frame.close();',
    '            this._releasePendingFrame(pending);',
    '            throw new Error("Video frame timestamp mismatch. Expected " +',
    '                frame.timestamp + " but but got " + pending.timestamp);',
    '        }',
    '',
    '        pending.frame = frame;',
    '        pending.ready = true;',
    '        pending.resolve();',
    '',
    '        if (!pending.keep) {',
    '            this._releasePendingFrame(pending);',
    '        }',
    '        frame = {};',
    '    }',
    '',
    '    // NexTerm patch: every pending wrapper owns exactly one VideoFrame and',
    '    // is tracked until released. Display calls release() after drawImage;',
    '    // teardown calls releaseFrames() for wrappers that never get rendered.',
    '    _releasePendingFrame(pending) {',
    '        if (!pending) {',
    '            return;',
    '        }',
    '        const index = this._pendingFrames.indexOf(pending);',
    '        if (index !== -1) {',
    '            this._pendingFrames.splice(index, 1);',
    '        }',
    '        const frame = pending.frame;',
    '        pending.frame = null;',
    '        this._retainedFrames.delete(pending);',
    '        if (frame && typeof frame.close === "function") {',
    '            frame.close();',
    '        }',
    '        if (!pending.ready && typeof pending.resolve === "function") {',
    '            pending.ready = true;',
    '            const resolve = pending.resolve;',
    '            pending.resolve = () => {};',
    '            resolve();',
    '        }',
    '    }',
    '',
    '    releaseFrames(closeDecoder = true) {',
    '        if (closeDecoder) {',
    '            this._pendingFrames.length = 0;',
    '        }',
    '        for (const pending of Array.from(this._retainedFrames)) {',
    '            if (closeDecoder || pending.ready) {',
    '                this._releasePendingFrame(pending);',
    '            }',
    '        }',
    '        if (!closeDecoder) {',
    '            return;',
    '        }',
    '        this._retainedFrames.clear();',
    '        if (this._decoder !== null) {',
    '            try {',
    '                if (this._decoder.state !== "closed") {',
    '                    this._decoder.close();',
    '                }',
    '            } catch (e) {',
    '                // The decoder may have already been closed by the browser.',
    '            }',
    '            this._decoder = null;',
    '        }',
    '    }',
  ].join('\n');
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
  const displayFrameAnchor = '                case \'frame\':\n                    if (a.frame.ready) {\n                        // The encoded frame may be larger than the rect due to\n                        // limitations of the encoder, so we need to crop the\n                        // frame.\n                        let frame = a.frame.frame;\n                        if (frame.codedWidth < a.width || frame.codedHeight < a.height) {\n                            Log.Warn("Decoded video frame does not cover its full rectangle area. Expecting at least " +\n                                      a.width + "x" + a.height + " but got " +\n                                      frame.codedWidth + "x" + frame.codedHeight);\n                        }\n                        const sx = 0;\n                        const sy = 0;\n                        const sw = a.width;\n                        const sh = a.height;\n                        const dx = a.x;\n                        const dy = a.y;\n                        const dw = sw;\n                        const dh = sh;\n                        this.drawImage(frame, sx, sy, sw, sh, dx, dy, dw, dh);\n                        frame.close();\n                    } else {\n                        let display = this;\n                        a.frame.promise.then(() => {\n                            display._scanRenderQ();\n                        });\n                        ready = false;\n                    }\n                    break;';
  const displayFramePatched = [
    '                case \'frame\':',
    '                    // NexTerm patch: teardown may have released this action',
    '                    // already (frame is null); skip it without drawing a',
    '                    // closed VideoFrame.',
    '                    if (!a.frame || !a.frame.frame) {',
    '                        break;',
    '                    }',
    '                    if (a.frame.ready) {',
    '                        // The encoded frame may be larger than the rect due to',
    '                        // limitations of the encoder, so we need to crop the',
    '                        // frame.',
    '                        let frame = a.frame.frame;',
    '                        try {',
    '                            if (frame.codedWidth < a.width || frame.codedHeight < a.height) {',
    '                                Log.Warn("Decoded video frame does not cover its full rectangle area. Expecting at least " +',
    '                                          a.width + "x" + a.height + " but got " +',
    '                                          frame.codedWidth + "x" + frame.codedHeight);',
    '                            }',
    '                            const sx = 0;',
    '                            const sy = 0;',
    '                            const sw = a.width;',
    '                            const sh = a.height;',
    '                            const dx = a.x;',
    '                            const dy = a.y;',
    '                            const dw = sw;',
    '                            const dh = sh;',
    '                            this.drawImage(frame, sx, sy, sw, sh, dx, dy, dw, dh);',
    '                        } finally {',
    '                            // Always release, even if drawImage throws; the',
    '                            // pending wrapper is idempotent.',
    '                            if (typeof a.frame.release === "function") {',
    '                                a.frame.release();',
    '                            } else {',
    '                                frame.close();',
    '                                a.frame.frame = null;',
    '                            }',
    '                        }',
    '                    } else {',
    '                        let display = this;',
    '                        a.frame.promise.then(() => {',
    '                            display._scanRenderQ();',
    '                        });',
    '                        ready = false;',
    '                    }',
    '                    break;',
  ].join('\n');
  if (!displaySource.includes(displayFrameAnchor)) fail('noVNC display.js 补丁 3 锚点未找到（frame 渲染分支），请核对 noVNC 版本');
  displaySource = displaySource.replace(displayFrameAnchor, displayFramePatched, 1);

  // 补丁 3b：_scanRenderQ 的 'img' 分支在 tight/jpeg 解码图尺寸与协议头声明
  // 尺寸不一致时直接 return，会永久卡死渲染队列头。videoFrame 与 image 共用
  // 同一个 _renderQ，队列头一旦被 img 卡住，其后所有 frame 动作（持有
  // VideoFrame）既不出队也不 close()，只能等 GC，浏览器随即报
  // "A VideoFrame was garbage collected without being closed"。Windows 远程
  // 桌面 tightjpeg 的 JPEG 以 8x8 块对齐、常与声明尺寸差几像素，因此这是
  // 正常运行中（非断开）触发的真实泄漏路径，之前的断开/隐藏/重连释放补丁
  // 都够不到这里。改为记录错误后丢弃该 img 动作并继续扫描，不再阻塞后续帧。
  const displayImgAnchor = '                case \'img\':\n                    if (a.img.complete) {\n                        if (a.img.width !== a.width || a.img.height !== a.height) {\n                            Log.Error("Decoded image has incorrect dimensions. Got " +\n                                      a.img.width + "x" + a.img.height + ". Expected " +\n                                      a.width + "x" + a.height + ".");\n                            return;\n                        }\n                        this.drawImage(a.img, a.x, a.y);';
  const displayImgPatched = [
    '                case \'img\':',
    '                    if (a.img.complete) {',
    '                        if (a.img.width !== a.width || a.img.height !== a.height) {',
    '                            // NexTerm patch: do NOT return here. Returning',
    '                            // wedges the whole render queue (videoFrame and',
    '                            // image actions share _renderQ), so every H.264',
    '                            // frame queued behind it is never drawn nor',
    '                            // closed and is eventually GC\'d, which the',
    '                            // browser reports as "A VideoFrame was garbage',
    '                            // collected without being closed". Drop this one',
    '                            // bad image (shift it out below via ready=true)',
    '                            // and keep scanning the rest of the queue.',
    '                            Log.Error("Decoded image has incorrect dimensions. Got " +',
    '                                      a.img.width + "x" + a.img.height + ". Expected " +',
    '                                      a.width + "x" + a.height + ". (dropping)");',
    '                        } else {',
    '                            this.drawImage(a.img, a.x, a.y);',
    '                        }',
  ].join('\n');
  if (!displaySource.includes(displayImgAnchor)) fail('noVNC display.js 补丁 3b 锚点未找到（img 渲染分支 return），请核对 noVNC 版本');
  displaySource = displaySource.replace(displayImgAnchor, displayImgPatched, 1);

  const displayReleaseAnchor = '    _renderQPush(action) {';
  const displayReleasePatched = [
    '    // NexTerm patch: close every VideoFrame still held by queued actions.',
    '    // This is called during teardown, when no further _scanRenderQ will run.',
    '    _vncReleaseVideoFrames(closeAll = true) {',
    '        for (const action of this._renderQ) {',
    '            if (action.type !== "frame" || !action.frame) {',
    '                continue;',
    '            }',
    '            if (!closeAll && !action.frame.ready) {',
    '                continue;',
    '            }',
    '            if (typeof action.frame.release === "function") {',
    '                action.frame.release();',
    '            } else if (action.frame.frame &&',
    '                       typeof action.frame.frame.close === "function") {',
    '                action.frame.frame.close();',
    '                action.frame.frame = null;',
    '            }',
    '        }',
    '    }',
    '',
    '    _renderQPush(action) {',
  ].join('\n');
  if (!displaySource.includes(displayReleaseAnchor)) fail('noVNC display.js 补丁 3 锚点未找到（_renderQPush），请核对 noVNC 版本');
  displaySource = displaySource.replace(displayReleaseAnchor, displayReleasePatched, 1);

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

  const h264PrepareAnchor = '        this._pendingFrames.push(pending);\n\n        return pending;';
  const h264PreparePatched = [
    '        pending.release = () => this._releasePendingFrame(pending);',
    '        this._pendingFrames.push(pending);',
    '        this._retainedFrames.add(pending);',
    '',
    '        return pending;',
  ].join('\n');
  if (!h264Source.includes(h264PrepareAnchor)) fail('noVNC h264.js 补丁 4 锚点未找到（_preparePendingFrame），请核对 noVNC 版本');
  h264Source = h264Source.replace(h264PrepareAnchor, h264PreparePatched, 1);

  // 补丁 4：decode() 每批最后一条 pending 被 keep=true 交给 Display 渲染。
  // 解码完成后它已经不在 _pendingFrames 中，旧版 unpinLastFrame 因此取不到
  // 真正持有的帧。这里给每个 pending 记录 release()，并在重置上下文/断开
  // 时通过 H264Context.releaseFrames() 全量释放。

  const h264CreateAnchor = '        if (Object.keys(this._contexts).length >= maxContexts) {\n            let oldestContextId = this._findOldestContextId();\n            delete this._contexts[oldestContextId];\n        }';
  const h264CreatePatched = [
    '        if (Object.keys(this._contexts).length >= maxContexts) {',
    '            let oldestContextId = this._findOldestContextId();',
    '            const oldestContext = this._contexts[oldestContextId];',
    '            if (oldestContext && typeof oldestContext.releaseFrames === "function") {',
    '                oldestContext.releaseFrames();',
    '            }',
    '            delete this._contexts[oldestContextId];',
    '        }',
  ].join('\n');
  if (!h264Source.includes(h264CreateAnchor)) fail('noVNC h264.js 补丁 4 锚点未找到（_createContext 淘汰），请核对 noVNC 版本');
  h264Source = h264Source.replace(h264CreateAnchor, h264CreatePatched, 1);

  const h264ResetAnchor = '    _resetContext(x, y, width, height) {\n        delete this._contexts[this._contextId(x, y, width, height)];\n    }\n\n    _resetAllContexts() {\n        this._contexts = {};\n    }';
  const h264ResetPatched = [
    '    _resetContext(x, y, width, height) {',
    '        const id = this._contextId(x, y, width, height);',
    '        const context = this._contexts[id];',
    '        if (context && typeof context.releaseFrames === "function") {',
    '            context.releaseFrames();',
    '        }',
    '        delete this._contexts[id];',
    '    }',
    '',
    '    _resetAllContexts() {',
    '        for (const context of Object.values(this._contexts)) {',
    '            if (context && typeof context.releaseFrames === "function") {',
    '                context.releaseFrames();',
    '            }',
    '        }',
    '        this._contexts = {};',
    '    }',
  ].join('\n');
  if (!h264Source.includes(h264ResetAnchor)) fail('noVNC h264.js 补丁 4 锚点未找到（上下文重置），请核对 noVNC 版本');
  h264Source = h264Source.replace(h264ResetAnchor, h264ResetPatched, 1);
  fs.writeFileSync(h264File, h264Source);

  // 补丁 4（续）：RFB 类新增 _vncUnpinVideoFrames()，遍历所有 H.264 解码
  // 上下文释放其跟踪的全部 pending/VideoFrame，并清空 Display 渲染队列
  // 中尚未绘制的帧。只释放解码队列会漏掉已出队、正等待渲染的最后一帧。
  const rfbFile = path.join(core, 'rfb.js');
  let rfbSource = fs.readFileSync(rfbFile, 'utf8');
  const rfbAnchor = '    static genDES(password, challenge) {';
  const rfbPatched = [
    '    // NexTerm patch: release every retained H.264 VideoFrame on teardown.',
    '    // Completed frames live in Display._renderQ, not in _pendingFrames, so',
    '    // both sides must be drained to avoid GC warnings and stalled decoders.',
    '    _vncUnpinVideoFrames(closeDecoder = true) {',
    '        const decoder = this._decoders && this._decoders[encodings.encodingH264];',
    '        if (decoder) {',
    '            for (const context of Object.values(decoder._contexts || {})) {',
    '                if (context && typeof context.releaseFrames === "function") {',
    '                    context.releaseFrames(closeDecoder);',
    '                }',
    '            }',
    '        }',
    '        if (this._display && typeof this._display._vncReleaseVideoFrames === "function") {',
    '            this._display._vncReleaseVideoFrames(closeDecoder);',
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
