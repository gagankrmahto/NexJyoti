/**
 * One-time setup. Run setup() from the Apps Script editor while signed in as info@.
 * Safe to run again: anything that already exists is kept, and triggers are reinstalled.
 */
function setup() {
  if (CONFIG.SHARED_DRIVE_ID.indexOf('PASTE') === 0) {
    throw new Error('Set CONFIG.SHARED_DRIVE_ID in Config.js first.');
  }
  const props = PropertiesService.getScriptProperties();
  const root = DriveApp.getFolderById(CONFIG.SHARED_DRIVE_ID);
  const folders = {};
  [['WORKING_FOLDER', 'Reports - Working'], ['FINAL_FOLDER', 'Reports - Final'], ['TEMPLATES_FOLDER', 'Templates'],
    ['FORMS_FOLDER', 'Forms'], ['ADMIN_FOLDER', 'Admin']]
    .forEach(([key, name]) => { folders[key] = ensureFolder_(props, key, root, name); });

  let registerId = existingFile_(props, 'REGISTER_ID');
  if (!registerId) {
    const created = SpreadsheetApp.create(`${CONFIG.ORG_NAME} Register`);
    DriveApp.getFileById(created.getId()).moveTo(folders.ADMIN_FOLDER);
    registerId = created.getId();
    props.setProperty('REGISTER_ID', registerId);
  }
  const ss = SpreadsheetApp.openById(registerId);
  ss.setSpreadsheetTimeZone(CONFIG.TIME_ZONE);
  Object.keys(HEADERS).forEach(name => ensureSheet_(ss, name, HEADERS[name]));
  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0) ss.deleteSheet(blank);
  addValidation_(ss);

  const types = ss.getSheetByName(SHEETS.TYPES);
  if (types.getLastRow() < 2) {
    const template = createDefaultTemplate_(folders.TEMPLATES_FOLDER);
    types.appendRow(['General Report', template.getUrl(), 1, '', 'No']);
  }

  ensureForm_(props, 'NEW_REPORT_FORM', buildNewReportForm_, folders.FORMS_FOLDER);
  ensureForm_(props, 'ACTION_FORM', buildActionForm_, folders.FORMS_FOLDER);
  ensureForm_(props, 'VOLUNTEER_FORM', buildVolunteerForm_, folders.FORMS_FOLDER);
  refreshReportTypes();
  installTriggers_();

  Logger.log([
    'Setup complete.',
    `Register:            ${ss.getUrl()}`,
    `New report form:     ${formUrl_('NEW_REPORT_FORM')}`,
    `Report action form:  ${formUrl_('ACTION_FORM')}`,
    `Volunteer sign-up:   ${formUrl_('VOLUNTEER_FORM')}`,
  ].join('\n'));
}

/** Keeps the "Report type" dropdown in sync with the Report Types sheet. */
function refreshReportTypes() {
  const names = reportTypes_().map(t => String(t.Type));
  const form = FormApp.openById(prop_('NEW_REPORT_FORM'));
  const item = form.getItems().find(i => i.getTitle() === FORM_ITEMS.REPORT_TYPE);
  if (item && names.length) item.asListItem().setChoiceValues(names);
}

function installTriggers_() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onNewReportSubmit').forForm(prop_('NEW_REPORT_FORM')).onFormSubmit().create();
  ScriptApp.newTrigger('onReportActionSubmit').forForm(prop_('ACTION_FORM')).onFormSubmit().create();
  ScriptApp.newTrigger('onVolunteerSignup').forForm(prop_('VOLUNTEER_FORM')).onFormSubmit().create();
  ScriptApp.newTrigger('onRegisterEdit').forSpreadsheet(prop_('REGISTER_ID')).onEdit().create();
  ScriptApp.newTrigger('dailyReminders').timeBased().everyDays(1).atHour(9).inTimezone(CONFIG.TIME_ZONE).create();
  ScriptApp.newTrigger('syncWebsite').timeBased().everyDays(1).atHour(2).inTimezone(CONFIG.TIME_ZONE).create();
}

function existingFile_(props, key) {
  const id = props.getProperty(key);
  if (!id) return null;
  try {
    return DriveApp.getFileById(id).isTrashed() ? null : id;
  } catch (err) {
    return null;
  }
}

function ensureFolder_(props, key, parent, name) {
  const id = props.getProperty(key);
  if (id) {
    try {
      const existing = DriveApp.getFolderById(id);
      if (!existing.isTrashed()) return existing;
    } catch (err) { /* recreate below */ }
  }
  const found = parent.getFoldersByName(name);
  const folder = found.hasNext() ? found.next() : parent.createFolder(name);
  props.setProperty(key, folder.getId());
  return folder;
}

