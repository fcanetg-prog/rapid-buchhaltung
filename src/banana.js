/* Liest den Excel-Export aus Banana Buchhaltung (Datei → Datei exportieren → Export in Excel, Format «Excel 2003 XML»)
   und macht daraus Kontenplan und Buchungen eines Geschäftsjahres. Läuft im Fenster (window.Banana) und in Node (Tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Banana = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const text = (s) => String(s).replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#'
    ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e] != null ? ENT[e] : m)));

  /** Tabellenblätter des Excel-2003-XML: { Name: [[Zelle, …], …] }. */
  function blaetter(xml) {
    const out = {};
    const reWs = /<(?:ss:)?Worksheet\b([^>]*)>([\s\S]*?)<\/(?:ss:)?Worksheet>/g;
    let ws;
    while ((ws = reWs.exec(xml))) {
      const name = (/(?:ss:)?Name="([^"]*)"/.exec(ws[1]) || [])[1];
      const zeilen = [];
      const reRow = /<(?:ss:)?Row\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:ss:)?Row>)/g;
      let r;
      while ((r = reRow.exec(ws[2]))) {
        const zeile = [];
        const reCell = /<(?:ss:)?Cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ss:)?Cell>)/g;
        let c;
        while ((c = reCell.exec(r[1] || ''))) {
          const idx = /(?:ss:)?Index="(\d+)"/.exec(c[1]);
          if (idx) while (zeile.length < +idx[1] - 1) zeile.push('');
          const d = /<(?:ss:)?Data\b[^>]*>([\s\S]*?)<\/(?:ss:)?Data>/.exec(c[2] || '');
          zeile.push(d ? text(d[1]) : '');
        }
        zeilen.push(zeile);
      }
      if (name) out[name] = zeilen;
    }
    return out;
  }

  /** Tabelle mit den englischen Spaltennamen der ersten Zeile; Daten beginnen nach der Zeile mit den Datentypen. */
  function tabelle(zeilen) {
    if (!zeilen || !zeilen.length) return [];
    const kopf = zeilen[0];
    const typ = zeilen.findIndex((r) => r.includes('String'));
    return zeilen.slice(typ + 1).map((r) => Object.fromEntries(kopf.map((k, i) => [k, (r[i] || '').trim()])));
  }

  const zahl = (t) => { const v = parseFloat(String(t || '').replace(/[’'\s]/g, '')); return isFinite(v) ? Math.round(v * 100) / 100 : null; };
  /** «01.12.2025» oder «2025-12-01…» → «2025-12-01» */
  function iso(t) {
    t = String(t || '').trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
    return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
  }

  /** Vortragskonto wie beim Eröffnen in der App: 2970, sonst ein Passivkonto für Vortrag, Eigenkapital oder Vermögen. */
  const vortragVon = (plan) => (plan.some((z) => z.konto === '2970') ? '2970'
    : ((plan.find((z) => z.konto && z.bklasse === '2' && /vortrag|eigenkapital|reinverm|vermögen|kapital/i.test(z.text)) || {}).konto || null));

  /**
   * Banana-Export → { typ, jahr, gjBeginn, von, bis, firma, kontenplan, buchungen }.
   * Eröffnungssaldi aus der Kontentabelle werden zu Eröffnungsbuchungen gegen das Vortragskonto.
   */
  function lesen(xml) {
    if (!/urn:schemas-microsoft-com:office:spreadsheet/.test(xml)) throw new Error('Das ist kein Excel-Export aus Banana (Format «Excel 2003 XML»).');
    const b = blaetter(xml);
    const info = {};
    for (const r of tabelle(b.FileInfo)) if (r.IdXml || r.Id) info[r.IdXml || r.Id] = r.Value;
    const konten = tabelle(b.Accounts), journal = tabelle(b.Transactions || b.Journal);
    if (!konten.length) throw new Error('Im Banana-Export fehlt die Tabelle «Konten» (Accounts).');
    if (!b.Transactions && !b.Journal) throw new Error('Im Banana-Export fehlt die Tabelle «Buchungen» oder «Journal».');

    const plan = [], eroeffnung = [];
    for (const r of konten) {
      const sektion = r.Section || '', gruppe = r.Group || '', konto = r.Account || '', txt = (r.Description || '').replace(/\s+/g, ' ');
      if (!(sektion || gruppe || konto)) continue;
      if (sektion && !txt && !gruppe && !konto) continue;   // leere Abschnittsmarke
      if (r.Disable) continue;
      plan.push({ sektion, gruppe, konto, text: txt, bklasse: r.BClass || '', summe_in: r.Gr || '' });
      const e = zahl(r.Opening);
      if (konto && e) eroeffnung.push({ konto, text: txt, betrag: e });
    }
    if (!plan.some((z) => z.konto)) throw new Error('Der Banana-Export enthält keine Konten.');

    let von = iso(info.OpeningDate), bis = iso(info.ClosureDate);
    const buchungen = [];
    let ohneKonto = 0;
    for (const r of journal) {
      const datum = iso(r.Date), betrag = zahl(r.Amount);
      if (!datum || !betrag) continue;
      const soll = r.AccountDebit || '', haben = r.AccountCredit || '';
      if (!soll || !haben) { ohneKonto++; continue; }
      const neg = betrag < 0;   // negativer Betrag: Soll und Haben vertauschen
      buchungen.push({ datum, beleg: r.Doc || '', text: (r.Description || '').replace(/\s+/g, ' '), soll: neg ? haben : soll, haben: neg ? soll : haben, betrag: Math.abs(betrag), pos: buchungen.length + 1 });
    }
    if (!von || !bis) {
      // Ohne Angaben zum Geschäftsjahr: Zeitraum der Buchungen, ganze Monate
      const d = buchungen.map((x) => x.datum).sort();
      if (!d.length) throw new Error('Im Banana-Export fehlen Beginn und Ende des Geschäftsjahres.');
      von = von || d[0].slice(0, 8) + '01'; bis = bis || d[d.length - 1];
    }
    const jahr = +bis.slice(0, 4);

    // Eröffnungssaldi (Spalte «Eröffnung») als Buchungen am ersten Tag gegen das Vortragskonto
    if (eroeffnung.length) {
      const vortrag = vortragVon(plan);
      if (!vortrag) throw new Error('Der Banana-Export enthält Eröffnungssaldi, aber kein Vortragskonto (2970 oder Passivkonto für Vortrag, Eigenkapital oder Vermögen).');
      const er = eroeffnung.filter((e) => e.konto !== vortrag).map((e) => ({
        datum: von, beleg: '1', text: `Eröffnung: ${e.text}`, soll: e.betrag > 0 ? e.konto : vortrag, haben: e.betrag > 0 ? vortrag : e.konto, betrag: Math.abs(e.betrag), eroeffnung: true,
      }));
      buchungen.unshift(...er);
      buchungen.forEach((x, i) => { x.pos = i + 1; });
    }

    return {
      typ: 'kontenplan', jahr, gjBeginn: von.slice(5), von, bis, firma: info.Company || '',
      kontenplan: plan, buchungen: buchungen.map((x) => Object.assign(x, { jahr })), ohneKonto, eroeffnungAusKonten: eroeffnung.length,
    };
  }

  return { lesen, blaetter };
});
