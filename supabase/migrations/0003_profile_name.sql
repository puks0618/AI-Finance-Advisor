-- Adds a display name to the profile, collected at signup and editable on /profile.
-- Run this in the Supabase SQL editor after 0002_stripe_subscriptions.sql.

alter table public.profiles add column if not exists full_name text;
