-- Run this once in the Supabase SQL Editor after creating your first Auth user.
-- Replace both example values with the exact email and display name you used.
insert into public.profiles (email, full_name, role, active)
values (lower('YOUR_EMAIL@example.com'), 'Your Name', 'admin', true)
on conflict (email) do update
set full_name = excluded.full_name,
    role = 'admin',
    active = true;
