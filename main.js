'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Daten = require('./src/daten.js');

const DATA_FILE = 'rapid-buchhaltung-daten.json';
const BACKUP_DIR = 'Sicherungen';
const KEEP_BACKUPS = 60;
// Stand des Datenformats. Eine ältere App darf eine Datei mit höherem Stand nicht überschreiben,
// weil sie neuere Teile nicht kennt und beim Speichern entfernen würde.
const SCHEMA = 1;
const ZU_NEU = 'Deine Daten stammen von einer neueren Version der App. Bitte installiere auf diesem Rechner die neuste Version; bis dahin wird hier nichts gespeichert.';

let win = null;

// Datumsfelder und Dialoge in Schweizer Schreibweise, unabhängig von der Windows-Sprache.
app.commandLine.appendSwitch('lang', 'de-CH');

/* ---------- Speicherort ---------- */

function configPath() { return path.join(app.getPath('userData'), 'config.json'); }

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return {}; }
}

function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
}

function dataDir() {
  if (process.env.RAPID_DATA_DIR) return process.env.RAPID_DATA_DIR;
  const cfg = readConfig();
  return cfg.dataDir || path.join(app.getPath('documents'), 'Buchhaltung Rapid Openair');
}

function dataPath() { return path.join(dataDir(), DATA_FILE); }

/* ---------- Lesen und Schreiben ---------- */

// Stand der Datendatei, wie ihn diese App zuletzt gelesen oder geschrieben hat.
// Weicht die Datei davon ab, hat ein anderer Rechner (über Dropbox o. ä.) geschrieben.
let bekannt = null;

function dateiStand(file) {
  try { const st = fs.statSync(file); return `${st.mtimeMs}:${st.size}`; } catch { return null; }
}

function stamp(mitZeit) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const tag = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return mitZeit ? `${tag}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` : tag;
}

function rechnerName() {
  return os.hostname().replace(/[^A-Za-z0-9-]+/g, '-').slice(0, 24) || 'rechner';
}

/** Konfliktkopien, wie Dropbox sie anlegt, wenn zwei Rechner gleichzeitig offline geändert haben. */
function konfliktDateien(dir) {
  const basis = DATA_FILE.replace(/\.json$/, '');
  try {
    return fs.readdirSync(dir).filter((f) => f !== DATA_FILE && f.startsWith(basis) && f.endsWith('.json') && !f.includes('-beschaedigt-'));
  } catch { return []; }
}

const warte = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Ersetzt die Datendatei durch die fertig geschriebene Zwischendatei.
 * Dropbox oder ein Virenscanner halten die Datei manchmal kurz gesperrt (EPERM/EBUSY/EACCES):
 * dann mehrmals versuchen und zuletzt direkt in die Datei schreiben.
 */
function ersetzeDatei(tmp, file, data) {
  let fehler = null;
  for (let i = 0; i < 8; i++) {
    try { fs.renameSync(tmp, file); return; }
    catch (e) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      fehler = e; warte(60 + i * 60);
    }
  }
  try { fs.writeFileSync(file, JSON.stringify(data, null, 1), 'utf8'); }
  catch (_) { throw fehler; }
  try { fs.unlinkSync(tmp); } catch (_) { /* bleibt liegen, stört nicht */ }
}

