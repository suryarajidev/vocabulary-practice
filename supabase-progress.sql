-- Run this once in the Supabase SQL Editor for the Vocab Lab project.
-- Each signed-in user can only read and update their own progress record.
-- Mirrors the setup in supabase-achievements.sql.

create table if not exists public.user_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  progress_data jsonb not null default '{}'::jsonb,
  high_scores_data jsonb not null default '{}'::jsonb,
  streak_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_progress enable row level security;

revoke all on table public.user_progress from anon;
grant select, insert, update on table public.user_progress to authenticated;

drop policy if exists "Users can read their own progress" on public.user_progress;
create policy "Users can read their own progress"
on public.user_progress
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own progress" on public.user_progress;
create policy "Users can create their own progress"
on public.user_progress
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own progress" on public.user_progress;
create policy "Users can update their own progress"
on public.user_progress
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
