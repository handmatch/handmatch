/**
 * handmatch → Google Sheets
 * Paste this into Extensions → Apps Script in your Google Sheet, then
 * Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 * Set a script property SHEETS_TOKEN (Project Settings → Script properties)
 * to the same value as SHEETS_TOKEN in Vercel.
 *
 * Each form gets its own tab (requests, messages, helpers, waitlist, paid_orders).
 * New columns are added automatically when a form gains a field.
 */
function doPost(e) {
  var body = JSON.parse(e.postData.contents || '{}');
  var expected = PropertiesService.getScriptProperties().getProperty('SHEETS_TOKEN');
  if (!expected || body.token !== expected) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'unauthorized' }));
  }
  var tab = String(body.tab || 'other').replace(/[^\w -]/g, '').slice(0, 50) || 'other';
  var row = body.row || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(tab) || ss.insertSheet(tab);
    var headers = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] : [];
    Object.keys(row).forEach(function (k) { if (headers.indexOf(k) === -1) headers.push(k); });
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    var values = headers.map(function (h) {
      var v = row[h];
      if (v === undefined || v === null) return '';
      if (Array.isArray(v)) return v.join(', ');
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    });
    sheet.appendRow(values);
  } finally {
    lock.releaseLock();
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: true }));
}
