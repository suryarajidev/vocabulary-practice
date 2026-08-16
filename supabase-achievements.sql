-- Run this once in the Supabase SQL Editor for the Vocab Lab project.
-- Each signed-in user can only read and update their own achievement record.

create table if not exists public.user_achievements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  achievement_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_achievements enable row level security;

revoke all on table public.user_achievements from anon;
grant select, insert, update on table public.user_achievements to authenticated;

drop policy if exists "Users can read their own achievements" on public.user_achievements;
create policy "Users can read their own achievements"
on public.user_achievements
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own achievements" on public.user_achievements;
create policy "Users can create their own achievements"
on public.user_achievements
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own achievements" on public.user_achievements;
create policy "Users can update their own achievements"
on public.user_achievements
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
