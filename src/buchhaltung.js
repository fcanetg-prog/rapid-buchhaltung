/* Buchhaltung: Buchungen, Konten, Bilanz und Erfolgsrechnung, Kontoauszug, E-Banking-Abgleich, Dossier als PDF. */
(function () {
  'use strict';
  const L = window.Ledger;

  window.Buchhaltung = function (ctx) {
    const { state, C, esc, fmtDate, heute, persist, render, toast, api, uid } = ctx;
    const $ = (sel, root) => (root || document).querySelector(sel);
    const VIEW = 'buchhaltung';
    const TITEL = 'Buchhaltung';
    const DB = () => state.data.buchungen || (state.data.buchungen = []);
    const KP = () => state.data.kontenplaene || (state.data.kontenplaene = {});
    const BZ_ = () => state.data.bankZeilen || (state.data.bankZeilen = {});
    /** Gespeicherte Bankbewegungen pro Jahr. */
    const bzKey = (j) => String(j);

    const S = state.bh = { tab: 'buchungen', konto: null, edit: null, q: '', alleKonten: false, neu: null, kEdit: null };

    /* ---------- Daten ---------- */

    const jahr = () => state.year;
    const plan = () => { const p = KP()[jahr()]; return p ? p.zeilen : null; };
    // Vorschläge aus dem Bankabgleich zählen erst, wenn sie bestätigt sind.
    const buchungen = () => DB().filter((b) => b.jahr === jahr() && !b.vorschlag);
    // Neueste zuoberst, wie in der Liste der Buchungen.
    /* Reihenfolge wie im E-Banking: Die eingelesenen Bankbewegungen sind gespeichert; daraus ergibt sich der Platz jeder
       Buchung, auch für später von Hand erfasste oder geänderte Buchungen, ohne dass die Datei neu eingelesen werden muss. */
    let platzMemo = { sig: '', map: new Map() };
    function plaetze() {
      const bz = BZ_()[bzKey(jahr())];
      if (!bz || !bz.zeilen.length) return null;
      const alle = DB().filter((b) => b.jahr === jahr());
      const sig = `${jahr()}|${bz.zeilen.length}|${bz.mod}|${alle.map((b) => `${b.id}:${b.datum}:${b.betrag}:${b.soll}:${b.haben}:${b.bankSchluessel || ''}`).join(',')}`;
      if (platzMemo.sig !== sig) platzMemo = { sig, map: L.bankPlaetze(bz.zeilen, abgleichbar(alle), BANK_()) };
      return platzMemo.map;
    }
    const vorschlaege = () => L.bankSortiert(DB().filter((b) => b.jahr === jahr() && b.vorschlag), plaetze()).reverse();
    /**
     * Buchungen, die mit E-Banking-Bewegungen abgeglichen werden dürfen. Aus dem Excel übernommene Buchungen («BEBU …»)
     * tragen kein echtes Bankdatum (alle auf demselben Tag) und würden sonst neue Bewegungen mit gleichem Betrag fälschlich als verbucht erkennen.
     */
    const abgleichbar = (liste) => liste.filter((b) => !/^BEBU \d{4}:/.test(b.bankText || ''));
    /** Konten des Kontenplans, die als Bankkonto für den E-Banking-Import in Frage kommen (Aktiven). */
    const bankKandidaten = () => konten().filter((z) => String(z.bklasse) === '1');
    /**
     * Bankkonto, gegen das die E-Banking-Bewegungen (GKB) gebucht werden: das in den Einstellungen gewählte,
     * sonst das erste Aktivkonto mit GKB, Kantonalbank oder Bank im Namen, sonst 1020 oder 1010.
     */
    function BANK_() {
      const gewaehlt = state.data.settings.bankKonto;
      if (gewaehlt && konten().some((z) => z.konto === gewaehlt)) return gewaehlt;
      const k = bankKandidaten().find((z) => /\bgkb\b|kantonalbank/i.test(z.text)) || bankKandidaten().find((z) => /bank/i.test(z.text))
        || konten().find((z) => z.konto === '1020') || konten().find((z) => z.konto === '1010');
      return k ? k.konto : '';
    }
    const vorschlagOpt = () => ({});
    const konten = () => (plan() || []).filter((z) => z.konto);
    const kontoName = (nr) => { const z = konten().find((x) => x.konto === nr); return z ? z.text : ''; };
    const firma = () => String(state.data.settings.firma || '').trim() || 'Rapid Openair';

    function chf(x, leerBeiNull) {
      if (x == null || !isFinite(x) || (leerBeiNull && Math.abs(x) < 0.005)) return '';
      const [g, r] = Math.abs(x).toFixed(2).split('.');
      return (x < -0.004 ? '-' : '') + g.replace(/\B(?=(\d{3})+(?!\d))/g, '’') + '.' + r;
    }

    function neuVorlage() {
      const bs = buchungen();
      const letzte = L.sortiert(bs).pop();
      return { datum: letzte && letzte.datum > `${jahr()}-01-01` ? (heute.startsWith(String(jahr())) ? heute : letzte.datum) : (heute.startsWith(String(jahr())) ? heute : `${jahr()}-01-01`), beleg: L.naechsterBeleg(bs), text: '', soll: '', haben: '', betrag: '' };
    }
    function neu() {
      if (!S.neu || S.neuJahr !== jahr()) { S.neu = neuVorlage(); S.neuJahr = jahr(); }
      return S.neu;
    }

    /** Prüft eine Buchung aus dem Formular. Gibt die fertige Buchung oder eine Fehlermeldung zurück. */
    function pruefe(f) {
      const betrag = C.parseAmount(f.betrag);
      const nummern = new Set(konten().map((z) => z.konto));
      const soll = String(f.soll).trim().split(/\s/)[0], haben = String(f.haben).trim().split(/\s/)[0];
      if (!f.datum) return { fehler: 'Das Datum fehlt.', feld: 'datum' };
      if (!f.datum.startsWith(jahr() + '-')) return { fehler: `Das Datum liegt nicht im Jahr ${jahr()}. Wähle links das passende Jahr.`, feld: 'datum' };
      if (!String(f.text).trim()) return { fehler: 'Die Beschreibung fehlt.', feld: 'text' };
      if (!nummern.has(soll)) return { fehler: `Das Soll-Konto «${soll}» gibt es im Kontenplan nicht.`, feld: 'soll' };
      if (!nummern.has(haben)) return { fehler: `Das Haben-Konto «${haben}» gibt es im Kontenplan nicht.`, feld: 'haben' };
      if (betrag == null || betrag <= 0) return { fehler: 'Der Betrag muss eine Zahl grösser als null sein.', feld: 'betrag' };
      return { buchung: { datum: f.datum, beleg: String(f.beleg).trim(), text: String(f.text).trim(), soll, haben, betrag: Math.round(betrag * 100) / 100 } };
    }

    /* ---------- Ansicht ---------- */

    const TABS = [['buchungen', 'Buchungen'], ['konten', 'Konten'], ['abschluss', 'Bilanz und Erfolgsrechnung'], ['auszug', 'Kontoauszug']];

    function view() {
      if (!plan()) return viewLeer();
      const t = L.totalsummen(plan(), buchungen());
      const gewinn = -t.erfolg;
      const inhalt = { buchungen: viewBuchungen, konten: viewKonten, abschluss: viewAbschluss, auszug: viewAuszug }[S.tab]();
      return `
      <header class="head">
        <h1>${TITEL} ${jahr()}</h1>
        <div class="bignum"><b class="${gewinn < 0 ? 'neg' : ''}">${chf(gewinn)}</b><span>${gewinn < 0 ? 'Jahresverlust' : 'Jahresgewinn'} bisher</span></div>
      </header>
      <div class="bh-bar">
        <div class="seg">${TABS.map(([k, l]) => `<button class="${S.tab === k ? 'on' : ''}" data-bh="tab" data-tab="${k}">${l}${k === 'buchungen' && vorschlaege().length ? ` <span class="bh-zahl">${vorschlaege().length}</span>` : ''}</button>`).join('')}</div>
        <span class="grow"></span>
        ${Math.abs(t.differenz) > 0.004 ? `<span class="warn">Differenz Soll/Haben: ${chf(t.differenz)}</span>` : ''}
        <button class="btn" data-bh="bank" title="CSV-Export der Kontobewegungen aus dem E-Banking der GKB">Bankbewegungen einlesen</button>
        ${BZ_()[bzKey(jahr())] ? `<button class="btn ${S.abgl ? 'on' : ''}" data-bh="abgl" title="Zeigt für die letzten Bankbewegungen, welcher Buchung sie zugeordnet sind">Abgleich ${S.abgl ? 'ausblenden' : 'zeigen'}</button>` : ''}
        <button class="btn" data-bh="pdf">Dossier als PDF</button>
      </div>
      ${abgleichPanel()}
      ${inhalt}`;
    }

    function viewLeer() {
      const vor = KP()[jahr() - 1];
      return `<header class="head"><h1>${TITEL} ${jahr()}</h1></header>
      <div class="sec"><p>Für ${jahr()} gibt es noch keine Buchhaltung. Sobald der Kontenplan geladen ist, kannst du buchen und Bankbewegungen einlesen.</p>
        <div class="row" style="margin-top:12px">
          ${vor ? `<button class="btn primary" data-bh="eroeffnen">Aus ${jahr() - 1} eröffnen</button>` : ''}
          <button class="btn" data-action="import">Kontenplan oder Buchhaltung importieren</button>
        </div>
        ${vor ? `<p class="hint">«Eröffnen» übernimmt den Kontenplan von ${jahr() - 1} und bucht per 1. Januar die Schlusssaldi aller Bilanzkonten gegen das Vortragskonto (2970 oder das Passivkonto für Vortrag, Eigenkapital oder Vermögen). Der Jahreserfolg ${jahr() - 1} landet damit im Vortrag.</p>` : ''}
      </div>`;
    }


    function formZeile(f, pre, aktion) {
      const feld = (key, extra) => `<input id="${pre}-${key}" data-bh="feld" data-form="${aktion}" data-key="${key}" value="${esc(f[key])}" ${extra || ''}>`;
      return `
        <td>${feld('datum', 'type="date"')}</td>
        <td>${feld('beleg', 'type="text"')}</td>
        <td>${feld('text', 'type="text" list="bh-texte" placeholder="Beschreibung"')}</td>
        <td>${feld('soll', 'type="text" data-kontowahl="1" autocomplete="off" placeholder="Soll" inputmode="numeric"')}</td>
        <td>${feld('haben', 'type="text" data-kontowahl="1" autocomplete="off" placeholder="Haben" inputmode="numeric"')}</td>
        <td>${feld('betrag', 'type="text" class="num r" placeholder="0.00" inputmode="decimal"')}</td>`;
    }

    function viewBuchungen() {
      // In der Reihenfolge der Bank (wie im E-Banking), Buchungen ohne Bankbewegung an ihrem Datum.
      const alle = L.bankSortiert(buchungen(), plaetze());
      const q = S.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const liste = alle.filter((b) => !q.length || q.every((t) => `${fmtDate(b.datum)} ${b.beleg} ${b.text} ${b.soll} ${b.haben} ${b.betrag.toFixed(2)}`.toLowerCase().includes(t))).reverse();
      const texte = [...new Set(alle.map((b) => b.text))].sort();
      const summe = liste.reduce((a, b) => a + b.betrag, 0);
      const zeile = (b) => (S.edit === b.id
        ? `<tr class="bh-edit" data-id="${b.id}">${formZeile(S.editForm, 'be', 'edit')}
            <td class="r"><button class="btn small primary" data-bh="edit-save">Speichern</button> <button class="btn small" data-bh="edit-cancel">Abbrechen</button> <button class="btn small danger" data-bh="del" data-id="${b.id}">Löschen</button></td></tr>`
        : `<tr class="bh-row" data-bh="edit" data-id="${b.id}" tabindex="0">
            <td class="num">${fmtDate(b.datum)}</td><td>${esc(b.beleg)}</td><td class="bt" title="${esc(b.text)}">${esc(b.text)}</td>
            <td class="num" title="${esc(kontoName(b.soll))}">${esc(b.soll)}</td><td class="num" title="${esc(kontoName(b.haben))}">${esc(b.haben)}</td>
            <td class="num r">${chf(b.betrag)}</td><td></td></tr>`);
      return `
      <datalist id="bh-texte">${texte.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
      <div class="bh-wrap"><table class="bh-tab">
        <colgroup><col style="width:120px"><col style="width:62px"><col><col style="width:68px"><col style="width:68px"><col style="width:104px"><col style="width:${S.edit ? 272 : vorschlaege().length ? 236 : 196}px"></colgroup>
        <thead><tr><th>Datum</th><th>Beleg</th><th>Beschreibung</th><th>Soll</th><th>Haben</th><th class="r">Betrag CHF</th>
          <th class="r"><input type="search" id="bh-q" placeholder="Suchen" value="${esc(S.q)}" data-bh="suche"></th></tr></thead>
        <tbody>
          <tr class="bh-neu">${formZeile(neu(), 'bn', 'neu')}<td class="r"><button class="btn primary small" data-bh="neu-save">Buchen</button> <span class="dim" id="bh-hinweis">${esc(hinweisNeu())}</span></td></tr>
          ${vorschlagZeilen()}
          ${liste.map(zeile).join('')}
        </tbody>
        <tfoot><tr><td colspan="5">${liste.length} Buchungen${q.length ? ' gefunden' : ''}</td><td class="num r">${chf(summe)}</td><td></td></tr></tfoot>
      </table></div>`;
    }

    function vHinweis(v) {
      if (istSammel(v) && !v.teilVon && !teile(v).length) return 'Sammelzahlung: bitte aufteilen';
      const gegen = v.soll === BANK_() ? v.haben : v.soll;
      if (!gegen) return 'Gegenkonto fehlt';
      const name = kontoName(gegen) || 'Konto unbekannt';
      return v.sicher ? name : `${name}, bitte prüfen`;
    }

    /* Aufteilen einer Bankbewegung (Sammelzahlung): Der Hauptteil kennt das Bank-Total und erhält jeweils den Rest. */
    const istSammel = (v) => /^sammel(zahlung|auftrag)/i.test(String(v.bankText || '').trim());
    // Alle Teile, auch schon bestätigte: Sie gehören weiterhin zur selben Bankbewegung.
    const teile = (h) => DB().filter((x) => x.teilVon === h.id);
    const hauptVon = (v) => (v.teilVon ? DB().find((x) => x.id === v.teilVon) : v);
    function restRechnen(h) {
      if (!h || !h.vorschlag || !C.isNum(h.bankTotal)) return;
      h.betrag = L.round2(h.bankTotal - teile(h).reduce((s, t) => s + (t.betrag || 0), 0));
    }
    function aufteilen(v) {
      const h = hauptVon(v);
      if (!C.isNum(h.bankTotal)) h.bankTotal = h.betrag;
      const ausgang = h.haben === BANK_();
      const t = { id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), jahr: h.jahr, datum: h.datum, beleg: '', text: '', soll: ausgang ? '' : BANK_(), haben: ausgang ? BANK_() : '', betrag: 0,
        vorschlag: true, sicher: false, bankText: h.bankText, bankSchluessel: h.bankSchluessel, bankDatum: h.bankDatum, bankNr: h.bankNr, teilVon: h.id, pos: h.pos };
      DB().push(t);
      return t;
    }

    /** Buchungsvorschläge aus dem Bankabgleich: farbig, direkt änderbar, zählen erst nach dem Bestätigen. */
    function vorschlagZeilen() {
      const vs = vorschlaege();
      if (!vs.length) return '';
      const sal = L.saldi(buchungen()).get(BANK_());
      let nach = sal ? sal.saldo : 0;
      for (const v of vs) nach += v.soll === BANK_() ? v.betrag : v.haben === BANK_() ? -v.betrag : 0;
      const bank = S.bank && S.bank.jahr === jahr() ? S.bank : null;
      const stimmt = bank && bank.saldo != null && Math.abs(nach - bank.saldo) < 0.005;
      const kopf = `<tr class="bh-vkopf"><td colspan="7"><div class="bh-vk"><b>${vs.length} ${vs.length === 1 ? 'Vorschlag' : 'Vorschläge'} aus dem E-Banking</b>
        <span>Prüfen und bestätigen. Bis dahin zählen sie nicht mit.</span>
        <span class="grow"></span>
        ${bank && bank.saldo != null ? `<span class="${stimmt ? 'pos' : 'neg'}">Bank per ${fmtDate(bank.datum)}: ${chf(bank.saldo)}, Konto ${BANK_()} danach: ${chf(nach)}${stimmt ? ' ✓' : ''}</span>` : ''}
        <button class="btn small" data-bh="v-alle">Alle eindeutigen bestätigen</button></div></td></tr>`;
      const feld = (v, key, extra) => `<input id="bv-${v.id}-${key}" data-bh="vfeld" data-id="${v.id}" data-key="${key}" value="${esc(v[key])}" ${extra || ''}>`;
      return kopf + vs.map((v) => {
        const gegen = v.soll === BANK_() ? v.haben : v.soll;
        const h = hauptVon(v), nTeile = h ? teile(h).length : 0, hauptMitTeilen = !v.teilVon && nTeile > 0;
        return `<tr class="bh-vor ${gegen && v.sicher ? '' : 'unsicher'} ${v.teilVon || hauptMitTeilen ? 'bh-teil' : ''}" data-id="${v.id}">
          <td class="num">${feld(v, 'datum', 'type="date" class="bh-vdat"')}</td><td></td>
          <td>${feld(v, 'text', 'type="text" list="bh-texte"')}<div class="bh-banktext" title="${esc(v.bankText)}">${esc(v.bankText)}</div></td>
          <td>${feld(v, 'soll', 'type="text" data-kontowahl="1" autocomplete="off" placeholder="Soll"')}</td>
          <td>${feld(v, 'haben', 'type="text" data-kontowahl="1" autocomplete="off" placeholder="Haben"')}</td>
          <td class="num r">${hauptMitTeilen ? `<span class="bh-rest" title="Rest der Bankbewegung von ${chf(h.bankTotal)}">${chf(v.betrag)}</span>` : `<input id="bv-${v.id}-betrag" data-bh="vfeld" data-id="${v.id}" data-key="betrag" type="text" class="num r bh-vbetrag" inputmode="decimal" value="${esc(Number(v.betrag).toFixed(2))}">`}</td>
          <td class="r"><button class="btn small primary" data-bh="v-ok" data-id="${v.id}">Bestätigen</button> ${v.teilVon ? `<button class="btn small" data-bh="v-teil-weg" data-id="${v.id}" title="Diesen Teil entfernen; der Betrag geht zurück zum ersten Teil">×</button>` : `<button class="btn small" data-bh="v-weg" data-id="${v.id}" title="Nicht verbuchen und bei künftigen Importen nicht mehr vorschlagen">Verwerfen</button>`}
            <div class="bh-vhin"><button class="link bh-teilen" data-bh="v-teilen" data-id="${v.id}" title="Die Bankbewegung auf mehrere Buchungen aufteilen (z. B. Sammelzahlung)">Aufteilen</button> · ${v.teilVon ? 'Teil · ' : hauptMitTeilen ? `Rest von ${chf(h.bankTotal)} · ` : ''}<span class="bh-vhin-t">${esc(vHinweis(v))}</span></div></td></tr>`;
      }).join('');
    }

    function bestaetige(v) {
      if (istSammel(v) && !v.teilVon && !teile(v).length) return 'Sammelzahlungen bitte mit «Aufteilen» einzeln verbuchen.';
      if (!v.teilVon && teile(v).length && !(v.betrag > 0)) return 'Die Teile ergeben schon das ganze Total: Entferne einen Teil oder passe die Beträge an.';
      const p = pruefe({ datum: v.datum, beleg: '', text: v.text, soll: v.soll, haben: v.haben, betrag: String(v.betrag) });
      if (p.fehler) return p.fehler;
      Object.assign(v, p.buchung, { beleg: L.naechsterBeleg(buchungen()), vorschlag: false });
      return null;
    }

    /** Die letzten Bankbewegungen mit ihrer Zuordnung: So sieht man, warum etwas nicht vorgeschlagen wird, und kann es korrigieren. */
    function abgleichPanel() {
      const bz = BZ_()[bzKey(jahr())];
      if (!S.abgl || !bz) return '';
      const alle = DB().filter((b) => b.jahr === jahr());
      const ign = new Set(state.data.settings.bankIgnoriert || []);
      const a = L.bankAbgleich(bz.zeilen, abgleichbar(alle), BANK_(), [...ign]);
      const zu = new Map(a.paare.map((p) => [p.zeile.schluessel, p.buchungen]));
      const n = S.abglAlle ? bz.zeilen.length : 20;
      const zeilen = bz.zeilen.slice(-n).reverse();
      const zeile = (z) => {
        const bs = zu.get(z.schluessel);
        let status, knopf = '';
        if (bs && bs.some((b) => b.vorschlag)) status = '<span class="over-text">Vorschlag, noch nicht bestätigt</span>';
        else if (bs) {
          status = bs.map((b) => `Beleg ${esc(b.beleg || '–')} vom ${fmtDate(b.datum)}: ${esc(b.text)}`).join('<br>');
          // Nur anbieten, wenn die Zuordnung über Betrag und Datum geraten ist (nicht bei Buchungen, die aus genau dieser Bewegung entstanden sind).
          if (!bs.some((b) => b.bankSchluessel === z.schluessel)) knopf = `<button class="btn small" data-bh="abg-neu" data-key="${esc(z.schluessel)}" title="Die Zuordnung stimmt nicht: diese Bankbewegung als neuen Vorschlag anlegen">Falsch zugeordnet</button>`;
        } else if (ign.has(z.schluessel)) { status = '<span class="dim">verworfen</span>'; knopf = `<button class="btn small" data-bh="abg-neu" data-key="${esc(z.schluessel)}">Wieder vorschlagen</button>`; }
        else { status = '<span class="neg">nicht verbucht</span>'; knopf = `<button class="btn small primary" data-bh="abg-neu" data-key="${esc(z.schluessel)}">Vorschlagen</button>`; }
        return `<tr><td class="num">${fmtDate(z.datum)}</td><td class="num r">${chf(z.betrag)}</td><td class="abg-t" title="${esc(z.text)}">${esc(z.text)}</td><td>${status}</td><td class="r">${knopf}</td></tr>`;
      };
      return `<div class="bh-abgl"><button class="x" data-bh="abgl" title="Schliessen">×</button>
        <h3>Abgleich mit der Bank</h3>
        <p>Jede Bankbewegung und die Buchung, der sie zugeordnet ist. Die neuste steht zuoberst.</p>
        <div class="bh-abgl-wrap"><table><thead><tr><th>Datum</th><th class="r">Betrag</th><th>Text der Bank</th><th>Zugeordnet</th><th></th></tr></thead><tbody>${zeilen.map(zeile).join('')}</tbody></table></div>
        ${bz.zeilen.length > 20 ? `<button class="of-mehr" data-bh="abgl-alle">${S.abglAlle ? 'Nur die letzten 20 zeigen' : `Alle ${bz.zeilen.length} zeigen`}</button>` : ''}</div>`;
    }

    /** Liest den CSV-Export aus dem E-Banking, erkennt Verbuchtes und legt für den Rest Vorschläge an. */
    async function bankEinlesen() {
      const r = await api.openText('Kontobewegungen aus dem E-Banking wählen', ['csv', 'txt']);
      if (!r || r.canceled) return;
      if (r.fehler) { toast(r.fehler, { fehler: true }); return; }
      const p = L.parseBankCsv(r.text);
      if (p.fehler) { toast(p.fehler, { fehler: true }); return; }
      if (!BANK_()) { toast('Im Kontenplan gibt es kein Bankkonto, gegen das die Bewegungen gebucht werden können.', { fehler: true }); return; }
      const z = p.zeilen.filter((x) => x.datum.startsWith(jahr() + '-'));
      if (!z.length) { toast(`Die Datei enthält keine Bewegungen im Jahr ${jahr()}. Wähle links das passende Jahr.`, { fehler: true }); return; }
      const alle = DB().filter((b) => b.jahr === jahr());
      // Bankbewegungen des Jahres merken: Sie bestimmen dauerhaft die Reihenfolge der Buchungen.
      const gemerkt = BZ_()[bzKey(jahr())] || { mod: 0, zeilen: [] };
      const zusammen = L.bankZeilenMerge(gemerkt.zeilen, z.filter((x) => Math.abs(x.betrag) > 0.004));
      const zeilenNeu = JSON.stringify(zusammen) !== JSON.stringify(gemerkt.zeilen);
      BZ_()[bzKey(jahr())] = { mod: gemerkt.mod, zeilen: zusammen };
      const a = L.bankAbgleich(z, abgleichbar(alle), BANK_(), state.data.settings.bankIgnoriert || []);
      // Gelernt wird nur aus bestätigten Buchungen.
      const lern = a.paare.filter((x) => x.buchungen.every((b) => !b.vorschlag));
      let pos = DB().reduce((m, b) => Math.max(m, b.pos || 0), 0);
      const vorschlag = (zeile) => L.bankVorschlag(zeile, lern, BANK_(), vorschlagOpt());
      let geaendert = 0;
      // Platz jeder Buchung im E-Banking merken, damit die Liste dieselbe Reihenfolge zeigt.
      for (const paar of a.paare) for (const b of paar.buchungen) {
        if (b.bankNr !== paar.zeile.nr || b.bankDatum !== paar.zeile.datum) { b.bankNr = paar.zeile.nr; b.bankDatum = paar.zeile.datum; geaendert++; }
      }
      for (const n of a.neu) DB().push(Object.assign({ id: uid('b'), jahr: jahr(), beleg: '', pos: ++pos, vorschlag: true }, vorschlag(n)));
      const letzte = z[z.length - 1];
      S.bank = { jahr: jahr(), datum: letzte.datum, saldo: letzte.saldo };
      S.tab = 'buchungen'; S.q = '';
      if (a.neu.length || geaendert || zeilenNeu) persist();
      render();
      const offenV = a.paare.length - lern.length;
      toast(`${a.paare.length + a.neu.length + a.ignoriert} Bewegungen gelesen: ${lern.length} schon verbucht, ${a.neu.length} ${a.neu.length === 1 ? 'neuer Vorschlag' : 'neue Vorschläge'}${offenV ? `, ${offenV} noch unbestätigt` : ''}${a.ignoriert ? `, ${a.ignoriert} früher verworfen` : ''}.`);
    }

    function hinweisNeu() {
      const f = neu();
      const s = String(f.soll).trim(), h = String(f.haben).trim();
      return [kontoName(s) && `Soll: ${kontoName(s)}`, kontoName(h) && `Haben: ${kontoName(h)}`].filter(Boolean).join(', ');
    }

    function viewKonten() {
      const a = L.auswertung(plan(), buchungen());
      const q = String(S.kq || '').trim().toLowerCase();
      const sichtbar = plan().filter((z) => {
        if (S.alleKonten || !z.konto) return true;
        return a.konto.has(z.konto);
      });
      // Gruppen ohne sichtbares Konto und ohne Saldo ausblenden, wenn nur bewegte Konten gezeigt werden.
      // Beim Suchen: alle Konten und Gruppen, deren Nummer oder Beschreibung passt (auch ohne Bewegung).
      const zeilen = q
        ? plan().filter((z) => (z.konto || z.gruppe) && q.split(/\s+/).every((w) => `${z.konto || ''} ${z.gruppe || ''} ${z.text || ''}`.toLowerCase().includes(w)))
        : sichtbar.filter((z) => S.alleKonten || !z.gruppe || Math.abs(a.saldoVon(z)) > 0.004);
      const gruppen = (plan() || []).filter((z) => z.gruppe);
      const k = S.kEdit;
      return `
      <div class="bh-bar2">
        <input id="bh-ksuche" type="search" placeholder="Konto suchen (Nummer oder Name)" value="${esc(S.kq || '')}" data-bh="ksuche" class="bh-ksuche">
        <label class="check"><input type="checkbox" data-bh="alle-konten" ${S.alleKonten ? 'checked' : ''}> Auch Konten ohne Bewegung zeigen</label>
        <span class="grow"></span>
        <button class="btn" data-bh="konto-neu">Konto hinzufügen</button>
      </div>
      ${k ? `<form class="sec bh-kform" data-bh-form="konto">
        <div class="fld"><label for="bk-konto">Konto</label><input id="bk-konto" type="text" value="${esc(k.konto)}" data-bh="kfeld" data-key="konto" ${k.alt ? 'disabled' : ''}></div>
        <div class="fld grow"><label for="bk-text">Beschreibung</label><input id="bk-text" type="text" value="${esc(k.text)}" data-bh="kfeld" data-key="text"></div>
        <div class="fld"><label for="bk-bk">Klasse</label><select id="bk-bk" data-bh="kfeld" data-key="bklasse">${[['1', '1 Aktiven'], ['2', '2 Passiven'], ['3', '3 Aufwand'], ['4', '4 Ertrag']].map(([v, l]) => `<option value="${v}" ${k.bklasse === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="fld"><label for="bk-in">Summiert in Gruppe</label><select id="bk-in" data-bh="kfeld" data-key="summe_in">${gruppen.map((g) => `<option value="${esc(g.gruppe)}" ${k.summe_in === g.gruppe ? 'selected' : ''}>${esc(g.gruppe)} ${esc(g.text.slice(0, 44))}</option>`).join('')}</select></div>
        <div class="row"><button class="btn primary" type="submit">${k.alt ? 'Speichern' : 'Hinzufügen'}</button><button class="btn" type="button" data-bh="konto-abbr">Abbrechen</button>
          ${k.alt && !a.konto.has(k.alt) ? '<button class="btn danger" type="button" data-bh="konto-del">Löschen</button>' : ''}</div>
      </form>` : ''}
      <div class="bh-wrap"><table class="bh-tab konten">
        <colgroup><col style="width:70px"><col style="width:70px"><col style="width:70px"><col><col style="width:70px"><col style="width:84px"><col style="width:130px"><col style="width:96px"></colgroup>
        <thead><tr><th>Sektion</th><th>Gruppe</th><th>Konto</th><th>Beschreibung</th><th>Klasse</th><th>Summ. in</th><th class="r">Saldo CHF</th><th></th></tr></thead>
        <tbody>${zeilen.map((z) => {
          const s = a.saldoVon(z);
          if (z.sektion && !z.konto && !z.gruppe) return `<tr class="k-sek"><td>${esc(z.sektion)}</td><td></td><td></td><td colspan="5">${esc(z.text)}</td></tr>`;
          if (z.gruppe) return `<tr class="k-grp ${/^(1|2|00|E\d|10|14|20|24|2A|28)$/.test(z.gruppe) ? 'gross' : ''}"><td></td><td>${esc(z.gruppe)}</td><td></td><td>${esc(z.text)}</td><td></td><td>${esc(z.summe_in)}</td><td class="num r">${chf(s, true)}</td><td></td></tr>`;
          return `<tr class="k-kto"><td></td><td></td><td class="num">${esc(z.konto)}</td><td>${esc(z.text)}</td><td>${esc(z.bklasse)}</td><td>${esc(z.summe_in)}</td><td class="num r">${chf(s, true)}</td>
            <td class="r"><button class="link" data-bh="auszug" data-konto="${esc(z.konto)}">Auszug</button> <button class="link" data-bh="konto-edit" data-konto="${esc(z.konto)}">Ändern</button></td></tr>`;
        }).join('') || `<tr><td colspan="8" class="dim">Kein Konto passt zu «${esc(S.kq)}».</td></tr>`}</tbody>
      </table></div>`;
    }

    /** Zeilen eines Abschnitts mit Saldo, für die kompakte Darstellung: nur was einen Saldo hat. vz dreht das Vorzeichen. */
    function kompakt(zeilen, a, vz) {
      return zeilen.filter((z) => (z.konto || z.gruppe) && Math.abs(a.saldoVon(z)) > 0.004 && z.gruppe !== '00')
        .map((z) => ({ nr: z.konto || '', text: z.text, wert: vz * a.saldoVon(z), gruppe: !!z.gruppe, gross: !!z.gruppe && /^(1|2|E\d|10|14|20|24|2A|28|3|5|6)$/.test(z.gruppe) }));
    }

    function abschlussTabelle(titel, zeilen) {
      return `<section class="sec"><h2>${titel}</h2><table class="bh-ab">
        <tbody>${zeilen.map((z) => `<tr class="${z.gruppe ? 'g' : ''} ${z.gross ? 'gross' : ''}"><td class="num">${esc(z.nr)}</td><td>${esc(z.text)}</td><td class="num r">${chf(z.wert)}</td></tr>`).join('')}</tbody></table></section>`;
    }

    function viewAbschluss() {
      const a = L.auswertung(plan(), buchungen());
      const ab = L.abschnitte(plan());
      return `<div class="bh-zwei">
        <div>${abschlussTabelle('Bilanz: Aktiven', kompakt(ab.aktiven, a, 1))}${abschlussTabelle('Bilanz: Passiven', kompakt(ab.passiven, a, -1))}</div>
        <div>${abschlussTabelle('Erfolgsrechnung', kompakt(ab.erfolg, a, -1))}
          <p class="hint">Erträge und Gewinne stehen positiv, Aufwände negativ. In der Bilanz stehen Aktiven und Passiven je positiv.</p></div>
      </div>`;
    }

    function viewAuszug() {
      const a = L.auswertung(plan(), buchungen());
      const mit = konten().filter((z) => a.konto.has(z.konto));
      if (!S.konto || !konten().some((z) => z.konto === S.konto)) S.konto = mit.length ? mit[0].konto : (konten()[0] || {}).konto;
      const nr = S.konto;
      const k = L.kontoauszug(nr, buchungen());
      return `
      <div class="bh-bar2"><label for="bh-konto">Konto</label>
        <select id="bh-konto" data-bh="konto-wahl">${konten().map((z) => `<option value="${esc(z.konto)}" ${z.konto === nr ? 'selected' : ''}>${esc(z.konto)} ${esc(z.text)}${a.konto.has(z.konto) ? '' : ' (ohne Bewegung)'}</option>`).join('')}</select></div>
      <div class="bh-wrap"><table class="bh-tab">
        <colgroup><col style="width:100px"><col style="width:84px"><col><col style="width:84px"><col style="width:118px"><col style="width:118px"><col style="width:126px"></colgroup>
        <thead><tr><th>Datum</th><th>Beleg</th><th>Beschreibung</th><th>Gegenkto.</th><th class="r">Soll CHF</th><th class="r">Haben CHF</th><th class="r">Saldo CHF</th></tr></thead>
        <tbody>${k.zeilen.map((z) => `<tr><td class="num">${fmtDate(z.datum)}</td><td>${esc(z.beleg)}</td><td class="bt" title="${esc(z.text)}">${esc(z.text)}</td><td class="num" title="${esc(kontoName(z.gegenkonto))}">${esc(z.gegenkonto)}</td>
          <td class="num r">${chf(z.soll)}</td><td class="num r">${chf(z.haben)}</td><td class="num r">${chf(z.saldo)}</td></tr>`).join('') || '<tr><td colspan="7" class="dim">Keine Bewegungen.</td></tr>'}</tbody>
        <tfoot><tr><td colspan="4">Totalsumme Bewegungen</td><td class="num r">${chf(k.soll)}</td><td class="num r">${chf(k.haben)}</td><td class="num r">${chf(k.saldo)}</td></tr></tfoot>
      </table></div>`;
    }

    /* ---------- Dossier als PDF ---------- */

    function dossierHtml() {
      const p = plan(), bs = L.sortiert(buchungen());
      const a = L.auswertung(p, bs), t = L.totalsummen(p, bs), ab = L.abschnitte(p);
      const titel = `${firma()} ${jahr()}`;
      const kopf = (name, spalten) => `<thead><tr><th colspan="${spalten.length}" class="kopf"><div class="t1">${esc(titel)}</div><div class="t2">${esc(name)}</div></th></tr>
        <tr class="sp">${spalten.map((s) => `<th class="${s[1] || ''}">${s[0]}</th>`).join('')}</tr></thead>`;
      const abschluss = (name, zeilen) => `<table class="ab">${kopf(name, [['Konto'], ['Beschreibung'], ['CHF', 'r']])}
        <tbody>${zeilen.map((z) => `<tr class="${z.gruppe ? 'g' : ''} ${z.gross ? 'gross' : ''}"><td>${esc(z.nr)}</td><td>${esc(z.text)}</td><td class="r">${chf(z.wert)}</td></tr>`).join('')}</tbody></table>`;

      const kontenTab = `<table class="kt">${kopf('Konten', [['Sektion'], ['Gruppe'], ['Konto'], ['Beschreibung'], ['BKlasse', 'c'], ['Summ. in', 'c'], ['Saldo CHF', 'r']])}
        <tbody>${p.map((z) => {
          if (z.sektion && !z.konto && !z.gruppe) return `<tr class="sek"><td>${esc(z.sektion)}</td><td></td><td></td><td colspan="4">${esc(z.text)}</td></tr>`;
          if (z.gruppe) return `<tr class="g ${/^(1|2|00|E\d|10|14|20|24|2A|28)$/.test(z.gruppe) ? 'gross' : ''}"><td></td><td>${esc(z.gruppe)}</td><td></td><td>${esc(z.text)}</td><td></td><td class="c">${esc(z.summe_in)}</td><td class="r">${chf(a.saldoVon(z), true)}</td></tr>`;
          return `<tr><td></td><td></td><td>${esc(z.konto)}</td><td>${esc(z.text)}</td><td class="c">${esc(z.bklasse)}</td><td class="c">${esc(z.summe_in)}</td><td class="r">${chf(a.saldoVon(z), true)}</td></tr>`;
        }).join('')}</tbody></table>`;

      const tot = [['1', 'Totalsumme Aktiven', t.aktiven], ['2', 'Total Passiven und Eigenkapital', t.passiven], ['01', 'Gewinn(+) Verlust(-) der Bilanz', t.bilanz],
        ['3', 'Totalsumme Aufwand', t.aufwand], ['4', 'Totalsumme Ertrag', t.ertrag], ['02', 'Verlust(+) Gewinn(-) der Erfolgsrechnung', t.erfolg], ['00', 'Differenz muss = 0 sein', t.differenz]];
      const totalTab = `<table class="tt">${kopf('Totalsummen', [['Gruppe'], ['Beschreibung'], ['Saldo CHF', 'r']])}
        <tbody>${tot.map((r) => `<tr class="${r[0].length === 2 ? 'g' : ''}"><td>${r[0]}</td><td>${r[1]}</td><td class="r">${chf(r[2], r[0] === '00')}</td></tr>`).join('')}</tbody></table>`;

      const journal = `<table class="jr">${kopf('Journal', [['Datum'], ['Beleg'], ['Beschreibung'], ['KtSoll'], ['KtHaben'], ['Betrag CHF', 'r']])}
        <tbody>${bs.map((b) => `<tr><td>${fmtDate(b.datum)}</td><td>${esc(b.beleg)}</td><td>${esc(b.text)}</td><td>${esc(b.soll)}</td><td>${esc(b.haben)}</td><td class="r">${chf(b.betrag)}</td></tr>`).join('')}</tbody></table>`;

      const auszuege = konten().filter((z) => a.konto.has(z.konto)).map((z) => {
        const k = L.kontoauszug(z.konto, bs);
        return `<table class="ka">${kopf(`${z.konto} ${z.text}`, [['Datum'], ['Beleg'], ['Beschreibung'], ['Gegenkto.'], ['Soll CHF', 'r'], ['Haben CHF', 'r'], ['Saldo CHF', 'r']])}
          <tbody>${k.zeilen.map((r) => `<tr><td>${fmtDate(r.datum)}</td><td>${esc(r.beleg)}</td><td>${esc(r.text)}</td><td>${esc(r.gegenkonto)}</td><td class="r">${chf(r.soll)}</td><td class="r">${chf(r.haben)}</td><td class="r">${chf(r.saldo, true)}</td></tr>`).join('')}
          <tr class="g"><td>${fmtDate(`${jahr()}-12-31`)}</td><td></td><td>Totalsumme Bewegungen</td><td></td><td class="r">${chf(k.soll, true)}</td><td class="r">${chf(k.haben, true)}</td><td class="r">${chf(k.saldo, true)}</td></tr></tbody></table>`;
      }).join('');

      const gewinn = -t.erfolg;
      return `<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><title>${esc(titel)}</title><style>
        @page { size: A4; }
        * { box-sizing: border-box; }
        body { font-family: Arial, Helvetica, "Liberation Sans", sans-serif; font-size: 8.5pt; line-height: 1.32; color: #000; margin: 0; }
        .deck { height: 240mm; display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
        .deck h1 { font-size: 24pt; margin: 0 0 6pt; }
        .deck p { font-size: 11pt; margin: 2pt 0; }
        .deck dl { margin-top: 26pt; display: grid; grid-template-columns: max-content max-content; gap: 4pt 22pt; font-size: 10.5pt; }
        .deck dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
        table { width: 100%; border-collapse: collapse; page-break-before: always; font-variant-numeric: tabular-nums; }
        table.ab.erste, table.ab.folgt { page-break-before: auto; }
        table.ab.folgt { margin-top: 22pt; }
        table.ab tr.g td { padding-bottom: 3.5pt; }
        table.ab tr.gross td { font-size: 10pt; padding-top: 3pt; padding-bottom: 4.5pt; }
        th { text-align: left; font-weight: normal; font-size: 7pt; padding: 0 3pt 5pt; vertical-align: bottom; }
        th.kopf { padding: 0 0 12pt; }
        .t1 { font-size: 9pt; font-weight: bold; }
        .t2 { font-size: 10.5pt; font-weight: bold; margin-top: 14pt; }
        td { padding: 1.1pt 3pt; vertical-align: top; }
        .r { text-align: right; white-space: nowrap; }
        .c { text-align: center; }
        tr { page-break-inside: avoid; }
        tr.g td { font-weight: bold; padding-bottom: 6pt; }
        tr.gross td { font-size: 10.5pt; padding-top: 5pt; padding-bottom: 8pt; }
        tr.sek td { font-size: 11pt; font-weight: bold; padding: 8pt 3pt 6pt; }
        table.kt td:nth-child(1), table.kt td:nth-child(2), table.kt td:nth-child(3) { width: 34pt; }
        table.kt td:nth-child(5), table.kt td:nth-child(6) { width: 40pt; }
        table.kt td:nth-child(7), table.tt td:nth-child(3), table.ab td:nth-child(3) { width: 78pt; }
        table.ab td:nth-child(1), table.tt td:nth-child(1) { width: 44pt; }
        table.jr td:nth-child(1), table.ka td:nth-child(1) { width: 54pt; }
        table.jr td:nth-child(2), table.ka td:nth-child(2) { width: 44pt; }
        table.jr td:nth-child(4), table.jr td:nth-child(5), table.ka td:nth-child(4) { width: 40pt; }
        table.jr td:nth-child(6) { width: 64pt; }
        table.ka td:nth-child(5), table.ka td:nth-child(6), table.ka td:nth-child(7) { width: 62pt; }
        table.tt tr.g td { padding-bottom: 10pt; }
      </style></head><body>
        <div class="deck"><h1>${esc(titel)}</h1><p>Buchhaltung, Stand ${fmtDate(heute)}</p>
          <dl><dt>Total Aktiven</dt><dd>${chf(t.aktiven)}</dd><dt>Ertrag</dt><dd>${chf(-t.ertrag)}</dd><dt>Aufwand</dt><dd>${chf(t.aufwand)}</dd>
          <dt><b>${gewinn < 0 ? 'Jahresverlust' : 'Jahresgewinn'}</b></dt><dd><b>${chf(gewinn)}</b></dd><dt>Buchungen</dt><dd>${bs.length}</dd></dl></div>
        ${abschluss('Bilanz: Aktiven', kompakt(ab.aktiven, a, 1)).replace('class="ab"', 'class="ab erste"')}
        ${abschluss('Bilanz: Passiven', kompakt(ab.passiven, a, -1)).replace('class="ab"', 'class="ab folgt"')}
        ${abschluss('Erfolgsrechnung', kompakt(ab.erfolg, a, -1))}
        ${kontenTab}${totalTab}${journal}${auszuege}
      </body></html>`;
    }

    async function pdf() {
      const name = `${firma().replace(/[^A-Za-z0-9äöüÄÖÜ]+/g, '_')}_${jahr()}_Stand_${heute.replace(/-/g, '')}.pdf`;
      const r = await api.savePdf(dossierHtml(), { ordner: 'Dossiers', name, fuss: fmtDate(heute) });
      if (r.fehler) toast(r.fehler, { fehler: true }); else toast('Dossier gespeichert: ' + r.path);
    }

    /* ---------- Aktionen ---------- */

    function buche() {
      const p = pruefe(neu());
      if (p.fehler) { toast(p.fehler, { fehler: true }); const el = $('#bn-' + p.feld); if (el) el.focus(); return; }
      const pos = DB().reduce((m, b) => Math.max(m, b.pos || 0), 0) + 1;
      DB().push(Object.assign({ id: uid('b'), jahr: jahr(), pos }, p.buchung));
      const datum = p.buchung.datum;
      S.neu = null;
      persist(); neu().datum = datum; render();
      const el = $('#bn-text'); if (el) el.focus();
    }

    function speichereEdit() {
      const b = DB().find((x) => x.id === S.edit);
      const p = pruefe(S.editForm);
      if (p.fehler) { toast(p.fehler, { fehler: true }); const el = $('#be-' + p.feld); if (el) el.focus(); return; }
      Object.assign(b, p.buchung);
      S.edit = null; persist(); render(); toast('Buchung gespeichert');
    }

    /** Gleiche Beschreibung wie früher: Soll und Haben der letzten solchen Buchung vorschlagen. */
    function vorschlag(f) {
      if (String(f.soll).trim() || String(f.haben).trim()) return false;
      const letzte = L.sortiert(buchungen()).reverse().find((b) => b.text === String(f.text).trim());
      if (!letzte) return false;
      f.soll = letzte.soll; f.haben = letzte.haben;
      return true;
    }

    document.addEventListener('click', (ev) => {
      const el = ev.target.closest('[data-bh]');
      if (!el || !state.data || state.view !== VIEW) return;
      const a = el.dataset.bh;
      if (a === 'tab') { S.tab = el.dataset.tab; S.edit = null; render(); }
      else if (a === 'bank') bankEinlesen();
      else if (a === 'abgl') { S.abgl = !S.abgl; render(); }
      else if (a === 'abgl-alle') { S.abglAlle = !S.abglAlle; render(); }
      else if (a === 'abg-neu') {
        // Bankbewegung ausdrücklich als Vorschlag anlegen; über ihren Schlüssel bleibt sie künftig dieser Buchung zugeordnet.
        const bz = BZ_()[bzKey(jahr())], z = bz.zeilen.find((x) => x.schluessel === el.dataset.key);
        if (!z) return;
        const alle = DB().filter((b) => b.jahr === jahr());
        const ign = state.data.settings.bankIgnoriert || [];
        const k = ign.indexOf(z.schluessel); if (k >= 0) ign.splice(k, 1);
        const lern = L.bankAbgleich(bz.zeilen, abgleichbar(alle), BANK_(), []).paare.filter((x) => x.zeile.schluessel !== z.schluessel && x.buchungen.every((b) => !b.vorschlag));
        const pos = DB().reduce((m, b) => Math.max(m, b.pos || 0), 0) + 1;
        DB().push(Object.assign({ id: uid('b'), jahr: jahr(), beleg: '', pos, vorschlag: true }, L.bankVorschlag(z, lern, BANK_(), vorschlagOpt())));
        S.tab = 'buchungen'; persist(); render(); toast('Als Vorschlag angelegt');
      }
      else if (a === 'v-teilen') {
        const v = DB().find((x) => x.id === el.dataset.id); if (!v) return;
        const t = aufteilen(v); persist(); render();
        const f = document.getElementById(`bv-${t.id}-betrag`); if (f) { f.focus(); f.select(); }
      } else if (a === 'v-teil-weg') {
        const i = DB().findIndex((x) => x.id === el.dataset.id); if (i < 0) return;
        const [weg] = DB().splice(i, 1); restRechnen(hauptVon(weg)); persist(); render();
      }
      else if (a === 'v-ok') {
        const v = DB().find((x) => x.id === el.dataset.id);
        const f = bestaetige(v);
        if (f) { toast(f, { fehler: true }); return; }
        persist(); render(); toast('Buchung bestätigt');
      } else if (a === 'v-weg') {
        const i = DB().findIndex((x) => x.id === el.dataset.id);
        const [weg] = DB().splice(i, 1);
        // Verwerfen gilt für die ganze Bankbewegung: auch ihre Teile entfernen.
        for (let k = DB().length - 1; k >= 0; k--) if (DB()[k].vorschlag && DB()[k].teilVon === weg.id) DB().splice(k, 1);
        const ign = state.data.settings.bankIgnoriert || (state.data.settings.bankIgnoriert = []);
        if (weg.bankSchluessel) ign.push(weg.bankSchluessel);
        persist(); render();
        toast('Vorschlag verworfen', { actionLabel: 'Rückgängig', action: () => { DB().splice(i, 0, weg); const k = ign.indexOf(weg.bankSchluessel); if (k >= 0) ign.splice(k, 1); persist(); render(); } });
      } else if (a === 'v-alle') {
        let n = 0, rest = 0;
        // In der Reihenfolge der Bank bestätigen (älteste zuerst), damit die Belegnummern gleich laufen.
        for (const v of vorschlaege().reverse()) { if (!v.sicher || bestaetige(v)) rest++; else n++; }
        persist(); render(); toast(`${n} ${n === 1 ? 'Buchung' : 'Buchungen'} bestätigt${rest ? `, ${rest} ${rest === 1 ? 'bleibt' : 'bleiben'} zum Prüfen` : ''}`);
      }
      else if (a === 'pdf') pdf();
      else if (a === 'neu-save') buche();
      else if (a === 'edit') {
        if (ev.target.closest('input,button')) return;
        const b = DB().find((x) => x.id === el.dataset.id);
        S.edit = b.id; S.editForm = { datum: b.datum, beleg: b.beleg, text: b.text, soll: b.soll, haben: b.haben, betrag: b.betrag.toFixed(2) };
        render(); const f = $('#be-text'); if (f) f.focus();
      } else if (a === 'edit-save') speichereEdit();
      else if (a === 'edit-cancel') { S.edit = null; render(); }
      else if (a === 'del') {
        const i = DB().findIndex((x) => x.id === el.dataset.id);
        const [weg] = DB().splice(i, 1);
        S.edit = null; persist(); render();
        toast('Buchung gelöscht', { actionLabel: 'Rückgängig', action: () => { DB().splice(i, 0, weg); persist(); render(); } });
      } else if (a === 'auszug') { S.konto = el.dataset.konto; S.tab = 'auszug'; render(); }
      else if (a === 'konto-neu') { S.kEdit = { konto: '', text: '', bklasse: '3', summe_in: (plan().find((z) => z.gruppe) || {}).gruppe || '', alt: null }; render(); const f = $('#bk-konto'); if (f) f.focus(); }
      else if (a === 'konto-edit') { const z = konten().find((x) => x.konto === el.dataset.konto); S.kEdit = { konto: z.konto, text: z.text, bklasse: z.bklasse, summe_in: z.summe_in, alt: z.konto }; render(); $('.main').scrollTop = 0; const f = $('#bk-text'); if (f) f.focus(); }
      else if (a === 'konto-abbr') { S.kEdit = null; render(); }
      else if (a === 'konto-del') {
        const p = KP()[jahr()];
        p.zeilen = p.zeilen.filter((z) => z.konto !== S.kEdit.alt);
        S.kEdit = null; persist(); render(); toast('Konto gelöscht');
      } else if (a === 'eroeffnen') {
        const vor = KP()[jahr() - 1];
        // 2970 Gewinnvortrag, sonst das Passivkonto für Vortrag, Eigenkapital oder Vermögen im Kontenplan.
        const vortrag = vor.zeilen.some((z) => z.konto === '2970') ? '2970'
          : ((vor.zeilen.find((z) => z.konto && String(z.bklasse) === '2' && /vortrag|eigenkapital|reinverm|vermögen|kapital/i.test(z.text)) || {}).konto || null);
        if (!vortrag) { toast('Im Kontenplan fehlt ein Passivkonto für Vortrag, Eigenkapital oder Vermögen.', { fehler: true }); return; }
        KP()[jahr()] = { zeilen: JSON.parse(JSON.stringify(vor.zeilen)), mod: 0 };
        const er = L.eroeffnung(vor.zeilen, DB().filter((b) => b.jahr === jahr() - 1 && !b.vorschlag), jahr(), vortrag);
        let pos = DB().reduce((m, b) => Math.max(m, b.pos || 0), 0);
        for (const b of er) DB().push(Object.assign(b, { id: uid('b'), pos: ++pos }));
        persist(); render(); toast(`Buchhaltung ${jahr()} eröffnet mit ${er.length} Eröffnungsbuchungen`);
      }
    });

    document.addEventListener('input', (ev) => {
      const el = ev.target, a = el.dataset && el.dataset.bh;
      if (!a || !state.data || state.view !== VIEW) return;
      if (a === 'feld') {
        const f = el.dataset.form === 'neu' ? neu() : S.editForm;
        f[el.dataset.key] = el.value;
        if (el.dataset.form === 'neu') { const h = $('#bh-hinweis'); if (h) h.textContent = hinweisNeu(); }
      } else if (a === 'vfeld') {
        const v = DB().find((x) => x.id === el.dataset.id);
        const key = el.dataset.key;
        if (key === 'betrag') { const b = C.parseAmount(el.value); if (b == null || b <= 0) return; v.betrag = Math.round(b * 100) / 100; if (v.teilVon) restRechnen(hauptVon(v)); }
        else if (key === 'datum') { if (!/^\d{4}-\d{2}-\d{2}$/.test(el.value)) return; v.datum = el.value; }
        else v[key] = key === 'text' ? el.value : el.value.trim().split(/\s/)[0];
        v.sicher = true;   // von Hand angefasst gilt als geprüft
      } else if (a === 'suche') { S.q = el.value; render(); }
      else if (a === 'ksuche') { S.kq = el.value; render(); }
      else if (a === 'kfeld') S.kEdit[el.dataset.key] = el.value;
    });

    document.addEventListener('change', (ev) => {
      const el = ev.target, a = el.dataset && el.dataset.bh;
      if (!a || !state.data || state.view !== VIEW) return;
      if (a === 'feld' && el.dataset.key === 'text') {
        const neuForm = el.dataset.form === 'neu';
        const f = neuForm ? neu() : S.editForm;
        if (neuForm && vorschlag(f)) { render(); const b = $('#bn-betrag'); if (b) b.focus(); }
      } else if (a === 'vfeld') {
        // Kein Neuaufbau der Liste, sonst ginge beim Tabben der Fokus verloren.
        const v = DB().find((x) => x.id === el.dataset.id);
        const tr = el.closest('tr');
        if (v && tr) {
          const gegen = v.soll === BANK_() ? v.haben : v.soll;
          tr.classList.toggle('unsicher', !(gegen && v.sicher));
          const h = tr.querySelector('.bh-vhin-t'); if (h) h.textContent = vHinweis(v);
        }
        persist();
        // Datum und Betrag verschieben Reihenfolge und Bank-Saldo: neu zeichnen (der Fokus bleibt über die id erhalten).
        if (el.dataset.key === 'datum' || el.dataset.key === 'betrag') render();
      }
      else if (a === 'alle-konten') { S.alleKonten = el.checked; render(); }
      else if (a === 'konto-wahl') { S.konto = el.value; render(); }
    });

    /* ---------- Kontoauswahl: eigene, scrollbare Liste statt der Vorschlagsliste des Browsers ---------- */

    let kw = null;   // { input, box, treffer, i }
    function kwSchliessen() { if (kw) { kw.box.remove(); kw = null; } }
    function kwZeigen(input, alle) {
      const q = alle ? '' : input.value.trim().toLowerCase();
      const liste = konten().filter((z) => !q || z.konto.startsWith(q) || String(z.text).toLowerCase().includes(q));
      if (!kw || kw.input !== input) { kwSchliessen(); const box = document.createElement('div'); box.className = 'bh-kwahl'; document.body.appendChild(box); kw = { input, box }; }
      kw.treffer = liste;
      kw.i = Math.max(0, liste.findIndex((z) => z.konto === input.value.trim().split(/\s/)[0]));
      kw.box.innerHTML = liste.length ? liste.map((z, i) => `<div class="bh-kw-z ${i === kw.i ? 'on' : ''}" data-i="${i}"><b>${esc(z.konto)}</b><span>${esc(z.text)}</span></div>`).join('') : '<div class="bh-kw-leer">Kein passendes Konto</div>';
      const r = input.getBoundingClientRect(), hoehe = Math.min(320, window.innerHeight - r.bottom - 12);
      Object.assign(kw.box.style, { left: `${r.left}px`, minWidth: `${Math.max(r.width, 280)}px`, ...(hoehe >= 160 ? { top: `${r.bottom + 2}px`, maxHeight: `${hoehe}px`, bottom: '' } : { top: '', bottom: `${window.innerHeight - r.top + 2}px`, maxHeight: `${Math.min(320, r.top - 12)}px` }) });
      // Nicht über den rechten Fensterrand hinaus
      const breite = kw.box.offsetWidth;
      if (r.left + breite > window.innerWidth - 12) kw.box.style.left = `${Math.max(12, window.innerWidth - 12 - breite)}px`;
      const on = kw.box.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' });
    }
    function kwWaehlen(i) {
      if (!kw || !kw.treffer[i]) return;
      const input = kw.input; input.value = kw.treffer[i].konto; kwSchliessen();
      input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    document.addEventListener('focusin', (ev) => { if (ev.target.dataset && ev.target.dataset.kontowahl && state.view === VIEW) kwZeigen(ev.target, true); });
    document.addEventListener('focusout', (ev) => { if (kw && ev.target === kw.input) setTimeout(() => { if (kw && document.activeElement !== kw.input) kwSchliessen(); }, 0); });
    document.addEventListener('input', (ev) => { if (ev.target.dataset && ev.target.dataset.kontowahl && ev.isTrusted && state.view === VIEW) kwZeigen(ev.target, false); });
    document.addEventListener('click', (ev) => { if (ev.target.dataset && ev.target.dataset.kontowahl && !kw && state.view === VIEW) kwZeigen(ev.target, true); });
    document.addEventListener('mousedown', (ev) => {
      const z = ev.target.closest && ev.target.closest('.bh-kwahl');
      if (!z) return;
      ev.preventDefault();   // Fokus im Feld lassen
      const zeile = ev.target.closest('.bh-kw-z'); if (zeile) kwWaehlen(+zeile.dataset.i);
    });
    document.addEventListener('keydown', (ev) => {
      if (!kw || ev.target !== kw.input) return;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault(); ev.stopImmediatePropagation();
        kw.i = Math.max(0, Math.min(kw.treffer.length - 1, kw.i + (ev.key === 'ArrowDown' ? 1 : -1)));
        kw.box.querySelectorAll('.bh-kw-z').forEach((n, i) => n.classList.toggle('on', i === kw.i));
        const on = kw.box.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' });
      } else if ((ev.key === 'Enter' || ev.key === 'Tab') && kw.treffer.length && kw.input.value.trim() !== kw.treffer[kw.i].konto) {
        if (ev.key === 'Enter') { ev.preventDefault(); ev.stopImmediatePropagation(); }
        kwWaehlen(kw.i);
      } else if (ev.key === 'Escape') { ev.stopImmediatePropagation(); kwSchliessen(); }
      else if (ev.key === 'Enter' || ev.key === 'Tab') kwSchliessen();
    }, true);
    window.addEventListener('resize', kwSchliessen);
    document.addEventListener('scroll', (ev) => { if (kw && !kw.box.contains(ev.target)) kwSchliessen(); }, true);

    document.addEventListener('keydown', (ev) => {
      const el = ev.target;
      if (!state.data || state.view !== VIEW) return;
      if (el.dataset && el.dataset.bh === 'feld') {
        if (ev.key === 'Enter') { ev.preventDefault(); if (el.dataset.form === 'neu') buche(); else speichereEdit(); }
        else if (ev.key === 'Escape' && el.dataset.form === 'edit') { S.edit = null; render(); }
      } else if (el.dataset && el.dataset.bh === 'vfeld' && ev.key === 'Enter') {
        ev.preventDefault();
        const v = DB().find((x) => x.id === el.dataset.id);
        const f = bestaetige(v);
        if (f) toast(f, { fehler: true }); else { persist(); render(); toast('Buchung bestätigt'); }
      } else if (ev.key === 'Enter' && el.classList && el.classList.contains('bh-row')) el.click();
    });

    document.addEventListener('submit', (ev) => {
      if (ev.target.dataset.bhForm !== 'konto' || state.view !== VIEW) return;
      ev.preventDefault(); ev.stopImmediatePropagation();
      const k = S.kEdit, p = KP()[jahr()];
      const nr = String(k.konto).trim(), text = String(k.text).trim();
      if (!/^\d{3,6}$/.test(nr)) { toast('Die Kontonummer muss aus 3 bis 6 Ziffern bestehen.', { fehler: true }); return; }
      if (!text) { toast('Die Beschreibung fehlt.', { fehler: true }); return; }
      if (k.alt) {
        const z = p.zeilen.find((x) => x.konto === k.alt);
        const gruppeGeaendert = z.summe_in !== k.summe_in;
        Object.assign(z, { text, bklasse: k.bklasse, summe_in: k.summe_in });
        if (gruppeGeaendert) { p.zeilen = p.zeilen.filter((x) => x !== z); einfuegen(p.zeilen, z); }
      } else {
        if (p.zeilen.some((x) => x.konto === nr)) { toast(`Das Konto ${nr} gibt es schon.`, { fehler: true }); return; }
        einfuegen(p.zeilen, { sektion: '', gruppe: '', konto: nr, text, bklasse: k.bklasse, summe_in: k.summe_in });
      }
      S.kEdit = null; persist(); render(); toast(k.alt ? 'Konto gespeichert' : 'Konto hinzugefügt');
    }, true);

    /** Fügt ein Konto vor der Zeile seiner Gruppe ein, sortiert nach Nummer unter den Konten derselben Gruppe. */
    function einfuegen(zeilen, konto) {
      const iGruppe = zeilen.findIndex((z) => z.gruppe === konto.summe_in);
      let i = iGruppe < 0 ? zeilen.length : iGruppe;
      while (i > 0 && zeilen[i - 1].konto && zeilen[i - 1].summe_in === konto.summe_in && zeilen[i - 1].konto > konto.konto) i--;
      zeilen.splice(i, 0, konto);
    }

    return { view, dossierHtml, BANK_, bankKandidaten, konten };
  };
})();
