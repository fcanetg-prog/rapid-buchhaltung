/* Budget: intern (mit Vorjahren und Ist-Zahlen aus der Buchhaltung) und extern (für Stiftungen, als PDF). */
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

    const chf = (x, mitNull) => (x == null || (!mitNull && Math.abs(x) < 0.005) ? (mitNull ? '0.00' : '') : (x < 0 ? '-' : '') + Math.abs(x).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, '’'));
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

    /** Ist-Zahlen eines Jahres aus der Buchhaltung, pro Konto positiv (Aufwand wie Ertrag); null, wenn es keine Buchhaltung gibt. */
    function ist(j) {
      if (!(state.data.kontenplaene || {})[j]) return null;
      const s = L.saldi(state.data.buchungen.filter((b) => b.jahr === j && !b.vorschlag));
      const out = new Map();
      for (const [k, v] of s) out.set(k, v.saldo);
      return out;
    }

    /** Vorjahre mit Budget oder Buchhaltung (höchstens drei), jüngstes zuerst. */
    function vorjahre() {
      const out = [];
      for (let j = jahr() - 1; j >= jahr() - 3; j--) {
        const hatBudget = Object.values(posten(j)).some((p) => p.intern != null);
        if (hatBudget || (state.data.kontenplaene || {})[j]) out.push(j);
      }
      return out;
    }

    /**
     * Budgetzeilen: Konten der Erfolgsrechnung (Aufwand, dann Ertrag), gruppiert nach den ersten zwei Ziffern.
     * Konten ohne Budget und ohne Buchungen in den gezeigten Jahren sind ausgeblendet (ausser mit «Alle Konten»).
     */
    function zeilen(jahre, istJe) {
      const plan = planFuer(jahr());
      const konten = new Map();
      for (const z of plan) if (z.konto && (z.bklasse === '3' || z.bklasse === '4')) konten.set(z.konto, { konto: z.konto, kontoText: z.text, art: z.bklasse === '3' ? 'aufwand' : 'ertrag' });
      // Budgetposten zu Konten, die im Kontenplan fehlen, trotzdem zeigen
      for (const j of jahre) for (const k of Object.keys(posten(j))) if (!konten.has(k)) konten.set(k, { konto: k, kontoText: '', art: /^3/.test(k) ? 'ertrag' : 'aufwand' });
      const liste = [...konten.values()].map((z) => {
        const p = posten(jahr())[z.konto] || {};
        let frueher = '';
        for (const j of jahre) if (!frueher && posten(j)[z.konto] && posten(j)[z.konto].text) frueher = posten(j)[z.konto].text;
        const sichtbar = S.alle || jahre.some((j) => {
          const q = posten(j)[z.konto] || {};
          const i = istJe[j];
          return q.intern != null || q.extern != null || (i && Math.abs(i.get(z.konto) || 0) > 0.004);
        });
        return Object.assign(z, { text: p.text || frueher || z.kontoText || z.konto, eigenerText: !!p.text, sichtbar });
      }).filter((z) => z.sichtbar);
      const sortiert = (art) => liste.filter((z) => z.art === art).sort((a, b) => a.konto.localeCompare(b.konto, 'de', { numeric: true }));
      return { aufwand: sortiert('aufwand'), ertrag: sortiert('ertrag') };
    }

    /* ---------- Ansicht ---------- */

    function view() {
      const j = jahr(), vj = vorjahre();
      const istJe = {}; for (const x of [j, ...vj]) istJe[x] = ist(x);
      const z = zeilen([j, ...vj], istJe);
      const leer = !z.aufwand.length && !z.ertrag.length;
      return `
      <header class="head">
        <h1>Budget ${j}<small class="gj">Geschäftsjahr ${C.zeitraum(state.data, j).text}</small></h1>
      </header>
      <div class="bh-bar">
        <div class="seg"><button class="${S.ansicht === 'intern' ? 'on' : ''}" data-bu="ansicht" data-v="intern">Intern</button><button class="${S.ansicht === 'extern' ? 'on' : ''}" data-bu="ansicht" data-v="extern">Extern</button></div>
        <label class="bg-alle"><input type="checkbox" data-bu="alle" ${S.alle ? 'checked' : ''}> Alle Konten zeigen</label>
        <span class="grow"></span>
        ${S.ansicht === 'extern' ? `<button class="btn" data-bu="uebernehmen" title="Setzt das externe Budget auf die Beträge des internen Budgets">Aus intern übernehmen</button>
          <button class="btn primary" data-bu="pdf">Budget als PDF</button>` : ''}
      </div>
      ${leer ? `<div class="sec"><p>Für das Budget ${j} fehlt ein Kontenplan. Importiere zuerst eine Buchhaltung oder einen Kontenplan.</p></div>`
        : S.ansicht === 'intern' ? viewIntern(z, j, vj, istJe) : viewExtern(z, j)}`;
    }

    const gruppen = (liste) => {
      const out = [];
      for (const z of liste) { const g = z.konto.slice(0, 2); if (!out.length || out[out.length - 1].g !== g) out.push({ g, zeilen: [] }); out[out.length - 1].zeilen.push(z); }
      return out;
    };
    const textFeld = (z) => `<input class="inline bg-text" id="bu-t-${esc(z.konto)}" data-bu="text" data-konto="${esc(z.konto)}" value="${esc(z.text)}" title="Bezeichnung im Budget (Konto ${esc(z.konto)}${z.kontoText ? ` ${esc(z.kontoText)}` : ''})">`;
    const betragInput = (art, z) => {
      const v = (posten(jahr())[z.konto] || {})[art];
      return `<input class="inline bg-betrag" id="bu-${art[0]}-${esc(z.konto)}" data-bu="betrag" data-art="${art}" data-konto="${esc(z.konto)}" value="${esc(betragFeld(v))}" inputmode="decimal" placeholder="–">`;
    };

    function viewIntern(z, j, vj, istJe) {
      const bud = (x, k) => { const p = posten(x)[k]; return p && p.intern != null ? p.intern : null; };
      const istV = (x, k) => (istJe[x] ? (istJe[x].get(k) || 0) : null);
      const vz = (art) => (art === 'ertrag' ? -1 : 1);   // Ertrag positiv zeigen
      // Spalten wie im Excel: Budgets, Ist, Differenzen; dazu «Ist laufendes Jahr» nach dem Budget
      const spalten = [
        { kopf: `Budget ${j}`, eingabe: true },
        { kopf: `Ist ${j} bisher`, ist: j, hinweis: 'laufend' },
        ...vj.map((x) => ({ kopf: `Budget ${x}`, budget: x })),
        ...vj.map((x) => ({ kopf: `Ist ${x}`, ist: x })),
        ...vj.map((x) => ({ kopf: `Differenz ${x}`, diff: x })),
      ];
      const wert = (sp, k, art) => {
        if (sp.eingabe) return bud(j, k);
        if (sp.budget) return bud(sp.budget, k);
        if (sp.ist) { const v = istV(sp.ist, k); return v == null ? null : v * vz(art); }
        if (sp.diff) { const b = bud(sp.diff, k), i = istV(sp.diff, k); return b == null || i == null ? null : i * vz(art) - b; }
        return null;
      };
      const summe = (sp, liste) => {
        const werte = liste.map((r) => wert(sp, r.konto, r.art)).filter((v) => v != null);
        if (sp.ist && !istJe[sp.ist]) return null;
        return werte.length ? werte.reduce((a, b) => a + b, 0) : (sp.ist ? 0 : null);
      };
      // Rot: mehr Aufwand oder weniger Ertrag als budgetiert
      const klasse = (sp, v, art) => (sp.diff && v != null && Math.abs(v) >= 0.5 ? ((art === 'aufwand' ? v > 0 : v < 0) ? 'neg' : 'pos') : '');
      const zelle = (sp, r) => {
        if (sp.eingabe) return `<td class="r ein">${betragInput('intern', r)}</td>`;
        const v = wert(sp, r.konto, r.art);
        const link = sp.ist && v != null ? ` data-bu="konto" data-konto="${esc(r.konto)}" data-jahr="${sp.ist}" title="Kontoauszug ${esc(r.konto)} ${sp.ist}"` : '';
        return `<td class="r ${sp.ist ? 'ist' : ''} ${sp.ist === j ? 'lauf' : ''} ${klasse(sp, v, r.art)}"${link}>${v == null ? '' : chf(v, true)}</td>`;
      };
      const total = (titel, liste, art) => `<tr class="bg-total"><td colspan="2">${titel}</td>${spalten.map((sp) => { const v = summe(sp, liste); return `<td class="r ${klasse(sp, v, art)}">${v == null ? '' : chf(v, true)}</td>`; }).join('')}</tr>`;
      const block = (liste) => gruppen(liste).map((g) => g.zeilen.map((r, i) => `<tr class="${i === 0 ? 'bg-neu' : ''}"><td class="k">${esc(r.konto)}</td><td class="t">${textFeld(r)}</td>${spalten.map((sp) => zelle(sp, r)).join('')}</tr>`).join('')).join('');
      // Überschuss = Einnahmen − Ausgaben
      const ueberschuss = spalten.map((sp) => {
        const e = summe(sp, z.ertrag), a = summe(sp, z.aufwand);
        if (e == null && a == null) return '<td></td>';
        const v = (e || 0) - (a || 0);
        return `<td class="r ${sp.diff && Math.abs(v) >= 0.5 ? (v < 0 ? 'neg' : 'pos') : ''}">${chf(v, true)}</td>`;
      }).join('');
      const kopf = `<tr><th>Konto</th><th>Posten</th>${spalten.map((sp) => `<th class="r ${sp.ist === j ? 'lauf' : ''}">${sp.kopf}</th>`).join('')}</tr>`;
      const breit = spalten.length + 2;
      return `<div class="sec bg-wrap"><table class="bg-tab">
        <thead>${kopf}</thead>
        <tbody>
          <tr class="bg-abschnitt"><td colspan="${breit}">Ausgaben</td></tr>
          ${block(z.aufwand)}
          ${total('Total Ausgaben', z.aufwand, 'aufwand')}
          <tr class="bg-abschnitt"><td colspan="${breit}">Einnahmen</td></tr>
          ${block(z.ertrag)}
          ${total('Total Einnahmen', z.ertrag, 'ertrag')}
          <tr class="bg-total bg-ueber"><td colspan="2">Überschuss</td>${ueberschuss}</tr>
        </tbody></table>
        <p class="hint">Ist-Zahlen kommen aus der Buchhaltung des jeweiligen Geschäftsjahres; ein Klick darauf zeigt den Kontoauszug. Differenz = Ist − Budget; rot heisst mehr ausgegeben oder weniger eingenommen als budgetiert. Ein leeres Budgetfeld bedeutet: kein Budget für diesen Posten.</p>
      </div>`;
    }

    function viewExtern(z, j) {
      const p = posten(j);
      const summe = (liste, art) => liste.reduce((s, r) => s + ((p[r.konto] || {})[art] || 0), 0);
      const zeile = (r) => {
        const e = (p[r.konto] || {}).extern, i = (p[r.konto] || {}).intern;
        const ab = e != null && i != null ? e - i : null;
        return `<td class="k">${esc(r.konto)}</td><td class="t">${textFeld(r)}</td><td class="r ein">${betragInput('extern', r)}</td>
          <td class="r bg-int">${i == null ? '' : chf(i, true)}</td><td class="r bg-int ${ab ? (ab > 0 ? 'hoeher' : 'tiefer') : ''}">${ab == null || Math.abs(ab) < 0.005 ? '' : (ab > 0 ? '+' : '') + chf(ab)}</td>`;
      };
      const block = (liste) => gruppen(liste).map((g) => g.zeilen.map((r, i) => `<tr class="${i === 0 ? 'bg-neu' : ''} ${(p[r.konto] || {}).extern == null ? 'bg-ohne' : ''}">${zeile(r)}</tr>`).join('')).join('');
      const tot = (titel, liste) => `<tr class="bg-total"><td colspan="2">${titel}</td><td class="r">${chf(summe(liste, 'extern'), true)}</td><td class="r bg-int">${chf(summe(liste, 'intern'), true)}</td><td></td></tr>`;
      const ue = summe(z.ertrag, 'extern') - summe(z.aufwand, 'extern'), ui = summe(z.ertrag, 'intern') - summe(z.aufwand, 'intern');
      return `<div class="sec bg-wrap"><table class="bg-tab bg-ext">
        <thead><tr><th>Konto</th><th>Posten</th><th class="r">Budget ${j} extern</th><th class="r bg-int">intern</th><th class="r bg-int">Abweichung</th></tr></thead>
        <tbody>
          <tr class="bg-abschnitt"><td colspan="5">Ausgaben</td></tr>${block(z.aufwand)}${tot('Total Ausgaben', z.aufwand)}
          <tr class="bg-abschnitt"><td colspan="5">Einnahmen</td></tr>${block(z.ertrag)}${tot('Total Einnahmen', z.ertrag)}
          <tr class="bg-total bg-ueber"><td colspan="2">Überschuss</td><td class="r ${ue < 0 ? 'neg' : ''}">${chf(ue, true)}</td><td class="r bg-int">${chf(ui, true)}</td><td></td></tr>
        </tbody></table>
        <p class="hint">Das externe Budget ist unabhängig vom internen. Ins PDF kommen nur Posten mit einem Betrag (auch 0); ein leeres Feld lässt den Posten weg. Die Spalten «intern» und «Abweichung» sind nur hier sichtbar, nicht im PDF.</p>
      </div>`;
    }

    /* ---------- PDF (extern) ---------- */

    function pdfHtml() {
      const j = jahr(), p = posten(j);
      const z = zeilen([j], {});
      const mit = (liste) => liste.filter((r) => (p[r.konto] || {}).extern != null);
      const aus = mit(z.aufwand), ein = mit(z.ertrag);
      const summe = (liste) => liste.reduce((s, r) => s + p[r.konto].extern, 0);
      const block = (liste) => gruppen(liste).map((g) => g.zeilen.map((r, i) => `<tr class="${i === 0 ? 'neu' : ''}"><td>${esc(r.text)}</td><td class="r">${chf(p[r.konto].extern, true)}</td></tr>`).join('')).join('');
      const ue = summe(ein) - summe(aus);
      const titel = `Budget ${firma()} ${j}`;
      return `<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><title>${esc(titel)}</title><style>
        @page { size: A4; }
        body { font-family: Arial, Helvetica, "Liberation Sans", sans-serif; font-size: 10pt; color: #000; margin: 0; }
        h1 { font-size: 17pt; margin: 0 0 4pt; }
        .sub { font-size: 10pt; color: #444; margin-bottom: 20pt; }
        table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
        th { text-align: left; font-size: 8.5pt; font-weight: normal; color: #444; padding: 0 4pt 5pt; border-bottom: 1px solid #000; }
        td { padding: 2.4pt 4pt; }
        .r { text-align: right; white-space: nowrap; width: 90pt; }
        tr.neu td { padding-top: 8pt; }
        tr.abschnitt td { font-weight: bold; font-size: 11pt; padding-top: 14pt; }
        tr.total td { font-weight: bold; border-top: 1px solid #000; padding-top: 4pt; padding-bottom: 4pt; }
        tr.ueber td { font-size: 11.5pt; border-top: 2px solid #000; padding-top: 7pt; }
        tr { page-break-inside: avoid; }
      </style></head><body>
        <h1>${esc(titel)}</h1>
        <div class="sub">Geschäftsjahr ${C.zeitraum(state.data, j).text} · Stand ${fmtDate(heute)}</div>
        <table><thead><tr><th>Posten</th><th class="r">Budget ${j} in CHF</th></tr></thead><tbody>
          <tr class="abschnitt"><td colspan="2">Ausgaben</td></tr>${block(aus)}
          <tr class="total"><td>Total Ausgaben</td><td class="r">${chf(summe(aus), true)}</td></tr>
          <tr class="abschnitt"><td colspan="2">Einnahmen</td></tr>${block(ein)}
          <tr class="total"><td>Total Einnahmen</td><td class="r">${chf(summe(ein), true)}</td></tr>
          <tr class="total ueber"><td>${ue < 0 ? 'Fehlbetrag' : 'Überschuss'}</td><td class="r">${chf(ue, true)}</td></tr>
        </tbody></table>
      </body></html>`;
    }

    async function pdf() {
      const p = posten(jahr());
      if (!Object.values(p).some((x) => x.extern != null)) { toast(`Für ${jahr()} gibt es noch kein externes Budget.`, { fehler: true }); return; }
      const name = `Budget_${firma().replace(/[^A-Za-z0-9äöüÄÖÜ]+/g, '_')}_${jahr()}_extern_Stand_${heute.replace(/-/g, '')}.pdf`;
      const r = await api.savePdf(pdfHtml(), { ordner: 'Budgets', name, fuss: fmtDate(heute) });
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

    // Enter springt wie Tab zum nächsten Betragsfeld
    document.addEventListener('keydown', (ev) => {
      if (state.view !== 'budget' || ev.key !== 'Enter' || !ev.target.matches || !ev.target.matches('input.bg-betrag, input.bg-text')) return;
      ev.preventDefault();
      const felder = [...document.querySelectorAll(ev.target.matches('.bg-betrag') ? 'input.bg-betrag' : 'input.bg-text')];
      const i = felder.indexOf(ev.target);
      ev.target.blur();
      const naechstes = document.getElementById((felder[i + 1] || {}).id);
      if (naechstes) { naechstes.focus(); naechstes.select(); }
    });

    return { view, pdfHtml, zeilen, ist };
  };
})();
