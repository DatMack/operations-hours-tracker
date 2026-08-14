# Production-readiness checklist

Complete this checklist before importing real employee information.

- [ ] Supabase RLS migration completed without an error.
- [ ] Anonymous REST requests cannot read any tracker table.
- [ ] Public Auth sign-ups are disabled.
- [ ] The first Auth user has a matching active admin profile.
- [ ] An admin can manage employees, users, schedule corrections, OT, and PTO.
- [ ] A supervisor can manage OT/PTO but cannot change users, employees, or the schedule.
- [ ] A viewer can read but cannot create, update, or delete records.
- [ ] Scheduled-shift overtime is rejected by PostgreSQL, even outside the UI.
- [ ] Audit records appear after employee, OT, PTO, user, and schedule changes.
- [ ] GitHub Build and security, CodeQL, and Pages deployment checks are green.
- [ ] No spreadsheet exports or employee data are committed to GitHub.
- [ ] Company IT has approved the pilot and its employee-data handling.
