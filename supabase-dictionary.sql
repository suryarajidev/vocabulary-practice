-- Run this once in the Supabase SQL Editor for the Vocab Lab project.
-- Each signed-in user can only read and update their own custom dictionary words.

create table if not exists public.user_dictionary_words (
  user_id uuid primary key references auth.users(id) on delete cascade,
  custom_words jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_dictionary_words enable row level security;

revoke all on table public.user_dictionary_words from anon;
grant select, insert, update on table public.user_dictionary_words to authenticated;

drop policy if exists "Users can read their own custom words" on public.user_dictionary_words;
create policy "Users can read their own custom words"
on public.user_dictionary_words
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own custom words" on public.user_dictionary_words;
create policy "Users can create their own custom words"
on public.user_dictionary_words
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own custom words" on public.user_dictionary_words;
create policy "Users can update their own custom words"
on public.user_dictionary_words
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
