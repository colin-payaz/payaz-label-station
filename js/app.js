import { renderLabel, LABEL_FONT } from "./labels.js";
import { Printer, bluetoothSupported, isNativeApp } from "./printer.js";
import { loadLog, addLogEntry, deleteLogEntry, logRow, exportCsv } from "./log.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const printer = new Printer();

// The two label screens. Box types: "pad" = number keypad (with PZ),
// "scan" = barcode scanner/camera (or type it), "text" = on-screen keyboard.
const MODES = {
  order: {
    title: "Order Label", logged: true,
    fields: [
      { k: "order", label: "Payaz Order Number:", ph: "Type the number", type: "pad" },
      { k: "sumup", label: "SumUp Card Reader:", ph: "Scan the reader", type: "scan" },
      { k: "tablet", label: "Tablet Serial Number:", ph: "Scan the tablet", type: "scan" },
    ],
  },
  stock: {
    title: "Stock Label", logged: false,
    fields: [
      { k: "name", label: "Name:", ph: "Tap here, then type the name", type: "text" },
      { k: "location", label: "Location:", ph: "Tap here, then type the location", type: "text" },
      { k: "code", label: "Stock Code:", ph: "Scan or type the code", type: "scan" },
    ],
  },
};
const vals = { order: "", sumup: "", tablet: "", name: "", location: "", code: "" };
let mode = "order", active = null, copies = 1, typing = false, caseMode = "Abc", idleTimer = null;
const fields = () => MODES[mode].fields;
const fieldOf = (k) => fields().find((f) => f.k === k);

/* ---------- settings (saved on this tablet) ---------- */
const DEFAULTS = { widthMm: 40, heightMm: 30, density: 4, rotate: false };
let settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem("payaz-settings") || "{}")); } catch (e) {}
function saveSettings(change) {
  Object.assign(settings, change);
  settings.widthMm = Math.max(20, Math.min(50, +settings.widthMm));
  settings.heightMm = Math.max(15, Math.min(100, +settings.heightMm));
  settings.density = Math.max(1, Math.min(9, +settings.density));
  try { localStorage.setItem("payaz-settings", JSON.stringify(settings)); } catch (e) {}
  drawSettings();
}

/* ---------- navigation ---------- */
function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("on", s.id === id));
  $("#backBtn").style.display = id === "home" ? "none" : "";
  $("#setBtn").style.display = id === "home" ? "" : "none";
  $("#pill").style.display = id === "home" ? "" : "none";
}
function home() {
  Object.keys(vals).forEach((k) => (vals[k] = ""));
  copies = 1;
  $("#hdrTitle").textContent = "Label Station";
  show("home");
}
// Order labels: one box filled -> that label on its own; two or three -> one combined label.
function printKind() {
  if (mode === "stock") return "stock";
  const filled = ["order", "sumup", "tablet"].filter((f) => vals[f]);
  return filled.length > 1 ? "all" : filled[0] || active;
}
const canPrint = () => mode === "stock" ? !!(vals.name || vals.code) : ["order", "sumup", "tablet"].some((f) => vals[f]);
function openMode(m) {
  mode = m; copies = 1; typing = false;
  $("#fields").innerHTML = fields().map((f) =>
    `<button class="field" data-f="${f.k}"><div class="lbl">${f.label}</div><div class="val"></div></button>`).join("");
  $("#fields").querySelectorAll(".field").forEach((b) => (b.onclick = () => setActive(b.dataset.f)));
  $("#fields").style.cssText = "display:flex;flex-direction:column;gap:8px";
  setActive(fields()[0].k);
  show("edit"); poke();
}
function setActive(k) {
  active = k; typing = false;
  render();
}

