# NexJyoti Workspace kit

A free Google Apps Script system that runs on the existing `info@nexjyoti.org` account (Business Standard). It covers:

- **Member register.** One Google Sheet is the single source of truth for staff and volunteers. Each person gets a permanent ID in the form `NJEF-<hire year>-<number>`, for example `NJEF-2021-00001`.
- **Reports.** Reports are Google Docs in a Shared Drive, so the org always owns them. They open as .docx in Word and can be downloaded as .docx.
- **Review hierarchy.** Each report is reviewed along the author's **Reports To** chain, one reviewer at a time. Reviewers act through email buttons.
- **Internal sign-off.** On final approval, a PDF is generated with an approval-record page that lists who approved, when, and a SHA-256 content fingerprint. Report types marked *Needs eSignature* go on to Google Docs eSignature.
- **Website verification.** Issued IDs are published to the website's Firestore, so `nexjyoti.org/verify/<ID>` works automatically.

Nobody except `info@` needs an org mailbox. Everyone else signs in with their personal Gmail, and the Register maps that Gmail to their ID.

## How it works

| Who | Does | Gets |
|---|---|---|
| New volunteer | Fills in the **Volunteer sign-up** form | Added to the Register as *Applied* |
| Coordinator | Sets Status to **Active** and fills in **Reports To** | ID issued automatically, welcome email sent, ID published on the website |
| Author | Fills in the **New report** form | A doc from the template, shared with them, owned by the org |
| Author | Clicks **Submit for review** in the email | Reviewer 1 is emailed |
| Reviewer | Comments or suggests in the doc, then clicks **Approve** or **Request changes** | The next reviewer is emailed, or the author is asked to fix it |
| Last approver | Clicks **Approve** | An approved PDF with an approval record is saved in *Reports - Final*, and the doc becomes read-only for the author |

The review chain for a report works like this:
1. It starts with the author's **Reports To**, then that person's manager, and so on, for the number of levels set in **Review Levels** on the report type.
2. It ends with the **Final Approver ID**, or the first active **Founder** if that's blank.
3. Inactive people are skipped.

Unanswered reviews get a reminder after 3 days.

Report statuses: `Draft → In Review → (Changes Requested → In Review) → Approved`, or `→ Awaiting Signature → Signed`.

## One-time setup (about an hour, signed in as info@nexjyoti.org)

### 1. Shared Drive and admin settings
1. Go to drive.google.com, then **Shared drives → New**, and name it `NexJyoti`. Copy its ID: the last part of the URL.
2. Go to admin.google.com, then **Apps → Google Workspace → Drive and Docs → Sharing settings**:
   - Set **Sharing outside of nexjyoti.org** to **ON**. Volunteers and staff use personal Gmail.
   - Under **Shared drive creation**, allow people outside the organisation to access files in shared drives, and allow non-members to be added to files.

### 2. Put the script in place
**Option A: clasp (recommended, keeps this folder in sync)**
```bash
npm install -g @google/clasp
```
```bash
clasp login
```
```bash
clasp create --type standalone --title "NexJyoti Workspace" --rootDir src
```
```bash
clasp push
```
Log in as `info@nexjyoti.org`.

**Option B: copy and paste.** Create a project at script.google.com and add one script file per file in `src/`, pasting in its contents. Then turn on **Project Settings → Show "appsscript.json"** and paste that file too.

### 3. Configure and run
1. In `Config.js`, paste the Shared Drive ID into `SHARED_DRIVE_ID`. Check `ADMIN_EMAIL` and the ID settings.
2. In the editor, choose `setup` and click **Run**, then approve the permissions.
3. The execution log lists the Register link and the three form links.

### 4. Fill the Register
1. If people already have IDs on the website, run `importFromWebsite` first. This needs step 5 below.
2. Otherwise, add the founders:
   - Fill in Name, Type `Staff`, Email (their Gmail), Role `Founder`, Designation and Department.
   - Set **Status** to `Active`. An ID is issued the moment you do.
3. Add staff the same way and set their **Reports To** to their manager's ID.
4. Volunteers arrive through the sign-up form. Set them to `Active` to issue their ID.

To use existing IDs, type the ID in yourself **before** setting the person to Active. New numbers continue after the highest existing `NJEF-` number.

### 5. Connect the website (`nexjyoti.org/verify`)
The script writes to the Firestore database of Firebase project `nexjyoti-f92e5` as `info@nexjyoti.org`. It uses Google Cloud permissions (IAM), not the website's login, so no keys or passwords are stored.

1. **Firebase console → Project settings → Users and permissions:** add `info@nexjyoti.org` as **Editor**. The Firebase project owner does this.
2. **Google Cloud console**, with project `nexjyoti-f92e5` selected:
   1. Go to **APIs & Services → OAuth consent screen**. Choose type *External*, app name *NexJyoti Workspace*, and add `info@nexjyoti.org` as a user.
   2. Set **Publishing status** to **In production**. In *Testing* status, Google expires the sign-in after 7 days and the nightly jobs stop working.
   3. Copy the **project number** from the dashboard.
3. **Apps Script → Project Settings → Google Cloud Platform project → Change project:** paste the project number.
4. In `Config.js`, set `WEBSITE.ENABLED: true`, push again, and run `setup` again. That re-authorises the script and adds the nightly sync.
5. Run `importFromWebsite` once, review the imported rows, then run `syncWebsite`.

After that:
- IDs are published when they are issued.
- People marked Inactive show as Inactive on the verify page.
- A full sync runs nightly at 2 AM.

Emails are **not** published unless `WEBSITE.PUBLISH_EMAIL` is set, because the verify page is public. Photos are still uploaded from the website admin, and the sync never overwrites them.

## Everyday admin

- **New report type:**
  1. Make a Google Doc template in *Templates*. It can use `{{Title}}`, `{{Report ID}}`, `{{Author}}` and `{{Date}}`.
  2. Add a row to **Report Types**. The form dropdown updates automatically.
  3. For a .docx template, first use **File → Save as Google Docs**.
- **Someone leaves:** set their Status to `Inactive`. The Left date fills in and the website shows them as inactive. Remove them from the Shared Drive if they were a member.
- **Stuck review:** the *Reports* sheet shows who each report is waiting on, and the Audit Log has every action. The *Report action* form also works for `info@`, as an admin override for *Mark signed*.
- **Limits:** about 1,500 emails a day from Business Standard, and a 6-minute limit per script run. Both are far above what the team needs.

## Development

The logic that doesn't depend on Google services (review chain, ID numbering, permission checks, website record) is in `src/Chain.js` and has unit tests:

```bash
npm test
```

Files in `src/`:

| File | Contents |
|---|---|
| `Config.js` | Settings, sheet headers, statuses |
| `Chain.js` | Pure logic, unit-tested |
| `Setup.js` | Folders, Register, forms, triggers |
| `People.js` | Volunteer sign-up, ID issuing |
| `Reports.js` | Report lifecycle, approval PDF, reminders |
| `Website.js` | Firestore sync for nexjyoti.org/verify |
| `Sheets.js`, `Util.js`, `Notify.js` | Helpers |
