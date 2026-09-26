-- Paper Sunshine: cross-device sync schema.
-- Run once in your Supabase project: SQL Editor → New query → paste → Run.
-- Safe to run again (it only creates what is missing).

-- One table mirrors every synced record. Row level security keeps each
-- account's rows private.
create table if not exists public.ps_records (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tbl text not null,             -- papers, highlights, ink, gen (translations), model, …
  id text not null,
  paper_id text,
  data jsonb,
  deleted boolean not null default false,
  updated_at bigint not null,    -- client clock (ms): last writer wins
  rev bigint not null default 0, -- server clock (ms): pull cursor, set by trigger
  primary key (user_id, tbl, id)
);
create index if not exists ps_records_user_rev on public.ps_records (user_id, rev);
create index if not exists ps_records_user_paper on public.ps_records (user_id, paper_id);

grant select, insert, update, delete on public.ps_records to authenticated;
alter table public.ps_records enable row level security;
drop policy if exists "ps own rows" on public.ps_records;
create policy "ps own rows" on public.ps_records
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.ps_set_rev() returns trigger
language plpgsql as $$
begin
  new.rev := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  return new;
end $$;

drop trigger if exists ps_records_rev on public.ps_records;
create trigger ps_records_rev before insert or update on public.ps_records
  for each row execute function public.ps_set_rev();

-- Upserts a batch of rows; an older write never overwrites a newer one.
create or replace function public.ps_push(rows jsonb) returns integer
language sql security invoker set search_path = public as $$
  with input as (
    select r->>'tbl' as tbl,
           r->>'id' as id,
           r->>'paper_id' as paper_id,
           r->'data' as data,
           coalesce((r->>'deleted')::boolean, false) as deleted,
           (r->>'updated_at')::bigint as updated_at
    from jsonb_array_elements(rows) as r
  ), up as (
    insert into public.ps_records as t (user_id, tbl, id, paper_id, data, deleted, updated_at)
    select auth.uid(), tbl, id, paper_id, data, deleted, updated_at from input
    on conflict (user_id, tbl, id) do update
      set paper_id = excluded.paper_id,
          data = excluded.data,
          deleted = excluded.deleted,
          updated_at = excluded.updated_at
      where t.updated_at <= excluded.updated_at
    returning 1
  )
  select count(*)::int from up;
$$;
grant execute on function public.ps_push(jsonb) to authenticated;

-- Live updates between open devices (optional; devices also poll).
do $$
begin
  alter publication supabase_realtime add table public.ps_records;
exception when others then null;
end $$;

-- Private bucket for PDFs and parsed layouts: <user id>/<paper id>/paper.pdf
insert into storage.buckets (id, name, public)
values ('ps-files', 'ps-files', false)
on conflict (id) do nothing;

drop policy if exists "ps files read" on storage.objects;
drop policy if exists "ps files insert" on storage.objects;
drop policy if exists "ps files update" on storage.objects;
drop policy if exists "ps files delete" on storage.objects;
create policy "ps files read" on storage.objects for select to authenticated
  using (bucket_id = 'ps-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "ps files insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'ps-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "ps files update" on storage.objects for update to authenticated
  using (bucket_id = 'ps-files' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'ps-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "ps files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'ps-files' and (storage.foldername(name))[1] = auth.uid()::text);
