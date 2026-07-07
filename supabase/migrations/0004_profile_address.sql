-- Adds a mailing address to the profile, editable on /profile.
-- Run this in the Supabase SQL editor after 0003_profile_name.sql.

alter table public.profiles add column if not exists address text;