function ensureSheet_(ss, name, headers) {
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function addValidation_(ss) {
  const list = values => SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build();
  const col = (name, header) => HEADERS[name].indexOf(header) + 1;

  const people = ss.getSheetByName(SHEETS.PEOPLE);
  people.getRange(2, col(SHEETS.PEOPLE, 'Type'), 999).setDataValidation(list(Object.keys(CONFIG.ID_PREFIX)));
  people.getRange(2, col(SHEETS.PEOPLE, 'Role'), 999).setDataValidation(list(ROLES));
  people.getRange(2, col(SHEETS.PEOPLE, 'Status'), 999).setDataValidation(list(Object.values(PERSON_STATUS)));
  people.getRange(2, col(SHEETS.PEOPLE, 'Phone'), 999).setNumberFormat('@');

  ss.getSheetByName(SHEETS.TYPES).getRange(2, col(SHEETS.TYPES, 'Needs eSignature'), 999).setDataValidation(list(['Yes', 'No']));

  // The scripts maintain these two sheets; warn anyone editing them by hand.
  [SHEETS.REPORTS, SHEETS.AUDIT].forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) {
      sheet.protect().setDescription('Maintained by the workspace script').setWarningOnly(true);
    }
  });
}

function createDefaultTemplate_(folder) {
  const doc = DocumentApp.create('Template · General Report');
  const body = doc.getBody();
  body.getParagraphs()[0].setText('{{Title}}').setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph('{{Report ID}} · {{Author}} · {{Date}}').setHeading(DocumentApp.ParagraphHeading.SUBTITLE);
  ['Summary', 'Background', 'Activities', 'Outcomes and numbers', 'Challenges', 'Next steps'].forEach(h => {
    body.appendParagraph(h).setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendParagraph('').setHeading(DocumentApp.ParagraphHeading.NORMAL);
  });
  doc.saveAndClose();
  const file = DriveApp.getFileById(doc.getId());
  file.moveTo(folder);
  return file;
}

function ensureForm_(props, key, build, folder) {
  if (existingFile_(props, key)) return;
  const form = build();
  // Respondents sign in with their own Google account, so we know exactly who submitted.
  try {
    form.setEmailCollectionType(FormApp.EmailCollectionType.VERIFIED);
  } catch (err) {
    form.setCollectEmail(true);
  }
  try {
    form.setRequireLogin(false); // allow personal Gmail accounts, not only @nexjyoti.org
  } catch (err) { /* not available on every edition */ }
  DriveApp.getFileById(form.getId()).moveTo(folder);
  props.setProperty(key, form.getId());
}

function buildNewReportForm_() {
  const form = FormApp.create(`${CONFIG.ORG_NAME} · New report`);
  form.setDescription('Creates your report document from a template and emails you the link. '
    + `Sign in with the Google account registered with ${CONFIG.ORG_NAME}.`);
  form.addListItem().setTitle(FORM_ITEMS.REPORT_TYPE).setChoiceValues(['General Report']).setRequired(true);
  form.addTextItem().setTitle(FORM_ITEMS.REPORT_TITLE).setRequired(true);
  form.setConfirmationMessage('Done. The document link will reach your inbox within a minute.');
  return form;
}

function buildActionForm_() {
  const form = FormApp.create(`${CONFIG.ORG_NAME} · Report action`);
  form.setDescription('Submit, approve or request changes on a report. The buttons in our emails fill this in for you.');
  form.addTextItem().setTitle(FORM_ITEMS.REPORT_ID).setHelpText('For example RPT-2026-0001').setRequired(true);
  form.addMultipleChoiceItem().setTitle(FORM_ITEMS.ACTION)
    .setChoiceValues(Object.values(ACTIONS)).setRequired(true);
  form.addParagraphTextItem().setTitle(FORM_ITEMS.COMMENT)
    .setHelpText('Required in practice when requesting changes. Tell the author what to fix.');
  form.setConfirmationMessage('Recorded. Everyone involved will be notified by email.');
  form.setShowLinkToRespondAgain(false);
  return form;
}

function buildVolunteerForm_() {
  const form = FormApp.create(`Volunteer with ${CONFIG.ORG_NAME}`);
  form.setDescription(`Thank you for your interest in volunteering with ${CONFIG.ORG_NAME}. `
    + 'Sign in with the Google account you want to use for volunteering.');
  form.addTextItem().setTitle(FORM_ITEMS.NAME).setRequired(true);
  form.addTextItem().setTitle(FORM_ITEMS.PHONE).setRequired(true);
  form.addTextItem().setTitle(FORM_ITEMS.CITY).setRequired(true);
  form.addParagraphTextItem().setTitle(FORM_ITEMS.SKILLS);
  form.addMultipleChoiceItem().setTitle(FORM_ITEMS.AVAILABILITY)
    .setChoiceValues(['Weekdays', 'Weekends', 'Flexible']).setRequired(true);
  form.addCheckboxItem().setTitle(FORM_ITEMS.CONSENT)
    .setChoiceValues([`I agree that ${CONFIG.ORG_NAME} may store these details to coordinate volunteering. `
      + 'I can ask for them to be deleted at any time.'])
    .setRequired(true);
  form.setConfirmationMessage('Thank you! We will be in touch soon.');
  return form;
}
