-- =====================================================================
-- Schéma RSVP — Anniversaires conjoints, 29 août 2026
--
-- À exécuter dans le SQL editor d'un projet Supabase neuf.
-- Idempotent : on peut le rejouer sans rien casser.
-- =====================================================================

-- 1. Table principale ----------------------------------------------------
create table if not exists public.rsvps (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique
              references auth.users(id) on delete cascade
              default auth.uid(),
  full_name   text not null,
  attending   boolean not null,
  activities  jsonb not null default '[]'::jsonb,
  companions  jsonb not null default '[]'::jsonb,
  diet        text,
  message     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.rsvps is
  'Une ligne par invité authentifié. user_id = auth.uid().';
comment on column public.rsvps.activities is
  'Liste des activités du répondant principal — array de strings.';
comment on column public.rsvps.companions is
  'Liste d''accompagnants — array d''objets {name, activities:[…]}.';

-- 2. Row-Level Security --------------------------------------------------
alter table public.rsvps enable row level security;

drop policy if exists "rsvps_select_own" on public.rsvps;
create policy "rsvps_select_own"
  on public.rsvps for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "rsvps_insert_own" on public.rsvps;
create policy "rsvps_insert_own"
  on public.rsvps for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "rsvps_update_own" on public.rsvps;
create policy "rsvps_update_own"
  on public.rsvps for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Pas de policy DELETE : on ne laisse personne effacer sa réponse via l'API.
-- L'organisateur peut supprimer manuellement depuis le dashboard.

-- 3. Trigger updated_at --------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_rsvps_updated_at on public.rsvps;
create trigger set_rsvps_updated_at
  before update on public.rsvps
  for each row
  execute function public.set_updated_at();
