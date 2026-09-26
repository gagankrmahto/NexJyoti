/**
 * Report lifecycle:
 * New report form → doc created from template (owned by the Shared Drive) → author submits →
 * reviewers approve one by one along the Reports To chain → approval-record PDF (→ optional eSignature).
 */

function onNewReportSubmit(e) {
  const email = normEmail(e.response.getRespondentEmail());
  const a = answers_(e.response);
  withLock_(() => {
    const author = personByEmail_(email, people_());
    if (!author || author.Status !== PERSON_STATUS.ACTIVE || !author.ID) {
      return reject_(email, 'Report not created',
        `${esc_(email)} is not registered as an active ${esc_(CONFIG.ORG_NAME)} member. Sign in with the Google `
        + `account you registered with, or ask ${esc_(CONFIG.ADMIN_EMAIL)} to add you.`);
    }
    const typeName = a[FORM_ITEMS.REPORT_TYPE];
    const type = reportTypes_().find(t => t.Type === typeName);
    if (!type) return reject_(email, 'Report not created', `Unknown report type "${esc_(typeName)}".`);

    const title = String(a[FORM_ITEMS.REPORT_TITLE] || '').trim();
    const reportId = nextReportId_();
    const template = DriveApp.getFileById(idFromUrl_(type['Template Doc URL']));
    const doc = template.makeCopy(`${reportId} · ${title} · ${author.ID}`, folder_('WORKING_FOLDER'));
    if (doc.getMimeType() === MimeType.GOOGLE_DOCS) {
      fillPlaceholders_(doc.getId(), {
        'Report ID': reportId, 'Title': title, 'Author': `${author.Name} (${author.ID})`, 'Date': fmtDate_(new Date()),
      });
    }
    doc.addEditor(author.Email);

    const now = new Date();
    appendRow_(SHEETS.REPORTS, {
      'Report ID': reportId, 'Title': title, 'Type': typeName, 'Author ID': author.ID, 'Author Email': email,
      'Doc URL': doc.getUrl(), 'Doc ID': doc.getId(), 'Status': STATUS.DRAFT, 'Step': 0, 'Created': now, 'Updated': now,
    });
    audit_(reportId, author.ID, email, 'Created', title);

    sendMail_(author.Email, `${reportId} created: ${title}`,
      `<p>Hi ${esc_(author.Name)},</p><p>Your report <b>${esc_(title)}</b> is ready to write. `
      + `Share it with co-authors from the document's Share button if others are writing with you.</p>`
      + `<p>${button_('Open the document', doc.getUrl(), '#374151')}</p>`
      + `<p>When it's ready, send it for review:</p>`
      + `<p>${button_('Submit for review', actionLink_(reportId, ACTIONS.SUBMIT), '#15803d')}</p>`);
  });
}

function onReportActionSubmit(e) {
  const email = normEmail(e.response.getRespondentEmail());
  const a = answers_(e.response);
  const reportId = normId(a[FORM_ITEMS.REPORT_ID]);
  const action = a[FORM_ITEMS.ACTION];
  const comment = String(a[FORM_ITEMS.COMMENT] || '').trim();
  const subject = `${reportId}: "${action}" not recorded`;

  withLock_(() => {
    const people = people_();
    const person = personByEmail_(email, people);
    const isAdmin = email === normEmail(CONFIG.ADMIN_EMAIL);
    if (!isAdmin && (!person || person.Status !== PERSON_STATUS.ACTIVE)) {
      return reject_(email, subject, `${esc_(email)} is not registered as an active member.`);
    }
    const report = readRows_(SHEETS.REPORTS).find(r => normId(r['Report ID']) === reportId);
    if (!report) return reject_(email, subject, `There is no report with ID ${esc_(reportId)}.`);

    const actor = { id: person ? normId(person.ID) : 'ADMIN', email, role: person ? person.Role : '', isAdmin };
    const problem = checkAction(report, action, actor);
    if (problem) return reject_(email, subject, esc_(problem));

    audit_(report['Report ID'], actor.id, email, action, comment);
    const handlers = {
      [ACTIONS.SUBMIT]: submit_,
      [ACTIONS.APPROVE]: approve_,
      [ACTIONS.CHANGES]: requestChanges_,
      [ACTIONS.WITHDRAW]: withdraw_,
      [ACTIONS.SIGNED]: markSigned_,
    };
    handlers[action](report, people, actor, comment);
  });
}

