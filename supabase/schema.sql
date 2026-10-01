-- Run in the SQL editor of a NEW Supabase project.
-- Then run each file in supabase/migrations/ in order.
create extension if not exists vector with schema extensions;

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  storage_object_id uuid not null references storage.objects(id) on delete cascade,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.document_sections (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  content text not null,
  embedding extensions.vector(1536) not null
);

create index document_sections_embedding_idx on public.document_sections
using hnsw (embedding extensions.vector_cosine_ops);

alter table public.documents enable row level security;
alter table public.document_sections enable row level security;

-- Compatible with the RAG service's existing RPC name and argument names.
create function public.match_document_sections(
  embedding extensions.vector(1536),
  match_threshold double precision
)
returns table (id uuid, document_id uuid, content text, similarity double precision)
language sql stable
set search_path = public, extensions
as $$
  select sections.id, sections.document_id, sections.content,
         1 - (sections.embedding <=> $1) as similarity
  from public.document_sections as sections
  where 1 - (sections.embedding <=> $1) > $2
  order by sections.embedding <=> $1
  limit 5;
$$;

revoke all on function public.match_document_sections(extensions.vector, double precision)
from public, anon, authenticated;
grant execute on function public.match_document_sections(extensions.vector, double precision)
to service_role;
grant all on public.documents, public.document_sections to service_role;

insert into storage.buckets (id, name, public)
values ('files', 'files', false)
on conflict (id) do nothing;
