/**
 * One-way sync from the Register to the website's Firestore collection that powers nexjyoti.org/verify.
 * Only the fields in websiteRecord() are written; photoUrl and anything else set in the website admin is kept.
 */

function firestoreBase_() {
  return `https://firestore.googleapis.com/v1/projects/${CONFIG.WEBSITE.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
}

function firestore_(method, url, body) {
  const options = {
    method: method,
    headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` },
    muteHttpExceptions: true,
  };
  if (body) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }
  const res = UrlFetchApp.fetch(url, options);
  if (res.getResponseCode() >= 300) {
    throw new Error(`Firestore ${method.toUpperCase()} failed (${res.getResponseCode()}): ${res.getContentText().slice(0, 300)}`);
  }
  return JSON.parse(res.getContentText() || '{}');
}

function decodeFields_(fields) {
  const out = {};
  Object.keys(fields || {}).forEach(k => {
    const v = fields[k];
    out[k] = v.stringValue !== undefined ? v.stringValue
      : v.timestampValue !== undefined ? v.timestampValue
        : v.integerValue !== undefined ? Number(v.integerValue)
          : v.booleanValue !== undefined ? v.booleanValue : '';
  });
  return out;
}

/** Every website record, keyed by employeeId. */
function websiteIndex_() {
  const index = {};
  let pageToken = '';
  do {
    const url = `${firestoreBase_()}/${CONFIG.WEBSITE.COLLECTION}?pageSize=300`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const page = firestore_('get', url);
    (page.documents || []).forEach(doc => {
      const data = decodeFields_(doc.fields);
      if (data.employeeId) index[normId(data.employeeId)] = { name: doc.name, data };
    });
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return index;
}

function findWebsiteDoc_(employeeId) {
  const rows = firestore_('post', `${firestoreBase_()}:runQuery`, {
    structuredQuery: {
      from: [{ collectionId: CONFIG.WEBSITE.COLLECTION }],
      where: { fieldFilter: { field: { fieldPath: 'employeeId' }, op: 'EQUAL', value: { stringValue: employeeId } } },
      limit: 1,
    },
  });
  const hit = rows.find(r => r.document);
  return hit ? { name: hit.document.name, data: decodeFields_(hit.document.fields) } : null;
}

/** Creates or updates one record. Returns 'created', 'updated' or 'unchanged'. */
function upsertWebsite_(record, existing) {
  const fields = {};
  Object.keys(record).forEach(k => { fields[k] = { stringValue: String(record[k]) }; });

  if (existing) {
    // A field listed in the mask but absent from `fields` is deleted: this clears emails published earlier.
    const paths = Object.keys(record);
    const staleEmail = !CONFIG.WEBSITE.PUBLISH_EMAIL && existing.data.email !== undefined;
    if (staleEmail) paths.push('email');
    const changed = staleEmail || paths
      .some(k => k !== 'lastUpdated' && k !== 'email' && String(existing.data[k] || '') !== String(record[k]));
    if (!changed) return 'unchanged';
    const mask = paths.map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
    firestore_('patch', `https://firestore.googleapis.com/v1/${existing.name}?${mask}`, { fields });
    return 'updated';
  }
  // New records use the ID as the document ID, so the site can later switch to direct lookups.
  fields.photoUrl = { stringValue: '' };
  firestore_('post', `${firestoreBase_()}/${CONFIG.WEBSITE.COLLECTION}?documentId=${encodeURIComponent(record.employeeId)}`,
    { fields });
  return 'created';
}

function isoDate_(date) {
  return date ? Utilities.formatDate(new Date(date), CONFIG.TIME_ZONE, 'yyyy-MM-dd') : '';
}

/** IDs already on the website, so the Register never issues one that the website admin already used. */
function websiteIds_() {
  if (!CONFIG.WEBSITE.ENABLED) return [];
  try {
    return Object.keys(websiteIndex_());
  } catch (err) {
    Logger.log(`Could not read website IDs: ${err}`);
    return [];
  }
}

/** Publishes one person right away (used when an ID is issued or someone is marked Inactive). */
function syncPersonToWebsite_(person) {
  if (!CONFIG.WEBSITE.ENABLED) return;
  const record = websiteRecord(person, isoDate_(person.Joined), new Date().toISOString());
  if (!record) return;
  try {
    upsertWebsite_(record, findWebsiteDoc_(record.employeeId));
  } catch (err) {
    Logger.log(`Website sync failed for ${record.employeeId}: ${err}. The nightly sync will retry.`);
  }
}

/** Nightly (and manual): brings the website in line with the Register. */
function syncWebsite() {
  if (!CONFIG.WEBSITE.ENABLED) return;
  const existing = websiteIndex_();
  const now = new Date().toISOString();
  const counts = { created: 0, updated: 0, unchanged: 0 };
  people_().forEach(person => {
    const record = websiteRecord(person, isoDate_(person.Joined), now);
    if (record) counts[upsertWebsite_(record, existing[record.employeeId])]++;
  });
  Logger.log(`Website sync: ${JSON.stringify(counts)}`);
}

/**
 * Run once before issuing new IDs: copies people already on the website into the Register,
 * so their IDs are kept and new numbers continue after them.
 */
function importFromWebsite() {
  const existing = websiteIndex_();
  const known = {};
  people_().forEach(p => { if (p.ID) known[normId(p.ID)] = true; });
  let added = 0;
  Object.keys(existing).forEach(id => {
    if (known[id]) return;
    const d = existing[id].data;
    const isVolunteer = /volunt/i.test(`${d.department} ${d.designation}`);
    appendRow_(SHEETS.PEOPLE, {
      'ID': id, 'Name': d.name || '', 'Type': isVolunteer ? 'Volunteer' : 'Staff', 'Email': d.email || '',
      'Role': isVolunteer ? 'Volunteer' : 'Staff', 'Designation': d.designation || '', 'Department': d.department || '',
      'Status': d.status === 'Active' ? PERSON_STATUS.ACTIVE : PERSON_STATUS.INACTIVE,
      'Joined': d.dateOfJoining ? new Date(d.dateOfJoining) : '', 'Notes': 'Imported from website',
    });
    added++;
  });
  Logger.log(`Imported ${added} people from the website. Fill in Email, Role and Reports To for each.`);
}