/* ---------- drawing ---------- */
function makeLabel(kind, values) {
  return renderLabel(kind, values, { widthMm: settings.widthMm, heightMm: settings.heightMm, rotate: settings.rotate });
}
let prevTimer;
function render() {
  document.querySelectorAll(".field").forEach((b) => {
    const f = fieldOf(b.dataset.f), v = b.querySelector(".val"), val = vals[f.k];
    b.classList.toggle("active", f.k === active);
    v.textContent = val || f.ph;
    v.classList.toggle("empty", !val);
    if (f.k === "sumup" && val.length > 3)
      v.innerHTML = `<span style="font-weight:500">${esc(val.slice(0, -3))}</span>${esc(val.slice(-3))}`;
  });
  const type = fieldOf(active).type;
  $("#keypad").style.display = type === "pad" ? "grid" : "none";
  $("#scan").style.display = type === "scan" && !typing ? "flex" : "none";
  const kbdOn = type === "text" || (type === "scan" && typing);
  $("#kbd").style.display = kbdOn ? "flex" : "none";
  if (kbdOn) buildKbd($("#kbd"), { scanKey: type === "scan" });
  $("#copies").textContent = copies;
  $("#printBtn").disabled = !canPrint();
  $("#hdrTitle").textContent = mode === "stock" ? "Stock Label" : printKind() === "all" ? "Order Label (combined)" : "Order Label";
  clearTimeout(prevTimer);
  prevTimer = setTimeout(() => {
    const { canvas } = makeLabel(printKind(), vals);
    $("#preview").replaceChildren(canvas);
  }, 60);
}

/* ---------- typing ---------- */
const maxLen = (k) => (k === "order" ? 30 : 40);
function press(key) {
  poke();
  const f = fieldOf(active);
  let v = vals[active];
  if (key === "DEL") v = v.slice(0, -1);
  else if (key === "CASE") { caseMode = nextCase(); render(); return; }
  else if (key === "PZ") { if (!v.endsWith("PZ")) v += "PZ"; }
  else if (v.length < maxLen(active)) {
    if (active === "order" && v.endsWith("PZ")) return;
    if (key === "SPACE") key = " ";
    if (f.type !== "text") key = key.toUpperCase();
    else if (/^[a-z]$/i.test(key)) key = capsNext(v) ? key.toUpperCase() : key.toLowerCase();
    if (key === " " && (!v || v.endsWith(" "))) return;
    v += key;
  }
  vals[active] = v; render();
}
$("#keypad").onclick = (e) => { const b = e.target.closest("button"); if (b) press(b.dataset.k || b.textContent); };

// Letter case for typed names: "Abc" = capital at the start of each word (default),
// "ABC" = all capitals, "abc" = all small.
const nextCase = () => ({ Abc: "ABC", ABC: "abc", abc: "Abc" })[caseMode];
const capsNext = (v) => caseMode === "ABC" || (caseMode === "Abc" && (!v || /[\s\-\/.]$/.test(v)));

// On-screen keyboard (letters, numbers, space and a few symbols)
const ROWS = ["1234567890", "QWERTYUIOP", "ASDFGHJKL-", "ZXCVBNM/."];
function buildKbd(el, { scanKey = false, doneKey = false, current = null } = {}) {
  const typed = current !== null ? current : active && fieldOf(active).type === "text" ? vals[active] : "";
  const big = current === null && active && fieldOf(active).type !== "text" ? true : capsNext(typed);
  const shown = (c) => (/[A-Z]/.test(c) && !big ? c.toLowerCase() : c);
  el.innerHTML = ROWS.map((r) => `<div class="row">${[...r].map((c) => `<button data-c="${c}">${shown(c)}</button>`).join("")}</div>`).join("") +
    `<div class="row"><button class="wide" data-k="CASE">${caseMode}</button>` +
    `<button style="flex:4" data-k="SPACE">space</button><button class="wide del" data-k="DEL">&#9003;</button>` +
    (scanKey ? `<button class="wide" data-k="SCAN">Scan instead</button>` : "") +
    (doneKey ? `<button class="wide" data-k="DONE" style="background:var(--teal);color:#fff">Done</button>` : "") + `</div>`;
}
$("#kbd").onclick = (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.k === "SCAN") { typing = false; render(); } else press(b.dataset.k || b.dataset.c);
};
$("#typeBtn").onclick = () => { typing = true; render(); };

