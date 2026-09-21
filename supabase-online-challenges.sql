-- Run this file in the Supabase SQL Editor, and re-run it after online challenge updates.
-- Challenge rows are private: only their 2–4 participating accounts can read or change them.

create table if not exists public.online_challenges (
  id uuid primary key default gen_random_uuid(),
  challenger_id uuid not null references auth.users(id) on delete cascade,
  opponent_id uuid not null references auth.users(id) on delete cascade,
  challenger_username text not null,
  opponent_username text not null,
  participant_ids uuid[] not null default '{}'::uuid[],
  participant_usernames jsonb not null default '{}'::jsonb,
  accepted_ids uuid[] not null default '{}'::uuid[],
  game_type text not null check (game_type in ('memory', 'paragraph', 'whack', 'bubble', 'taboo', 'wordbound')),
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

-- Re-running this setup upgrades existing two-player projects without deleting matches.
alter table public.online_challenges
  add column if not exists participant_ids uuid[] default '{}'::uuid[],
  add column if not exists participant_usernames jsonb default '{}'::jsonb,
  add column if not exists accepted_ids uuid[] default '{}'::uuid[];

update public.online_challenges
set participant_ids = array[challenger_id, opponent_id]
where participant_ids is null or cardinality(participant_ids) = 0;

update public.online_challenges
set participant_usernames = jsonb_build_object(
  challenger_id::text, challenger_username,
  opponent_id::text, opponent_username
)
where participant_usernames is null or participant_usernames = '{}'::jsonb;

update public.online_challenges
set accepted_ids = case
  when status = 'pending' then array[challenger_id]
  else array[challenger_id, opponent_id]
end
where accepted_ids is null or cardinality(accepted_ids) = 0;

alter table public.online_challenges
  alter column participant_ids set not null,
  alter column participant_usernames set not null,
  alter column accepted_ids set not null;

alter table public.online_challenges
  drop constraint if exists online_challenges_game_type_check;
alter table public.online_challenges
  add constraint online_challenges_game_type_check
  check (game_type in ('memory', 'paragraph', 'whack', 'bubble', 'taboo', 'wordbound'));

alter table public.online_challenges
  drop constraint if exists online_challenges_participant_count_check;
alter table public.online_challenges
  add constraint online_challenges_participant_count_check check (
    cardinality(participant_ids) between 2 and 4
    and array_position(participant_ids, null) is null
    and participant_ids[1] = challenger_id
    and participant_ids[2] = opponent_id
    and participant_ids[1] <> all(participant_ids[2:4])
    and participant_ids[2] <> all(participant_ids[3:4])
    and (participant_ids[3] is null or participant_ids[3] <> participant_ids[4])
    and accepted_ids <@ participant_ids
    and accepted_ids @> array[challenger_id]
    and array_position(accepted_ids, null) is null
  );

create index if not exists online_challenges_challenger_status_idx
  on public.online_challenges (challenger_id, status, updated_at desc);
create index if not exists online_challenges_opponent_status_idx
  on public.online_challenges (opponent_id, status, updated_at desc);
create index if not exists online_challenges_participants_idx
  on public.online_challenges using gin (participant_ids);

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
    or new.opponent_username <> old.opponent_username
    or new.participant_ids is distinct from old.participant_ids
    or new.participant_usernames is distinct from old.participant_usernames then
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
using ((select auth.uid()) = any(participant_ids));

drop policy if exists "Users can create their own challenges" on public.online_challenges;
create policy "Users can create their own challenges"
on public.online_challenges for insert
to authenticated
with check (
  (select auth.uid()) = challenger_id
  and challenger_id = participant_ids[1]
  and opponent_id = participant_ids[2]
  and cardinality(participant_ids) between 2 and 4
);

drop policy if exists "Participants can update online challenges" on public.online_challenges;
create policy "Participants can update online challenges"
on public.online_challenges for update
to authenticated
using ((select auth.uid()) = any(participant_ids))
with check ((select auth.uid()) = any(participant_ids));

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
    and (select auth.uid()) = any(participant_ids)
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
