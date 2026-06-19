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

-- =====================================================================
-- 4. Accès admin (tableau de bord)
--
-- Un admin peut LIRE toutes les réponses. La sécurité repose entièrement
-- sur la RLS ci-dessous : ouvrir admin.html sans être admin ne renvoie
-- aucune donnée.
-- =====================================================================

-- 4.1 Table des admins. RLS activée SANS aucune policy => personne ne peut
--     la lire/modifier via l'API publique. On la gère depuis le SQL editor.
create table if not exists public.admins (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

alter table public.admins enable row level security;

-- 4.2 Fonction helper : l'utilisateur courant est-il admin ?
--     SECURITY DEFINER pour pouvoir lire public.admins malgré sa RLS.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.admins where user_id = auth.uid()
  );
$$;

grant execute on function public.is_admin() to authenticated;

-- 4.3 Policy : un admin peut lire toutes les lignes rsvps.
--     (Les policies permissives s'additionnent : un invité normal continue
--      de ne voir que la sienne via rsvps_select_own.)
drop policy if exists "rsvps_select_admin" on public.rsvps;
create policy "rsvps_select_admin"
  on public.rsvps for select
  to authenticated
  using (public.is_admin());

-- 4.4 Fonction qui renvoie toutes les réponses + l'email de chaque invité.
--     SECURITY DEFINER (peut lire auth.users), mais protégée par un filtre
--     `where public.is_admin()` : un non-admin reçoit zéro ligne.
create or replace function public.admin_list_rsvps()
returns table (
  id          uuid,
  email       text,
  full_name   text,
  attending   boolean,
  activities  jsonb,
  companions  jsonb,
  diet        text,
  message     text,
  created_at  timestamptz,
  updated_at  timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    r.id, u.email, r.full_name, r.attending, r.activities,
    r.companions, r.diet, r.message, r.created_at, r.updated_at
  from public.rsvps r
  join auth.users u on u.id = r.user_id
  where public.is_admin()
  order by r.full_name;
$$;

grant execute on function public.admin_list_rsvps() to authenticated;

-- Pour devenir admin (à exécuter une fois, après s'être inscrit sur le site) :
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'TON_EMAIL@exemple.com'
--   on conflict do nothing;