// Put a scanned code in the right box.
function acceptScan(code) {
  code = code.trim().replace(/[^\x20-\x7E]/g, "").slice(0, 40);
  if (!active || code.length < 2) return;
  if (mode === "stock") {
    vals.code = code;
    active = !vals.name ? "name" : !vals.location ? "location" : "code";
  } else {
    code = code.toUpperCase();
    let target = active;
    if (target === "order") target = !vals.sumup ? "sumup" : "tablet";
    vals[target] = code;
    active = ["sumup", "tablet"].find((f) => !vals[f]) || target; // next empty scan box
  }
  typing = false; poke(); render();
}

// Barcode scanner (USB or Bluetooth) "types" very fast then presses Enter.
// Slower key presses (a real keyboard) go into the box being edited.
let buf = "", bufTimer = null;
function keyInput(e, { onScan, onType, onDelete }) {
  if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); clearTimeout(bufTimer); if (buf) { const c = buf; buf = ""; onScan(c); } return; }
  if (e.key === "Backspace" && !buf) { onDelete(); return; }
  if (e.key.length === 1) {
    buf += e.key; clearTimeout(bufTimer);
    bufTimer = setTimeout(() => { const c = buf; buf = ""; onType(c); }, 150);
  }
}
document.addEventListener("keydown", (e) => {
  if ($("#typer").classList.contains("on")) return;
  if ($("#log").classList.contains("on")) {
    keyInput(e, { onScan: (c) => setSearch(c.trim()), onType: (c) => setSearch(search + c), onDelete: () => setSearch(search.slice(0, -1)) });
    return;
  }
  if (!$("#edit").classList.contains("on")) return;
  const type = fieldOf(active).type;
  keyInput(e, {
    onScan: acceptScan,
    onType: (c) => {
      if (type === "scan" && c.length >= 4) return acceptScan(c); // scanner without Enter
      if (type === "scan" && !typing) return;
      for (const ch of c) if (type !== "pad" || /[0-9]/.test(ch)) press(ch === " " ? "SPACE" : ch);
    },
    onDelete: () => press("DEL"),
  });
});

/* ---------- camera scanning ---------- */
let camStream = null, camTimer = null;
const NATIVE = isNativeApp();
const hasCamera = NATIVE || ("BarcodeDetector" in window && navigator.mediaDevices);
if (!hasCamera) $("#camBtn").style.display = "none";

// In the Android app: Google's barcode scanner (ML Kit) opens full screen.
async function nativeCameraScan() {
  const scanner = window.Capacitor.Plugins.BarcodeScanner;
  try {
    const { available } = await scanner.isGoogleBarcodeScannerModuleAvailable();
    if (!available) {
      overlay("Getting the camera scanner ready…", "This only happens once and needs internet.", false, true);
      await scanner.installGoogleBarcodeScannerModule();
      for (let i = 0; i < 60 && !(await scanner.isGoogleBarcodeScannerModuleAvailable()).available; i++) await new Promise((r) => setTimeout(r, 1000));
      hideOverlay();
    }
    const { barcodes } = await scanner.scan({ formats: ["CODE_128", "CODE_39", "CODE_93", "EAN_13", "UPC_A", "QR_CODE", "DATA_MATRIX"] });
    if (barcodes && barcodes.length) acceptScan(barcodes[0].rawValue || barcodes[0].displayValue || "");
  } catch (e) {
    if (!/cancel/i.test(e && e.message)) overlay("Camera not available", (e && e.message) || "Use the barcode scanner instead.", true);
  }
}

