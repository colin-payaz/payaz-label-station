// Label drawing for the Payaz Label Station (tablet version).
// Draws each label at the printer's native 203 dpi (8 dots per mm) so barcode
// bars land exactly on printer dots, then turns it into 1-bit dots.

export const LABEL_FONT = "PayazLabel"; // Atkinson Hyperlegible Bold (loaded in app.js)

// ---------------------------------------------------------------- Code 128 ---
const PATTERNS = (
  "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 " +
  "221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 " +
  "221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 " +
  "212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 " +
  "231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 " +
  "231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 " +
  "314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 " +
  "112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 " +
  "111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 " +
  "214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 " +
  "114131 311141 411131 211412 211214 211232 2331112"
).split(" ");
const START_B = 104, START_C = 105, TO_B = 100, TO_C = 99, STOP = 106;

const isDigit = (c) => c >= "0" && c <= "9";

export function code128Values(text) {
  if (!text) throw new Error("Nothing to encode");
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new Error(`Character ${ch} can't go in a barcode`);
  }
  const vals = [];
  let cur = null, i = 0;
  const run = (i) => { let n = 0; while (i + n < text.length && isDigit(text[i + n])) n++; return n; };
  while (i < text.length) {
    let r = run(i);
    if (r >= 4 || (cur === null && r === text.length && r % 2 === 0)) {
      if (r % 2) { // odd run: one digit in set B first
        if (cur !== "B") { vals.push(cur === null ? START_B : TO_B); cur = "B"; }
        vals.push(text.charCodeAt(i) - 32); i++; r--;
      }
      if (cur !== "C") { vals.push(cur === null ? START_C : TO_C); cur = "C"; }
      for (let k = 0; k < r / 2; k++) { vals.push(parseInt(text.slice(i, i + 2), 10)); i += 2; }
    } else {
      if (cur !== "B") { vals.push(cur === null ? START_B : TO_B); cur = "B"; }
      vals.push(text.charCodeAt(i) - 32); i++;
    }
  }
  let check = vals[0];
  for (let p = 1; p < vals.length; p++) check += vals[p] * p;
  return [...vals, check % 103, STOP];
}

export function code128Modules(text) {
  let out = "";
  for (const v of code128Values(text)) {
    let bar = true;
    for (const w of PATTERNS[v]) { out += (bar ? "1" : "0").repeat(+w); bar = !bar; }
  }
  return out;
}

// Widest whole-dot bar width that fits, with a quiet zone. Draws on ctx (black).
function drawBarcode(ctx, text, x0, y0, x1, y1) {
  const mods = code128Modules(text);
  let quiet = 10;
  const avail = x1 - x0;
  let m = Math.floor(avail / (mods.length + 2 * quiet));
  if (m < 1) { quiet = 4; m = Math.floor(avail / (mods.length + 2 * quiet)); }
  if (m < 1) return false;
  m = Math.min(m, 4);
  const width = mods.length * m;
  let x = x0 + Math.floor((avail - width) / 2);
  ctx.fillStyle = "#000";
  for (const bit of mods) {
    if (bit === "1") ctx.fillRect(x, y0, m, y1 - y0);
    x += m;
  }
  return true;
}

// ------------------------------------------------------------------- Text ---
// A "line" is a list of runs [text, size, spaceAfter] sharing one baseline, so
// mixed sizes (the SumUp number's big last 3 digits) line up neatly.
let mctx = null;
const fontCss = (size) => `${size}px ${LABEL_FONT}`;
function measure(text, size) {
  if (!mctx) mctx = document.createElement("canvas").getContext("2d");
  mctx.font = fontCss(size);
  const m = mctx.measureText(text);
  return { w: m.width, top: -m.actualBoundingBoxAscent, bottom: m.actualBoundingBoxDescent };
}
function lineMetrics(runs) {
  let width = 0, top = 0, bottom = 0;
  runs.forEach(([t, s, gap], i) => {
    const m = measure(t, s);
    width += m.w + (i < runs.length - 1 ? gap : 0);
    top = Math.min(top, m.top);
    bottom = Math.max(bottom, m.bottom);
  });
  return { width, top, bottom };
}
const lineHeight = (runs) => { const m = lineMetrics(runs); return m.bottom - m.top; };
function drawLine(ctx, cx, ytop, runs) {
  const { width, top } = lineMetrics(runs);
  let x = cx - width / 2;
  const base = ytop - top;
  ctx.fillStyle = "#000";
  ctx.textBaseline = "alphabetic";
  for (const [t, s, gap] of runs) {
    ctx.font = fontCss(s);
    ctx.fillText(t, x, base);
    x += measure(t, s).w + gap;
  }
}
function valueRuns(kind, value, size) {
  if (kind === "sumup" && value.length > 3)
    return [[value.slice(0, -3), Math.round(size * 0.62), Math.round(size * 0.1)], [value.slice(-3), size, 0]];
  return [[value, size, 0]];
}
function fitRuns(make, size, maxW, min = 8) {
  for (; size > min; size--) { const r = make(size); if (lineMetrics(r).width <= maxW) return r; }
  return make(min);
}

