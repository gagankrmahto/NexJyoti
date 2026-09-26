/**
 * Register spreadsheet helpers. Rows are read as objects keyed by the header row;
 * each object carries _row (its 1-based sheet row) so it can be updated in place.
 */

function prop_(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) throw new Error(`Missing script property ${key}. Run setup() first.`);
  return value;
}

function register_() { return SpreadsheetApp.openById(prop_('REGISTER_ID')); }
function sheet_(name) { return register_().getSheetByName(name); }
function folder_(key) { return DriveApp.getFolderById(prop_(key)); }

function headersOf_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function readRows_(name) {
  const values = sheet_(name).getDataRange().getValues();
  const headers = values.shift();
  return values
    .map((row, i) => {
      const obj = { _row: i + 2 };
      headers.forEach((h, j) => { obj[h] = row[j]; });
      return obj;
    })
    .filter(obj => headers.some(h => obj[h] !== ''));
}

function appendRow_(name, obj) {
  const sheet = sheet_(name);
  sheet.appendRow(headersOf_(sheet).map(h => (obj[h] === undefined ? '' : obj[h])));
}

function updateRow_(name, row, changes) {
  const sheet = sheet_(name);
  const headers = headersOf_(sheet);
  Object.keys(changes).forEach(key => {
    const col = headers.indexOf(key) + 1;
    if (col === 0) throw new Error(`Column "${key}" not found in ${name}`);
    sheet.getRange(row, col).setValue(changes[key]);
  });
}

function people_() { return readRows_(SHEETS.PEOPLE); }
function reportTypes_() { return readRows_(SHEETS.TYPES).filter(t => t.Type); }

function personByEmail_(email, people) {
  return people.find(p => normEmail(p.Email) === normEmail(email));
}

function personById_(id, people) {
  return people.find(p => normId(p.ID) === normId(id));
}

function audit_(reportId, actorId, actorEmail, action, comment) {
  appendRow_(SHEETS.AUDIT, {
    'Timestamp': new Date(), 'Report ID': reportId, 'Actor ID': actorId,
    'Actor Email': actorEmail, 'Action': action, 'Comment': comment || '',
  });
}
