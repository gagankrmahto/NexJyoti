/** Small helpers shared by the triggers. */

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** Form answers keyed by question title. */
function answers_(response) {
  const out = {};
  response.getItemResponses().forEach(r => { out[r.getItem().getTitle()] = r.getResponse(); });
  return out;
}

/** Link to a form with some answers already filled in (used for Approve / Request changes buttons). */
function prefillUrl_(formId, values) {
  const form = FormApp.openById(formId);
  const response = form.createResponse();
  form.getItems().forEach(item => {
    const value = values[item.getTitle()];
    if (value === undefined) return;
    switch (item.getType()) {
      case FormApp.ItemType.TEXT: response.withItemResponse(item.asTextItem().createResponse(value)); break;
      case FormApp.ItemType.PARAGRAPH_TEXT: response.withItemResponse(item.asParagraphTextItem().createResponse(value)); break;
      case FormApp.ItemType.MULTIPLE_CHOICE: response.withItemResponse(item.asMultipleChoiceItem().createResponse(value)); break;
      case FormApp.ItemType.LIST: response.withItemResponse(item.asListItem().createResponse(value)); break;
    }
  });
  return response.toPrefilledUrl();
}

function formUrl_(key) { return FormApp.openById(prop_(key)).getPublishedUrl(); }

function sha256_(input) {
  const digest = typeof input === 'string'
    ? Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8)
    : Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input);
  return digest.map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

function fmt_(date) { return Utilities.formatDate(new Date(date), CONFIG.TIME_ZONE, 'dd MMM yyyy, HH:mm'); }
function fmtDate_(date) { return Utilities.formatDate(new Date(date), CONFIG.TIME_ZONE, 'dd MMM yyyy'); }
function yearOf_(date) { return Number(Utilities.formatDate(new Date(date), CONFIG.TIME_ZONE, 'yyyy')); }

function idFromUrl_(url) {
  const match = String(url || '').match(/[-\w]{25,}/);
  if (!match) throw new Error(`Not a Google Drive link: ${url}`);
  return match[0];
}

function nextReportId_() {
  const props = PropertiesService.getScriptProperties();
  const year = yearOf_(new Date());
  const key = `REPORT_SEQ_${year}`;
  const n = Number(props.getProperty(key) || 0) + 1;
  props.setProperty(key, String(n));
  return `${CONFIG.REPORT_PREFIX}-${year}-${String(n).padStart(4, '0')}`;
}

function esc_(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