// ------------------------------------------------------------------ Layout ---
export const TITLES = {
  order: "Payaz Order Number:",
  sumup: "SumUp Card Reader:",
  tablet: "Tablet Serial Number:",
};
const DPMM = 8;

// Lay items out top to bottom, centred. Spare height first widens every gap
// evenly (up to growMax times its size); the rest is split above and below.
function stack(ctx, cx, x0, w, y0, h, items, gaps, growMax = 2.0) {
  const heights = items.map((it) => it[0] === "line" ? lineHeight(it[1]) : it[0] === "bar" ? it[2] : 1);
  let spare = h - heights.reduce((a, b) => a + b, 0) - gaps.reduce((a, b) => a + b, 0);
  let extra = gaps.map(() => 0);
  if (spare > 0 && gaps.length) {
    const total = gaps.reduce((a, b) => a + b, 0);
    const use = Math.min(spare, total * (growMax - 1));
    extra = gaps.map((g) => g / total * use);
    spare -= use;
  }
  let y = y0 + Math.max(0, spare) / 2;
  items.forEach((it, i) => {
    if (it[0] === "line") drawLine(ctx, cx, y, it[1]);
    else if (it[0] === "bar") drawBarcode(ctx, it[1], x0, Math.round(y), x0 + w, Math.round(y + heights[i]));
    else { ctx.fillStyle = "#000"; for (let xx = Math.round(x0); xx < x0 + w; xx += 4) ctx.fillRect(xx, Math.round(y), 1, 1); }
    y += heights[i];
    if (i < gaps.length) y += gaps[i] + extra[i];
  });
}

function layoutSingle(ctx, kind, value, cx, x0, w, y0, h, unit, date, hd) {
  const gPair = Math.round(unit * 0.03), g = Math.round(unit * 0.05);
  const maxBar = unit * (kind === "order" ? 0.26 : 0.36); // orders: a small barcode
  let scale = 1, title, val, room;
  for (;;) {
    title = fitRuns((s) => [[TITLES[kind], s, 0]], Math.round(unit * 0.095 * scale), w);
    val = fitRuns((s) => valueRuns(kind, value || "-", s), Math.round(unit * 0.2 * scale), w);
    room = h - lineHeight(title) - gPair - lineHeight(val) - hd - 2 * g;
    if (!value || room >= unit * 0.2 || scale <= 0.6) break;
    scale -= 0.05;
  }
  if (value)
    stack(ctx, cx, x0, w, y0, h, [["line", title], ["line", val], ["bar", value, Math.max(0, Math.min(room, maxBar))], ["line", date]], [gPair, g, g]);
  else
    stack(ctx, cx, x0, w, y0, h, [["line", title], ["line", val], ["line", date]], [gPair, g]);
}

function layoutCombined(ctx, sections, values, cx, x0, w, y0, h, unit, date, hd) {
  const n = sections.length;
  const gIn = Math.round(unit * 0.022), gSep = Math.round(unit * 0.03), gDate = Math.round(unit * 0.045);
  const lineFor = (s, size) => [[TITLES[s], Math.round(size * 0.66), Math.round(size * 0.22)], ...valueRuns(s, values[s], size)];
  const per = (h - (n * gIn + (n - 1) * 2 * gSep + gDate + hd + (n - 1))) / n;
  let size = Math.min(Math.round(per * 0.4), Math.round(unit * 0.12));
  while (size > 9 && sections.some((s) => lineMetrics(lineFor(s, size)).width > w)) size--;
  const lines = sections.map((s) => lineFor(s, size));
  const hl = Math.max(...lines.map(lineHeight));
  const bar = Math.max(0, Math.min(per - hl, unit * 0.3));
  const items = [], gaps = [];
  sections.forEach((s, i) => {
    items.push(["line", lines[i]], ["bar", values[s], bar]);
    gaps.push(gIn + hl - lineHeight(lines[i]));
    if (i < n - 1) { items.push(["rule"]); gaps.push(gSep, gSep); }
  });
  items.push(["line", date]);
  gaps.push(gDate);
  stack(ctx, cx, x0, w, y0, h, items, gaps, 1.8);
}

