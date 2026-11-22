-- Synapic database setup
-- Paste this whole file into Supabase -> SQL Editor -> New query, then press Run.
-- It is safe to run more than once. Everything here is on Supabase's free plan.

-- 1. Saved decks remember the notes they were made from ---------------------
alter table public.decks add column if not exists notes text;

-- 2. Spaced repetition: each flashcard remembers when to show it next ------
alter table public.flashcards
  add column if not exists ease real not null default 2.5,
  add column if not exists interval_days integer not null default 0,
  add column if not exists repetitions integer not null default 0,
  add column if not exists due_at timestamptz not null default now(),
  add column if not exists last_reviewed_at timestamptz;

create index if not exists flashcards_deck_due_idx on public.flashcards (deck_id, due_at);

-- Signed-in users may update cards, but only cards in their own decks...
drop policy if exists "Users can update cards in their own decks" on public.flashcards;
create policy "Users can update cards in their own decks" on public.flashcards
  for update to authenticated
  using (exists (select 1 from public.decks d where d.id = flashcards.deck_id and d.user_id::text = (select auth.uid())::text))
  with check (exists (select 1 from public.decks d where d.id = flashcards.deck_id and d.user_id::text = (select auth.uid())::text));

-- ...and only the review-progress columns (not the question or answer).
revoke update on public.flashcards from anon, authenticated;
grant update (ease, interval_days, repetitions, due_at, last_reviewed_at) on public.flashcards to authenticated;

-- 3. Profile pictures --------------------------------------------------------
-- A public bucket (pictures can be viewed by link) that only accepts small
-- JPEGs. The app shrinks every picture to 256x256 before uploading.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg'])
on conflict (id) do update
  set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg'];

-- Each user can only add, replace or delete the one file in their own folder.
drop policy if exists "Users can view their own avatar file" on storage.objects;
create policy "Users can view their own avatar file" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and name = (select auth.uid())::text || '/avatar.jpg');

drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and name = (select auth.uid())::text || '/avatar.jpg');

drop policy if exists "Users can replace their own avatar" on storage.objects;
create policy "Users can replace their own avatar" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and name = (select auth.uid())::text || '/avatar.jpg')
  with check (bucket_id = 'avatars' and name = (select auth.uid())::text || '/avatar.jpg');

drop policy if exists "Users can delete their own avatar" on storage.objects;
create policy "Users can delete their own avatar" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and name = (select auth.uid())::text || '/avatar.jpg');

-- 4. "Delete my account" -----------------------------------------------------
-- Runs with extra rights so it can remove the login itself, but it only ever
-- deletes the account of whoever is calling it.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  delete from public.flashcards where deck_id in (select id from public.decks where user_id::text = uid::text);
  delete from public.decks where user_id::text = uid::text;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- 5. Safety check ------------------------------------------------------------
-- Both rows below should say rls_enabled = true. If either says false,
-- other people could read those tables: tell Claude before changing anything.
select tablename, rowsecurity as rls_enabled
from pg_tables
where schemaname = 'public' and tablename in ('decks', 'flashcards');