$("#camBtn").onclick = async () => {
  if (NATIVE) return nativeCameraScan();
  try {
    const detector = new BarcodeDetector({ formats: ["code_128", "code_39", "ean_13", "qr_code", "data_matrix", "upc_a"] });
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 } } });
    const video = $("#video");
    video.srcObject = camStream; await video.play();
    $("#camera").classList.add("on");
    const tick = async () => {
      if (!camStream) return;
      try {
        const found = await detector.detect(video);
        if (found.length) { closeCamera(); acceptScan(found[0].rawValue); return; }
      } catch (e) {}
      camTimer = setTimeout(tick, 150);
    };
    tick();
  } catch (e) { closeCamera(); overlay("Camera not available", "Allow camera access for this app, or use the barcode scanner.", true); }
};
function closeCamera() {
  clearTimeout(camTimer);
  if (camStream) camStream.getTracks().forEach((t) => t.stop());
  camStream = null; $("#camera").classList.remove("on");
}
$("#camClose").onclick = closeCamera;

/* ---------- printing ---------- */
// Connecting must start straight from a tap (Chrome shows the printer list).
async function connectFromTap() {
  if (!bluetoothSupported()) throw new Error("This browser can't use Bluetooth. Open the app in Google Chrome.");
  if (printer.connected) return;
  if (printer.known && (await printer.findKnown().catch(() => false))) return;
  await printer.choose();
}

// Explain a failed connection, with the most useful next step as a button.
function connectError(e) {
  const msg = e && e.name === "NotFoundError" ? "No printer was chosen." : (e && e.message) || String(e);
  if (e && e.code === "location")
    return overlay("Location is off", msg, true, false, { label: "Open Location settings", run: () => printer.openLocationSettings() });
  overlay("Couldn't connect", msg + " If the printer didn't appear, try showing all Bluetooth devices.", true, false,
    { label: "Show all Bluetooth devices", run: () => chooseFrom(true) });
}
async function chooseFrom(showAll) {
  overlay("Searching for printers…", "", false, true);
  try {
    if (printer.connected) await printer.disconnect();
    await printer.choose(showAll); overlay("Printer connected \u2713", printer.name, false, true); setTimeout(hideOverlay, 1200);
  } catch (e) { connectError(e); }
}

