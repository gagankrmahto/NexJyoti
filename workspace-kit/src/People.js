/**
 * Member register: volunteer sign-up and ID assignment.
 * Setting someone's Status to Active in the People sheet assigns their NJEF-YYYY-NNNNN ID.
 */

function onVolunteerSignup(e) {
  const email = normEmail(e.response.getRespondentEmail());
  const a = answers_(e.response);
  withLock_(() => {
    const fields = {
      'Name': a[FORM_ITEMS.NAME],
      'Phone': a[FORM_ITEMS.PHONE] || '',
      'City': a[FORM_ITEMS.CITY] || '',
      'Skills': a[FORM_ITEMS.SKILLS] || '',
      'Availability': a[FORM_ITEMS.AVAILABILITY] || '',
      'Consent': `Yes, ${fmt_(new Date())}`,
    };
    const existing = personByEmail_(email, people_());
    if (existing) {
      updateRow_(SHEETS.PEOPLE, existing._row, fields);
    } else {
      appendRow_(SHEETS.PEOPLE, Object.assign({ Type: 'Volunteer', Email: email, Status: PERSON_STATUS.APPLIED }, fields));
    }

    const coordinators = people_()
      .filter(p => p.Role === 'Volunteer Coordinator' && p.Status === PERSON_STATUS.ACTIVE)
      .map(p => p.Email);
    sendMail_([CONFIG.ADMIN_EMAIL].concat(coordinators), `New volunteer application: ${fields.Name}`,
      `<p><b>${esc_(fields.Name)}</b> (${esc_(email)}, ${esc_(fields.City)}) applied to volunteer.</p>`
      + `<p>Skills: ${esc_(fields.Skills)}<br>Availability: ${esc_(fields.Availability)}</p>`
      + `<p>To approve, set their <b>Status</b> to <b>Active</b> and fill in <b>Reports To</b> in the Register. `
      + `An ID is assigned automatically.</p>`
      + `<p>${button_('Open the Register', register_().getUrl())}</p>`);
    sendMail_(email, 'Thanks for signing up',
      `<p>Hi ${esc_(fields.Name)},</p><p>Thank you for offering to volunteer with ${esc_(CONFIG.ORG_NAME)}. `
      + `Our team will contact you soon. Once you're approved, you'll get your ${esc_(CONFIG.ORG_NAME)} ID by email.</p>`);
  });
}

/** Installable edit trigger on the Register. */
function onRegisterEdit(e) {
  const sheet = e.range.getSheet();
  if (sheet.getName() === SHEETS.TYPES) return refreshReportTypes();
  if (sheet.getName() !== SHEETS.PEOPLE) return;

  const headers = headersOf_(sheet);
  const statusCol = headers.indexOf('Status') + 1;
  if (statusCol < e.range.getColumn() || statusCol > e.range.getLastColumn()) return;

  withLock_(() => {
    const people = people_();
    const ids = people.map(p => p.ID).filter(Boolean).concat(websiteIds_());
    for (let row = Math.max(e.range.getRow(), 2); row <= e.range.getLastRow(); row++) {
      const person = people.find(p => p._row === row);
      if (!person) continue;
      if (person.Status === PERSON_STATUS.ACTIVE && !person.ID) {
        activate_(sheet, headers, person, ids);
      } else if (person.Status === PERSON_STATUS.INACTIVE && !person.Left) {
        updateRow_(SHEETS.PEOPLE, row, { 'Left': new Date() });
        syncPersonToWebsite_(person);
      }
    }
  });
}

function activate_(sheet, headers, person, ids) {
  const typeCell = sheet.getRange(person._row, headers.indexOf('Type') + 1);
  if (!CONFIG.ID_PREFIX[person.Type]) {
    typeCell.setNote('Set Type (Staff or Volunteer), then set Status to Active again to assign an ID.');
    return;
  }
  typeCell.clearNote();
  const joined = person.Joined || new Date();
  const id = nextId(person.Type, ids, yearOf_(joined));
  ids.push(id);
  updateRow_(SHEETS.PEOPLE, person._row, { 'ID': id, 'Joined': joined });
  syncPersonToWebsite_(Object.assign({}, person, { ID: id, Joined: joined }));

  if (!person.Email) return;
  const verifyUrl = CONFIG.WEBSITE.VERIFY_URL + encodeURIComponent(id);
  sendMail_(person.Email, `Welcome to ${CONFIG.ORG_NAME}. Your ID is ${id}`,
    `<p>Hi ${esc_(person.Name)},</p>`
    + `<p>Welcome aboard! Your ${esc_(CONFIG.ORG_NAME)} ID is <b style="font-size:16px">${esc_(id)}</b>. `
    + `Please use it on reports and when you contact the team.</p>`
    + (CONFIG.WEBSITE.ENABLED ? `<p>Anyone can confirm your ID at <a href="${esc_(verifyUrl)}">${esc_(verifyUrl)}</a>.</p>` : '')
    + `<p>When you use our forms, sign in with this Google account (${esc_(person.Email)}).</p>`
    + `<p>${button_('Start a new report', formUrl_('NEW_REPORT_FORM'))}</p>`);
}
