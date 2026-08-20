-- Run this file in the Supabase SQL Editor, and re-run it after updates that add an online game type.
-- Challenge rows are private: only the two participating accounts can read or change them.

create table if not exists public.online_challenges (
  id uuid primary key default gen_random_uuid(),
  challenger_id uuid not null references auth.users(id) on delete cascade,
  opponent_id uuid not null references auth.users(id) on delete cascade,
  challenger_username text not null,
  opponent_username text not null,
  game_type text not null check (game_type in ('memory', 'paragraph', 'whack', 'bubble', 'taboo')),
  status text not null default 'pending' check (status in ('pending', 'active', 'completed', 'declined', 'cancelled')),
  game_state jsonb not null default '{}'::jsonb,
  challenger_result jsonb,
  opponent_result jsonb,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  completed_at timestamptz,
  constraint online_challenges_different_players check (challenger_id <> opponent_id)
);

-- Re-running this setup upgrades existing projects to include Taboo challenges.
alter table public.online_challenges
  drop constraint if exists online_challenges_game_type_check;
alter table public.online_challenges
  add constraint online_challenges_game_type_check
  check (game_type in ('memory', 'paragraph', 'whack', 'bubble', 'taboo'));

create index if not exists online_challenges_challenger_status_idx
  on public.online_challenges (challenger_id, status, updated_at desc);
create index if not exists online_challenges_opponent_status_idx
  on public.online_challenges (opponent_id, status, updated_at desc);

create or replace function public.set_online_challenge_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_online_challenge_updated_at on public.online_challenges;
create trigger set_online_challenge_updated_at
before update on public.online_challenges
for each row execute function public.set_online_challenge_updated_at();

create or replace function public.protect_online_challenge_identity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.challenger_id <> old.challenger_id
    or new.opponent_id <> old.opponent_id
    or new.game_type <> old.game_type
    or new.challenger_username <> old.challenger_username
    or new.opponent_username <> old.opponent_username then
    raise exception 'Challenge players and game type cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_online_challenge_identity on public.online_challenges;
create trigger protect_online_challenge_identity
before update on public.online_challenges
for each row execute function public.protect_online_challenge_identity();

alter table public.online_challenges enable row level security;

drop policy if exists "Participants can view online challenges" on public.online_challenges;
create policy "Participants can view online challenges"
on public.online_challenges for select
to authenticated
using ((select auth.uid()) = challenger_id or (select auth.uid()) = opponent_id);

drop policy if exists "Users can create their own challenges" on public.online_challenges;
create policy "Users can create their own challenges"
on public.online_challenges for insert
to authenticated
with check ((select auth.uid()) = challenger_id and challenger_id <> opponent_id);

drop policy if exists "Participants can update online challenges" on public.online_challenges;
create policy "Participants can update online challenges"
on public.online_challenges for update
to authenticated
using ((select auth.uid()) = challenger_id or (select auth.uid()) = opponent_id)
with check ((select auth.uid()) = challenger_id or (select auth.uid()) = opponent_id);

drop policy if exists "Challengers can delete pending challenges" on public.online_challenges;
create policy "Challengers can delete pending challenges"
on public.online_challenges for delete
to authenticated
using ((select auth.uid()) = challenger_id and status in ('pending', 'cancelled', 'declined'));

grant select, insert, update, delete on public.online_challenges to authenticated;

-- Version-checked state updates prevent both browsers from overwriting the same turn.
create or replace function public.update_online_challenge_state(
  p_challenge_id uuid,
  p_expected_version integer,
  p_game_state jsonb
)
returns setof public.online_challenges
language sql
security invoker
set search_path = public
as $$
  update public.online_challenges
  set game_state = p_game_state,
      version = version + 1
  where id = p_challenge_id
    and version = p_expected_version
    and status = 'active'
    and ((select auth.uid()) = challenger_id or (select auth.uid()) = opponent_id)
  returning *;
$$;

grant execute on function public.update_online_challenge_state(uuid, integer, jsonb) to authenticated;

-- Enable Postgres Changes for live turns and challenge notifications.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'online_challenges'
  ) then
    alter publication supabase_realtime add table public.online_challenges;
  end if;
end $$;
