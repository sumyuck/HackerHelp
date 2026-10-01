-- 003: semantic duplicate detection for support tickets.
-- Ticket records live in MongoDB; this table holds only what similarity search needs.

create table if not exists public.ticket_embeddings (
  ticket_id text primary key,                 -- MongoDB ObjectId of the ticket
  guild_id text not null,
  ticket_number integer not null,
  creator_id text not null,
  status text not null check (status in ('open', 'assigned', 'waiting_user', 'resolved')),
  embedding extensions.vector(1536) not null,
  updated_at timestamptz not null default now()
);

create index if not exists ticket_embeddings_embedding_idx on public.ticket_embeddings
  using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists ticket_embeddings_guild_idx on public.ticket_embeddings (guild_id);

alter table public.ticket_embeddings enable row level security;
grant all on public.ticket_embeddings to service_role;

create or replace function public.match_tickets(
  query_embedding extensions.vector(1536),
  p_guild_id text,
  match_threshold double precision,
  match_count integer
)
returns table (ticket_id text, ticket_number integer, creator_id text, status text, similarity double precision)
language sql stable
set search_path = public, extensions
as $$
  select t.ticket_id, t.ticket_number, t.creator_id, t.status,
         1 - (t.embedding <=> query_embedding) as similarity
  from ticket_embeddings as t
  where t.guild_id = p_guild_id
    and 1 - (t.embedding <=> query_embedding) > match_threshold
  order by t.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 20);
$$;

revoke all on function public.match_tickets(extensions.vector, text, double precision, integer)
  from public, anon, authenticated;
grant execute on function public.match_tickets(extensions.vector, text, double precision, integer)
  to service_role;
