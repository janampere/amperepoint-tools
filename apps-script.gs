/**
 * Ampere Rush - zapis leadow z targow do arkusza Google.
 *
 * JAK TO URUCHOMIC (5 minut):
 *  1. Zaloz nowy arkusz Google, np. "Ampere Rush - leady KNM 2026".
 *  2. Rozszerzenia -> Apps Script. Skasuj to, co tam jest, i wklej ten plik.
 *  3. Wdroz -> Nowe wdrozenie -> typ: Aplikacja internetowa.
 *       - Wykonaj jako: Ja
 *       - Kto ma dostep: Wszyscy
 *  4. Skopiuj adres wdrozenia (konczy sie na /exec).
 *  5. Wklej go w Vercelu jako zmienna srodowiskowa SHEET_WEBHOOK_URL.
 *
 * Uwaga: ten adres jest jedynym zabezpieczeniem tego endpointu - kto go ma,
 * ten moze dopisywac wiersze. Nie publikuj go nigdzie poza Vercelem.
 * Jesli wycieknie, zrob nowe wdrozenie (dostaniesz nowy adres) i podmien
 * zmienna w Vercelu.
 */

var SHEET_NAME = 'Leady';
var HEADERS = ['Data zapisu', 'Nick', 'E-mail', 'Zgoda', 'Wynik', 'Dystans (m)',
               'Ładowarki', 'Kod przejazdu', 'Rozegrano', 'Wydarzenie'];

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = getSheet_();
    sheet.appendRow([
      new Date(),
      data.nick || '',
      data.email || '',
      data.consent ? 'TAK' : 'NIE',
      Number(data.score) || 0,
      Number(data.distance) || 0,
      Number(data.pickups) || 0,
      data.code || '',
      data.playedAt || '',
      data.event || ''
    ]);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doGet() {
  return json_({ ok: true, info: 'Ampere Rush lead sink' });
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
