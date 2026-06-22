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

-- =====================================================================
-- 5. Activités gérables depuis le dashboard admin
--
-- Les rsvps stockent des UUID d'activités plutôt que des labels texte, ce
-- qui permet à l'admin de renommer/retimer une activité sans casser les
-- inscriptions existantes. Une migration idempotente plus bas convertit
-- les anciens labels en uuids une fois pour toutes.
-- =====================================================================

create table if not exists public.activities (
  id               uuid primary key default gen_random_uuid(),
  label            text not null,
  time_label       text not null default '',
  time_sort        int  not null default 9999,
  description      text,
  max_participants int,
  position         int  not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.activities enable row level security;

drop policy if exists "activities_select_all" on public.activities;
create policy "activities_select_all"
  on public.activities for select to authenticated using (true);

drop policy if exists "activities_admin_write" on public.activities;
create policy "activities_admin_write"
  on public.activities for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop trigger if exists set_activities_updated_at on public.activities;
create trigger set_activities_updated_at
  before update on public.activities
  for each row execute function public.set_updated_at();

-- 5.1 Seed initial (si la table est vide). Reproduit les 5 activités
--     actuelles avec leurs anciennes formes pour que la migration ci-dessous
--     les retrouve à partir des chaînes "Label (HhMM)".
insert into public.activities (label, time_label, time_sort, description, max_participants, position)
select * from (values
  ('Pilates',       '9h00',  9*60,  'Séance douce pour réveiller les corps — tous niveaux, tapis fournis.', null::int, 1),
  ('Poterie',       '11h00', 11*60, 'Mettez les mains dans la terre et repartez avec votre création — débutants bienvenus.', null::int, 2),
  ('Repas du midi', '12h30', 12*60+30, 'Pause déjeuner conviviale entre les deux ateliers.', null::int, 3),
  ('Poterie',       '14h00', 14*60, 'Deuxième session pour ceux qui ont raté la première — ou qui en redemandent.', 0::int, 4),
  ('Repas du soir', '19h30', 19*60+30, 'Grande tablée pour célébrer les six héros de la journée.', null::int, 5)
) as v(label, time_label, time_sort, description, max_participants, position)
where not exists (select 1 from public.activities);

-- 5.2 Migration des rsvps : remplace les anciens labels texte
--     ("Pilates (9h00)", etc.) par les UUID correspondants. Idempotente :
--     un élément déjà au format UUID est conservé tel quel.
do $$
declare
  rec       record;
  v_acts    jsonb;
  v_comps   jsonb;
  v_val     text;
  v_comp    jsonb;
  v_cacts   jsonb;
  v_cval    text;
  v_id      uuid;
  v_changed boolean;
begin
  for rec in select id, activities, companions from public.rsvps loop
    v_changed := false;

    -- activités du répondant principal
    v_acts := '[]'::jsonb;
    if jsonb_typeof(rec.activities) = 'array' then
      for v_val in select jsonb_array_elements_text(rec.activities) loop
        if v_val ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          v_acts := v_acts || to_jsonb(v_val);
        else
          v_changed := true;
          select id into v_id from public.activities
            where label || ' (' || time_label || ')' = v_val
            limit 1;
          if v_id is not null then
            v_acts := v_acts || to_jsonb(v_id::text);
          end if;
        end if;
      end loop;
    end if;

    -- accompagnants
    v_comps := '[]'::jsonb;
    if jsonb_typeof(rec.companions) = 'array' then
      for v_comp in select jsonb_array_elements(rec.companions) loop
        v_cacts := '[]'::jsonb;
        if jsonb_typeof(v_comp->'activities') = 'array' then
          for v_cval in select jsonb_array_elements_text(v_comp->'activities') loop
            if v_cval ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
              v_cacts := v_cacts || to_jsonb(v_cval);
            else
              v_changed := true;
              select id into v_id from public.activities
                where label || ' (' || time_label || ')' = v_cval
                limit 1;
              if v_id is not null then
                v_cacts := v_cacts || to_jsonb(v_id::text);
              end if;
            end if;
          end loop;
        end if;
        v_comps := v_comps || jsonb_build_array(jsonb_set(v_comp, '{activities}', v_cacts));
      end loop;
    end if;

    if v_changed then
      update public.rsvps
      set activities = v_acts, companions = v_comps
      where id = rec.id;
    end if;
  end loop;
end $$;

-- 5.3 Lecture des activités + compte d'inscriptions en cours
--     (répondant principal + accompagnants). Disponible à tous les invités
--     authentifiés pour pouvoir griser une activité pleine côté front.
create or replace function public.list_activities_with_counts()
returns table (
  id uuid, label text, time_label text, time_sort int, description text,
  max_participants int, position int, taken int
)
language sql security definer set search_path = public stable as $$
  with main_signups as (
    select jsonb_array_elements_text(r.activities) as activity_id
    from public.rsvps r
    where r.attending = true and jsonb_typeof(r.activities) = 'array'
  ),
  comp_signups as (
    select jsonb_array_elements_text(c.value->'activities') as activity_id
    from public.rsvps r
    cross join lateral jsonb_array_elements(coalesce(r.companions, '[]'::jsonb)) c
    where r.attending = true
      and jsonb_typeof(c.value->'activities') = 'array'
  ),
  all_signups as (
    select activity_id from main_signups
    union all
    select activity_id from comp_signups
  ),
  counts as (
    select activity_id, count(*)::int as taken
    from all_signups
    where activity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    group by activity_id
  )
  select
    a.id, a.label, a.time_label, a.time_sort, a.description,
    a.max_participants, a.position,
    coalesce(c.taken, 0) as taken
  from public.activities a
  left join counts c on c.activity_id = a.id::text
  order by a.time_sort, a.position, a.label;
$$;

grant execute on function public.list_activities_with_counts() to authenticated, anon;

-- Pour devenir admin (à exécuter une fois, après s'être inscrit sur le site) :
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'TON_EMAIL@exemple.com'
--   on conflict do nothing;
