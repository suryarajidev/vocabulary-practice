-- Run this once in the Supabase SQL Editor for the Vocab Lab project.
-- Usernames and the aggregate learning stats in this table are visible only
-- to signed-in users. Email addresses and private account data are not stored.

create table if not exists public.user_public_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  stars bigint not null default 0 check (stars >= 0),
  achievements_unlocked integer not null default 0 check (achievements_unlocked >= 0),
  streak_days integer not null default 0 check (streak_days >= 0),
  sessions_completed integer not null default 0 check (sessions_completed >= 0),
  mastered_words integer not null default 0 check (mastered_words >= 0),
  got_it_ratings bigint not null default 0 check (got_it_ratings >= 0),
  bubble_best bigint not null default 0 check (bubble_best >= 0),
  whack_best bigint not null default 0 check (whack_best >= 0),
  wordbound_best_turns integer,
  updated_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[A-Za-z0-9]{3,20}$'),
  constraint wordbound_turns_positive check (wordbound_best_turns is null or wordbound_best_turns > 0)
);

-- lower() makes Surya123 and surya123 count as the same username.
create unique index if not exists user_public_profiles_username_lower_idx
on public.user_public_profiles (lower(username));

alter table public.user_public_profiles enable row level security;

revoke all on table public.user_public_profiles from anon;
grant select, insert, update on table public.user_public_profiles to authenticated;

drop policy if exists "Signed-in users can find public profiles" on public.user_public_profiles;
create policy "Signed-in users can find public profiles"
on public.user_public_profiles
for select
to authenticated
using (true);

drop policy if exists "Users can create their own public profile" on public.user_public_profiles;
create policy "Users can create their own public profile"
on public.user_public_profiles
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own public profile" on public.user_public_profiles;
create policy "Users can update their own public profile"
on public.user_public_profiles
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
