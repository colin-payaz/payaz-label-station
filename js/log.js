// The log of Order Labels printed, kept on this tablet.
// Each entry: { ts: ISO time, order, sumup, tablet }.
// Also written as a CSV backup to Documents/PayazLabels/ in the Android app.
import { formatDate } from "./labels.js";
import { isNativeApp } from "./printer.js";

const KEY = "payaz-log";
const BACKUP_DIR = "PayazLabels";
const BACKUP_FILE = `${BACKUP_DIR}/payaz-label-log.csv`;

export function loadLog() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return []; }
}

function saveLog(entries) {
  try { localStorage.setItem(KEY, JSON.stringify(entries)); } catch (e) {}
  writeBackup(entries);
}

export function addLogEntry({ order = "", sumup = "", tablet = "" }, when = new Date()) {
  const entries = loadLog();
  entries.push({ ts: when.toISOString(), order, sumup, tablet });
  saveLog(entries);
  return entries;
}

export function deleteLogEntry(ts) {
  const entries = loadLog().filter((e) => e.ts !== ts);
  saveLog(entries);
  return entries;
}

/** Warranty runs 12 months from the day the label was printed. */
export function warrantyDate(ts) {
  const d = new Date(ts);
  const w = new Date(d.getFullYear() + 1, d.getMonth(), d.getDate());
  if (w.getDate() !== d.getDate()) w.setDate(0); // 29 Feb -> 28 Feb next year
  return w;
}

export const logRow = (e) => ({
  order: e.order, date: formatDate(new Date(e.ts)), sumup: e.sumup, tablet: e.tablet,
  warranty: formatDate(warrantyDate(e.ts)), expired: warrantyDate(e.ts) < new Date(new Date().toDateString()),
});

const HEADERS = ["Payaz Order Number", "Date", "Card Reader", "Tablet", "Warranty Expires"];
const cell = (v) => {
  v = String(v ?? "");
  // Quote everything; a leading tab stops spreadsheets turning serials like 0123 into numbers
  const safe = /^[0-9]{6,}$/.test(v) || /^0[0-9]+$/.test(v) ? `\t${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
};

export function toCsv(entries = loadLog()) {
  const lines = [HEADERS.map(cell).join(",")];
  for (const e of entries) {
    const r = logRow(e);
    lines.push([r.order, r.date, r.sumup, r.tablet, r.warranty].map(cell).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n"; // BOM so Excel reads it as UTF-8
}

const plugins = () => window.Capacitor.Plugins;

async function writeBackup(entries) {
  if (!isNativeApp()) return;
  try {
    await plugins().Filesystem.writeFile({
      path: BACKUP_FILE, data: toCsv(entries), directory: "DOCUMENTS", encoding: "utf8", recursive: true,
    });
  } catch (e) { /* backup is best effort; the log is still kept in the app */ }
}

/** Share (Android app) or download (browser) the log as a CSV file. */
export async function exportCsv() {
  const csv = toCsv();
  const name = `payaz-label-log-${formatDate().split("/").reverse().join("-")}.csv`;
  if (isNativeApp()) {
    const { uri } = await plugins().Filesystem.writeFile({ path: name, data: csv, directory: "CACHE", encoding: "utf8" });
    await plugins().Share.share({ title: "Payaz label log", text: "Payaz label log (CSV)", files: [uri], dialogTitle: "Send the label log" });
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
