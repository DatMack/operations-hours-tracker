# Operations Hours Tracker

A private, role-based overtime, PTO, employee, department, and 2-2-3 shift tracking app for company operations teams.

## Company-wide features

- Configurable departments with default cost codes and safe deactivation.
- Four crews: Blue Day, Blue Night, Yellow Day, and Yellow Night.
- Overtime entry with quick hours, working department, cost code, reason, and notes.
- Historical employee, department, and shift snapshots so later transfers or renames do not rewrite old reports.
- Personal dashboards with add/remove, ordering, sizing, KPI, chart, workforce, schedule, and daily-detail widgets saved for each signed-in account.
- Reports filtered by employee, department, shift, cost code, reason, and date.
- CSV employee and historical-data imports plus Excel-ready report exports.

## Architecture

- GitHub Pages hosts the static React interface.
- Supabase Auth provides email/password sign-in.
- Supabase PostgreSQL stores all tracker data.
- Row-level security (RLS) enforces administrator, supervisor, and viewer permissions.
- Database triggers enforce overtime schedule rules and write the audit trail.

The Supabase **publishable** key is intentionally used by the browser. It is not a password; RLS protects the data. Never add a Supabase secret key or service-role key to this repository or to browser code.

## Security controls

- No anonymous table access; approved Supabase Auth users only.
- PostgreSQL-enforced admin, supervisor, and viewer permissions.
- Database validation prevents scheduled-shift overtime outside the UI.
- Database validation blocks duplicate employee/date/department/cost-code overtime and non-quarter-hour values.
- Department records are deactivated rather than deleted, preserving reporting history.
- Overtime records retain historical employee, department, and shift snapshots.
- Database-triggered, administrator-only audit history.
- Protection against disabling the last active administrator.
- 30-minute browser inactivity timeout and a restrictive Content Security Policy.
- Automated typechecking, tests, secret checks, dependency audit, CodeQL scanning, and Dependabot updates.

Do not import real employee information until every item in `SECURITY_CHECKLIST.md` has been verified.

## First deployment

1. In Supabase SQL Editor, run the files in `supabase/migrations` in filename order. Existing installations only need migrations that have not already been applied.
2. In Supabase Authentication, create the first email/password user.
3. Edit and run `supabase/ADMIN_SETUP.sql` with the exact same email.
4. In GitHub, open **Settings → Pages** and select **GitHub Actions** as the source.
5. The deployment workflow publishes the app at `https://datmack.github.io/operations-hours-tracker/`.
6. In Supabase Authentication URL settings, add that URL as the Site URL and an allowed redirect URL.
7. Disable public user sign-ups for an invite-only pilot.

## Local development

```bash
npm install
npm run dev
```

The project includes the current Supabase project URL and browser-safe publishable key as defaults so the GitHub build works without secret configuration. They can be overridden with the variables shown in `.env.example`.

## Roles

- **Admin:** departments, employees, imports, schedule corrections, user approvals, reports, OT/PTO, and audit history.
- **Supervisor:** OT and PTO entry/deletion plus read-only operational views.
- **Viewer:** read-only access.

## Managing approved users

Administrators manage tracker authorization from **Administration**. Select an
existing person to update their name, email, role, assignment, or active status;
email changes update the selected profile rather than inserting a duplicate.
The delete action removes tracker access and is audited, while the final active
administrator and the currently signed-in account remain protected. Use **Add
new person** only for a new approved profile.

Supabase Authentication remains the identity and password system. Every active
tracker profile must have a matching Supabase Auth user with the exact same
email. Removing a tracker profile does not delete its Supabase Auth account.

## Personal dashboards

Every administrator, supervisor, and viewer can select **Customize dashboard**
to choose their own widgets, order, and width. The layout is saved against the
Supabase Auth user ID, so it follows that person between computers and browsers.
Viewer accounts can customize their dashboard but remain read-only everywhere
else. PostgreSQL row-level security allows each approved user to read or change
only their own dashboard preference record.
