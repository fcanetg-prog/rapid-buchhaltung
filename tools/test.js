/* Prüft die Rechenlogik der Buchhaltung (erfundene Daten). */
'use strict';
const assert = require('assert');
const C = require('../src/daten.js');
const L = require('../src/ledger.js');

// Beträge
assert.strictEqual(C.parseAmount("3'820.50"), 3820.5); assert.strictEqual(C.parseAmount('3’820'), 3820);
assert.strictEqual(C.parseAmount('3390+430'), 3820); assert.strictEqual(C.parseAmount('12,5'), 12.5); assert.strictEqual(C.parseAmount('abc'), null);

// Buchhaltung
const plan = [
  { sektion: '1', gruppe: '', konto: '', text: 'AKTIVEN' },
  { konto: '1020', text: 'GKB', bklasse: '1', summe_in: '100' }, { gruppe: '100', text: 'Flüssige Mittel', summe_in: '1' }, { gruppe: '1', text: 'Total Aktiven', summe_in: '00' },
  { sektion: '2', gruppe: '', konto: '', text: 'PASSIVEN' },
  { konto: '2800', text: 'Kapital', bklasse: '2', summe_in: '28' }, { konto: '2970', text: 'Vortrag', bklasse: '2', summe_in: '297' },
  { gruppe: '29A', text: 'Jahresgewinn', summe_in: '297' }, { gruppe: '297', text: 'Bilanzgewinn', summe_in: '28' }, { gruppe: '28', text: 'Eigenkapital', summe_in: '2' }, { gruppe: '2', text: 'Total Passiven', summe_in: '00' },
  { sektion: '*', gruppe: '', konto: '', text: 'ERFOLGSRECHNUNG' },
  { konto: '3400', text: 'Ticketverkauf', bklasse: '4', summe_in: 'E7' }, { konto: '6600', text: 'Werbung', bklasse: '3', summe_in: 'E7' }, { gruppe: 'E7', text: 'Jahresgewinn', summe_in: '29A' }, { gruppe: '00', text: 'Differenz', summe_in: '' },
];
const b = [
  { id: 'a', datum: '2026-01-01', beleg: '1', text: 'Eröffnung', soll: '1020', haben: '2800', betrag: 20000, pos: 1 },
  { id: 'b', datum: '2026-03-01', beleg: '2', text: 'Tickets', soll: '1020', haben: '3400', betrag: 1081.05, pos: 2 },
  { id: 'c', datum: '2026-02-01', beleg: '3a', text: 'Werbung', soll: '6600', haben: '1020', betrag: 81.05, pos: 3 },
];
const a = L.auswertung(plan, b);
assert.strictEqual(a.konto.get('1020').saldo, 21000); assert.strictEqual(a.gruppe.get('1'), 21000); assert.strictEqual(a.gruppe.get('E7'), -1000);
assert.strictEqual(a.gruppe.get('2'), -21000); assert.strictEqual(a.gruppe.get('00'), 0);
const t = L.totalsummen(plan, b); assert.strictEqual(t.bilanz, 1000); assert.strictEqual(t.erfolg, -1000); assert.strictEqual(t.differenz, 0);
const k = L.kontoauszug('1020', b); assert.deepStrictEqual(k.zeilen.map((z) => z.saldo), [20000, 19918.95, 21000]); assert.strictEqual(k.zeilen[1].gegenkonto, '6600');
const e = L.eroeffnung(plan, b, 2027, '2970'); assert.deepStrictEqual(e.map((x) => [x.soll, x.haben, x.betrag]), [['1020', '2970', 21000], ['2970', '2800', 20000]]);
assert.strictEqual(L.saldi(e).get('2970').saldo, -1000); assert.strictEqual(L.naechsterBeleg(b), '4');
const ab = L.abschnitte(plan); assert.strictEqual(ab.aktiven.length, 3); assert.strictEqual(ab.erfolg.length, 4);
console.log('Buchhaltung bestanden.');

