/**
 * Pure logic with no Google services, so it can be unit-tested in Node (see tests/).
 */

function normId(v) { return String(v || '').trim().toUpperCase(); }
function normEmail(v) { return String(v || '').trim().toLowerCase(); }
function splitChain(v) { return String(v || '').split(',').map(normId).filter(Boolean); }

/**
 * Review chain: the author's manager, then their manager, and so on, `levels` deep, then the final approver.
 * Inactive people are skipped (climbing continues past them); the author and duplicates are never added.
 * @param {string} authorId
 * @param {Object[]} people rows from the People sheet
 * @param {{levels: number, finalApproverId: string}} type
 * @return {string[]} reviewer IDs in order
 */
function resolveChain(authorId, people, type) {
  const byId = {};
  people.forEach(p => { if (p.ID) byId[normId(p.ID)] = p; });
  const isActive = id => !!byId[id] && byId[id].Status === PERSON_STATUS.ACTIVE;
  const author = normId(authorId);
  const chain = [];

  const levels = Number(type.levels) || 0;
  const seen = { [author]: true }; // guards against Reports To loops
  let current = author;
  while (chain.length < levels) {
    const next = byId[current] ? normId(byId[current]['Reports To']) : '';
    if (!next || seen[next]) break;
    seen[next] = true;
    if (isActive(next)) chain.push(next);
    current = next;
  }

  let finalId = normId(type.finalApproverId);
  if (!isActive(finalId) || finalId === author) {
    const founder = people.find(p => p.Role === 'Founder' && isActive(normId(p.ID)) && normId(p.ID) !== author);
    finalId = founder ? normId(founder.ID) : '';
  }
  if (finalId && chain.indexOf(finalId) === -1) chain.push(finalId);
  return chain;
}

/**
 * Next member ID, e.g. NJEF-2021-00001. Existing IDs in the register are respected, so
 * pre-existing employees keep their numbers and new ones continue after the highest.
 * @param {string} type 'Staff' or 'Volunteer'
 * @param {string[]} existingIds
 * @param {number} hireYear
 */
function nextId(type, existingIds, hireYear) {
  const prefix = CONFIG.ID_PREFIX[type];
  if (!prefix) throw new Error(`Unknown type "${type}". Use one of: ${Object.keys(CONFIG.ID_PREFIX).join(', ')}`);
  const pattern = new RegExp(`^${prefix}-(\\d{4})-(\\d+)$`);
  let max = 0;
  existingIds.forEach(id => {
    const m = normId(id).match(pattern);
    if (!m) return;
    if (CONFIG.ID_RESET_EACH_YEAR && Number(m[1]) !== Number(hireYear)) return;
    max = Math.max(max, Number(m[2]));
  });
  return `${prefix}-${hireYear}-${String(max + 1).padStart(CONFIG.ID_DIGITS, '0')}`;
}

/**
 * The public record shown on the website's verify page, or null if the person shouldn't be listed
 * (no ID yet, or still an applicant). Photos are managed on the website, so photoUrl is never sent.
 * @param {Object} person row from the People sheet
 * @param {string} joined date of joining as yyyy-MM-dd
 * @param {string} now ISO timestamp
 */
function websiteRecord(person, joined, now) {
  const listed = person.Status === PERSON_STATUS.ACTIVE || person.Status === PERSON_STATUS.INACTIVE;
  if (!person.ID || !listed) return null;
  const record = {
    employeeId: normId(person.ID),
    name: String(person.Name || '').trim(),
    designation: String(person.Designation || person.Role || '').trim(),
    department: String(person.Department || person.Type || '').trim(),
    dateOfJoining: joined || '',
    status: person.Status,
    lastUpdated: now,
  };
  if (CONFIG.WEBSITE.PUBLISH_EMAIL) record.email = normEmail(person.Email);
  return record;
}

/**
 * Returns '' when `actor` may perform `action` on `report`, otherwise a reason to show them.
 * @param {Object} report row from the Reports sheet
 * @param {string} action one of ACTIONS
 * @param {{id: string, email: string, role: string, isAdmin: boolean}} actor
 */
function checkAction(report, action, actor) {
  const status = report.Status;
  const isAuthor = normEmail(actor.email) === normEmail(report['Author Email']);
  const chain = splitChain(report.Chain);
  const waitingOn = chain[Number(report.Step) || 0];

  switch (action) {
    case ACTIONS.SUBMIT:
      if (!isAuthor) return 'Only the author can submit this report.';
      if (status !== STATUS.DRAFT && status !== STATUS.CHANGES) return `This report is already "${status}".`;
      return '';
    case ACTIONS.WITHDRAW:
      if (!isAuthor) return 'Only the author can withdraw this report.';
      if (status !== STATUS.IN_REVIEW) return `Only reports in review can be withdrawn (this one is "${status}").`;
      return '';
    case ACTIONS.APPROVE:
    case ACTIONS.CHANGES:
      if (status !== STATUS.IN_REVIEW) return `This report is not in review (it is "${status}").`;
      if (normId(actor.id) !== waitingOn) return `This report is waiting on reviewer ${waitingOn}, not you.`;
      return '';
    case ACTIONS.SIGNED:
      if (status !== STATUS.AWAITING_SIGNATURE) return `This report is not awaiting a signature (it is "${status}").`;
      if (actor.isAdmin || actor.role === 'Founder' || normId(actor.id) === chain[chain.length - 1]) return '';
      return 'Only a founder, the final approver or the admin can mark a report as signed.';
    default:
      return `Unknown action "${action}".`;
  }
}
