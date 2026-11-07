// SUPVAN T50M Pro over Bluetooth LE (Web Bluetooth, Chrome on Android).
//
// A trimmed plain-JavaScript port of the T50/T80 Bluetooth driver from
// "Supvan & Katasymbol web print studio" (github.com/khromov/supvan-katasymbol-printer-web-ui,
// MIT licence, see LICENSE-supvan-web-ui.txt), which was ported from the official
// Katasymbol Android app and verified printing on a T50M Pro.
import LZMA from "./lzma.js";

const SERVICE = "0000e0ff-3c17-d293-8e48-14fe2e4da212";
const WRITE_CHAR = "0000ffe9-0000-1000-8000-00805f9b34fb";
const NOTIFY_CHAR = "0000ffe1-0000-1000-8000-00805f9b34fb";
const NAME_PREFIX = "T0"; // printers advertise as e.g. "T0148B2507018663"
const MAX_WRITE = 128;
const HEAD_DOTS = 384;
const BUF_LENGTH = 4096;

export const CMD = {
  BUF_FULL: 0x10, INQUIRY_STA: 0x11, CHECK_DEVICE: 0x12, START_PRINT: 0x13,
  STOP_PRINT: 0x14, RETURN_MAT: 0x30, NEXTFRM_BULK: 0x5c,
};

export class PrinterError extends Error {}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const bluetoothSupported = () => typeof navigator !== "undefined" && "bluetooth" in navigator;

// ------------------------------------------------------------- framing ---
const sum16 = (b, from, to) => { let s = 0; for (let i = from; i < to; i++) s += b[i]; return s & 0xffff; };

/** 16-byte command frame: 7E 5A 0C 00 10 01 AA <cmd> <sum LE> 00 01 <a LE16> <b LE16>. */
export function commandFrame(cmd, a = 0, b = 0) {
  const f = new Uint8Array([0x7e, 0x5a, 0x0c, 0x00, 0x10, 0x01, 0xaa, cmd & 0xff, 0, 0, 0x00, 0x01,
    a & 0xff, (a >> 8) & 0xff, b & 0xff, (b >> 8) & 0xff]);
  const s = sum16(f, 10, 16);
  f[8] = s & 0xff; f[9] = s >> 8;
  return f;
}

/** Split an LZMA stream into 512-byte data frames (500 data bytes each). */
export function dataFrames(stream) {
  const count = Math.ceil(stream.length / 500);
  const frames = [];
  for (let i = 0; i < count; i++) {
    const f = new Uint8Array(512);
    f.set([0x7e, 0x5a, 0xfc, 0x01, 0x10, 0x02, 0xaa, 0xbb]);
    f[10] = i & 0xff; f[11] = count & 0xff;
    f.set(stream.subarray(i * 500, Math.min(stream.length, (i + 1) * 500)), 12);
    const s = sum16(f, 10, 512);
    f[8] = s & 0xff; f[9] = s >> 8;
    frames.push(f);
  }
  return frames;
}

// ------------------------------------------------------------- raster ---
/** Bitmap (1 = black, row-major, x across the print head) -> column bytes. */
export function packForHead(bm) {
  // rotate -90: rows = bitmap columns (across the head), cols = print lines
  const rows = bm.width, cols = bm.height;
  let r0 = 0, nrows = rows;
  if (rows > HEAD_DOTS) { r0 = Math.floor((rows - HEAD_DOTS) / 2); nrows = HEAD_DOTS; }
  const bpc = Math.ceil(nrows / 8);
  const bytes = new Uint8Array(bpc * cols);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < nrows; r++) {
      // rotate(-90): out[i][j] = in[j][w - i - 1]
      const i = r + r0;
      if (bm.data[c * bm.width + (bm.width - i - 1)]) bytes[c * bpc + (r >> 3)] |= 1 << (r & 7);
    }
  }
  return { bytes, bytesPerColumn: bpc, columns: cols };
}