// Zwei Rechner: Buchungen einzeln, Kontenplan pro Jahr, Gelöschtes bleibt gelöscht, Einstellungen der jüngeren Fassung
{
  const M = C.mergeData({ buchungen: [Object.assign({}, b[0], { mod: 1 })], kontenplaene: { 2026: { mod: 1, zeilen: plan } }, settings: { firma: 'A' }, settingsMod: 1 },
    { buchungen: [Object.assign({}, b[0], { mod: 5, betrag: 1 }), Object.assign({}, b[1], { mod: 2 }), Object.assign({}, b[2], { mod: 2 })], kontenplaene: { 2026: { mod: 3, zeilen: plan.slice(0, 2) }, 2027: { mod: 1, zeilen: [] } },
      settings: { firma: 'B' }, settingsMod: 4, geloescht: { c: 3 } });
  assert.deepStrictEqual(M.buchungen.map((x) => x.id + ':' + x.betrag), ['a:1', 'b:1081.05']); assert.strictEqual(M.kontenplaene[2026].zeilen.length, 2); assert.ok(M.kontenplaene[2027]);
  assert.strictEqual(M.settings.firma, 'B');
  const leer = C.emptyData(); assert.deepStrictEqual(Object.keys(C.mergeData(leer, C.emptyData())).sort(), ['bankZeilen', 'buchungen', 'geloescht', 'kontenplaene', 'settings', 'settingsMod', 'version']);
  console.log('Zwei Rechner bestanden.');
}

// Bankabgleich
{
  const csv = ['IBAN;Booked At;Text;Credit/Debit Amount;Balance;Valuta Date',
    'CH00;2026-02-01 00:00:00.0;Online Einkauf Meta 31.01.2026, 08:00, Debit Mastercard-Nr. 1234xxxx;-81.05;19918.95;2026-02-01 00:00:00.0',
    'CH00;2026-03-03 00:00:00.0;Gutschrift Ticketpark AG;1081.05;21000;2026-03-03 00:00:00.0',
    'CH00;2026-04-02 00:00:00.0;Online Einkauf Meta 01.04.2026, 09:00, Debit Mastercard-Nr. 1234xxxx;-50;20950;2026-04-02 00:00:00.0',
    'CH00;2026-04-05 00:00:00.0;Zahlung Unbekannt GmbH;-10;20940;2026-04-05 00:00:00.0'].join('\r\n');
  const pz = L.parseBankCsv(csv); assert.ok(!pz.fehler); assert.strictEqual(pz.zeilen.length, 4);
  assert.strictEqual(pz.zeilen[0].betrag, -81.05); assert.strictEqual(pz.zeilen[0].datum, '2026-02-01'); assert.strictEqual(pz.zeilen[3].saldo, 20940);
  assert.ok(L.parseBankCsv('a;b\n1;2').fehler);
  const ag = L.bankAbgleich(pz.zeilen, b, '1020', []);
  assert.strictEqual(ag.paare.length, 2); assert.strictEqual(ag.neu.length, 2);
  const v1 = L.bankVorschlag(ag.neu[0], ag.paare, '1020');
  assert.deepStrictEqual([v1.text, v1.soll, v1.haben, v1.betrag, v1.sicher], ['Werbung', '6600', '1020', 50, true]);
  const v2 = L.bankVorschlag(ag.neu[1], ag.paare, '1020'); assert.strictEqual(v2.soll, ''); assert.strictEqual(v2.haben, '1020'); assert.strictEqual(v2.sicher, false);
  const mitV = b.concat([Object.assign({ id: 'v1', vorschlag: true }, v1)]);
  const ag2 = L.bankAbgleich(pz.zeilen, mitV, '1020', [v2.bankSchluessel]);
  assert.strictEqual(ag2.neu.length, 0); assert.strictEqual(ag2.ignoriert, 1); assert.strictEqual(ag2.paare.length, 3);
  // Keine feste TWINT-Regel mehr: TWINT-Eingänge werden wie jede andere Gutschrift vorgeschlagen
  const tw = L.bankVorschlag({ datum: '2026-10-13', text: 'Gutschrift TWINT Acquiring AG', betrag: 88.35, schluessel: 't1', nr: 1 }, [], '1020');
  assert.deepStrictEqual([tw.soll, tw.haben, tw.sicher], ['1020', '', false]);
  const sa = L.bankVorschlag({ datum: '2026-10-12', text: 'Sammelzahlung', betrag: -1250.4, schluessel: 's1', nr: 2 }, [], '1020');
  assert.deepStrictEqual([sa.text, sa.soll, sa.haben, sa.sicher], ['Sammelzahlung', '', '1020', false]);
  const ab2 = L.bankAbgleich([{ datum: '2026-10-12', text: 'Sammelzahlung', betrag: -1250.4, schluessel: 's1' }],
    [{ datum: '2026-10-12', soll: '5000', haben: '1020', betrag: 1000, bankSchluessel: 's1' }, { datum: '2026-10-12', soll: '6500', haben: '1020', betrag: 250.4, bankSchluessel: 's1' }], '1020', []);
  assert.strictEqual(ab2.paare.length, 1); assert.strictEqual(ab2.paare[0].buchungen.length, 2);
  // Reihenfolge wie im E-Banking
  const bs = L.bankSortiert([{ id: 'x', datum: '2026-10-31', bankDatum: '2026-09-30', bankNr: 7, pos: 1 }, { id: 'y', datum: '2026-10-01', pos: 2 }, { id: 'z', datum: '2026-09-30', bankDatum: '2026-09-30', bankNr: 5, pos: 9 }, { id: 'w', datum: '2026-09-30', pos: 3 }]);
  assert.deepStrictEqual(bs.map((x) => x.id), ['z', 'x', 'w', 'y']);
  const Z = (datum, betrag, text) => ({ datum, betrag, text, schluessel: datum + betrag + text });
  const bzA = L.bankZeilenMerge([], [Z('2026-03-01', -10, 'a'), Z('2026-03-02', -20, 'b'), Z('2026-03-02', 30, 'c')]);
  const bzB = L.bankZeilenMerge(bzA, [Z('2026-03-02', -20, 'b'), Z('2026-03-02', 30, 'c'), Z('2026-03-02', -5, 'd'), Z('2026-03-03', 7, 'e')]);
  assert.deepStrictEqual(bzB.map((x) => x.text + x.nr), ['a0', 'b1', 'c2', 'd3', 'e4']);
  console.log('Bankabgleich bestanden.');
}

