-- Run this once in the Supabase SQL Editor for the Vocab Lab project.
-- Each signed-in user can only read and update their own saved batches.

create table if not exists public.user_saved_batches (
  user_id uuid primary key references auth.users(id) on delete cascade,
  batches jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint user_saved_batches_valid_data check (
    case when jsonb_typeof(batches) = 'array'
      then jsonb_array_length(batches) <= 10
      else false
    end
  )
);

-- Re-running this file also refreshes the validation constraint.
alter table public.user_saved_batches
  drop constraint if exists user_saved_batches_valid_data;
alter table public.user_saved_batches
  add constraint user_saved_batches_valid_data check (
    case when jsonb_typeof(batches) = 'array'
      then jsonb_array_length(batches) <= 10
      else false
    end
  );

alter table public.user_saved_batches enable row level security;

revoke all on table public.user_saved_batches from anon;
grant select, insert, update on table public.user_saved_batches to authenticated;

drop policy if exists "Users can read their own batches" on public.user_saved_batches;
create policy "Users can read their own batches"
on public.user_saved_batches
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own batches" on public.user_saved_batches;
create policy "Users can create their own batches"
on public.user_saved_batches
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own batches" on public.user_saved_batches;
create policy "Users can update their own batches"
on public.user_saved_batches
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
