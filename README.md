# Operations Hours Tracker

A private, role-based overtime, PTO, employee, and 2-2-3 shift tracking app for operations teams.

## Architecture

- GitHub Pages hosts the static React interface.
- Supabase Auth provides email/password sign-in.
- Supabase PostgreSQL stores all tracker data.
- Row-level security (RLS) enforces administrator, supervisor, and viewer permissions.
- Database triggers enforce overtime schedule rules and write the audit trail.

The Supabase **publishable** key is intentionally used by the browser. It is not a password; RLS protects the data. Never add a Supabase secret key or service-role key to this repository or to browser code.

## First deployment

1. In Supabase SQL Editor, run `supabase/migrations/20260814010000_github_pages_auth_rls.sql`.
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

- **Admin:** employees, imports, schedule corrections, user approvals, reports, OT/PTO, and audit history.
- **Supervisor:** OT and PTO entry/deletion plus read-only operational views.
- **Viewer:** read-only access.
