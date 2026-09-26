// Unit tests for src/Chain.js. Run with: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load(configOverrides = {}) {
  const ctx = vm.createContext({});
  for (const f of ['Config.js', 'Chain.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), ctx, { filename: f });
  }
  vm.runInContext(`Object.assign(CONFIG, ${JSON.stringify(configOverrides)})`, ctx);
  return vm.runInContext('({ resolveChain, nextId, checkAction, websiteRecord, STATUS, ACTIONS })', ctx);
}

const { resolveChain, nextId, checkAction, websiteRecord, STATUS, ACTIONS } = load();
const arr = a => Array.from(a); // vm arrays come from another realm

const person = (ID, Role, reportsTo, Status = 'Active') =>
  ({ ID, Role, 'Reports To': reportsTo, Status, Email: `${ID.toLowerCase()}@gmail.com` });

const people = [
  person('NJEF-2021-00001', 'Founder', ''),
  person('NJEF-2021-00002', 'Staff', 'NJEF-2021-00001'),
  person('NJEF-2022-00003', 'Staff', 'NJEF-2021-00002'),
  person('NJEF-2024-00004', 'Volunteer', 'NJEF-2022-00003'),
  person('NJEF-2022-00005', 'Staff', 'NJEF-2021-00001', 'Inactive'),
  person('NJEF-2023-00006', 'Staff', 'NJEF-2022-00005'),
];

test('one level: manager then founder', () => {
  assert.deepStrictEqual(arr(resolveChain('NJEF-2024-00004', people, { levels: 1 })),
    ['NJEF-2022-00003', 'NJEF-2021-00001']);
});

test('two levels climb the hierarchy', () => {
  assert.deepStrictEqual(arr(resolveChain('NJEF-2024-00004', people, { levels: 2 })),
    ['NJEF-2022-00003', 'NJEF-2021-00002', 'NJEF-2021-00001']);
});

test('founder reached as manager is not added twice', () => {
  assert.deepStrictEqual(arr(resolveChain('NJEF-2024-00004', people, { levels: 5 })),
    ['NJEF-2022-00003', 'NJEF-2021-00002', 'NJEF-2021-00001']);
});

test('inactive manager is skipped, climbing continues', () => {
  assert.deepStrictEqual(arr(resolveChain('NJEF-2023-00006', people, { levels: 1 })), ['NJEF-2021-00001']);
});

test('explicit final approver replaces founder fallback', () => {
  assert.deepStrictEqual(arr(resolveChain('NJEF-2024-00004', people, { levels: 1, finalApproverId: 'njef-2021-00002' })),
    ['NJEF-2022-00003', 'NJEF-2021-00002']);
});

test('founder as author: another founder approves, or nobody', () => {
  assert.deepStrictEqual(arr(resolveChain('NJEF-2021-00001', people, { levels: 1 })), []);
  const withCofounder = people.concat(person('NJEF-2021-00009', 'Founder', ''));
  assert.deepStrictEqual(arr(resolveChain('NJEF-2021-00001', withCofounder, { levels: 1 })), ['NJEF-2021-00009']);
});

test('reports-to loop does not hang', () => {
  const loop = [person('NJEF-2025-00001', 'Staff', 'NJEF-2025-00002'), person('NJEF-2025-00002', 'Staff', 'NJEF-2025-00001')];
  assert.deepStrictEqual(arr(resolveChain('NJEF-2025-00001', loop, { levels: 5 })), ['NJEF-2025-00002']);
});

test('IDs: running number continues across years', () => {
  assert.strictEqual(nextId('Staff', ['NJEF-2021-00001', 'NJEF-2023-00007', 'junk'], 2026), 'NJEF-2026-00008');
  assert.strictEqual(nextId('Volunteer', [], 2026), 'NJEF-2026-00001');
});

test('IDs: optional yearly reset', () => {
  const yearly = load({ ID_RESET_EACH_YEAR: true });
  assert.strictEqual(yearly.nextId('Staff', ['NJEF-2021-00001', 'NJEF-2026-00002'], 2026), 'NJEF-2026-00003');
  assert.strictEqual(yearly.nextId('Staff', ['NJEF-2021-00005'], 2026), 'NJEF-2026-00001');
});

test('actions: only the right person can act', () => {
  const report = { Status: STATUS.DRAFT, 'Author Email': 'a@gmail.com', Chain: 'NJEF-2022-00003, NJEF-2021-00001', Step: 0 };
  const author = { id: 'NJEF-2024-00004', email: 'A@gmail.com', role: 'Volunteer' };
  const reviewer = { id: 'NJEF-2022-00003', email: 'r@gmail.com', role: 'Staff' };
  const founder = { id: 'NJEF-2021-00001', email: 'f@gmail.com', role: 'Founder' };

  assert.strictEqual(checkAction(report, ACTIONS.SUBMIT, author), '');
  assert.notStrictEqual(checkAction(report, ACTIONS.SUBMIT, reviewer), '');

  const inReview = { ...report, Status: STATUS.IN_REVIEW };
  assert.strictEqual(checkAction(inReview, ACTIONS.APPROVE, reviewer), '');
  assert.match(checkAction(inReview, ACTIONS.APPROVE, founder), /waiting on reviewer NJEF-2022-00003/);
  assert.strictEqual(checkAction(inReview, ACTIONS.WITHDRAW, author), '');

  const awaiting = { ...report, Status: STATUS.AWAITING_SIGNATURE };
  assert.strictEqual(checkAction(awaiting, ACTIONS.SIGNED, founder), '');
  assert.notStrictEqual(checkAction(awaiting, ACTIONS.SIGNED, reviewer), '');
  assert.strictEqual(checkAction(awaiting, ACTIONS.SIGNED, { id: 'ADMIN', email: 'info@nexjyoti.org', isAdmin: true }), '');
});

test('website record: only issued IDs, no email by default', () => {
  const p = { ID: 'njef-2026-00012', Name: ' Asha ', Type: 'Volunteer', Role: 'Volunteer', Status: 'Active', Email: 'asha@gmail.com' };
  const rec = websiteRecord(p, '2026-09-26', 'NOW');
  assert.deepStrictEqual({ ...rec }, {
    employeeId: 'NJEF-2026-00012', name: 'Asha', designation: 'Volunteer', department: 'Volunteer',
    dateOfJoining: '2026-09-26', status: 'Active', lastUpdated: 'NOW',
  });
  assert.strictEqual(websiteRecord({ ...p, Status: 'Applied' }, '', 'NOW'), null);
  assert.strictEqual(websiteRecord({ ...p, ID: '' }, '', 'NOW'), null);
  assert.strictEqual(websiteRecord({ ...p, Status: 'Inactive' }, '', 'NOW').status, 'Inactive');
  assert.strictEqual(load({ WEBSITE: { PUBLISH_EMAIL: true } }).websiteRecord(p, '', 'NOW').email, 'asha@gmail.com');
});