function submit_(report, people, actor, comment) {
  const type = reportTypes_().find(t => t.Type === report.Type) || {};
  const chain = resolveChain(report['Author ID'], people,
    { levels: type['Review Levels'], finalApproverId: type['Final Approver ID'] });
  if (!chain.length) {
    audit_(report['Report ID'], actor.id, actor.email, 'Submit rejected', 'No reviewer found');
    return reject_(actor.email, `${report['Report ID']}: no reviewer found`,
      `Nobody is set up to review your reports. Ask ${esc_(CONFIG.ADMIN_EMAIL)} to fill in your `
      + `"Reports To" in the Register, or to mark a Founder as Active.`);
  }
  const file = DriveApp.getFileById(report['Doc ID']);
  chain.forEach(id => {
    const reviewer = personById_(id, people);
    if (reviewer) shareAsCommenter_(file, reviewer.Email);
  });
  updateRow_(SHEETS.REPORTS, report._row,
    { 'Status': STATUS.IN_REVIEW, 'Chain': chain.join(', '), 'Step': 0, 'Updated': new Date(), 'Last Reminder': '' });
  notifyReviewer_(Object.assign({}, report, { Chain: chain.join(', '), Step: 0 }), people, comment);
}

function approve_(report, people, actor, comment) {
  const chain = splitChain(report.Chain);
  const step = (Number(report.Step) || 0) + 1;
  if (step >= chain.length) return finalize_(report, people);

  updateRow_(SHEETS.REPORTS, report._row, { 'Step': step, 'Updated': new Date(), 'Last Reminder': '' });
  notifyReviewer_(Object.assign({}, report, { Step: step }), people, comment);
  const author = personById_(report['Author ID'], people);
  const approver = personById_(actor.id, people) || { Name: 'Admin' };
  if (author) {
    sendMail_(author.Email, `${report['Report ID']} approved by ${approver.Name} (${step} of ${chain.length})`,
      `<p><b>${esc_(report.Title)}</b> has moved to the next reviewer.</p>`
      + (comment ? `<p><i>${esc_(approver.Name)}: ${esc_(comment)}</i></p>` : ''));
  }
}

function requestChanges_(report, people, actor, comment) {
  updateRow_(SHEETS.REPORTS, report._row, { 'Status': STATUS.CHANGES, 'Updated': new Date() });
  const author = personById_(report['Author ID'], people);
  const reviewer = personById_(actor.id, people) || { Name: 'A reviewer' };
  if (!author) return;
  sendMail_(author.Email, `Changes requested on ${report['Report ID']}: ${report.Title}`,
    `<p>${esc_(reviewer.Name)} (${esc_(actor.id)}) asked for changes.</p>`
    + (comment ? `<blockquote style="border-left:3px solid #d1d5db;margin:0;padding-left:12px">${esc_(comment)}</blockquote>` : '')
    + `<p>Check the comments in the document, update it, then submit again. Review restarts from the first reviewer.</p>`
    + `<p>${button_('Open the document', report['Doc URL'], '#374151')}`
    + `${button_('Submit again', actionLink_(report['Report ID'], ACTIONS.SUBMIT), '#15803d')}</p>`);
}

function withdraw_(report, people) {
  const chain = splitChain(report.Chain);
  const reviewer = personById_(chain[Number(report.Step) || 0], people);
  updateRow_(SHEETS.REPORTS, report._row, { 'Status': STATUS.DRAFT, 'Updated': new Date() });
  if (reviewer) {
    sendMail_(reviewer.Email, `${report['Report ID']} withdrawn`,
      `<p>The author withdrew <b>${esc_(report.Title)}</b> from review. No action needed from you.</p>`);
  }
}

function markSigned_(report, people) {
  updateRow_(SHEETS.REPORTS, report._row, { 'Status': STATUS.SIGNED, 'Updated': new Date() });
  const author = personById_(report['Author ID'], people);
  if (author) {
    sendMail_(author.Email, `${report['Report ID']} signed`, `<p><b>${esc_(report.Title)}</b> has been signed.</p>`);
  }
}

function finalize_(report, people) {
  const id = report['Report ID'];
  const chain = splitChain(report.Chain);
  const type = reportTypes_().find(t => t.Type === report.Type) || {};
  const needsSignature = /^y/i.test(String(type['Needs eSignature'] || ''));

  const pdf = buildApprovalPdf_(report, people);
  lockDoc_(report);
  updateRow_(SHEETS.REPORTS, report._row, {
    'Status': needsSignature ? STATUS.AWAITING_SIGNATURE : STATUS.APPROVED, 'Step': chain.length,
    'Updated': new Date(), 'Final PDF URL': pdf.url, 'PDF SHA-256': pdf.hash,
  });

  const recipients = [report['Author Email']]
    .concat(chain.map(c => (personById_(c, people) || {}).Email))
    .filter((v, i, all) => v && all.indexOf(v) === i);
  sendMail_(recipients, `${id} approved: ${report.Title}`,
    `<p><b>${esc_(report.Title)}</b> has been approved by every reviewer. The approval record is attached to the final PDF.</p>`
    + `<p>${button_('Open the approved PDF', pdf.url, '#15803d')}</p>`
    + (needsSignature ? '<p>It now goes to the founders for eSignature.</p>' : ''));

  if (needsSignature) {
    const signer = personById_(chain[chain.length - 1], people) || {};
    sendMail_(CONFIG.ADMIN_EMAIL, `${id} needs an eSignature`,
      `<ol><li>Open the report document while signed in as ${esc_(CONFIG.ADMIN_EMAIL)}.</li>`
      + `<li>Go to <b>Tools → eSignature</b>, add a signature field, and request a signature from `
      + `${esc_(signer.Name || 'the final approver')} (${esc_(signer.Email || '')}).</li>`
      + `<li>When the signed copy arrives, mark it as signed.</li></ol>`
      + `<p>${button_('Open the document', report['Doc URL'], '#374151')}`
      + `${button_('Mark signed', actionLink_(id, ACTIONS.SIGNED), '#15803d')}</p>`);
  }
}

