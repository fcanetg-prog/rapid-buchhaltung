/* Buchhaltung Rapid Openair – Oberfläche (Rahmen, Speichern, Abgleich zwischen Rechnern, Einstellungen) */
(function () {
  'use strict';
  const C = window.Daten;

  /* ============ Hilfen ============ */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const pad = (n) => String(n).padStart(2, '0');

  const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

  function todayIso() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function fmtDate(iso) { return iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : ''; }

  /* ============ Speicher-Schnittstelle (Desktop-App oder Browser-Vorschau) ============ */

  const api = window.api || {
    async load() { const t = localStorage.getItem('rapid-buchhaltung'); return { data: t ? JSON.parse(t) : null, path: 'Browser-Vorschau' }; },
    async save(d) { localStorage.setItem('rapid-buchhaltung', JSON.stringify(d)); return { ok: true }; },
    importFile() {
      return new Promise((res) => {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,.xls,.xml';
        inp.onchange = async () => { try { const t = await inp.files[0].text(); res(/^\s*</.test(t) ? { text: t } : { data: JSON.parse(t) }); } catch (e) { res({ error: e.message }); } };
        inp.click();
      });
    },
    async exportFile() { return { canceled: true }; },
    async openFolder() {}, async chooseFolder() { return { canceled: true }; },
    async info() { return { version: 'Vorschau', dataPath: 'Browser-Vorschau' }; },
    async savePdf() { return { fehler: 'PDF gibt es nur in der Desktop-App.' }; },
    openText() {
      return new Promise((res) => {
        const inp = document.createElement('input'); inp.type = 'file';
        inp.onchange = async () => {
          const roh = await inp.files[0].arrayBuffer();
          let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(roh); } catch (_) { text = new TextDecoder('windows-1252').decode(roh); }
          res({ text, name: inp.files[0].name });
        };
        inp.click();
      });
    },
  };

  if (window.api && window.api.confirm) window.confirm = (t) => window.api.confirm(t);

  /* ============ Zustand ============ */

  const heute = todayIso();
  const state = {
    data: null,
    geladen: false,
    fehler: null,
    info: { version: '', dataPath: '' },
    view: 'buchhaltung',
    year: C.gjJahr(C.DEFAULTS, heute),
  };

  /* Änderungsstempel: Damit zwei Rechner ihre Stände zusammenführen können, bekommt jede geänderte
     Buchung beim Speichern die aktuelle Zeit, Gelöschtes einen Löschvermerk. */
  let abbild = { b: new Map(), k: {}, z: {}, s: '' };
  const ohneMod = (r) => JSON.stringify(Object.assign({}, r, { mod: undefined }));
  function merkeAbbild() {
    abbild = {
      b: new Map(state.data.buchungen.map((r) => [r.id, ohneMod(r)])),
      k: Object.fromEntries(Object.entries(state.data.kontenplaene).map(([j, pl]) => [j, JSON.stringify([pl.zeilen, pl.von, pl.bis])])),
      z: Object.fromEntries(Object.entries(state.data.bankZeilen || {}).map(([j, bz]) => [j, JSON.stringify(bz.zeilen)])),
      u: Object.fromEntries(Object.entries(state.data.budgets || {}).map(([j, bu]) => [j, JSON.stringify(bu.posten)])),
      s: JSON.stringify(state.data.settings),
    };
  }
  function stempeln() {
    const jetzt = Date.now();
    const d = state.data;
    if (!d.geloescht) d.geloescht = {};
    const da = new Set();
    for (const r of d.buchungen) {
      da.add(r.id);
      if (abbild.b.get(r.id) !== ohneMod(r)) { r.mod = jetzt; delete d.geloescht[r.id]; }
    }
    for (const id of abbild.b.keys()) if (!da.has(id)) d.geloescht[id] = jetzt;
    if (JSON.stringify(d.settings) !== abbild.s) d.settingsMod = jetzt;
    for (const [j, pl] of Object.entries(d.kontenplaene)) if (JSON.stringify([pl.zeilen, pl.von, pl.bis]) !== abbild.k[j]) pl.mod = jetzt;
    for (const [j, bz] of Object.entries(d.bankZeilen || {})) if (JSON.stringify(bz.zeilen) !== abbild.z[j]) bz.mod = jetzt;
    for (const [j, bu] of Object.entries(d.budgets || {})) if (JSON.stringify(bu.posten) !== (abbild.u || {})[j]) bu.mod = jetzt;
    merkeAbbild();
  }

  async function persist(opts) {
    stempeln();
    const r = await api.save(state.data, opts);
    if (!r || r.ok === false) toast('Speichern fehlgeschlagen: ' + ((r && r.error) || 'unbekannter Fehler'), { fehler: true });
    else if (r.data) uebernehme(r.data);   // ein anderer Rechner hatte inzwischen gespeichert
  }

  /** Übernimmt einen zusammengeführten Stand in die Anzeige. */
  function uebernehme(daten) {
    state.data = normalize(daten);
    merkeAbbild();
    render();
  }

  /** Die Datendatei wurde von aussen geändert (anderer Rechner): laden, mit dem eigenen Stand zusammenführen. */
  let holtGerade = false;
  async function holeAenderungen() {
    if (holtGerade || !state.data) return;
    holtGerade = true;
    try {
      const r = await api.load();
      if (!r.data) return;
      const fern = normalize(r.data);
      stempeln();
      const zusammen = C.mergeData(state.data, fern);
      const gleichWieFern = JSON.stringify(normalize(zusammen)) === JSON.stringify(fern);
      uebernehme(zusammen);
      if (!gleichWieFern) await api.save(state.data);
    } finally { holtGerade = false; }
  }

  /* ============ Toast ============ */

  let toastTimer = null, toastAction = null;
  function toast(text, opts) {
    const el = $('#toast');
    toastAction = (opts && opts.action) || null;
    el.className = 'show' + (opts && opts.fehler ? ' fehler' : '');
    const fehler = !!(opts && opts.fehler);
    el.innerHTML = `<span>${esc(text)}</span>` + (toastAction ? `<button data-action="toast-action">${esc(opts.actionLabel)}</button>` : '')
      + (fehler ? '<button data-action="toast-zu" title="Meldung schliessen" aria-label="Meldung schliessen">OK</button>' : '');
    clearTimeout(toastTimer);
    // Fehlermeldungen bleiben stehen, bis sie mit OK geschlossen werden; andere Meldungen je nach Länge länger sichtbar.
    if (fehler && !(opts && opts.dauer)) return;
    const lesezeit = 2500 + String(text).length * 60;
    toastTimer = setTimeout(() => { el.className = ''; toastAction = null; }, (opts && opts.dauer) || Math.max(opts && opts.action ? 8000 : 4000, Math.min(lesezeit, 15000)));
  }

  /* ============ Normalisieren ============ */

  function normPlan(zeilen) {
    return (zeilen || []).map((z) => ({ sektion: String(z.sektion || ''), gruppe: String(z.gruppe || ''), konto: String(z.konto || ''), text: z.text || '', bklasse: String(z.bklasse || ''), summe_in: String(z.summe_in || '') }));
  }

  function normalize(d) {
    if (!d || typeof d !== 'object' || (!Array.isArray(d.buchungen) && !d.kontenplaene)) throw new Error('Die Datei enthält keine Buchhaltungs-Daten.');
    const out = Object.assign({}, d, C.emptyData());   // Unbekanntes aus neueren Versionen bleibt erhalten
    out.settings = Object.assign({}, C.DEFAULTS, d.settings || {});
    out.geloescht = Object.assign({}, d.geloescht || {});
    out.settingsMod = d.settingsMod || 0;
    out.buchungen = (d.buchungen || []).filter((b) => b && b.datum && C.isNum(b.betrag)).map((b, i) => ({
      id: b.id || uid('b'), jahr: +b.jahr || C.gjJahr(out.settings, b.datum), datum: b.datum, beleg: String(b.beleg == null ? '' : b.beleg), text: b.text || '',
      soll: String(b.soll == null ? '' : b.soll), haben: String(b.haben == null ? '' : b.haben), betrag: b.betrag, pos: C.isNum(b.pos) ? b.pos : i + 1, mod: b.mod || 0,
      vorschlag: !!b.vorschlag, sicher: !!b.sicher, bankText: b.bankText || '', bankSchluessel: b.bankSchluessel || '', bankDatum: b.bankDatum || null, bankNr: Number.isFinite(b.bankNr) ? b.bankNr : null,
      // Aufgeteilte Bankbewegung (z. B. Sammelzahlung): Teile verweisen auf den Hauptteil, der das Bank-Total kennt.
      ...(b.eroeffnung ? { eroeffnung: true } : {}),   // Eröffnungsbuchung aus «Aus Vorjahr eröffnen»
      ...(b.teilVon ? { teilVon: String(b.teilVon) } : {}), ...(C.isNum(b.bankTotal) ? { bankTotal: b.bankTotal } : {}),
    }));
    out.budgets = {};
    for (const [jahr, bu] of Object.entries(d.budgets || {})) {
      const posten = {};
      for (const [konto, p] of Object.entries((bu && bu.posten) || {})) {
        const q = {};
        if (p && typeof p.text === 'string' && p.text.trim()) q.text = p.text.trim();
        if (p && C.isNum(p.intern)) q.intern = p.intern;
        if (p && C.isNum(p.extern)) q.extern = p.extern;
        if (p && C.isNum(p.ist)) q.ist = p.ist;   // tatsächlich, von Hand (nur für Jahre ohne Buchhaltung in der App)
        if (Object.keys(q).length) posten[String(konto)] = q;
      }
      out.budgets[jahr] = { mod: (bu && bu.mod) || 0, posten };
    }
    out.bankZeilen = {};
    for (const [jahr, bz] of Object.entries(d.bankZeilen || {})) {
      out.bankZeilen[jahr] = { mod: (bz && bz.mod) || 0, zeilen: ((bz && bz.zeilen) || []).filter((z) => z && z.datum && C.isNum(z.betrag)).map((z, i) => ({ datum: z.datum, text: z.text || '', betrag: z.betrag, saldo: C.isNum(z.saldo) ? z.saldo : null, schluessel: z.schluessel || '', nr: C.isNum(z.nr) ? z.nr : i })) };
    }
    out.kontenplaene = {};
    const isoDatum = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(x || '') ? x : null);
    for (const [jahr, plan] of Object.entries(d.kontenplaene || {})) {
      out.kontenplaene[jahr] = { mod: plan.mod || 0, zeilen: normPlan(plan.zeilen) };
      // eigener Zeitraum eines importierten Geschäftsjahres
      if (isoDatum(plan.von) && isoDatum(plan.bis)) Object.assign(out.kontenplaene[jahr], { von: plan.von, bis: plan.bis });
    }
    return out;
  }

  /* ============ Rahmen ============ */

  const NAV = [
    ['buchhaltung', 'Buchhaltung'],
    ['budget', 'Budget'],
    ['einstellungen', 'Einstellungen'],
  ];

  function years() {
    // Das nächste Jahr ist immer wählbar, damit sich ein neues Jahr eröffnen lässt.
    const jetzt = C.gjJahr(state.data.settings, heute);
    const ys = new Set([jetzt, jetzt + 1, state.year]);
    for (const y of Object.keys(state.data.kontenplaene || {})) ys.add(+y);
    for (const y of Object.keys(state.data.budgets || {})) ys.add(+y);
    for (const b of state.data.buchungen) ys.add(b.jahr);
    return [...ys].sort((a, b) => b - a);
  }

  function render() {
    const act = document.activeElement;
    const keep = act && act.id ? { id: act.id, a: act.selectionStart, b: act.selectionEnd } : null;
    const main = $('.main');
    const scroll = main ? main.scrollTop : 0;
    // Liste der Buchhaltung (eigener Scrollbereich): Position behalten, solange Reiter, Jahr und Unterreiter gleich bleiben
    const bhKey = () => { const t = $('.bh-bar .seg .on'); return `${state.view}|${state.year}|${t ? t.dataset.tab : ''}`; };
    const bw = $('.bh-wrap'), bwScroll = bw ? { key: bhKey(), top: bw.scrollTop, left: bw.scrollLeft } : null;

    if (!state.geladen) { $('#app').innerHTML = '<div class="leer"><p>Daten werden geladen …</p></div>'; return; }
    if (!state.data) { $('#app').innerHTML = viewStart(); return; }

    const views = { buchhaltung: () => BH.view(), budget: () => BU.view(), einstellungen: viewEinstellungen };
    const firma = String(state.data.settings.firma || '').trim() || 'Rapid Openair';
    $('#app').innerHTML = `
      <nav class="side">
        <div class="brand"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="7" fill="#c81e26"/><text x="16" y="23.6" text-anchor="middle" font-size="21.5" font-weight="800" fill="#fff" font-family="Inter, 'Segoe UI', Arial, sans-serif">R</text></svg>
          <div><strong>Buchhaltung</strong><span>${esc(firma)}</span></div></div>
        <div class="navlist">${NAV.map(([k, l]) => `<button class="nav ${state.view === k ? 'on' : ''}" data-action="nav" data-view="${k}">${l}</button>`).join('')}</div>
        <label class="yearpick">Jahr
          <select id="year-select" data-action="year">${years().map((y) => `<option ${y === state.year ? 'selected' : ''}>${y}</option>`).join('')}</select>
        </label>
        ${state.update && !state.updateZu ? `<div class="update-hinweis" role="status">
          <button class="update-zu" data-action="update-zu" title="Ausblenden">×</button>
          <strong>Neue Version ${esc(state.update.version)}</strong>
          <span>Installiert ist ${esc(state.update.installiert)}.</span>
          <a href="${esc(state.update.url)}" target="_blank" rel="noopener">Herunterladen</a>
        </div>` : ''}
      </nav>
      <main class="main view-${state.view}">${views[state.view]()}</main>`;

    const m2 = $('.main'); if (m2) m2.scrollTop = scroll;
    const bw2 = $('.bh-wrap'); if (bw2 && bwScroll && bwScroll.key === bhKey()) { bw2.scrollTop = bwScroll.top; bw2.scrollLeft = bwScroll.left; }
    if (keep) {
      const el = document.getElementById(keep.id);
      if (el) { el.focus(); try { if (keep.a != null) el.setSelectionRange(keep.a, keep.b); } catch (_) { /* nicht jedes Feld kann das */ } }
    }
  }

  /* ============ Start ohne Daten ============ */

  function viewStart() {
    return `<div class="leer"><div class="leer-box">
      <h1>Buchhaltung Rapid Openair</h1>
      ${state.fehler ? `<p class="warn">${esc(state.fehler)}</p>` : ''}
      ${state.veraltet ? '' : `<p>Es sind noch keine Daten vorhanden. Importiere eine Buchhaltung aus Banana (Excel-Export) oder einen Kontenplan, oder starte leer und lade den Kontenplan später.</p>
      <div class="row"><button class="btn primary" data-action="import">Importieren</button>
      <button class="btn" data-action="start-empty">Leer starten</button></div>`}
    </div></div>`;
  }

  /* ============ Einstellungen ============ */

  function viewEinstellungen() {
    const s = state.data.settings;
    const jahre = Object.keys(state.data.kontenplaene).sort();
    const plan = state.data.kontenplaene[state.year];
    const kandidaten = plan ? BH.bankKandidaten() : [];
    const bank = plan ? BH.BANK_() : '';
    const nB = state.data.buchungen.filter((b) => !b.vorschlag).length;
    return `
    <header class="head"><h1>Einstellungen</h1></header>
    <div class="settings">
      <section class="sec"><h2>Allgemein</h2>
        <div class="cols2">
          <div class="fld"><label for="s-firma">Name in Titel und Dossier</label><input id="s-firma" type="text" value="${esc(s.firma || '')}" data-action="setting-text" data-key="firma"><small>Steht oben links, auf dem Dossier als PDF und in dessen Dateinamen.</small></div>
          <div class="fld"><label for="s-gj">Beginn des Geschäftsjahres</label>
            <select id="s-gj" data-action="gj-beginn">${MONATE.map((m, i) => { const v = `${pad(i + 1)}-01`; return `<option value="${v}" ${C.gjBeginn(s) === v ? 'selected' : ''}>1. ${m}</option>`; }).join('')}</select>
            <small>Das Geschäftsjahr ${state.year} dauert vom ${C.zeitraum(state.data, state.year).text}. Es trägt die Jahreszahl, in der es endet.</small></div>
          <div class="fld"><label for="s-bank">Bankkonto für den E-Banking-Import (${state.year})</label>
            ${plan ? `<select id="s-bank" data-action="bank-konto">${kandidaten.map((z) => `<option value="${esc(z.konto)}" ${z.konto === bank ? 'selected' : ''}>${esc(z.konto)} ${esc(z.text)}</option>`).join('')}</select>
            <small>Gegen dieses Konto werden die Bewegungen aus dem CSV-Export der GKB gebucht.${s.bankKonto ? '' : ' Zurzeit automatisch gewählt.'}</small>`
            : `<input id="s-bank" type="text" disabled value="Für ${state.year} gibt es noch keinen Kontenplan"><small>Sobald der Kontenplan geladen ist, kannst du hier das Bankkonto wählen.</small>`}</div>
        </div>
      </section>
      <section class="sec"><h2>Daten</h2>
        <p>Version ${esc(state.info.version)}. Enthalten sind ${nB} Buchungen (${jahre.join(', ') || 'noch kein Kontenplan'}). Auf beiden Rechnern müssen hier dieselben Zahlen stehen.</p>
        <p>Gespeichert in <code>${esc(state.info.dataPath)}</code>. Jede Änderung wird sofort gesichert; im Unterordner «Sicherungen» liegt pro Tag eine Kopie des Vortagsstands.</p>
        <p>Für die Arbeit auf zwei Rechnern legst du den Speicherort in deinen Dropbox-Ordner und wählst auf dem zweiten Rechner denselben Ordner. Änderungen vom anderen Rechner erscheinen dann von selbst.</p>
        <div class="row">
          <button class="btn" data-action="open-folder">Ordner öffnen</button>
          <button class="btn" data-action="choose-folder">Speicherort ändern</button>
          <button class="btn" data-action="export">Daten exportieren</button>
          <button class="btn" data-action="import">Importieren</button>
        </div>
        <p class="hint">Importieren nimmt den Excel-Export einer Banana-Buchhaltung (in Banana: Datei → Datei exportieren → Export in Excel), eine Datei mit Kontenplan und Buchungen eines Geschäftsjahres oder eine exportierte Datendatei der App. Ein Geschäftsjahr aus Banana ersetzt nur dieses Jahr; die anderen Jahre bleiben.</p>
      </section>
    </div>`;
  }

  /* ============ Import ============ */

  async function doImport() {
    const r = await api.importFile();
    if (!r || r.canceled) return;
    if (r.error) { toast(r.error, { fehler: true }); return; }
    let d = r.data || {};
    if (r.text != null) {
      // Excel-Export aus Banana
      try { d = window.Banana.lesen(r.text); } catch (e) { toast(e.message, { fehler: true }); return; }
    }
    if (d.typ === 'budget') {
      // Budgets einzelner Jahre (intern und extern); andere Jahre bleiben unverändert
      if (!state.data) { state.data = C.emptyData(); merkeAbbild(); }
      const jahre = Object.keys(d.budgets || {}).filter((j) => /^\d{4}$/.test(j)).sort();
      if (!jahre.length) { toast('Die Datei enthält kein Budget.', { fehler: true }); return; }
      const schon = jahre.filter((j) => state.data.budgets[j] && Object.keys(state.data.budgets[j].posten).length);
      if (schon.length && !confirm(`Für ${schon.join(', ')} gibt es schon ein Budget. Der Import ersetzt ${schon.length === 1 ? 'es' : 'sie'}. Fortfahren?`)) return;
      await api.save(state.data, { sicherungErzwingen: true });
      for (const j of jahre) state.data.budgets[j] = { mod: 0, posten: d.budgets[j].posten || {} };
      state.data = normalize(state.data);
      await persist();
      state.year = +jahre[jahre.length - 1]; state.view = 'budget'; render();
      toast(`Budget ${jahre.join(', ')} übernommen`);
      return;
    }
    if (d.typ === 'buchhaltung' || d.typ === 'kontenplan') {
      // Kontenplan eines Geschäftsjahres, allenfalls mit Buchungen
      if (!state.data) { state.data = C.emptyData(); merkeAbbild(); }
      const j = +d.jahr || state.year, neueB = Array.isArray(d.buchungen) ? d.buchungen : [];
      if (!Array.isArray(d.kontenplan) || !d.kontenplan.some((z) => z && z.konto)) { toast('Die Datei enthält keinen Kontenplan.', { fehler: true }); return; }
      const nKonten = d.kontenplan.filter((z) => z && z.konto).length;
      const zeitraum = d.von && d.bis ? `${fmtDate(d.von)} bis ${fmtDate(d.bis)}` : '';
      const ausserhalb = d.von && d.bis ? neueB.filter((b) => b.datum < d.von || b.datum > d.bis).length : 0;
      const alte = state.data.buchungen.filter((b) => b.jahr === j);
      const schonDa = alte.length || state.data.kontenplaene[j];
      const frage = (r.text != null ? `Banana-Export: Geschäftsjahr ${j}${zeitraum ? ` (${zeitraum})` : ''} mit ${nKonten} Konten und ${neueB.length} Buchungen${d.eroeffnungAusKonten ? ` (davon ${neueB.filter((b) => b.eroeffnung).length} aus den Eröffnungssaldi)` : ''}.` : '')
        + (ausserhalb ? ` Achtung: ${ausserhalb} Buchungen liegen ausserhalb dieses Zeitraums.` : '')
        + (d.ohneKonto ? ` ${d.ohneKonto} Zeilen ohne Soll- oder Habenkonto werden übersprungen.` : '')
        + (schonDa ? ` Für ${j} gibt es schon eine Buchhaltung mit ${alte.length} Buchungen. Der Import ersetzt den Kontenplan${neueB.length ? ` und die Buchungen durch die aus der Datei` : '; die Buchungen bleiben'}. Der bisherige Stand wird vorher gesichert.` : '');
      if ((r.text != null || schonDa || ausserhalb) && !confirm(`${frage.trim()} Importieren?`)) return;
      const erstesJahr = !Object.keys(state.data.kontenplaene).length && !state.data.buchungen.length;
      await api.save(state.data, { sicherungErzwingen: true });
      if (neueB.length) state.data.buchungen = state.data.buchungen.filter((b) => b.jahr !== j).concat(neueB.map((b) => Object.assign({}, b, { id: undefined, jahr: j })));
      state.data.kontenplaene[j] = { zeilen: normPlan(d.kontenplan), mod: 0 };
      // Eigener Zeitraum des importierten Geschäftsjahres; Beginn und Name gelten für die ganze App nur beim ersten Import
      if (d.von && d.bis) Object.assign(state.data.kontenplaene[j], { von: d.von, bis: d.bis });
      if (erstesJahr && d.gjBeginn && C.gjBeginn({ gjBeginn: d.gjBeginn }) === d.gjBeginn) state.data.settings.gjBeginn = d.gjBeginn;
      if (erstesJahr && d.firma) state.data.settings.firma = String(d.firma);
      state.data = normalize(state.data);
      await persist();
      state.year = j; state.view = 'buchhaltung'; render();
      toast(`Buchhaltung ${j}: Kontenplan mit ${nKonten} Konten übernommen${neueB.length ? `, ${neueB.length} Buchungen` : ''}`);
      return;
    }
    let neu;
    try { neu = normalize(d); } catch (e) { toast(e.message, { fehler: true }); return; }
    if (state.data && (state.data.buchungen.length || Object.keys(state.data.kontenplaene).length)) {
      if (!confirm(`Der Import ersetzt alle vorhandenen Daten (${state.data.buchungen.length} Buchungen) durch ${neu.buchungen.length} Buchungen aus der Datei. Der bisherige Stand wird vorher gesichert. Fortfahren?`)) return;
      await api.save(state.data, { sicherungErzwingen: true });
    }
    neu.geloescht = Object.assign({}, state.data ? state.data.geloescht : {});
    state.data = neu; state.fehler = null;
    merkeAbbild(); abbild.s = '';
    await persist({ ersetzen: true });
    render();
    toast(`${neu.buchungen.length} Buchungen importiert`);
  }

  /* ============ Aktionen ============ */

  document.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    switch (el.dataset.action) {
      case 'update-zu': state.updateZu = true; render(); break;
      case 'nav': state.view = el.dataset.view; render(); break;
      case 'toast-action': if (toastAction) { const f = toastAction; toastAction = null; $('#toast').className = ''; f(); } break;
      case 'toast-zu': { const t = $('#toast'); t.className = ''; toastAction = null; break; }
      case 'import': await doImport(); break;
      case 'start-empty': state.data = C.emptyData(); merkeAbbild(); await persist(); render(); break;
      case 'export': { const r = await api.exportFile(state.data); if (r && r.path) toast('Exportiert nach ' + r.path); break; }
      case 'open-folder': api.openFolder(); break;
      case 'choose-folder': {
        const r = await api.chooseFolder();
        if (!r || r.canceled) break;
        if (r.vorhanden) { const l = await api.load(); if (l.data) { state.data = normalize(l.data); merkeAbbild(); } }
        else await persist();
        state.info = await api.info(); render();
        toast(r.vorhanden ? 'Vorhandene Daten am neuen Speicherort geladen' : 'Speicherort geändert');
        break;
      }
      default: break;
    }
  });

  document.addEventListener('change', (ev) => {
    const el = ev.target, a = el.dataset && el.dataset.action;
    if (!a) return;
    if (a === 'year') { state.year = +el.value; render(); }
    else if (a === 'setting-text') { const v = el.value.trim(); if (v) state.data.settings[el.dataset.key] = v; else delete state.data.settings[el.dataset.key]; persist(); render(); }
    else if (a === 'gj-beginn') {
      // Bestehende Buchungen bleiben in ihrem Geschäftsjahr; nur neue Buchungen und Datumsprüfungen folgen dem neuen Beginn.
      if (state.data.buchungen.length && !confirm('Den Beginn des Geschäftsjahres ändern? Bestehende Buchungen bleiben in ihrem bisherigen Jahr; geprüft wird künftig nach dem neuen Zeitraum.')) { render(); return; }
      state.data.settings.gjBeginn = el.value; persist(); render(); toast(`Das Geschäftsjahr beginnt neu am ${el.value.slice(3)}.${el.value.slice(0, 2)}.`);
    }
    else if (a === 'bank-konto') { state.data.settings.bankKonto = el.value; persist(); render(); toast(`Bankbewegungen werden gegen das Konto ${el.value} gebucht`); }
  });

  document.addEventListener('submit', (ev) => { if (!ev.defaultPrevented) ev.preventDefault(); });

  /* ============ Start ============ */

  async function start() {
    render();
    try {
      state.info = await api.info();
      const r = await api.load();
      if (r.error) state.fehler = r.error;
      if (r.veraltet) { state.fehler = r.veraltet; state.veraltet = true; state.geladen = true; render(); return; }
      if (r.data) { state.data = normalize(r.data); merkeAbbild(); state.year = C.gjJahr(state.data.settings, heute); }
      if (r.eingearbeitet) setTimeout(() => toast('Änderungen von einem anderen Rechner wurden eingearbeitet.'), 400);
      if (api.onChanged) api.onChanged(holeAenderungen);
    } catch (e) {
      state.fehler = 'Die Daten konnten nicht geladen werden: ' + e.message;
    }
    state.geladen = true;
    render();
  }

  async function pruefeUpdate() {
    if (!api.update) return;
    try {
      const u = await api.update();
      if (!u) return;
      if (state.update && state.update.version === u.version) return;
      state.update = u; state.updateZu = false; render();
    } catch (_) { /* egal */ }
  }
  setTimeout(pruefeUpdate, 1500);
  setInterval(pruefeUpdate, 6 * 3600 * 1000);

  const BH = window.Buchhaltung({ state, C, esc, fmtDate, heute, persist, render, toast, api, uid });
  const BU = window.Budget({ state, C, esc, fmtDate, heute, persist, render, toast, api });
  window.__app = { state, render, persist };
  start();
})();
