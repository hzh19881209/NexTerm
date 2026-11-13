// xterm 补丁 3：备用缓冲区历史累积到主缓冲区（Codex 运行中可上翻）。
// 由 build-xterm-vendor.js 读取本文件中的锚点/替换串，对 BufferService.ts 打补丁。
//
// 原理：Codex 等 TUI 用 clear+绝对定位原地重绘备用缓冲区，从不让行滚出屏幕，
// 因此补丁 1 的 alt-scrollback 对 Codex 本体不积累历史、运行中无法上翻。
// Tabby 能翻是因为它把 TUI 输出按普通行累积进主缓冲历史。本补丁对齐该做法：
// 在 BufferService.scroll() 中，当活动缓冲区是备用缓冲区且顶部一行即将滚出
// （scrollTop===0 分支）时，把该行文本累积到主缓冲区 scrollback，使 Codex
// 输出（含原地重绘产生的新行）成为主缓冲区可上翻的 scrollback。仅对 alternate
// 生效，不影响普通 shell。
'use strict';

const stateAnchor = [
  '  /** An IBufferline to clone/copy from for new blank lines */',
  '  private _cachedBlankLine: IBufferLine | undefined;',
].join('\n');

const statePatch = [
  '  /** An IBufferline to clone/copy from for new blank lines */',
  '  private _cachedBlankLine: IBufferLine | undefined;',
  '',
  '  // NexTerm patch 3: 累积备用缓冲区（TUI）滚出的行到主缓冲区 scrollback，',
  '  // 使原地重绘 TUI（Codex）的历史在运行中即可上翻（对齐 Tabby 输出累积）。',
  "  private _nextermAltText: string[] = [];",
  "  private _nextermAltDirty = false;",
].join('\n');

const scrollAnchor = [
  '      // Only adjust ybase and ydisp when the buffer is not trimmed',
  '      if (!willBufferBeTrimmed) {',
].join('\n');

const scrollPatch = [
  "      // NexTerm patch 3: 备用缓冲区（TUI）顶部行即将滚出时，累积该行文本。",
  "      if (buffer !== (this.buffers as IBufferSet).normal) {",
  '        const _nextermTop = buffer.lines.get(buffer.ybase);',
  '        if (_nextermTop) this._nextermAccumAltLine(_nextermTop);',
  '      }',
  '      // Only adjust ybase and ydisp when the buffer is not trimmed',
  '      if (!willBufferBeTrimmed) {',
].join('\n');

// 方法锚点：scrollLines 方法上方的注释块（用于在其前插入累积方法）。
const methodAnchor = [
  '  /**',
  '   * Scroll the display of the terminal',
  "   * @param disp The number of lines to scroll down (negative scroll up).",
  "   * @param suppressScrollEvent Don't emit the scroll event as scrollLines. This is used",
].join('\n');

const methodPatch = [
  "  // NexTerm patch 3: 累积一条备用缓冲区行文本（纯文本，不保留 TUI 颜色）。",
  "  private _nextermAccumAltLine(line: IBufferLine): void {",
  "    let text = '';",
  "    try { text = line.translateToString(true).replace(/[ \\t]+$/, ''); } catch { return; }",
  "    // 仅累积有内容的行；空行用单个空格占位以保留行结构。",
  "    this._nextermAltText.push(text === '' ? ' ' : text);",
  "    this._nextermAltDirty = true;",
  "    // 每 16 行批量刷入主缓冲区，避免频繁写主缓冲拖累 TUI 渲染。",
  "    if (this._nextermAltText.length >= 16) this._nextermFlushAltText();",
  "  }",
  "",
  "  // NexTerm patch 3: 把累积的文本刷入主缓冲区 scrollback。",
  "  private _nextermFlushAltText(): void {",
  "    if (!this._nextermAltText.length) return;",
  "    const normal = this.buffers.normal;",
  "    const linesArr = this._nextermAltText;",
  "    this._nextermAltText = [];",
  "    this._nextermAltDirty = false;",
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
  "      // 复刻 scroll() 的行推进：push 后递增 ybase，未上滚时 ydisp 跟随尾部。",
  "      normal.ybase++;",
  "      if (!userScrolling) normal.ydisp++;",
  "    }",

  "  }",
  "",
  "  // NexTerm patch 3: TUI 退出时把残留累积一次性刷入，避免丢失尾段。",
  "  public nextermFlushAltOnExit(): void {",
  "    this._nextermFlushAltText();",
  "  }",
  '',
].join('\n');

module.exports = { stateAnchor, statePatch, scrollAnchor, scrollPatch, methodAnchor, methodPatch };
