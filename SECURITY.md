# Security policy

## Reporting a vulnerability

Please use GitHub's **Security → Report a vulnerability** private reporting flow. Do not open a public issue containing employee information, credentials, database details, or an exploit.

## Data boundary

This public repository contains application code and a Supabase publishable key. It must never contain employee records, exported reports, passwords, access tokens, Supabase secret keys, service-role keys, or database backups.

All operational data is protected by Supabase Auth and PostgreSQL row-level security. The static GitHub Pages site is not a security boundary.

## Operational requirements

- Keep public sign-ups disabled and create users through the administrator workflow.
- Require a matching active row in `public.profiles` for every user.
- Apply every Supabase migration before deploying dependent application changes.
- Review Dependabot and CodeQL alerts.
- Do not load real employee information until the admin, supervisor, and viewer access tests pass.
- Immediately disable a profile and revoke the user's Supabase sessions when access is no longer required.