/** Checksummed 4096-byte print buffers for one page. */
export function buildBuffers(bm, { density, paperType, printEnd }) {
  const { bytes, bytesPerColumn, columns } = packForHead(bm);
  const maxCols = Math.floor((BUF_LENGTH - 22) / bytesPerColumn);
  const count = Math.ceil(columns / maxCols);
  const buffers = [];
  for (let i = 0; i < count; i++) {
    const last = i === count - 1;
    const cols = last ? columns - maxCols * i : maxCols;
    const buf = new Uint8Array(BUF_LENGTH);
    let b0 = 0;
    if (i === 0) b0 |= 0x02;
    if (last) b0 |= 0x04;
    if (last && printEnd) b0 |= 0x08;
    buf[2] = b0 & 0x0f;
    buf[3] = ((paperType << 6) | (density << 2)) & 0xff;
    buf[4] = cols & 0xff; buf[5] = (cols >> 8) & 0xff;
    buf[6] = bytesPerColumn & 0xff;
    buf[8] = 1; buf[10] = 1;
    buf.set(bytes.subarray(maxCols * i * bytesPerColumn, (maxCols * i + cols) * bytesPerColumn), 14);
    const len = cols * bytesPerColumn + 14;
    let sum = 0;
    for (let j = 2; j < 14; j++) sum += buf[j];
    for (let k = 0; k < Math.floor(len / 256); k++) sum += buf[(k + 1) * 256 - 1];
    buf[0] = sum & 0xff; buf[1] = (sum >> 8) & 0xff;
    buffers.push(buf);
  }
  return buffers;
}

const compress = (buf) => Uint8Array.from(LZMA.compress(buf, 9), (b) => b & 0xff);
const concat = (bufs) => { const a = new Uint8Array(BUF_LENGTH * bufs.length); bufs.forEach((b, i) => a.set(b, i * BUF_LENGTH)); return a; };

/** Up to 8 buffers per LZMA chunk (each under 4096 bytes), and the print speed. */
export function chunkPage(buffers, maxBuffers = 8) {
  const chunks = [];
  let firstN = 0;
  for (let i = 0; i < buffers.length;) {
    let n = Math.min(maxBuffers, buffers.length - i);
    let stream = compress(concat(buffers.slice(i, i + n)));
    while (stream.length > BUF_LENGTH && n > 1) { n--; stream = compress(concat(buffers.slice(i, i + n))); }
    if (!chunks.length) firstN = n;
    chunks.push(stream);
    i += n;
  }
  return { chunks, speed: firstN >= buffers.length ? 51 : firstN * 6 + 3 };
}

// ------------------------------------------------------------- status ---
export function parseStatus(frame) {
  const b = frame.subarray(14, 22);
  // Same order as the official app's Bluetooth check: each of these stops printing.
  const chain = [
    [b[1] & 0x08, "The print head is too hot - wait a minute"],
    [b[2] & 0x08, "The label cover is open"],
    [b[0] & 0x10, "The label roll isn't fitted properly"],
    [b[0] & 0x20, "Check the labels remaining"],
    [b[0] & 0x02, "No label detected"],
    [b[0] & 0x08, "Label not recognised"],
    [b[0] & 0x04, "Out of labels"],
  ];
  const hit = chain.find(([on]) => on);
  const error = hit ? hit[1] : null;
  const s = {
    bufferFull: !!(b[0] & 0x01), busy: !!(b[1] & 0x04), printing: !!(b[2] & 0x40),
    lowBattery: !!(b[0] & 0x40), pagesPrinted: b[4] | (b[5] << 8), error,
  };
  if (frame.length >= 26) {
    const v = (frame[24] | (frame[25] << 8)) / 1000;
    if (v > 0) s.batteryVolts = v;
  }
  return s;
}