/** Copy of the doc + an approval-record page, exported to PDF in the Final folder. */
function buildApprovalPdf_(report, people) {
  const id = report['Report ID'];
  const source = DriveApp.getFileById(report['Doc ID']);
  const contentHash = sha256_(DocumentApp.openById(source.getId()).getBody().getText());

  const snapshot = source.makeCopy(`${id} · approval snapshot`, folder_('WORKING_FOLDER'));
  const doc = DocumentApp.openById(snapshot.getId());
  const body = doc.getBody();
  body.appendPageBreak();
  body.appendParagraph('Approval record').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph(`${id} · ${report.Title}`);

  const rows = [['Step', 'Name', 'ID', 'Role', 'Action', 'Date and time']];
  approvalTrail_(id).forEach((entry, i) => {
    const p = personById_(entry['Actor ID'], people) || {};
    rows.push([i === 0 ? 'Author' : `Reviewer ${i}`, String(p.Name || entry['Actor Email']),
      String(entry['Actor ID']), String(p.Role || ''), String(entry.Action), fmt_(entry.Timestamp)]);
  });
  const table = body.appendTable(rows);
  table.getRow(0).editAsText().setBold(true);

  body.appendParagraph(`Content fingerprint (SHA-256 of the document text at approval): ${contentHash}`);
  body.appendParagraph(`Generated by ${CONFIG.ORG_NAME} Workspace on ${fmt_(new Date())}. Internal approval record.`)
    .editAsText().setItalic(true);
  doc.saveAndClose();

  const blob = snapshot.getAs(MimeType.PDF).setName(`${id} - ${report.Title} - approved.pdf`);
  const pdf = folder_('FINAL_FOLDER').createFile(blob);
  snapshot.setTrashed(true);
  return { url: pdf.getUrl(), hash: sha256_(blob.getBytes()) };
}

/** The latest submission plus every approval after it. */
function approvalTrail_(reportId) {
  const entries = readRows_(SHEETS.AUDIT).filter(r => normId(r['Report ID']) === normId(reportId));
  let start = -1;
  entries.forEach((r, i) => { if (r.Action === ACTIONS.SUBMIT) start = i; });
  if (start === -1) return [];
  return [entries[start]].concat(entries.slice(start + 1).filter(r => r.Action === ACTIONS.APPROVE));
}

/** After approval the author keeps comment access only, so the approved text can't drift. */
function lockDoc_(report) {
  const file = DriveApp.getFileById(report['Doc ID']);
  try {
    file.removeEditor(report['Author Email']);
    file.addCommenter(report['Author Email']);
  } catch (err) {
    Logger.log(`Could not lock ${report['Report ID']}: ${err}`);
  }
}

function shareAsCommenter_(file, email) {
  try {
    const isEditor = file.getEditors().some(u => normEmail(u.getEmail()) === normEmail(email));
    if (!isEditor) file.addCommenter(email);
  } catch (err) {
    Logger.log(`Could not share ${file.getName()} with ${email}: ${err}`);
  }
}

function fillPlaceholders_(docId, values) {
  const doc = DocumentApp.openById(docId);
  const body = doc.getBody();
  Object.keys(values).forEach(key => body.replaceText(`\\{\\{${key}\\}\\}`, values[key]));
  doc.saveAndClose();
}

/** Daily: remind reviewers who have had a report for REMIND_AFTER_DAYS or more. */
function dailyReminders() {
  refreshReportTypes();
  const people = people_();
  const cutoff = Date.now() - CONFIG.REMIND_AFTER_DAYS * 24 * 60 * 60 * 1000;
  readRows_(SHEETS.REPORTS)
    .filter(r => r.Status === STATUS.IN_REVIEW)
    .forEach(r => {
      const last = new Date(r['Last Reminder'] || r.Updated).getTime();
      if (last > cutoff) return;
      notifyReviewer_(r, people, '', true);
      updateRow_(SHEETS.REPORTS, r._row, { 'Last Reminder': new Date() });
    });
}
