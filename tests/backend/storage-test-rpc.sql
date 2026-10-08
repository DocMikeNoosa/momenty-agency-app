-- Test-only: SQL entry points the local gateway uses to emulate Supabase Storage.
-- SECURITY INVOKER, so the storage.objects RLS policies from schema.sql decide access.
create or replace function public.test_storage_put(p_bucket text, p_name text, p_ctype text, p_b64 text) returns void
language sql security invoker as $$
  insert into storage.objects (bucket_id, name, content_type, data, owner)
  values (p_bucket, p_name, p_ctype, decode(p_b64, 'base64'), auth.uid())
  on conflict (bucket_id, name) do update set data = excluded.data, content_type = excluded.content_type
$$;
create or replace function public.test_storage_get(p_bucket text, p_name text) returns table (content_type text, b64 text)
language sql stable security invoker as $$
  select content_type, encode(data, 'base64') from storage.objects where bucket_id = p_bucket and name = p_name
$$;
create or replace function public.test_storage_delete(p_bucket text, p_name text) returns void
language sql security invoker as $$
  delete from storage.objects where bucket_id = p_bucket and name = p_name
$$;
grant execute on function public.test_storage_put, public.test_storage_get, public.test_storage_delete to authenticated;
