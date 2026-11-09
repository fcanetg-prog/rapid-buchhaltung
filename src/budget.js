/* Budget: intern (mit Vorjahren und tatsächlichen Zahlen aus der Buchhaltung) und extern (für Stiftungen), je als PDF. */
(function () {
  'use strict';
  const L = window.Ledger;

  window.Budget = function (ctx) {
    const { state, C, esc, fmtDate, heute, persist, render, toast, api } = ctx;
    const S = state.bu = { ansicht: 'intern', alle: false };
    const jahr = () => state.year;
    const BU = () => state.data.budgets || (state.data.budgets = {});
    const posten = (j) => (BU()[j] && BU()[j].posten) || {};
    const firma = () => String(state.data.settings.firma || '').trim() || 'Rapid Openair';

    const chf = (x) => (x == null ? '' : (x < 0 && Math.abs(x) >= 0.005 ? '-' : '') + Math.abs(x).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, '’'));
    const betragFeld = (x) => (x == null ? '' : (Number.isInteger(x) ? String(x) : x.toFixed(2)));

    /* ---------- Grundlagen ---------- */

    /** Kontenplan für das Budget eines Jahres: der des Jahres, sonst der jüngste frühere, sonst der jüngste überhaupt. */
    function planFuer(j) {
      const kp = state.data.kontenplaene || {};
      if (kp[j]) return kp[j].zeilen;
      const jahre = Object.keys(kp).map(Number).sort((a, b) => b - a);
      const j2 = jahre.find((x) => x < j) || jahre[0];
      return j2 ? kp[j2].zeilen : [];
    }
    const artVon = (konto) => {
      const z = planFuer(jahr()).find((x) => x.konto === konto);
      return z ? (z.bklasse === '4' ? 'ertrag' : 'aufwand') : (/^3/.test(konto) ? 'ertrag' : 'aufwand');
    };

    /**
     * Tatsächliche Zahlen eines Jahres pro Konto, positiv für Aufwand und Ertrag.
     * Fix übernommene Zahlen (z. B. aus dem Excel) haben Vorrang; sonst aus der Buchhaltung des Jahres (immer aktuell).
     * null: keine Zahlen.
     */
    function tatsaechlich(j) {
      // Fix übernommene Zahlen (z. B. aus dem Excel) gelten auch dann, wenn das Jahr später in der App gebucht ist.
      const hand = Object.entries(posten(j)).filter(([, p]) => p.ist != null);
      if (hand.length) return { werte: new Map(hand.map(([k, p]) => [k, p.ist])), quelle: 'hand' };
      if ((state.data.kontenplaene || {})[j]) {
        const s = L.saldi(state.data.buchungen.filter((b) => b.jahr === j && !b.vorschlag));
        const werte = new Map();
        for (const [k, v] of s) werte.set(k, artVon(k) === 'ertrag' ? -v.saldo : v.saldo);
        return { werte, quelle: 'buchhaltung' };
      }
      return null;
    }

    /** Immer die drei Vorjahre, jüngstes zuerst; Jahre ohne Daten bleiben leer, sehen aber gleich aus. */
    const vorjahre = () => [jahr() - 1, jahr() - 2, jahr() - 3];

    /**
     * Budgetzeilen: Konten der Erfolgsrechnung (Aufwand, dann Ertrag), gruppiert nach den ersten zwei Ziffern.
     * Konten ohne Budget und ohne Zahlen in den gezeigten Jahren sind ausgeblendet (ausser mit «Alle Konten»).
     */
    function zeilen(jahre, tatJe) {
      const plan = planFuer(jahr());
      const konten = new Map();
      for (const z of plan) if (z.konto && (z.bklasse === '3' || z.bklasse === '4')) konten.set(z.konto, { konto: z.konto, kontoText: z.text, art: z.bklasse === '3' ? 'aufwand' : 'ertrag' });
      // Budgetposten zu Konten, die im Kontenplan fehlen, trotzdem zeigen
      for (const j of jahre) for (const k of Object.keys(posten(j))) if (!konten.has(k)) konten.set(k, { konto: k, kontoText: '', art: artVon(k) });
      const liste = [...konten.values()].map((z) => {
        const p = posten(jahr())[z.konto] || {};
        let frueher = '';
        for (const j of jahre) if (!frueher && posten(j)[z.konto] && posten(j)[z.konto].text) frueher = posten(j)[z.konto].text;
        const sichtbar = S.alle || jahre.some((j) => {
          const q = posten(j)[z.konto] || {};
          const t = tatJe[j];
          return q.intern != null || q.extern != null || (t && Math.abs(t.werte.get(z.konto) || 0) > 0.004);
        });
        return Object.assign(z, { text: p.text || frueher || z.kontoText || z.konto, sichtbar });
      }).filter((z) => z.sichtbar);
      const sortiert = (art) => liste.filter((z) => z.art === art).sort((a, b) => a.konto.localeCompare(b.konto, 'de', { numeric: true }));
      return { aufwand: sortiert('aufwand'), ertrag: sortiert('ertrag') };
    }

    const gruppen = (liste) => {
      const out = [];
      for (const z of liste) { const g = z.konto.slice(0, 2); if (!out.length || out[out.length - 1].g !== g) out.push({ g, zeilen: [] }); out[out.length - 1].zeilen.push(z); }
      return out;
    };

    /**
     * Inhalt des internen Budgets für Bildschirm und PDF: pro Jahr Budget, tatsächlich, Differenz (tatsächlich − Budget),
     * zuerst das gewählte Jahr, dann die Vorjahre.
     */
    function modellIntern() {
      const j = jahr(), jahre = [j, ...vorjahre()];
      const tatJe = {}; for (const x of jahre) tatJe[x] = tatsaechlich(x);
      const z = zeilen(jahre, tatJe);
      const bud = (x, k) => { const p = posten(x)[k]; return p && p.intern != null ? p.intern : null; };
      const tat = (x, k) => (tatJe[x] ? (tatJe[x].werte.get(k) || 0) : null);
      const spalten = [];
      for (const x of jahre) {
        spalten.push({ art: 'budget', jahr: x, kopf: `Budget ${x}`, eingabe: x === j });
        spalten.push({ art: 'tat', jahr: x, kopf: `Tatsächlich ${x}`, quelle: tatJe[x] && tatJe[x].quelle });
        spalten.push({ art: 'diff', jahr: x, kopf: `Differenz ${x}` });
      }
      const wert = (sp, k) => {
        if (sp.art === 'budget') return bud(sp.jahr, k);
        if (sp.art === 'tat') return tat(sp.jahr, k);
        const b = bud(sp.jahr, k), t = tat(sp.jahr, k);
        return b == null || t == null ? null : t - b;
      };
      const summe = (sp, liste) => {
        if (sp.art !== 'budget' && !tatJe[sp.jahr]) return null;
        const w = liste.map((r) => wert(sp, r.konto)).filter((v) => v != null);
        return w.length ? w.reduce((a, b) => a + b, 0) : (sp.art === 'tat' ? 0 : null);
      };
      const ueber = (sp) => { const e = summe(sp, z.ertrag), a = summe(sp, z.aufwand); return e == null && a == null ? null : (e || 0) - (a || 0); };
      // Rot: mehr Aufwand oder weniger Ertrag als budgetiert
      const klasse = (sp, v, art) => (sp.art === 'diff' && v != null && Math.abs(v) >= 0.5 ? ((art === 'aufwand' ? v > 0 : v < 0) ? 'schlecht' : 'gut') : '');
      return { j, jahre, tatJe, z, spalten, wert, summe, ueber, klasse };
    }

    /* ---------- Ansicht ---------- */

    function view() {
      const j = jahr();
      const m = modellIntern();
      const leer = !m.z.aufwand.length && !m.z.ertrag.length;
      return `
      <header class="head">
        <h1>Budget ${j}<small class="gj">Geschäftsjahr ${C.zeitraum(state.data, j).text}</small></h1>
      </header>
      <div class="bh-bar">
        <div class="seg"><button class="${S.ansicht === 'intern' ? 'on' : ''}" data-bu="ansicht" data-v="intern">Intern</button><button class="${S.ansicht === 'extern' ? 'on' : ''}" data-bu="ansicht" data-v="extern">Extern</button></div>
        <label class="bg-alle"><input type="checkbox" data-bu="alle" ${S.alle ? 'checked' : ''}> Alle Konten zeigen</label>
        <span class="grow"></span>
        ${S.ansicht === 'extern' ? '<button class="btn" data-bu="uebernehmen" title="Setzt das externe Budget auf die Beträge des internen Budgets">Aus intern übernehmen</button>' : ''}
        <button class="btn primary" data-bu="pdf">${S.ansicht === 'extern' ? 'Budget extern als PDF' : 'Budget intern als PDF'}</button>
      </div>
      ${leer ? `<div class="sec"><p>Für das Budget ${j} fehlt ein Kontenplan. Importiere zuerst eine Buchhaltung oder einen Kontenplan.</p></div>`
        : S.ansicht === 'intern' ? viewIntern(m) : viewExtern(m.z, j)}`;
    }

    const textFeld = (z) => `<input class="inline bg-text" id="bu-t-${esc(z.konto)}" data-bu="text" data-konto="${esc(z.konto)}" value="${esc(z.text)}" title="${esc(z.text)} (Konto ${esc(z.konto)}${z.kontoText ? ` ${esc(z.kontoText)}` : ''})">`;
    const betragInput = (art, z) => {
      const v = (posten(jahr())[z.konto] || {})[art];
      return `<input class="inline bg-betrag" id="bu-${art[0]}-${esc(z.konto)}" data-bu="betrag" data-art="${art}" data-konto="${esc(z.konto)}" value="${esc(betragFeld(v))}" inputmode="decimal" placeholder="–">`;
    };

    /** Abschnitt mit Gruppen; zwischen den Gruppen eine sichtbare Leerzeile. */
    // Gruppen: Die erste Zeile jeder weiteren Gruppe bekommt oben einen dicken Strich (Klasse bg-grp).
    const abschnitt = (liste, breite, zeile) => gruppen(liste).map((g, i) => g.zeilen.map((r, k) => {
      const h = zeile(r);
      return i && !k ? h.replace(/^<tr class="/, '<tr class="bg-grp ').replace(/^<tr>/, '<tr class="bg-grp">') : h;
    }).join('')).join('');

    function viewIntern(m) {
      const { j, spalten, wert, summe, ueber, klasse, z } = m;
      const breite = spalten.length + 2;
      const kl = (sp) => `${sp.art === 'tat' ? 'tat' : ''} ${sp.jahr === j ? 'akt' : ''} ${sp.art === 'budget' ? 'jahr-start' : ''} ${sp.quelle === 'hand' ? 'hand' : ''}`;
      const zelle = (sp, r) => {
        if (sp.eingabe) return `<td class="r ein ${kl(sp)}">${betragInput('intern', r)}</td>`;
        const v = wert(sp, r.konto);
        const link = sp.art === 'tat' && sp.quelle === 'buchhaltung' && v != null ? ` data-bu="konto" data-konto="${esc(r.konto)}" data-jahr="${sp.jahr}" title="Kontoauszug ${esc(r.konto)} ${sp.jahr}"` : '';
        return `<td class="r ${kl(sp)} ${klasse(sp, v, r.art)}"${link}>${chf(v)}</td>`;
      };
      const zeile = (r) => `<tr><td class="k">${esc(r.konto)}</td><td class="t">${textFeld(r)}</td>${spalten.map((sp) => zelle(sp, r)).join('')}</tr>`;
      const total = (titel, liste, art) => `<tr class="bg-total"><td colspan="2">${titel}</td>${spalten.map((sp) => { const v = summe(sp, liste); return `<td class="r ${kl(sp)} ${klasse(sp, v, art)}">${chf(v)}</td>`; }).join('')}</tr>`;
      const ue = spalten.map((sp) => { const v = ueber(sp); return `<td class="r ${kl(sp)} ${klasse(sp, v, 'ertrag')}">${chf(v)}</td>`; }).join('');
      const hand = spalten.filter((sp) => sp.art === 'tat' && sp.quelle === 'hand').map((sp) => sp.jahr);
      return `<div class="sec bg-wrap"><table class="bg-tab">
        <thead>
          <tr class="bg-jahre"><th colspan="2"></th>${m.jahre.map((x) => `<th colspan="3" class="c jahr-start ${x === j ? 'akt' : ''}">${x}${x === j ? ' (laufend)' : ''}</th>`).join('')}</tr>
          <tr><th>Konto</th><th>Posten</th>${spalten.map((sp) => `<th class="r ${kl(sp)}">${{ budget: 'Budget', tat: 'Tatsächlich', diff: 'Differenz' }[sp.art]}</th>`).join('')}</tr>
        </thead>
        <tbody>
          <tr class="bg-abschnitt"><td colspan="${breite}">Ausgaben</td></tr>
          ${abschnitt(z.aufwand, breite, zeile)}
          ${total('Total Ausgaben', z.aufwand, 'aufwand')}
          <tr class="bg-abschnitt zweiter"><td colspan="${breite}">Einnahmen</td></tr>
          ${abschnitt(z.ertrag, breite, zeile)}
          ${total('Total Einnahmen', z.ertrag, 'ertrag')}
          <tr class="bg-total bg-ueber"><td colspan="2">Überschuss</td>${ue}</tr>
        </tbody></table>
        <p class="hint">Tatsächliche Zahlen kommen aus der Buchhaltung des jeweiligen Geschäftsjahres und sind immer aktuell; ein Klick darauf zeigt den Kontoauszug.${hand.length ? ` Die Zahlen für ${hand.join(', ')} sind fix aus dem Excel übernommen (kursiv).` : ''} Differenz = tatsächlich − Budget. <span class="bg-legende gut">grün</span> besser als budgetiert (weniger ausgegeben oder mehr eingenommen), <span class="bg-legende schlecht">rot</span> schlechter (mehr ausgegeben oder weniger eingenommen).</p>
      </div>`;
    }

    function viewExtern(z, j) {
      const p = posten(j);
      const summe = (liste, art) => liste.reduce((s, r) => s + ((p[r.konto] || {})[art] || 0), 0);
      const zeile = (r) => {
        const e = (p[r.konto] || {}).extern, i = (p[r.konto] || {}).intern;
        const ab = e != null && i != null ? e - i : null;
        return `<tr class="${e == null ? 'bg-ohne' : ''}"><td class="k">${esc(r.konto)}</td><td class="t">${textFeld(r)}</td><td class="r ein">${betragInput('extern', r)}</td>
          <td class="r bg-int">${chf(i)}</td><td class="r bg-int ${ab ? (ab > 0 ? 'hoeher' : 'tiefer') : ''}">${ab == null || Math.abs(ab) < 0.005 ? '' : (ab > 0 ? '+' : '') + chf(ab)}</td></tr>`;
      };
      const tot = (titel, liste) => `<tr class="bg-total"><td colspan="2">${titel}</td><td class="r">${chf(summe(liste, 'extern'))}</td><td class="r bg-int">${chf(summe(liste, 'intern'))}</td><td></td></tr>`;
      const ue = summe(z.ertrag, 'extern') - summe(z.aufwand, 'extern'), ui = summe(z.ertrag, 'intern') - summe(z.aufwand, 'intern');
      return `<div class="sec bg-wrap"><table class="bg-tab bg-ext">
        <thead><tr><th>Konto</th><th>Posten</th><th class="r">Budget ${j} extern</th><th class="r bg-int">intern</th><th class="r bg-int">Abweichung</th></tr></thead>
        <tbody>
          <tr class="bg-abschnitt"><td colspan="5">Ausgaben</td></tr>${abschnitt(z.aufwand, 5, zeile)}${tot('Total Ausgaben', z.aufwand)}
          <tr class="bg-abschnitt zweiter"><td colspan="5">Einnahmen</td></tr>${abschnitt(z.ertrag, 5, zeile)}${tot('Total Einnahmen', z.ertrag)}
          <tr class="bg-total bg-ueber"><td colspan="2">Überschuss</td><td class="r ${ue < 0 ? 'neg' : ''}">${chf(ue)}</td><td class="r bg-int">${chf(ui)}</td><td></td></tr>
        </tbody></table>
        <p class="hint">Das externe Budget ist unabhängig vom internen. Ins PDF kommen nur Posten mit einem Betrag (auch 0); ein leeres Feld lässt den Posten weg. Die Spalten «intern» und «Abweichung» sind nur hier sichtbar, nicht im PDF.</p>
      </div>`;
    }

    /* ---------- PDF ---------- */

    const pdfStil = `
        * { box-sizing: border-box; }
        body { font-family: Arial, Helvetica, "Liberation Sans", sans-serif; color: #000; margin: 0; }
        h1 { margin: 0 0 3pt; }
        .sub { color: #444; }
        table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
        th { text-align: left; font-weight: normal; color: #444; border-bottom: 1px solid #000; white-space: nowrap; vertical-align: bottom; }
        td { white-space: nowrap; }
        .r { text-align: right; }
        td { border-bottom: 0.5pt dotted #9aa6a7; }
        tr.bg-grp td { border-top: 1.3pt solid #333; }
        tr.abschnitt td { border-bottom: 1.3pt solid #000; }
        tr.abschnitt td { font-weight: bold; }
        tr.total td { font-weight: bold; border-top: 1px solid #000; border-bottom: 0; }
        tr.ueber td { border-top: 2px solid #000; }
        tr { page-break-inside: avoid; }`;

    function pdfExtern() {
      const j = jahr(), p = posten(j);
      const z = zeilen([j], {});
      const mit = (liste) => liste.filter((r) => (p[r.konto] || {}).extern != null);
      const aus = mit(z.aufwand), ein = mit(z.ertrag);
      const summe = (liste) => liste.reduce((s, r) => s + p[r.konto].extern, 0);
      const zeile = (r) => `<tr><td class="t">${esc(r.text)}</td><td class="r">${chf(p[r.konto].extern)}</td></tr>`;
      const ue = summe(ein) - summe(aus);
      const titel = `Budget ${firma()} ${j}`;
      return `<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><title>${esc(titel)}</title><style>${pdfStil}
        @page { size: A4; }
        body { font-size: 10pt; }
        h1 { font-size: 17pt; } .sub { font-size: 10pt; margin-bottom: 18pt; }
        th { font-size: 8.5pt; padding: 0 4pt 5pt; }
        td { padding: 0 4pt; height: 16pt; }
        td.r { width: 90pt; }
        td.t { max-width: 0; width: 100%; overflow: hidden; text-overflow: ellipsis; }
        tr.abschnitt td { font-size: 13pt; height: 26pt; vertical-align: bottom; padding-bottom: 3pt; }
        tr.abschnitt.zweiter td { height: 40pt; }
        tr.ueber td { font-size: 13pt; height: 26pt; }
      </style></head><body>
        <h1>${esc(titel)}</h1>
        <div class="sub">Geschäftsjahr ${C.zeitraum(state.data, j).text} · Stand ${fmtDate(heute)}</div>
        <table><thead><tr><th>Posten</th><th class="r">Budget ${j} in CHF</th></tr></thead><tbody>
          <tr class="abschnitt"><td colspan="2">Ausgaben</td></tr>${abschnitt(aus, 2, zeile)}
          <tr class="total"><td>Total Ausgaben</td><td class="r">${chf(summe(aus))}</td></tr>
          <tr class="abschnitt zweiter"><td colspan="2">Einnahmen</td></tr>${abschnitt(ein, 2, zeile)}
          <tr class="total"><td>Total Einnahmen</td><td class="r">${chf(summe(ein))}</td></tr>
          <tr class="total ueber"><td>${ue < 0 ? 'Fehlbetrag' : 'Überschuss'}</td><td class="r">${chf(ue)}</td></tr>
        </tbody></table>
      </body></html>`;
    }

    /** Internes Budget mit allen Spalten, A4 quer, kleine Schrift, möglichst auf einer Seite. */
    function pdfIntern() {
      const { j, jahre, spalten, wert, summe, ueber, klasse, z } = modellIntern();
      const breite = spalten.length + 2;
      const kl = (sp) => `${sp.art === 'budget' ? 'js' : ''} ${sp.art === 'tat' ? 'tat' : ''} ${sp.quelle === 'hand' ? 'hand' : ''}`;
      const zelle = (sp, v, art) => `<td class="r ${kl(sp)} ${klasse(sp, v, art)}">${chf(v)}</td>`;
      const zeile = (r) => `<tr><td class="k">${esc(r.konto)}</td><td class="t">${esc(r.text)}</td>${spalten.map((sp) => zelle(sp, wert(sp, r.konto), r.art)).join('')}</tr>`;
      const total = (titel, liste, art) => `<tr class="total"><td colspan="2">${titel}</td>${spalten.map((sp) => zelle(sp, summe(sp, liste), art)).join('')}</tr>`;
      const hand = spalten.filter((sp) => sp.art === 'tat' && sp.quelle === 'hand').map((sp) => sp.jahr);
      const titel = `Budget ${firma()} ${j} intern`;
      return `<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><title>${esc(titel)}</title><style>${pdfStil}
        @page { size: A4 landscape; margin: 9mm 10mm 8mm; }
        body { font-size: 7pt; }
        h1 { font-size: 12pt; } .sub { font-size: 7.5pt; margin-bottom: 6pt; }
        th { font-size: 6.5pt; padding: 0 3pt 3pt; }
        td { padding: 0 3pt; height: 10.4pt; }
        td.k { color: #555; width: 22pt; }
        td.t { max-width: 0; width: 100%; overflow: hidden; text-overflow: ellipsis; }
        td.r { width: 50pt; }
        .js { border-left: 1px solid #9aa; }
        .tat { background: #f1f6f6; }
        .hand { font-style: italic; }
        tr.abschnitt td { font-size: 10pt; height: 16pt; vertical-align: bottom; padding-bottom: 2pt; }
        tr.abschnitt.zweiter td { height: 26pt; }
        tr.ueber td { font-size: 9.5pt; height: 17pt; }
        .fuss { font-size: 6.5pt; color: #555; margin-top: 5pt; white-space: nowrap; }
        tr.jahre th { font-size: 8pt; font-weight: bold; color: #000; border-bottom: 0; text-align: center; }
        .c { text-align: center; }
        td.gut { background: #cdebd8; color: #135c33; font-weight: bold; }
        td.schlecht { background: #f7d0c8; color: #9b2412; font-weight: bold; }
        .lg { padding: 0 3pt; font-weight: bold; }
      </style></head><body>
        <h1>${esc(titel)}</h1>
        <div class="sub">Geschäftsjahr ${C.zeitraum(state.data, j).text} · Stand ${fmtDate(heute)} · Beträge in CHF</div>
        <table><thead>
          <tr class="jahre"><th colspan="2"></th>${jahre.map((x) => `<th colspan="3" class="c js">${x}${x === j ? ' (laufend)' : ''}</th>`).join('')}</tr>
          <tr><th>Konto</th><th>Posten</th>${spalten.map((sp) => `<th class="r ${kl(sp)}">${{ budget: 'Budget', tat: 'Tatsächlich', diff: 'Differenz' }[sp.art]}</th>`).join('')}</tr>
        </thead><tbody>
          <tr class="abschnitt"><td colspan="${breite}">Ausgaben</td></tr>${abschnitt(z.aufwand, breite, zeile)}
          ${total('Total Ausgaben', z.aufwand, 'aufwand')}
          <tr class="abschnitt zweiter"><td colspan="${breite}">Einnahmen</td></tr>${abschnitt(z.ertrag, breite, zeile)}
          ${total('Total Einnahmen', z.ertrag, 'ertrag')}
          <tr class="total ueber"><td colspan="2">Überschuss</td>${spalten.map((sp) => zelle(sp, ueber(sp), 'ertrag')).join('')}</tr>
        </tbody></table>
        <div class="fuss">Differenz = tatsächlich − Budget: <span class="lg gut" style="background:#cdebd8;color:#135c33">grün</span> besser als budgetiert (weniger ausgegeben oder mehr eingenommen), <span class="lg" style="background:#f7d0c8;color:#9b2412">rot</span> schlechter. Tatsächliche Zahlen aus der Buchhaltung${hand.length ? `; ${hand.join(', ')} aus dem Excel (kursiv)` : ''}.</div>
      </body></html>`;
    }

    async function pdf() {
      const j = jahr(), extern = S.ansicht === 'extern';
      if (extern && !Object.values(posten(j)).some((x) => x.extern != null)) { toast(`Für ${j} gibt es noch kein externes Budget.`, { fehler: true }); return; }
      const name = `Budget_${firma().replace(/[^A-Za-z0-9äöüÄÖÜ]+/g, '_')}_${j}_${extern ? 'extern' : 'intern'}_Stand_${heute.replace(/-/g, '')}.pdf`;
      const r = extern
        ? await api.savePdf(pdfExtern(), { ordner: 'Budgets', name, fuss: fmtDate(heute) })
        : await api.savePdf(pdfIntern(), { ordner: 'Budgets', name, roh: true });
      if (r.fehler) toast(r.fehler, { fehler: true }); else toast('Budget gespeichert: ' + r.path);
    }

    /* ---------- Aktionen ---------- */

    const eintrag = (konto) => {
      const b = BU()[jahr()] || (BU()[jahr()] = { mod: 0, posten: {} });
      return b.posten[konto] || (b.posten[konto] = {});
    };
    const aufraeumen = (konto) => { const b = BU()[jahr()]; if (b && b.posten[konto] && !Object.keys(b.posten[konto]).length) delete b.posten[konto]; };

    document.addEventListener('click', (ev) => {
      if (state.view !== 'budget') return;
      const el = ev.target.closest('[data-bu]');
      if (!el) return;
      const a = el.dataset.bu;
      if (a === 'ansicht') { S.ansicht = el.dataset.v; render(); }
      else if (a === 'pdf') pdf();
      else if (a === 'konto') {
        // Kontoauszug in der Buchhaltung öffnen
        state.year = +el.dataset.jahr; state.view = 'buchhaltung';
        if (state.bh) { state.bh.tab = 'auszug'; state.bh.konto = el.dataset.konto; }
        render();
      } else if (a === 'uebernehmen') {
        const p = posten(jahr());
        const intern = Object.entries(p).filter(([, x]) => x.intern != null);
        if (!intern.length) { toast(`Für ${jahr()} gibt es noch kein internes Budget.`, { fehler: true }); return; }
        if (Object.values(p).some((x) => x.extern != null) && !confirm('Das externe Budget wird durch die Beträge des internen Budgets ersetzt. Fortfahren?')) return;
        for (const k of Object.keys(p)) delete eintrag(k).extern;
        for (const [k, x] of intern) eintrag(k).extern = x.intern;
        persist(); render(); toast('Externes Budget aus dem internen übernommen');
      }
    });

    document.addEventListener('change', (ev) => {
      if (state.view !== 'budget') return;
      const el = ev.target, a = el.dataset && el.dataset.bu;
      if (!a) return;
      if (a === 'alle') { S.alle = el.checked; render(); return; }
      const konto = el.dataset.konto;
      if (a === 'betrag') {
        const t = el.value.trim();
        const v = t === '' ? null : C.parseAmount(t);
        if (t !== '' && v == null) { toast('Bitte einen Betrag eingeben, zum Beispiel 1500 oder 1500.50.', { fehler: true }); el.focus(); return; }
        const e = eintrag(konto);
        if (v == null) delete e[el.dataset.art]; else e[el.dataset.art] = C.round2(v);
        aufraeumen(konto); persist(); render();
      } else if (a === 'text') {
        const e = eintrag(konto), t = el.value.trim();
        if (t) e.text = t; else delete e.text;
        aufraeumen(konto); persist(); render();
      }
    });

    // Enter springt wie Tab zum nächsten Feld derselben Spalte
    document.addEventListener('keydown', (ev) => {
      if (state.view !== 'budget' || ev.key !== 'Enter' || !ev.target.matches || !ev.target.matches('input.bg-betrag, input.bg-text')) return;
      ev.preventDefault();
      const felder = [...document.querySelectorAll(ev.target.matches('.bg-betrag') ? 'input.bg-betrag' : 'input.bg-text')];
      const i = felder.indexOf(ev.target);
      const id = (felder[i + 1] || {}).id;
      ev.target.blur();
      const naechstes = id && document.getElementById(id);
      if (naechstes) { naechstes.focus(); naechstes.select(); }
    });

    return { view, pdfIntern, pdfExtern, zeilen, tatsaechlich };
  };
})();