async function doPrint(kind, values, n, log = false) {
  overlay("Connecting…", "", false, true);
  try {
    if (!printer.connected) await connectFromTap();
    const { bitmap } = makeLabel(kind, values);
    await printer.print(bitmap, { copies: n, density: settings.density, onProgress: (m) => overlay(m, "", false, true) });
    if (log) addLogEntry(values);
    overlay("Printed ✓", log ? "Added to the log" : "", false, true);
    return true;
  } catch (err) {
    if (!printer.connected && (err.code === "location" || err.code === "notfound" || err.name === "NotFoundError" || /isn't the label printer/.test(err.message))) connectError(err);
    else overlay("Couldn't print", (err && err.message) || String(err), true);
    return false;
  }
}

$("#printBtn").onclick = async () => {
  const values = mode === "stock"
    ? { name: vals.name, location: vals.location, code: vals.code }
    : { order: vals.order, sumup: vals.sumup, tablet: vals.tablet };
  if (await doPrint(printKind(), values, copies, MODES[mode].logged)) setTimeout(() => { hideOverlay(); home(); }, 1200);
};
$("#clearBtn").onclick = () => { vals[active] = ""; render(); };
$("#cMinus").onclick = () => { copies = Math.max(1, copies - 1); render(); };
$("#cPlus").onclick = () => { copies = Math.min(20, copies + 1); render(); };

/* ---------- printer status ---------- */
function drawPrinter() {
  const ok = printer.connected;
  $("#pill").textContent = ok ? "Printer connected" : "Connect printer";
  $("#pill").className = "pill " + (ok ? "ok" : "bad");
  const st = $("#pStatus");
  st.textContent = ok ? `✓ Connected to ${printer.name}` : "✗ Not connected";
  st.className = "status " + (ok ? "ok" : "bad");
  $("#connectBtn").textContent = ok ? "Choose a different printer" : "Connect printer";
  $("#disconnectBtn").style.display = ok ? "" : "none";
}
printer.onchange = drawPrinter;
$("#pill").onclick = async () => {
  if (printer.connected) { openSettings(); return; }
  overlay("Connecting…", "", false, true);
  try { await connectFromTap(); hideOverlay(); }
  catch (e) { connectError(e); }
};
$("#connectBtn").onclick = () => chooseFrom(false);
$("#allDevicesBtn").onclick = () => chooseFrom(true);
$("#disconnectBtn").onclick = () => printer.disconnect();
$("#testBtn").onclick = async () => {
  if (await doPrint("all", { order: "12345PZ", sumup: "TEST123", tablet: "TEST456" }, 1)) setTimeout(hideOverlay, 1200);
};
// Reconnect quietly to the printer used last time.
printer.findKnown().catch(() => {}).finally(drawPrinter);
// In the app, also reconnect when it comes back to the front.
document.addEventListener("visibilitychange", () => {
  if (NATIVE && document.visibilityState === "visible" && !printer.connected && printer.known) printer.findKnown().catch(() => {});
});

/* ---------- overlay ---------- */
function overlay(msg, sub, isErr, noBtn, alt) {
  $("#ovMsg").textContent = msg; $("#ovSub").textContent = sub || "";
  $("#ovBox").classList.toggle("err", !!isErr);
  $("#ovBtn").style.display = noBtn ? "none" : ""; $("#overlay").classList.add("on");
  $("#ovBtn").textContent = alt ? "Cancel" : "OK";
  $("#ovAlt").style.display = alt ? "" : "none";
  if (alt) { $("#ovAlt").textContent = alt.label; $("#ovAlt").onclick = () => { hideOverlay(); alt.run(); }; }
}
function hideOverlay() { $("#overlay").classList.remove("on"); }
$("#ovBtn").onclick = hideOverlay;

/* ---------- settings screen ---------- */
const PRESETS = [[40, 30], [40, 40], [40, 60], [50, 30], [50, 50]];
function openSettings() { $("#hdrTitle").textContent = "Settings"; show("settings"); drawSettings(); drawPrinter(); }
function drawSettings() {
  $("#wmm").textContent = settings.widthMm + " mm";
  $("#hmm").textContent = settings.heightMm + " mm";
  $("#dens").textContent = settings.density;
  $("#rotVal").textContent = settings.rotate ? "ON" : "OFF";
  $("#sizeChips").innerHTML = PRESETS.map(([w, h]) =>
    `<button class="chip ${w == settings.widthMm && h == settings.heightMm ? "on" : ""}" data-w="${w}" data-h="${h}">${w} × ${h} mm</button>`).join("");
  $("#sizeChips").querySelectorAll("button").forEach((b) => (b.onclick = () => saveSettings({ widthMm: +b.dataset.w, heightMm: +b.dataset.h })));
}
document.querySelectorAll("[data-d]").forEach((b) => (b.onclick = () => {
  const [k, d] = b.dataset.d.split(":"); saveSettings({ [k]: +settings[k] + +d });
}));
$("#rotBtn").onclick = () => saveSettings({ rotate: !settings.rotate });
$("#reloadBtn").onclick = () => location.reload();

document.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => openMode(b.dataset.go)));
$("#goStock").onclick = () => overlay("Coming soon", "Stock control is on its way.");
$("#goLog").onclick = openLog;

