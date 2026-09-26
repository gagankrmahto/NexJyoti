/** Outgoing email. Everything is sent from the account that owns the script (info@). */

function sendMail_(to, subject, html) {
  const recipients = [].concat(to).filter(Boolean).join(',');
  if (!recipients) return;
  MailApp.sendEmail({
    to: recipients,
    subject: `[${CONFIG.ORG_NAME}] ${subject}`,
    htmlBody: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2937">${html}`
      + `<p style="color:#6b7280;font-size:12px;margin-top:24px">${esc_(CONFIG.ORG_NAME)} Workspace · `
      + `questions: ${esc_(CONFIG.ADMIN_EMAIL)}</p></div>`,
    name: `${CONFIG.ORG_NAME} Workspace`,
    replyTo: CONFIG.ADMIN_EMAIL,
  });
}

function button_(label, url, color) {
  return `<a href="${esc_(url)}" style="display:inline-block;padding:10px 16px;margin:4px 8px 4px 0;`
    + `background:${color || '#1d4ed8'};color:#fff;border-radius:6px;text-decoration:none">${esc_(label)}</a>`;
}

function reject_(to, subject, html) {
  Logger.log(`Rejected (${to}): ${subject}`);
  sendMail_(to, subject, `<p>${html}</p>`);
}

function actionLink_(reportId, action) {
  return prefillUrl_(prop_('ACTION_FORM'), { [FORM_ITEMS.REPORT_ID]: reportId, [FORM_ITEMS.ACTION]: action });
}

function notifyReviewer_(report, people, comment, isReminder) {
  const chain = splitChain(report.Chain);
  const step = Number(report.Step) || 0;
  const reviewer = personById_(chain[step], people);
  if (!reviewer) return;
  const author = personById_(report['Author ID'], people) || {};
  const id = report['Report ID'];

  sendMail_(reviewer.Email, `${isReminder ? 'Reminder: ' : ''}please review ${id}: ${report.Title}`,
    `<p>Hi ${esc_(reviewer.Name)},</p>`
    + `<p>${esc_(author.Name)} (${esc_(report['Author ID'])}) has sent <b>${esc_(report.Title)}</b> (${esc_(id)}) `
    + `for review. You are reviewer ${step + 1} of ${chain.length}.</p>`
    + (comment ? `<p><i>Latest note: ${esc_(comment)}</i></p>` : '')
    + `<p>${button_('Open the document', report['Doc URL'], '#374151')}</p>`
    + `<p>Leave comments or suggestions in the document, then:</p>`
    + `<p>${button_('Approve', actionLink_(id, ACTIONS.APPROVE), '#15803d')}`
    + `${button_('Request changes', actionLink_(id, ACTIONS.CHANGES), '#b45309')}</p>`
    + `<p style="color:#6b7280">Sign in to the form as ${esc_(reviewer.Email)}. That is how we know it's you.</p>`);
}
