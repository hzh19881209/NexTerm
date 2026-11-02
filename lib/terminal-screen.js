const { Terminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');

// Keep the resolved screen, not the sequence of redraws that produced it.
const SCROLLBACK = 1000;

class TerminalScreen {
  constructor(cols, rows) {
    this.terminal = new Terminal({ cols, rows, scrollback:SCROLLBACK, convertEol:true, allowProposedApi:true });
    this.serializer = new SerializeAddon();
    this.terminal.loadAddon(this.serializer);
    this.seq = 0;
    this.disposed = false;
  }

  write(data, onParsed) {
    if (this.disposed) return;
    this.terminal.write(data, () => {
      if (!this.disposed) onParsed(++this.seq);
    });
  }

  // xterm parses asynchronously. Queue control operations behind earlier
  // writes so a snapshot and its sequence number always describe the same frame.
  flush(callback) {
    if (this.disposed) return;
    this.terminal.write('', () => { if (!this.disposed) callback(); });
  }

  resize(cols, rows) {
    this.flush(() => this.terminal.resize(cols, rows));
  }

  snapshot(callback) {
    this.flush(() => callback({
      seq:this.seq, cols:this.terminal.cols, rows:this.terminal.rows,
      data:Buffer.from(this.serializer.serialize({ scrollback:SCROLLBACK })).toString('base64')
    }));
  }

  dispose() {
    this.disposed = true;
    this.terminal.dispose();
  }
}

module.exports = { TerminalScreen, SCROLLBACK };