function schreibe(file, data) {
  data.schema = Math.max(SCHEMA, data.schema || 0);
  data.appVersion = app.getVersion();
  const tmp = `${file}.${rechnerName()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8');
  ersetzeDatei(tmp, file, data);
  bekannt = dateiStand(file);
}

function loadData() {
  const file = dataPath();
  const dir = path.dirname(file);
  let data = null;
  if (fs.existsSync(file)) {
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      // Beschädigte Datei nie überschreiben: zur Seite legen und melden.
      const kaputt = file.replace(/\.json$/, `-beschaedigt-${stamp(true)}.json`);
      try { fs.copyFileSync(file, kaputt); } catch { /* egal */ }
      return { data: null, path: file, error: `Die Datendatei konnte nicht gelesen werden (${err.message}). Eine Kopie liegt unter ${kaputt}.` };
    }
  }
  bekannt = dateiStand(file);
  if (data && (data.schema || 0) > SCHEMA) return { data, path: file, veraltet: ZU_NEU };

  // Konfliktkopien einarbeiten und danach zu den Sicherungen legen.
  let eingearbeitet = 0;
  for (const name of konfliktDateien(dir)) {
    const quelle = path.join(dir, name);
    try {
      data = Daten.mergeData(data, JSON.parse(fs.readFileSync(quelle, 'utf8')));
      const ziel = path.join(dir, BACKUP_DIR);
      fs.mkdirSync(ziel, { recursive: true });
      fs.renameSync(quelle, path.join(ziel, `konflikt-${stamp(true)}-${name}`));
      eingearbeitet++;
    } catch { /* unlesbare Kopie liegen lassen */ }
  }
  if (eingearbeitet && data) schreibe(file, data);
  return { data, path: file, eingearbeitet };
}

/** Erste Speicherung des Tages auf diesem Rechner: den bisherigen Stand als Sicherung ablegen. */
function backup(file, mitZeit) {
  if (!fs.existsSync(file)) return;
  const dir = path.join(path.dirname(file), BACKUP_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const ziel = path.join(dir, `buchhaltung-${stamp(mitZeit)}-${rechnerName()}.json`);
  if (!mitZeit && fs.existsSync(ziel)) return;
  fs.copyFileSync(file, ziel);
  const alle = fs.readdirSync(dir).filter((f) => /^buchhaltung-.*\.json$/.test(f)).sort();
  while (alle.length > KEEP_BACKUPS) fs.unlinkSync(path.join(dir, alle.shift()));
}

function saveData(data, opts) {
  const file = dataPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Schreibt inzwischen eine neuere App-Version in diese Datei, nichts überschreiben.
  try { if (fs.existsSync(file) && (JSON.parse(fs.readFileSync(file, 'utf8')).schema || 0) > SCHEMA) return { ok: false, error: ZU_NEU }; } catch { /* unlesbar: wie bisher weiter */ }
  backup(file, opts && opts.sicherungErzwingen);
  // Hat inzwischen ein anderer Rechner geschrieben, dessen Änderungen nicht überschreiben, sondern zusammenführen.
  let zusammengefuehrt = null;
  if (!(opts && opts.ersetzen) && bekannt && dateiStand(file) && dateiStand(file) !== bekannt) {
    try {
      zusammengefuehrt = Daten.mergeData(data, JSON.parse(fs.readFileSync(file, 'utf8')));
      data = zusammengefuehrt;
    } catch { /* Datei wird gerade geschrieben: unseren Stand behalten, der Wächter meldet die Änderung erneut */ }
  }
  schreibe(file, data);
  return { ok: true, path: file, data: zusammengefuehrt };
}

/* ---------- Änderungen von anderen Rechnern bemerken ---------- */

let waechter = null, waechterTimer = null, abfrage = null;

function pruefeAenderung() {
  const file = dataPath();
  const stand = dateiStand(file);
  const fremd = konfliktDateien(path.dirname(file)).length > 0;
  if ((stand && stand !== bekannt) || fremd) {
    if (win && !win.isDestroyed()) win.webContents.send('data:changed');
  }
}

function starteWaechter() {
  if (waechter) { try { waechter.close(); } catch { /* egal */ } waechter = null; }
  clearInterval(abfrage);
  const dir = dataDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    waechter = fs.watch(dir, () => { clearTimeout(waechterTimer); waechterTimer = setTimeout(pruefeAenderung, 600); });
    waechter.on('error', () => { /* die Abfrage unten fängt es auf */ });
  } catch { /* kein Wächter möglich: die Abfrage unten reicht */ }
  // Sicherheitsnetz, falls der Ordner keine Änderungsmeldungen liefert.
  abfrage = setInterval(pruefeAenderung, 15000);
}

/* ---------- Berichte als PDF ---------- */

/** Lädt das HTML in ein unsichtbares Fenster und druckt es als A4-PDF. */
async function renderPdf(html, fuss, roh) {
  const tmp = path.join(app.getPath('temp'), `rapid-buchhaltung-${Date.now()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, javascript: false } });
  try {
    await w.loadFile(tmp);
    if (roh) return await w.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
    if (fuss == null) return await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    // Mehrseitige Berichte: Ränder in Zoll, unten Datum und Seitenzahl wie im Banana-Ausdruck.
    const sicher = String(fuss).replace(/[<>&]/g, '');
    return await w.webContents.printToPDF({
      pageSize: 'A4', printBackground: true, displayHeaderFooter: true,
      margins: { top: 0.55, bottom: 0.7, left: 0.72, right: 0.6 },
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font-family:Arial,sans-serif;font-size:8px;padding:0 44px;display:flex;justify-content:space-between;"><span></span><span>${sicher}</span><span>-<span class="pageNumber"></span>-</span></div>`,
    });
  } finally {
    w.destroy();
    try { fs.unlinkSync(tmp); } catch { /* egal */ }
  }
}

