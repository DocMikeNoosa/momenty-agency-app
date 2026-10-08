-- Momenty Agency – Supabase schema.
-- Run once in Supabase → SQL Editor. Safe to re-run (idempotent where possible).
--
-- Security model
--  * One agency ("workspace") per Supabase project. Only the first person can create it (becomes admin).
--  * Nobody can read anything unless they are a member. Membership is only granted by redeeming
--    a single-use invite code created by an admin (codes are stored hashed and expire after 7 days).
--  * All agency data lives in `records`; clients can read it only through RLS and write it only
--    through push_records(), which always writes into the caller's own workspace.
--  * OAuth tokens (Google, Canva) are never readable by clients – only by the Edge Functions.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables
create table if not exists public.workspace (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  singleton boolean not null default true unique check (singleton),
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspace(id) on delete cascade,
  role text not null check (role in ('admin', 'member')),
  slot text not null,
  display_name text not null,
  email text,
  created_at timestamptz not null default now(),
  unique (workspace_id, slot)
);

create table if not exists public.invites (
  code_hash text primary key,
  workspace_id uuid not null references public.workspace(id) on delete cascade,
  role text not null check (role in ('admin', 'member')),
  slot text not null,
  display_name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz
);

create sequence if not exists public.records_seq;

create table if not exists public.records (
  id uuid primary key,
  workspace_id uuid not null references public.workspace(id) on delete cascade,
  col text not null,
  data jsonb not null,
  updated_at timestamptz not null,
  deleted boolean not null default false,
  seq bigint not null default nextval('public.records_seq'),
  updated_by uuid references auth.users(id) on delete set null
);
create index if not exists records_ws_seq on public.records (workspace_id, seq);

-- server-only tables (no client policies)
create table if not exists public.oauth_tokens (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'canva')),
  refresh_token text,
  access_token text,
  expires_at timestamptz,
  account text,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

create table if not exists public.oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  code_verifier text,
  created_at timestamptz not null default now()
);

create table if not exists public.calendar_links (
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null,
  event_id text not null,
  calendar_id text not null,
  hash text,
  primary key (user_id, task_id)
);

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  calls int not null default 0,
  primary key (user_id, day)
);

-- ---------------------------------------------------------------- helpers
create or replace function public.my_workspace() returns uuid
language sql stable security definer set search_path = public as $$
  select workspace_id from public.members where user_id = auth.uid()
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid() and role = 'admin')
$$;

-- bump seq on every write so devices can pull "everything after N"
create or replace function public.records_bump_seq() returns trigger
language plpgsql as $$
begin
  new.seq := nextval('public.records_seq');
  return new;
end $$;
drop trigger if exists records_bump_seq on public.records;
create trigger records_bump_seq before insert or update on public.records
  for each row execute function public.records_bump_seq();

-- ---------------------------------------------------------------- RLS
alter table public.workspace enable row level security;
alter table public.members enable row level security;
alter table public.invites enable row level security;
alter table public.records enable row level security;
alter table public.oauth_tokens enable row level security;
alter table public.oauth_states enable row level security;
alter table public.calendar_links enable row level security;
alter table public.ai_usage enable row level security;

drop policy if exists workspace_read on public.workspace;
create policy workspace_read on public.workspace for select to authenticated using (id = public.my_workspace());

drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated using (workspace_id = public.my_workspace());

drop policy if exists records_read on public.records;
create policy records_read on public.records for select to authenticated using (workspace_id = public.my_workspace());

-- no insert/update/delete policies: writes only go through the security-definer functions below.
revoke all on public.invites, public.oauth_tokens, public.oauth_states, public.calendar_links, public.ai_usage from anon, authenticated;
revoke insert, update, delete on public.workspace, public.members, public.records from anon, authenticated;
revoke all on public.workspace, public.members, public.records from anon;

-- ---------------------------------------------------------------- RPCs
create or replace function public.agency_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare ws uuid := public.my_workspace();
begin
  return jsonb_build_object(
    'exists', exists (select 1 from public.workspace),
    'member', ws is not null,
    'workspace_id', ws,
    'name', (select name from public.workspace where id = ws),
    'role', (select role from public.members where user_id = auth.uid()),
    'slot', (select slot from public.members where user_id = auth.uid())
  );
end $$;

