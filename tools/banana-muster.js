/* Erzeugt einen kleinen Banana-Export (Excel 2003 XML) mit erfundenen Daten – für Tests. */
'use strict';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const zeile = (werte) => `<Row>${werte.map((w, i) => `<Cell ss:Index="${i + 1}"><Data ss:Type="String">${esc(w)}</Data></Cell>`).join('')}</Row>`;
function blatt(name, kopf, daten) {
  const leer = kopf.map(() => '');
  return `<Worksheet ss:Protected="1" ss:Name="${name}"><Table>${zeile(kopf)}${zeile(leer)}${zeile(leer)}${zeile(leer)}${zeile(kopf)}${zeile(kopf.map(() => 'String'))}`
    + daten.map((d) => zeile(kopf.map((k) => (d[k] == null ? '' : d[k])))).join('') + '<Row/></Table></Worksheet>';
}
/** opt: { von: 'TT.MM.JJJJ', bis, firma, konten: [{Section, Group, Account, Description, BClass, Gr, Opening}], buchungen: [{Date, Doc, Description, AccountDebit, AccountCredit, Amount}] } */
module.exports = function bananaMuster(opt) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">'
    + blatt('Accounts', ['TableInfo', 'Section', 'Group', 'Account', 'Description', 'Disable', 'BClass', 'Gr', 'Opening', 'Balance'], opt.konten)
    + blatt('Journal', ['TableInfo', 'Date', 'Doc', 'Description', 'AccountDebit', 'AccountCredit', 'Amount'], opt.buchungen)
    + blatt('FileInfo', ['TableInfo', 'Id', 'IdXml', 'Value'], [{ Id: 'Firma', IdXml: 'Company', Value: opt.firma || '' }, { IdXml: 'OpeningDate', Value: opt.von }, { IdXml: 'ClosureDate', Value: opt.bis }])
    + '</Workbook>';
};