/* ---------- Fenster ---------- */

/* ---------- Hinweis auf neuere Version (nur nachfragen, nichts installieren) ---------- */

const RELEASES = 'https://api.github.com/repos/fcanetg-prog/rapid-buchhaltung/releases/latest';

function versionTeile(v) {
  const m = String(v || '').match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? m.slice(1).map(Number) : null;
}

function istNeuer(a, b) {
  const x = versionTeile(a), y = versionTeile(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

async function neueVersion() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await net.fetch(RELEASES, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Buchhaltung-Rapid-Openair' }, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const r = await res.json();
    const tp = versionTeile(r.tag_name);
    if (!tp) return null;
    const neu = tp.join('.');
    if (!istNeuer(neu, app.getVersion())) return null;
    const url = /^https:\/\/github\.com\//.test(r.html_url || '') ? r.html_url : 'https://github.com/fcanetg-prog/rapid-buchhaltung/releases/latest';
    return { version: neu, installiert: app.getVersion(), url };
  } catch (_) {
    return null; /* offline oder GitHub nicht erreichbar: still nichts anzeigen */
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 520,
    minHeight: 480,
    backgroundColor: '#f6f8f8',
    title: 'Buchhaltung Rapid Openair',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // Vergrössern und verkleinern wie im Browser: Ctrl und +, − oder 0, oder Ctrl und Mausrad. Die Stufe bleibt gespeichert.
  const zoomSetzen = (stufe) => {
    const z = Math.max(-3, Math.min(5, Math.round(stufe * 2) / 2));
    win.webContents.setZoomLevel(z);
    const cfg = readConfig(); if (cfg.zoom !== z) { cfg.zoom = z; try { writeConfig(cfg); } catch { /* egal */ } }
  };
  win.webContents.on('did-finish-load', () => {
    const z = readConfig().zoom; if (typeof z === 'number') win.webContents.setZoomLevel(z);
    // Zoomen mit zwei Fingern auf dem Touchpad (wie in Chrome); ist in Electron sonst abgeschaltet.
    win.webContents.setVisualZoomLevelLimits(1, 4).catch(() => { /* nicht verfügbar */ });
  });
  win.webContents.on('zoom-changed', (_e, richtung) => zoomSetzen(win.webContents.getZoomLevel() + (richtung === 'in' ? 0.5 : -0.5)));
  win.webContents.on('before-input-event', (ev, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    const k = input.key;
    if (k === '+' || k === '=' || input.code === 'NumpadAdd') { zoomSetzen(win.webContents.getZoomLevel() + 0.5); ev.preventDefault(); }
    else if (k === '-' || k === '_' || input.code === 'NumpadSubtract') { zoomSetzen(win.webContents.getZoomLevel() - 0.5); ev.preventDefault(); }
    else if (k === '0' || input.code === 'Numpad0') { zoomSetzen(0); ev.preventDefault(); }
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.webContents.on('will-navigate', (e) => e.preventDefault());   // hineingezogene Dateien nie im Fenster öffnen
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => { win = null; });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);

    ipcMain.handle('data:load', () => loadData());
    ipcMain.handle('data:save', (_e, data, opts) => {
      try { return saveData(data, opts); } catch (err) { return { ok: false, error: err.message }; }
    });
    ipcMain.handle('data:import', async () => {
      const r = await dialog.showOpenDialog(win, {
        title: 'Daten importieren',
        filters: [{ name: 'Buchhaltungs-Daten', extensions: ['json'] }],
        properties: ['openFile'],
      });
      if (r.canceled || !r.filePaths[0]) return { canceled: true };
      try {
        return { data: JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')), path: r.filePaths[0] };
      } catch (err) {
        return { error: `Die Datei konnte nicht gelesen werden: ${err.message}` };
      }
    });
    ipcMain.handle('data:export', async (_e, data) => {
      const r = await dialog.showSaveDialog(win, {
        title: 'Daten exportieren',
        defaultPath: path.join(app.getPath('documents'), `Buchhaltung-Rapid-Openair-Export-${stamp()}.json`),
        filters: [{ name: 'Buchhaltungs-Daten', extensions: ['json'] }],
      });
      if (r.canceled || !r.filePath) return { canceled: true };
      fs.writeFileSync(r.filePath, JSON.stringify(data, null, 1), 'utf8');
      return { path: r.filePath };
    });
    ipcMain.handle('data:openFolder', () => {
      fs.mkdirSync(dataDir(), { recursive: true });
      return shell.openPath(dataDir());
    });
    ipcMain.handle('data:chooseFolder', async () => {
      const r = await dialog.showOpenDialog(win, {
        title: 'Speicherort für die Daten wählen',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (r.canceled || !r.filePaths[0]) return { canceled: true };
      const neu = r.filePaths[0];
      const alt = dataPath();
      const ziel = path.join(neu, DATA_FILE);
      const vorhanden = fs.existsSync(ziel);
      // Liegt am neuen Ort noch nichts, den aktuellen Stand mitnehmen.
      if (!vorhanden && fs.existsSync(alt)) fs.copyFileSync(alt, ziel);
      const cfg = readConfig();
      cfg.dataDir = neu;
      writeConfig(cfg);
      bekannt = null;
      starteWaechter();
      return { path: ziel, vorhanden };
    });
    // Rückfragen als eigenes Dialogfenster: Nach dem eingebauten confirm() nimmt Windows in Textfeldern sonst keine Tastatureingaben mehr an.
    ipcMain.on('dlg:confirm', (ev, text) => {
      ev.returnValue = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['OK', 'Abbrechen'], defaultId: 0, cancelId: 1, noLink: true, title: 'Buchhaltung Rapid Openair', message: String(text) }) === 0;
    });
    ipcMain.handle('app:update', () => neueVersion());
    ipcMain.handle('app:info', () => ({ version: app.getVersion(), dataPath: dataPath() }));
    ipcMain.handle('file:openText', async (_e, titel, endungen) => {
      const r = await dialog.showOpenDialog(win, { title: String(titel || 'Datei öffnen'), filters: [{ name: 'Export', extensions: Array.isArray(endungen) && endungen.length ? endungen.map(String) : ['csv'] }], properties: ['openFile'] });
      if (r.canceled || !r.filePaths[0]) return { canceled: true };
      try {
        const roh = fs.readFileSync(r.filePaths[0]);
        let text;
        // Bankexporte sind je nach Alter UTF-8 oder Windows-1252.
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(roh); } catch { text = new TextDecoder('windows-1252').decode(roh); }
        return { text, name: path.basename(r.filePaths[0]) };
      } catch (err) {
        return { fehler: `Die Datei konnte nicht gelesen werden: ${err.message}` };
      }
    });
    ipcMain.handle('pdf:save', async (_e, html, opts) => {
      try {
        const ordner = path.basename(String((opts && opts.ordner) || 'Berichte'));
        const name = path.basename(String((opts && opts.name) || 'Bericht.pdf')).replace(/[\\/:*?"<>|]/g, '_');
        // «roh»: Seitenformat und Ränder kommen aus dem Dokument selbst.
        const pdf = await renderPdf(html, opts && opts.roh ? undefined : (opts && opts.fuss) || '', opts && opts.roh);
        const dir = path.join(dataDir(), ordner);
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, name);
        fs.writeFileSync(file, pdf);
        if (!process.env.RAPID_KEIN_OEFFNEN) shell.openPath(file);
        return { path: file };
      } catch (err) {
        return { fehler: `Das PDF konnte nicht erstellt werden: ${err.message}` };
      }
    });
    createWindow();
    starteWaechter();
  });

  app.on('window-all-closed', () => app.quit());
}