// Stock label: name (big) at the top, then the location, then the stock code and its barcode.
function layoutStock(ctx, values, cx, x0, w, y0, h, unit) {
  const name = (values.name || "").trim() || "Item name";
  const location = (values.location || "").trim();
  const code = (values.code || "").trim();
  const g = Math.round(unit * 0.045), gIn = Math.round(unit * 0.025);
  // Name: one line if it stays big enough, otherwise split onto two lines
  let nameLines = [fitRuns((s) => [[name, s, 0]], Math.round(unit * 0.15), w)];
  if (nameLines[0][0][1] < unit * 0.1 && name.includes(" ")) {
    const words = name.split(/\s+/);
    let best = 1, bestDiff = Infinity;
    for (let i = 1; i < words.length; i++) {
      const d = Math.abs(words.slice(0, i).join(" ").length - words.slice(i).join(" ").length);
      if (d < bestDiff) { bestDiff = d; best = i; }
    }
    const parts = [words.slice(0, best).join(" "), words.slice(best).join(" ")];
    const size = Math.min(...parts.map((p) => fitRuns((s) => [[p, s, 0]], Math.round(unit * 0.13), w)[0][1]));
    nameLines = parts.map((p) => [[p, size, 0]]);
  }
  const items = [], gaps = [];
  nameLines.forEach((l, i) => { items.push(["line", l]); gaps.push(i < nameLines.length - 1 ? Math.round(unit * 0.02) : g); });
  if (location) {
    items.push(["line", fitRuns((s) => [["Location:", Math.round(s * 0.75), Math.round(s * 0.25)], [location, s, 0]], Math.round(unit * 0.085), w)]);
    gaps.push(g);
  }
  if (code) {
    const codeLine = fitRuns((s) => [[code, s, 0]], Math.round(unit * 0.1), w);
    const used = items.reduce((a, it) => a + lineHeight(it[1]), 0) + gaps.reduce((a, b) => a + b, 0) + lineHeight(codeLine) + gIn;
    items.push(["line", codeLine]); gaps.push(gIn);
    items.push(["bar", code, Math.max(0, Math.min(h - used, unit * 0.3))]);
  } else {
    gaps.pop();
  }
  stack(ctx, cx, x0, w, y0, h, items, gaps);
}

export function formatDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * Draw a label. kind: "order" | "sumup" | "tablet" | "all".
 * Returns { canvas, bitmap } - canvas is the 1-bit preview, bitmap is
 * { width, height, data } with 1 = black dot, ready for the printer.
 */
export function renderLabel(kind, values, { widthMm = 40, heightMm = 30, rotate = false, when } = {}) {
  const W = Math.round(widthMm * DPMM), H = Math.round(heightMm * DPMM);
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  const pad = Math.round(1.5 * DPMM);
  const x0 = pad, y0 = pad, w = W - 2 * pad, h = H - 2 * pad, cx = W / 2;
  const unit = Math.min(H, W * 0.75);
  const date = [[formatDate(when), Math.max(11, Math.round(unit * 0.07)), 0]];
  const hd = lineHeight(date);
  if (kind === "stock") {
    layoutStock(ctx, values, cx, x0, w, y0, h, unit);
  } else if (kind === "all") {
    const sections = ["order", "sumup", "tablet"].filter((s) => values[s]);
    layoutCombined(ctx, sections.length ? sections : ["order"], values, cx, x0, w, y0, h, unit, date, hd);
  } else {
    layoutSingle(ctx, kind, values[kind] || "", cx, x0, w, y0, h, unit, date, hd);
  }

  // Turn into crisp 1-bit dots (what the printer will print)
  const img = ctx.getImageData(0, 0, W, H);
  const data = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const g = img.data[i * 4] * 0.3 + img.data[i * 4 + 1] * 0.59 + img.data[i * 4 + 2] * 0.11;
    data[i] = g < 140 ? 1 : 0;
  }
  if (rotate) data.reverse();
  for (let i = 0; i < W * H; i++) {
    const v = data[i] ? 0 : 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, bitmap: { width: W, height: H, data } };
}
