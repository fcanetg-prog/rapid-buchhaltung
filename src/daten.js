/* Datenmodell der Buchhaltung: leerer Stand, Beträge lesen, Stände zweier Rechner zusammenführen.
   Läuft im Fenster (window.Daten) und in Node (main.js, Tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Daten = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // gjBeginn: Beginn des Geschäftsjahres (MM-TT). Das Geschäftsjahr heisst nach dem Kalenderjahr, in dem es endet:
  // Beginn 12-01 → Geschäftsjahr 2026 = 01.12.2025 bis 30.11.2026. Mit 01-01 gilt das Kalenderjahr.
  const DEFAULTS = { firma: 'Rapid Openair', gjBeginn: '12-01' };

  const round2 = (x) => Math.round(x * 100 + 1e-6) / 100;
  const isNum = (x) => typeof x === 'number' && isFinite(x);

  /* ---------- Geschäftsjahr ---------- */

  const gjBeginn = (s) => (/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test((s && s.gjBeginn) || '') ? s.gjBeginn : '01-01');
  const isoPlus = (iso, tage) => new Date(Date.parse(iso + 'T00:00:00Z') + tage * 86400000).toISOString().slice(0, 10);
  /** Erster Tag des Geschäftsjahres j. */
  function gjVon(s, j) { const b = gjBeginn(s); return b === '01-01' ? `${j}-01-01` : `${j - 1}-${b}`; }
  /** Letzter Tag des Geschäftsjahres j. */
  function gjBis(s, j) { return isoPlus(gjVon(s, j + 1), -1); }
  /** Geschäftsjahr, in das ein Datum fällt. */
  function gjJahr(s, datum) { const y = +String(datum).slice(0, 4), b = gjBeginn(s); return b !== '01-01' && String(datum).slice(5, 10) >= b ? y + 1 : y; }
  const gjIn = (s, j, datum) => datum >= gjVon(s, j) && datum <= gjBis(s, j);
  const dm = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
  /** «01.12.2025 bis 30.11.2026» */
  const gjText = (s, j) => `${dm(gjVon(s, j))} bis ${dm(gjBis(s, j))}`;

  function emptyData() {
    return { version: 1, settings: Object.assign({}, DEFAULTS), buchungen: [], kontenplaene: {}, bankZeilen: {} };
  }

  /** Geldbetrag aus «3'820.00», «3’820», «3820,5». Erlaubt auch einfache Summen wie «3390+430». */
  function parseAmount(txt) {
    if (txt == null) return null;
    let t = String(txt).trim().replace(/[’'`\s]/g, '').replace(/chf/ig, '');
    if (!t) return null;
    if (/^[\d.,]+([+\-][\d.,]+)+$/.test(t)) {
      let sum = 0;
      for (const part of t.match(/[+\-]?[\d.,]+/g)) {
        const v = parseFloat(part.replace(',', '.'));
        if (!isFinite(v)) return null;
        sum += v;
      }
      return sum;
    }
    if (!/^-?[\d]+([.,]\d+)?$/.test(t)) return null;
    return parseFloat(t.replace(',', '.'));
  }

  /** Einstellungen: Grundsätzlich gilt die jüngere Fassung; Merker einmaliger Umstellungen werden zusammengeführt. */
  function settingsZusammen(neu, alt) {
    const s = Object.assign({}, neu || alt || {});
    if (!alt || !neu) return s;
    if (alt.einmalig || neu.einmalig) s.einmalig = Object.assign({}, alt.einmalig || {}, neu.einmalig || {});
    return s;
  }

  /**
   * Führt zwei Stände zusammen (z. B. von zwei Rechnern über Dropbox). Buchungen einzeln (jüngere Änderung gewinnt),
   * Kontenplan und Bankbewegungen pro Jahr als Ganzes. Gelöschtes bleibt gelöscht, solange es danach nicht wieder geändert wurde.
   */
  function mergeData(a, b) {
    if (!a) return b;
    if (!b) return a;
    const geloescht = Object.assign({}, a.geloescht || {});
    for (const [id, t] of Object.entries(b.geloescht || {})) if (!(geloescht[id] >= t)) geloescht[id] = t;
    const mergeList = (x, y) => {
      const map = new Map();
      for (const r of x || []) map.set(r.id, r);
      for (const r of y || []) {
        const v = map.get(r.id);
        if (!v || (r.mod || 0) > (v.mod || 0)) map.set(r.id, r);
      }
      return [...map.values()].filter((r) => !(geloescht[r.id] >= (r.mod || 0)));
    };
    const neuer = (b.settingsMod || 0) > (a.settingsMod || 0) ? b : a;
    const nachJahr = (x, y) => { const o = {}; for (const q of [x || {}, y || {}]) for (const [j, v] of Object.entries(q)) if (!o[j] || (v.mod || 0) > (o[j].mod || 0)) o[j] = v; return o; };
    const buchungen = mergeList(a.buchungen, b.buchungen).sort((x, y) => (x.datum < y.datum ? -1 : x.datum > y.datum ? 1 : (x.pos || 0) - (y.pos || 0)));
    // Teile, die diese Version nicht kennt (aus einer neueren App), unverändert mitnehmen.
    const bekannt = new Set(['version', 'settings', 'settingsMod', 'geloescht', 'buchungen', 'kontenplaene', 'bankZeilen']);
    const fremd = {};
    for (const q of [a, b]) for (const k of Object.keys(q)) if (!bekannt.has(k) && fremd[k] === undefined) fremd[k] = q[k];
    return {
      ...fremd,
      version: 1,
      settings: settingsZusammen(neuer === a ? a.settings : b.settings, neuer === a ? b.settings : a.settings),
      settingsMod: neuer.settingsMod || 0,
      geloescht, buchungen,
      kontenplaene: nachJahr(a.kontenplaene, b.kontenplaene),
      bankZeilen: nachJahr(a.bankZeilen, b.bankZeilen),
    };
  }

  return { DEFAULTS, emptyData, parseAmount, mergeData, round2, isNum, gjBeginn, gjVon, gjBis, gjJahr, gjIn, gjText };
});