// ------------------------------------------------------------- printer ---
export class Printer {
  constructor() {
    this.device = null;
    this.writeChar = null;
    this.notifyChar = null;
    this.withoutResponse = false;
    this.frames = [];
    this.pending = new Uint8Array(0);
    this.wake = null;
    this.queue = Promise.resolve();
    this.onchange = () => {};
    this.paperType = 1; // die-cut labels
    this._onNotify = (e) => {
      const v = e.target.value;
      if (v) this._receive(new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)));
    };
    this._onDisconnect = () => { this.writeChar = null; this.onchange(); };
  }

  get connected() { return !!(this.device && this.device.gatt && this.device.gatt.connected && this.writeChar); }
  get name() { return this.device ? this.device.name || "Label printer" : ""; }

  /** Show Chrome's printer chooser. Must be called straight from a tap. */
  async choose() {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: NAME_PREFIX }], optionalServices: [SERVICE],
    });
    await this.connect(device);
  }

  /** Reconnect to a printer chosen before (no chooser needed). */
  async findKnown() {
    if (!bluetoothSupported() || !navigator.bluetooth.getDevices) return false;
    const known = (await navigator.bluetooth.getDevices()).find((d) => (d.name || "").startsWith(NAME_PREFIX));
    if (!known) return false;
    await this.connect(known);
    return true;
  }

  async connect(device = this.device) {
    if (!device) throw new PrinterError("No printer chosen yet");
    if (this.device && this.device !== device) this.device.removeEventListener("gattserverdisconnected", this._onDisconnect);
    this.device = device;
    device.addEventListener("gattserverdisconnected", this._onDisconnect);
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE);
    this.writeChar = await service.getCharacteristic(WRITE_CHAR);
    this.notifyChar = await service.getCharacteristic(NOTIFY_CHAR);
    this.notifyChar.addEventListener("characteristicvaluechanged", this._onNotify);
    await this.notifyChar.startNotifications();
    const p = this.writeChar.properties;
    this.withoutResponse = p.writeWithoutResponse && !p.write;
    await this.handshake();
    try {
      const m = await this.readMedia();
      if (m && m.paperType !== undefined) this.paperType = m.paperType;
      this.media = m;
    } catch (e) { /* label info is optional */ }
    this.onchange();
  }

  async disconnect() {
    if (this.device && this.device.gatt.connected) this.device.gatt.disconnect();
    this.writeChar = null;
    this.onchange();
  }

  async ensureConnected() {
    if (this.connected) return;
    if (this.device) return this.connect(this.device);
    if (await this.findKnown()) return;
    throw new PrinterError("No printer connected. Tap 'Connect printer' first.");
  }

  // ---- byte stream ----
  async _write(data) {
    for (let o = 0; o < data.length; o += MAX_WRITE) {
      const piece = data.slice(o, o + MAX_WRITE);
      if (this.withoutResponse) await this.writeChar.writeValueWithoutResponse(piece);
      else await this.writeChar.writeValueWithResponse(piece);
    }
  }

  _receive(chunk) {
    const buf = new Uint8Array(this.pending.length + chunk.length);
    buf.set(this.pending); buf.set(chunk, this.pending.length);
    let i = 0;
    for (;;) {
      while (i + 1 < buf.length && !(buf[i] === 0x7e && buf[i + 1] === 0x5a)) i++;
      if (i + 4 > buf.length) break;
      const total = (buf[i + 2] | (buf[i + 3] << 8)) + 4;
      if (total < 8 || total > 2048) { i++; continue; }
      if (i + total > buf.length) break;
      this.frames.push(buf.slice(i, i + total));
      i += total;
    }
    this.pending = buf.slice(i);
    if (this.wake) this.wake();
  }

  _clear() { this.frames = []; this.pending = new Uint8Array(0); }

  async _next(match, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      while (this.frames.length) { const f = this.frames.shift(); if (match(f)) return f; }
      const left = deadline - Date.now();
      if (left <= 0) return null;
      await new Promise((resolve) => {
        const t = setTimeout(done, left);
        function done() { clearTimeout(t); resolve(); }
        this.wake = done;
      });
      this.wake = null;
    }
  }

  _serial(run) { const p = this.queue.then(run, run); this.queue = p.catch(() => {}); return p; }

  /** Send a command and wait for the reply that echoes it (one retry). */
  command(cmd, a = 0, b = 0, timeoutMs = 4000, retry = true) {
    return this._serial(async () => {
      for (let attempt = 0; attempt < (retry ? 2 : 1); attempt++) {
        this._clear();
        await this._write(commandFrame(cmd, a, b));
        await sleep(10);
        const reply = await this._next((f) => f[7] === cmd, timeoutMs);
        if (reply) return reply;
      }
      throw new PrinterError("The printer didn't answer. Is it switched on and close by?");
    });
  }

  /** Announce, then send, one LZMA chunk (the printer doesn't acknowledge frames over BLE). */
  sendChunk(stream) {
    return this._serial(async () => {
      const frames = dataFrames(stream);
      this._clear();
      await this._write(commandFrame(CMD.NEXTFRM_BULK, 512, frames.length));
      await sleep(10);
      await this._next((f) => f[7] === CMD.NEXTFRM_BULK, 4000);
      for (const f of frames) {
        this._clear();
        for (let o = 0; o < f.length; o += 128) { await this._write(f.subarray(o, o + 128)); await sleep(10); }
      }
    });
  }

  async handshake(attempts = 6) {
    let last;
    for (let i = 0; i < attempts; i++) {
      try { return parseStatus(await this.command(CMD.INQUIRY_STA, 0, 0, 1500, false)); }
      catch (e) { last = e; await sleep(300); }
    }
    throw last || new PrinterError("The printer didn't answer");
  }

  async status() { return parseStatus(await this.command(CMD.INQUIRY_STA)); }

  async readMedia() {
    const f = await this.command(CMD.RETURN_MAT, 0, 0, 4000, false);
    if (f.length < 42) return null; // incomplete reply: keep the default (die-cut labels)
    const at = (o) => f[o + 21] || 0;
    return { labelId: at(16) | (at(17) << 8), paperType: at(18), lengthMm: at(19), widthMm: at(20) };
  }

  _check(s) { if (s.error) throw new PrinterError(s.error); }

  /** Print one label bitmap. density 1..9 (darkness). */
  async print(bitmap, { copies = 1, density = 4, onProgress = () => {} } = {}) {
    await this.ensureConnected();
    copies = Math.max(1, copies | 0);
    density = Math.min(15, Math.max(0, density | 0));
    const sequence = [];
    for (let c = 0; c < copies; c++) {
      const buffers = buildBuffers(bitmap, { density, paperType: this.paperType, printEnd: c === copies - 1 });
      sequence.push(chunkPage(buffers));
    }

    onProgress("Checking printer…");
    await this.command(CMD.CHECK_DEVICE);
    let s;
    for (let tries = 0; ; tries++) {
      await sleep(100);
      s = await this.status();
      if (s.printing) throw new PrinterError("The printer is already printing - try again in a moment");
      if (!s.busy) break;
      if (tries >= 60) throw new PrinterError("The printer stayed busy");
    }
    this._check(s);

    await this.command(CMD.START_PRINT, 0);
    try {
      for (let tries = 0; ; tries++) {
        await sleep(100);
        s = await this.status();
        this._check(s);
        if (s.printing) break;
        if (tries >= 60) throw new PrinterError("The printer didn't start printing");
      }
      for (let p = 0; p < sequence.length; p++) {
        onProgress(copies > 1 ? `Printing ${p + 1} of ${copies}…` : "Printing…");
        const { chunks, speed } = sequence[p];
        for (const chunk of chunks) {
          for (;;) {
            s = await this.status();
            this._check(s);
            if (!s.printing && !s.busy && !s.lowBattery) throw new PrinterError("Printing was stopped on the printer");
            if (!s.bufferFull) break;
            await sleep(20);
          }
          await this.sendChunk(chunk);
          await sleep(20);
          await this.command(CMD.BUF_FULL, chunk.length, speed);
        }
      }
      for (let tries = 0; tries < 1200; tries++) {
        await sleep(100);
        s = await this.status();
        this._check(s);
        if (!s.printing && !s.busy) break;
      }
    } catch (e) {
      await this.stop().catch(() => {});
      throw e;
    }
  }

  async stop() {
    let s = await this.status();
    if (!s.printing) return;
    await this.command(CMD.STOP_PRINT);
    for (let i = 0; i < 50 && s.printing; i++) { await sleep(20); s = await this.status(); }
  }
}