create or replace function public.create_workspace(p_name text, p_slot text, p_display_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  perform pg_advisory_xact_lock(4242);
  if exists (select 1 from public.workspace) then
    raise exception 'agency already exists – ask an admin for an invite';
  end if;
  insert into public.workspace (name) values (coalesce(nullif(trim(p_name), ''), 'Momenty Agency')) returning id into ws;
  insert into public.members (user_id, workspace_id, role, slot, display_name, email)
    values (auth.uid(), ws, 'admin', coalesce(nullif(p_slot, ''), 'p1'), p_display_name,
            (select email from auth.users where id = auth.uid()));
  return ws;
end $$;

create or replace function public.create_invite(p_display_name text, p_role text default 'member', p_slot text default null) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  ws uuid := public.my_workspace();
  code text;
  v_slot text := p_slot;
  n int := 1;
begin
  if not public.is_admin() then raise exception 'only an admin can invite'; end if;
  if p_role not in ('admin', 'member') then raise exception 'bad role'; end if;
  if v_slot is null or v_slot = '' then
    loop
      v_slot := 'p' || n;
      exit when not exists (select 1 from public.members m where m.workspace_id = ws and m.slot = v_slot)
            and not exists (select 1 from public.invites i where i.workspace_id = ws and i.slot = v_slot and i.used_at is null and i.expires_at > now());
      n := n + 1;
    end loop;
  elsif exists (select 1 from public.members m where m.workspace_id = ws and m.slot = v_slot) then
    raise exception 'slot already taken';
  end if;
  code := encode(gen_random_bytes(18), 'hex');
  insert into public.invites (code_hash, workspace_id, role, slot, display_name, created_by)
    values (encode(digest(code, 'sha256'), 'hex'), ws, p_role, v_slot, p_display_name, auth.uid());
  return code;
end $$;

create or replace function public.redeem_invite(p_code text, p_display_name text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare inv public.invites;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then
    raise exception 'already a member';
  end if;
  select * into inv from public.invites
    where code_hash = encode(digest(coalesce(p_code, ''), 'sha256'), 'hex') for update;
  if inv.code_hash is null or inv.used_at is not null or inv.expires_at < now() then
    raise exception 'invite is invalid, used or expired';
  end if;
  insert into public.members (user_id, workspace_id, role, slot, display_name, email)
    values (auth.uid(), inv.workspace_id, inv.role, inv.slot,
            coalesce(nullif(trim(p_display_name), ''), inv.display_name),
            (select email from auth.users where id = auth.uid()));
  update public.invites set used_by = auth.uid(), used_at = now() where code_hash = inv.code_hash;
  return jsonb_build_object('workspace_id', inv.workspace_id, 'role', inv.role, 'slot', inv.slot);
end $$;

create or replace function public.list_invites() returns table (slot text, display_name text, role text, created_at timestamptz, expires_at timestamptz, used boolean)
language sql stable security definer set search_path = public as $$
  select slot, display_name, role, created_at, expires_at, used_at is not null
  from public.invites where workspace_id = public.my_workspace() and public.is_admin()
  order by created_at desc limit 50
$$;

create or replace function public.remove_member(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'only an admin can remove people'; end if;
  if p_user = auth.uid() then raise exception 'you cannot remove yourself'; end if;
  delete from public.members where user_id = p_user and workspace_id = public.my_workspace();
end $$;

create or replace function public.update_my_name(p_name text) returns void
language sql security definer set search_path = public as $$
  update public.members set display_name = p_name where user_id = auth.uid() and coalesce(trim(p_name), '') <> ''
$$;

-- Upsert a batch of records. Last write wins by the client's updated_at.
create or replace function public.push_records(p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  ws uuid := public.my_workspace();
  r jsonb;
  n int := 0;
begin
  if ws is null then raise exception 'not a member of the agency'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then raise exception 'bad batch'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.records as t (id, workspace_id, col, data, updated_at, deleted, updated_by)
    values ((r->>'id')::uuid, ws, r->>'col', r->'data', (r->>'updated_at')::timestamptz,
            coalesce((r->>'deleted')::boolean, false), auth.uid())
    on conflict (id) do update
      set data = excluded.data, col = excluded.col, updated_at = excluded.updated_at,
          deleted = excluded.deleted, updated_by = excluded.updated_by
      where t.workspace_id = ws and t.updated_at <= excluded.updated_at;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Connection status for integrations (never returns tokens).
create or replace function public.my_connections() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(provider, jsonb_build_object('account', account, 'settings', settings, 'since', updated_at)), '{}'::jsonb)
  from public.oauth_tokens where user_id = auth.uid() and refresh_token is not null
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.agency_status, public.create_workspace, public.create_invite, public.redeem_invite,
  public.list_invites, public.remove_member, public.update_my_name, public.push_records, public.my_connections,
  public.my_workspace, public.is_admin to authenticated;

-- ---------------------------------------------------------------- file storage
-- Private bucket; files live under <workspace_id>/<file>.
insert into storage.buckets (id, name, public) values ('files', 'files', false) on conflict (id) do nothing;

drop policy if exists momenty_files_read on storage.objects;
create policy momenty_files_read on storage.objects for select to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = public.my_workspace()::text);
drop policy if exists momenty_files_insert on storage.objects;
create policy momenty_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and (storage.foldername(name))[1] = public.my_workspace()::text);
drop policy if exists momenty_files_update on storage.objects;
create policy momenty_files_update on storage.objects for update to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = public.my_workspace()::text);
drop policy if exists momenty_files_delete on storage.objects;
create policy momenty_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = public.my_workspace()::text);
