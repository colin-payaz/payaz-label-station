import { renderLabel, LABEL_FONT } from "./labels.js";
import { Printer, bluetoothSupported, isNativeApp } from "./printer.js";

const $ = (s) => document.querySelector(s);
const TITLES = { order: "Payaz Order", sumup: "SumUp Card Reader", tablet: "Tablet", all: "Combined label" };
const FIELD_LABEL = { order: "Payaz Order Number:", sumup: "SumUp Card Reader:", tablet: "Tablet Serial Number:" };
const PLACEHOLDER = { order: "Type the number", sumup: "Scan the reader", tablet: "Scan the tablet" };
const FIELDS = ["order", "sumup", "tablet"];
const vals = { order: "", sumup: "", tablet: "" };
let active = null, copies = 1, typing = false, idleTimer = null;
const printer = new Printer();

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
  FIELDS.forEach((k) => (vals[k] = ""));
  copies = 1;
  $("#hdrTitle").textContent = "Label Station";
  show("home");
}
// One box filled -> that label on its own; two or three -> one combined label.
function printKind() {
  const filled = FIELDS.filter((f) => vals[f]);
  return filled.length > 1 ? "all" : filled[0] || active;
}
function openKind(k) {
  copies = 1; typing = false;
  $("#fields").innerHTML = FIELDS.map((f) =>
    `<button class="field" data-f="${f}"><div class="lbl">${FIELD_LABEL[f]}</div><div class="val"></div></button>`).join("");
  $("#fields").querySelectorAll(".field").forEach((b) => (b.onclick = () => setActive(b.dataset.f)));
  $("#fields").style.cssText = "display:flex;flex-direction:column;gap:8px";
  setActive(k === "all" ? "order" : k);
  show("edit"); poke();
}
function setActive(f) { active = f; typing = false; render(); }

/* ---------- drawing ---------- */
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function makeLabel(kind, values) {
  return renderLabel(kind, values, { widthMm: settings.widthMm, heightMm: settings.heightMm, rotate: settings.rotate });
}
let prevTimer;
function render() {
  document.querySelectorAll(".field").forEach((b) => {
    const f = b.dataset.f, v = b.querySelector(".val");
    b.classList.toggle("active", f === active);
    v.textContent = vals[f] || PLACEHOLDER[f];
    v.classList.toggle("empty", !vals[f]);
    if (f === "sumup" && vals[f].length > 3)
      v.innerHTML = `<span style="font-weight:500">${esc(vals[f].slice(0, -3))}</span>${esc(vals[f].slice(-3))}`;
  });
  const isOrder = active === "order";
  $("#keypad").style.display = isOrder ? "grid" : "none";
  $("#scan").style.display = !isOrder && !typing ? "flex" : "none";
  $("#kbd").style.display = !isOrder && typing ? "flex" : "none";
  $("#copies").textContent = copies;
  $("#printBtn").disabled = !FIELDS.some((f) => vals[f]);
  $("#hdrTitle").textContent = TITLES[printKind()];
  clearTimeout(prevTimer);
  prevTimer = setTimeout(() => {
    const { canvas } = makeLabel(printKind(), vals);
    $("#preview").replaceChildren(canvas);
  }, 60);
}

/* ---------- input ---------- */
function press(key) {
  poke();
  let v = vals[active];
  if (key === "DEL") v = v.slice(0, -1);
  else if (key === "PZ") { if (!v.endsWith("PZ")) v += "PZ"; }
  else if (v.length < 30) { if (active === "order" && v.endsWith("PZ")) return; v += key; }
  vals[active] = v; render();
}
$("#keypad").onclick = (e) => { const b = e.target.closest("button"); if (b) press(b.dataset.k || b.textContent); };

const ROWS = ["1234567890", "QWERTYUIOP", "ASDFGHJKL-", "ZXCVBNM"];
$("#kbd").innerHTML = ROWS.map((r, i) => `<div class="row">${[...r].map((c) => `<button>${c}</button>`).join("")}${
  i === 3 ? '<button class="wide del" data-k="DEL">&#9003;</button><button class="wide" data-k="SCAN">Scan instead</button>' : ""}</div>`).join("");
$("#kbd").onclick = (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.k === "SCAN") { typing = false; render(); } else press(b.dataset.k || b.textContent);
};
$("#typeBtn").onclick = () => { typing = true; render(); };

// Put a scanned code in the right box, then move on to the next empty scan box.
function acceptScan(code) {
  code = code.trim().toUpperCase().replace(/[^\x20-\x7E]/g, "").slice(0, 40);
  if (!active || code.length < 2) return;
  let target = active;
  if (target === "order") target = !vals.sumup ? "sumup" : "tablet";
  vals[target] = code;
  active = ["sumup", "tablet"].find((f) => !vals[f]) || target;
  typing = false; poke(); render();
}

// Barcode scanner (USB or Bluetooth): it "types" very fast then presses Enter.
let buf = "", bufTimer = null;
function commitScan() { clearTimeout(bufTimer); const code = buf; buf = ""; acceptScan(code); }
document.addEventListener("keydown", (e) => {
  if (!$("#edit").classList.contains("on")) return;
  if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); if (buf) commitScan(); return; }
  if (active === "order" && buf === "") {
    if (/^[0-9]$/.test(e.key)) { press(e.key); return; }
    if (e.key === "Backspace") { press("DEL"); return; }
  }
  if (e.key.length === 1) {
    buf += e.key; clearTimeout(bufTimer);
    bufTimer = setTimeout(() => { if (buf.length >= 4) commitScan(); else buf = ""; }, 150);
  }
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
  if (printer.known && (await printer.findKnown())) return;
  await printer.choose();
}

async function doPrint(kind, values, n) {
  overlay("Connecting…", "", false, true);
  try {
    if (!printer.connected) await connectFromTap();
    const { bitmap } = makeLabel(kind, values);
    await printer.print(bitmap, { copies: n, density: settings.density, onProgress: (m) => overlay(m, "", false, true) });
    overlay("Printed ✓", "", false, true);
    return true;
  } catch (err) {
    const msg = err && err.name === "NotFoundError" ? "No printer was chosen." : (err.message || String(err));
    overlay("Couldn't print", msg, true);
    return false;
  }
}

$("#printBtn").onclick = async () => {
  if (await doPrint(printKind(), { ...vals }, copies)) setTimeout(() => { hideOverlay(); home(); }, 1200);
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
  catch (e) { overlay("Couldn't connect", e.name === "NotFoundError" ? "No printer was chosen." : e.message, true); }
};
$("#connectBtn").onclick = async () => {
  overlay("Connecting…", "", false, true);
  try {
    if (printer.connected) await printer.disconnect();
    await printer.choose(); hideOverlay();
  } catch (e) { overlay("Couldn't connect", e.name === "NotFoundError" ? "No printer was chosen." : e.message, true); }
};
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
function overlay(msg, sub, isErr, noBtn) {
  $("#ovMsg").textContent = msg; $("#ovSub").textContent = sub || "";
  $("#ovBox").classList.toggle("err", !!isErr);
  $("#ovBtn").style.display = noBtn ? "none" : ""; $("#overlay").classList.add("on");
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

document.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => openKind(b.dataset.go)));
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
window.__payaz = { renderLabel, printer, vals };
