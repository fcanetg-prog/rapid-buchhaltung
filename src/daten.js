/* Datenmodell der Buchhaltung: leerer Stand, Beträge lesen, Stände zweier Rechner zusammenführen.
   Läuft im Fenster (window.Daten) und in Node (main.js, Tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Daten = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULTS = { firma: 'Rapid Openair' };

  const round2 = (x) => Math.round(x * 100 + 1e-6) / 100;
  const isNum = (x) => typeof x === 'number' && isFinite(x);

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

  return { DEFAULTS, emptyData, parseAmount, mergeData, round2, isNum };
});