// E-Banking-Export der GKB: Vorspann mit Saldo, Datum mit zweistelligem Jahr, neuste Bewegung zuerst
{
  const csv = 'Kontoauszug bis: 27.10.2026 ;;;\n;;;\nKontonummer: CK 1;;;\nSaldo: CHF 46292.43;;;\n;;;\nDatum;Buchungstext;Betrag;Valuta\n'
    + '27.10.26;Belastung TWINT Ticketpark 0400005051572557;-60.00;27.10.26\n'
    + '26.10.26;Debitkarte-Einkauf 23.10.2026 09:47 Adrianos Coffee  SBB Karte: 555968******6247;-10.50;23.10.26\n'
    + '16.10.26;Gutschrift Muster AG;30000.00;16.10.26\n';
  const p = L.parseBankCsv(csv);
  assert.deepStrictEqual(p.zeilen.map((z) => [z.datum, z.betrag, z.nr, z.saldo]), [['2026-10-16', 30000, 0, null], ['2026-10-26', -10.5, 1, null], ['2026-10-27', -60, 2, 46292.43]]);
  const v = (z) => L.bankVorschlag(z, [], '1020', {});
  assert.deepStrictEqual([v(p.zeilen[1]).text, v(p.zeilen[1]).haben], ['Adrianos Coffee SBB', '1020']);
  assert.strictEqual(v(p.zeilen[2]).text, 'TWINT Ticketpark');
  console.log('GKB-Export bestanden.');
}

console.log('Alle Prüfungen bestanden.');