/* ---------- log screen ---------- */
let search = "";
function openLog() { search = ""; $("#hdrTitle").textContent = "Log"; show("log"); drawLog(); poke(); }
function setSearch(v) { search = v.slice(0, 40); drawLog(); poke(); }
function drawLog() {
  const q = search.trim().toLowerCase();
  const all = loadLog().slice().reverse(); // newest first
  const rows = all.filter((e) => !q || [e.order, e.sumup, e.tablet].some((v) => (v || "").toLowerCase().includes(q)));
  $("#searchText").innerHTML = search ? `<b>${esc(search)}</b>` : '<span class="ph">Scan or tap to search (order, reader or tablet)</span>';
  $("#clearSearch").style.display = search ? "" : "none";
  $("#logCount").textContent = q ? `${rows.length} of ${all.length} labels` : `${all.length} label${all.length === 1 ? "" : "s"} printed`;
  $("#logBody").innerHTML = rows.map((e) => {
    const r = logRow(e);
    return `<tr class="row" data-ts="${esc(e.ts)}"><td>${esc(r.order || "-")}</td><td>${r.date}</td><td>${esc(r.sumup || "-")}</td>` +
      `<td>${esc(r.tablet || "-")}</td><td class="${r.expired ? "exp" : ""}">${r.warranty}${r.expired ? " (expired)" : ""}</td></tr>`;
  }).join("");
  $("#logEmpty").textContent = rows.length ? "" : all.length ? "Nothing matches that search." : "No labels printed yet. Order labels appear here when you print them.";
  $("#logBody").querySelectorAll("tr").forEach((tr) => (tr.onclick = () => {
    const e = all.find((x) => x.ts === tr.dataset.ts), r = logRow(e);
    overlay(`Order ${r.order || "(none)"}`, `Printed ${r.date} · Reader ${r.sumup || "-"} · Tablet ${r.tablet || "-"} · Warranty until ${r.warranty}`, false, false,
      { label: "Delete this entry", run: () => { deleteLogEntry(e.ts); drawLog(); } });
  }));
}
$("#clearSearch").onclick = () => setSearch("");
$("#exportBtn").onclick = async () => {
  if (!loadLog().length) { overlay("Nothing to export yet", "Print an order label first."); return; }
  try { await exportCsv(); }
  catch (e) { if (!/cancel/i.test(e && e.message)) overlay("Couldn't export", (e && e.message) || String(e), true); }
};
// Search typing pop-up
$("#searchBtn").onclick = () => { drawTyper(); $("#typer").classList.add("on"); };
function drawTyper() {
  $("#typerShown").textContent = search || " ";
  buildKbd($("#typerKbd"), { doneKey: true, current: search });
}
$("#typerKbd").onclick = (e) => {
  const b = e.target.closest("button"); if (!b) return;
  const k = b.dataset.k, c = b.dataset.c;
  if (k === "DONE") { $("#typer").classList.remove("on"); return; }
  if (k === "CASE") caseMode = nextCase();
  else if (k === "DEL") setSearch(search.slice(0, -1));
  else if (k === "SPACE") setSearch(search + " ");
  else setSearch(search + (capsNext(search) ? c : c.toLowerCase()));
  drawTyper();
};
$("#typer").onclick = (e) => { if (e.target.id === "typer") $("#typer").classList.remove("on"); };
$("#backBtn").onclick = home;
$("#setBtn").onclick = openSettings;

/* ---------- tablet niceties ---------- */
// Back to the start screen after 3 minutes of no use
function poke() { clearTimeout(idleTimer); idleTimer = setTimeout(() => { hideOverlay(); closeCamera(); home(); }, 180000); }
document.addEventListener("pointerdown", poke);
document.addEventListener("contextmenu", (e) => e.preventDefault());
// Keep the screen on while the app is open
async function keepAwake() {
  try {
    if (NATIVE && window.Capacitor.Plugins.KeepAwake) await window.Capacitor.Plugins.KeepAwake.keepAwake();
    else if ("wakeLock" in navigator) await navigator.wakeLock.request("screen");
  } catch (e) {}
}
keepAwake();
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") keepAwake(); });
// Work offline once loaded
if (!NATIVE && "serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

// Load the label font before drawing any label
const face = new FontFace(LABEL_FONT, "url(fonts/AtkinsonHyperlegible-Bold.ttf)");
face.load().then((f) => document.fonts.add(f)).catch(() => {}).finally(() => { if (active) render(); });

// For automated tests
window.__payaz = { renderLabel, printer, vals, loadLog };
