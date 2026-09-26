/**
 * NexJyoti Workspace kit: configuration.
 * Edit the values below, then run setup() once from the Apps Script editor (signed in as info@).
 */
const CONFIG = {
  ORG_NAME: 'NexJyoti',
  ADMIN_EMAIL: 'info@nexjyoti.org',
  // Open the Shared Drive in the browser. Its ID is the last part of the URL.
  SHARED_DRIVE_ID: 'PASTE_SHARED_DRIVE_ID_HERE',
  TIME_ZONE: 'Asia/Kolkata',

  // Member IDs look like NJEF-2021-00001: prefix, hire year, number.
  ID_PREFIX: { Staff: 'NJEF', Volunteer: 'NJEF' },
  ID_DIGITS: 5,
  // false: one running number across all years (NJEF-2021-00007, then NJEF-2022-00008).
  // true:  numbering restarts every hire year (NJEF-2022-00001).
  ID_RESET_EACH_YEAR: false,

  REPORT_PREFIX: 'RPT',
  REMIND_AFTER_DAYS: 3,

  // Publishes Active/Inactive members to the website's Firestore, which powers nexjyoti.org/verify.
  WEBSITE: {
    ENABLED: false, // turn on after the one-time Firebase step in the README
    FIREBASE_PROJECT_ID: 'nexjyoti-f92e5',
    COLLECTION: 'employees',
    VERIFY_URL: 'https://nexjyoti.org/verify/',
    PUBLISH_EMAIL: false, // the verify page is public, so keep personal emails off it
  },
};

const SHEETS = {
  PEOPLE: 'People',
  TYPES: 'Report Types',
  REPORTS: 'Reports',
  AUDIT: 'Audit Log',
};

const HEADERS = {
  'People': ['ID', 'Name', 'Type', 'Email', 'Phone', 'Reports To', 'Role', 'Designation', 'Department', 'Status',
    'Skills', 'City', 'Availability', 'Consent', 'Joined', 'Left', 'Notes'],
  'Report Types': ['Type', 'Template Doc URL', 'Review Levels', 'Final Approver ID', 'Needs eSignature'],
  'Reports': ['Report ID', 'Title', 'Type', 'Author ID', 'Author Email', 'Doc URL', 'Doc ID', 'Status',
    'Chain', 'Step', 'Created', 'Updated', 'Last Reminder', 'Final PDF URL', 'PDF SHA-256'],
  'Audit Log': ['Timestamp', 'Report ID', 'Actor ID', 'Actor Email', 'Action', 'Comment'],
};

const ROLES = ['Founder', 'Staff', 'Volunteer Coordinator', 'Volunteer'];

const PERSON_STATUS = { APPLIED: 'Applied', ACTIVE: 'Active', INACTIVE: 'Inactive' };

const STATUS = {
  DRAFT: 'Draft',
  IN_REVIEW: 'In Review',
  CHANGES: 'Changes Requested',
  AWAITING_SIGNATURE: 'Awaiting Signature',
  APPROVED: 'Approved',
  SIGNED: 'Signed',
};

const ACTIONS = {
  SUBMIT: 'Submit for review',
  APPROVE: 'Approve',
  CHANGES: 'Request changes',
  WITHDRAW: 'Withdraw',
  SIGNED: 'Mark signed',
};

// Form question titles. The scripts read answers by these titles, so keep them in sync.
const FORM_ITEMS = {
  REPORT_TYPE: 'Report type',
  REPORT_TITLE: 'Report title',
  REPORT_ID: 'Report ID',
  ACTION: 'Action',
  COMMENT: 'Comment',
  NAME: 'Full name',
  PHONE: 'Phone (WhatsApp)',
  CITY: 'City',
  SKILLS: 'Skills and interests',
  AVAILABILITY: 'Availability',
  CONSENT: 'Consent',
};
