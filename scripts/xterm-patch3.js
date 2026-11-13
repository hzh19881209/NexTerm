// xterm 补丁 3：备用缓冲区历史累积到主缓冲区（Codex 退出后可上翻，安全版）。
// 由 build-xterm-vendor.js 读取本文件中的锚点/替换串，对 BufferService.ts 打补丁。
//
// 原理：Codex 等 TUI 用 clear+绝对定位原地重绘备用缓冲区，alt-scrollback 对其
// 不积累历史。本补丁把 TUI 期间滚出的行文本累积起来，在 TUI 退出（备用缓冲区
// 切回主缓冲区）的瞬间一次性写入主缓冲区 scrollback，使整段 Codex 会话成为可
// 上翻的历史。
//
// 关键：只在缓冲区切换的边界（onBufferActivate，inactiveBuffer 为 alt）才写主
// 缓冲区，绝不在 TUI 运行中改动主缓冲区 ybase/ydisp/lines——运行中改动会与
// 渲染器抢同一份视图状态，导致滚轮/坐标计算读到未就绪的元素而报错。
'use strict';

// 状态字段：挂在 BufferService 上。
const stateAnchor = [
  '  /** An IBufferline to clone/copy from for new blank lines */',
  '  private _cachedBlankLine: IBufferLine | undefined;',
].join('\n');

const statePatch = [
  '  /** An IBufferline to clone/copy from for new blank lines */',
  '  private _cachedBlankLine: IBufferLine | undefined;',
  '',
  '  // NexTerm patch 3: TUI 期间滚出的行文本（纯文本），退出时一次性写入主缓冲区。',
  "  private _nextermAltText: string[] = [];",
  "  private _nextermInAlt = false;",
].join('\n');

// 构造：监听缓冲区切换，alt→normal 时把累积文本刷入主缓冲区。
const ctorAnchor = [
  '    this.buffers = this.register(new BufferSet(optionsService, this));',
  '  }',
].join('\n');

const ctorPatch = [
  '    this.buffers = this.register(new BufferSet(optionsService, this));',
  '    // NexTerm patch 3: 监听缓冲区切换。进入备用缓冲区开始累积，切回主缓冲区',
  '    // 时把累积文本一次性写入主缓冲区 scrollback（边界处写主缓冲是安全的，',
  '    // 因为此时主缓冲区即将成为活动缓冲区，不与 TUI 渲染抢状态）。',
  "    this.register(this.buffers.onBufferActivate(e => {",
  "      if (e.inactiveBuffer === this.buffers.alt && e.activeBuffer === this.buffers.normal) {",
  "        this._nextermInAlt = false;",
  '        this._nextermFlushAltText();',
  "      } else if (e.activeBuffer === this.buffers.alt) {",
  '        this._nextermInAlt = true;',
  '        this._nextermAltText = [];',
  '      }',
  '    }));',
  '  }',
].join('\n');

// scroll 钩子：TUI 运行中只累积文本，不改缓冲区。
const scrollAnchor = [
  '      // Only adjust ybase and ydisp when the buffer is not trimmed',
  '      if (!willBufferBeTrimmed) {',
].join('\n');

const scrollPatch = [
  '      // NexTerm patch 3: 备用缓冲区（TUI）顶部行即将滚出时，仅累积该行文本',
  '      // （运行中不改任何缓冲区状态，避免与渲染器抢视图导致滚轮报错）。',
  "      if (buffer !== (this.buffers as IBufferSet).normal) {",
  '        const _nextermTop = buffer.lines.get(buffer.ybase);',
  '        if (_nextermTop) this._nextermAccumAltLine(_nextermTop);',
  '      }',
  '      // Only adjust ybase and ydisp when the buffer is not trimmed',
  '      if (!willBufferBeTrimmed) {',
].join('\n');

// 方法：累积 + 退出时刷入主缓冲区。
const methodAnchor = [
  '  /**',
  '   * Scroll the display of the terminal',
  "   * @param disp The number of lines to scroll down (negative scroll up).",
  "   * @param suppressScrollEvent Don't emit the scroll event as scrollLines. This is used",
].join('\n');

const methodPatch = [
  "  // NexTerm patch 3: 累积一条备用缓冲区行文本（纯文本，不保留 TUI 颜色）。",
  "  private _nextermAccumAltLine(line: IBufferLine): void {",
  "    if (!this._nextermInAlt) return;",
  "    let text = '';",
  "    try { text = line.translateToString(true).replace(/[ \\t]+$/, ''); } catch { return; }",
  "    this._nextermAltText.push(text === '' ? ' ' : text);",
  "    // 上限保护：避免极长会话占用过多内存。",
  "    if (this._nextermAltText.length > 20000) this._nextermAltText.splice(0, this._nextermAltText.length - 20000);",
  "  }",
  "",
  "  // NexTerm patch 3: 退出 TUI 时把累积文本一次性写入主缓冲区 scrollback。",
  "  // 复刻 scroll() 的行推进：push 新行 + 递增 ybase，未上滚时 ydisp 跟随尾部。",
  "  private _nextermFlushAltText(): void {",
  "    if (!this._nextermAltText.length) return;",
  "    const normal = this.buffers.normal;",
  "    const linesArr = this._nextermAltText;",
  "    this._nextermAltText = [];",
  "    const cols = this.cols;",
  "    const nullCell = normal.getNullCell();",
  "    const userScrolling = this.isUserScrolling;",
  "    for (const t of linesArr) {",
  "      const row = normal.getBlankLine(nullCell);",
  "      row.isWrapped = false;",
  "      const max = Math.min(t.length, cols);",
  "      for (let c = 0; c < max; c++) {",
  "        const ch = t.charAt(c);",
  "        row.setCellFromCodepoint(c, ch.codePointAt(0) || 32, ch.length, nullCell);",
  "      }",
  "      normal.lines.push(row);",
  "      normal.ybase++;",
  "      if (!userScrolling) normal.ydisp++;",
  "    }",
  "  }",
  '',
].join('\n');

module.exports = { stateAnchor, statePatch, ctorAnchor, ctorPatch, scrollAnchor, scrollPatch, methodAnchor, methodPatch };
