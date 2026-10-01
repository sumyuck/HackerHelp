-- 002: citation metadata, idempotent re-indexing, atomic document replacement.
-- Run in the Supabase SQL editor after schema.sql. Safe to run once on an existing 001 install.

-- Repository-sourced documents have no Storage object; uploads still keep one.
alter table public.documents alter column storage_object_id drop not null;

alter table public.documents
  add column if not exists slug text unique,              -- stable ID, e.g. 'orchestrate/faq'
  add column if not exists title text,
  add column if not exists source_url text,
  add column if not exists origin text not null default 'upload'
    check (origin in ('knowledge_base', 'upload', 'discord_channel', 'ticket_resolution')),
  add column if not exists verification text not null default 'official'
    check (verification in ('official', 'derived', 'community')),
  add column if not exists content_hash text,             -- skip re-embedding unchanged documents
  add column if not exists updated_at timestamptz not null default now();

alter table public.document_sections
  add column if not exists heading text,
  add column if not exists section_index integer not null default 0;

create index if not exists document_sections_document_id_idx on public.document_sections (document_id);

-- The placeholder rules.txt from the initial setup contradicts Orchestrate's solo format.
delete from public.documents where slug is null and name = 'rules.md';

-- Replaces a document and all its sections in one transaction, so a failure part-way through
-- never leaves a document with a new hash but missing or stale sections.
create or replace function public.upsert_document(
  p_slug text,
  p_title text,
  p_source_url text,
  p_origin text,
  p_verification text,
  p_content_hash text,
  p_sections jsonb,
  p_storage_object_id uuid default null
)
returns uuid
language plpgsql
set search_path = public, extensions
as $$
declare
  v_document_id uuid;
begin
  insert into documents (name, slug, title, source_url, origin, verification, content_hash, storage_object_id, updated_at)
  values (p_slug, p_slug, p_title, p_source_url, p_origin, p_verification, p_content_hash, p_storage_object_id, now())
  on conflict (slug) do update
    set title = excluded.title,
        source_url = excluded.source_url,
        origin = excluded.origin,
        verification = excluded.verification,
        content_hash = excluded.content_hash,
        storage_object_id = coalesce(excluded.storage_object_id, documents.storage_object_id),
        updated_at = now()
  returning id into v_document_id;

  delete from document_sections where document_id = v_document_id;

  insert into document_sections (document_id, content, heading, section_index, embedding)
  select v_document_id,
         section->>'content',
         section->>'heading',
         (section->>'section_index')::integer,
         (section->>'embedding')::extensions.vector
  from jsonb_array_elements(p_sections) as section;

  return v_document_id;
end;
$$;

drop function if exists public.match_document_sections(extensions.vector, double precision);

create function public.match_document_sections(
  query_embedding extensions.vector(1536),
  match_threshold double precision,
  match_count integer
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  heading text,
  similarity double precision,
  document_slug text,
  document_title text,
  source_url text,
  origin text,
  verification text
)
language sql stable
set search_path = public, extensions
as $$
  select sections.id, sections.document_id, sections.content, sections.heading,
         1 - (sections.embedding <=> query_embedding) as similarity,
         documents.slug, coalesce(documents.title, documents.name), documents.source_url,
         documents.origin, documents.verification
  from document_sections as sections
  join documents on documents.id = sections.document_id
  where 1 - (sections.embedding <=> query_embedding) > match_threshold
  order by sections.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 20);
$$;

revoke all on function public.match_document_sections(extensions.vector, double precision, integer)
  from public, anon, authenticated;
grant execute on function public.match_document_sections(extensions.vector, double precision, integer)
  to service_role;

revoke all on function public.upsert_document(text, text, text, text, text, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.upsert_document(text, text, text, text, text, text, jsonb, uuid)
  to service_role;
