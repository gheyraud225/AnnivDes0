# Mise en route — Supabase

Ce site est statique (GitHub Pages) mais il enregistre les RSVP dans une base
Supabase. La connexion des invités se fait par **email + mot de passe**, avec la
confirmation d'email **désactivée** : aucun email n'est jamais envoyé, donc
aucun SMTP, aucun template, aucun service tiers à configurer. L'email sert
uniquement d'identifiant pour pouvoir revenir modifier sa réponse.

## 1. Créer le projet Supabase

1. Va sur [supabase.com](https://supabase.com), connecte-toi, clique **New project**.
2. Donne un nom (ex. *anniv-corcelles*), choisis un mot de passe DB (tu n'en auras pas besoin pour ce site), prends la région la plus proche (Europe Central / Frankfurt convient).
3. Attends la fin du provisionnement (≈ 1 minute).

## 2. Créer la table et la sécurité

1. Dans le dashboard, va dans **SQL Editor** → **New query**.
2. Copie-colle le contenu de `supabase/schema.sql`, puis clique **Run**.
3. Vérifie sous **Database → Tables** que `rsvps` apparaît, et sous **Authentication → Policies** qu'il y a bien `rsvps_select_own`, `rsvps_insert_own` et `rsvps_update_own`.

## 3. Configurer l'authentification (email + mot de passe, sans email)

> C'est l'étape clé de cette approche : on désactive la confirmation par email
> pour que `signUp` ouvre directement une session, sans qu'aucun mail ne parte.

1. Va dans **Authentication → Sign In / Providers → Email**.
2. Vérifie que le provider **Email** est **activé**.
3. **Désactive « Confirm email »** (le toggle doit être sur OFF).
4. Laisse tout le reste par défaut. Tu n'as **rien** à faire côté SMTP, templates
   ou Resend.

> ℹ️ Avec « Confirm email » sur OFF, un nouvel invité qui clique sur « Créer mon
> accès » est connecté immédiatement. S'il est resté sur ON, le compte est créé
> mais sans session, et le site affichera un message demandant de désactiver
> cette option.

## 4. Renseigner les clés dans le site

1. Dans **Project Settings → API**, copie :
   - **Project URL** (ressemble à `https://xxxxxxxxxxxxxxxx.supabase.co`)
   - **Project API Key** → utilise la clé étiquetée `anon` / `publishable` (PAS `service_role`).
2. Ouvre `config.js` à la racine du repo et remplace les deux placeholders :
   ```js
   export const SUPABASE_URL = "https://xxxxxxxxxxxxxxxx.supabase.co";
   export const SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOi...";
   ```
3. Commit + push : GitHub Pages se redéploie en moins d'une minute.

> La clé publishable est conçue pour être exposée côté client **tant que la RLS
> est active** sur les tables (ce qui est le cas ici grâce au schéma fourni).

## 5. Tester le parcours complet

Sur ton téléphone ou en navigation privée :

1. Ouvre l'URL GitHub Pages.
2. Dans le bloc de connexion, entre un email + un mot de passe, clique **Créer mon accès**.
   - Tu dois être connecté immédiatement (le formulaire RSVP apparaît).
   - Si un message te demande de désactiver « Confirm email », c'est que l'étape 3.3 n'a pas été appliquée.
3. Remplis le formulaire, clique **Envoyer ma réponse** → confettis + toast.
4. La ligne apparaît dans **Database → rsvps**.
5. **Se déconnecter**, puis reviens sur un **autre appareil** → entre le **même email + mot de passe** → **Se connecter** → le formulaire est prérempli avec ta réponse → modifie → **Mettre à jour ma réponse**.
6. Vérifie dans **Database → rsvps** qu'il n'y a **toujours qu'une seule ligne** pour cet email (l'upsert met à jour, il ne duplique pas).

## 5 bis. Tableau de bord admin (`admin.html`)

La page `admin.html` (sur la même URL, ex. `…github.io/AnnivDes0/admin.html`)
affiche qui vient, les accompagnants, et le décompte par activité. Elle est
**réservée aux admins** : la sécurité vient de la RLS, pas du fait que l'URL
soit discrète. Un compte non-admin qui ouvre la page ne voit **aucune** donnée.

Tu as déjà tout côté base si tu as exécuté `supabase/schema.sql` (il crée la
table `admins`, la fonction `is_admin()` et `admin_list_rsvps()`). Il reste à
**te déclarer admin** :

1. Inscris-toi d'abord normalement sur le site (pour exister dans `auth.users`).
2. Dans **SQL Editor**, exécute (avec ton email) :
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'mayorr27@gmail.com'
   on conflict do nothing;
   ```
3. Ouvre `admin.html`, connecte-toi avec ce compte → le tableau de bord s'affiche.

### Gérer les activités

La section **« Gérer les activités »** du dashboard permet d'ajouter, renommer,
changer l'heure ou fixer un nombre max de places. Le statut « complet » est
calculé automatiquement (`taken >= max`) et les invités voient la case grisée
en direct. Si tu changes une heure ou un nom, les inscriptions existantes
suivent : les activités sont référencées par un identifiant interne, pas par
leur libellé. Supprimer une activité ayant des inscriptions est possible (avec
confirmation) — ces lignes restent en base mais n'apparaissent plus côté front.

> Pour ajouter un autre organisateur : il s'inscrit sur le site, puis tu relances
> la requête ci-dessus avec son email. Pour retirer un admin :
> `delete from public.admins where user_id = (select id from auth.users where email = '…');`

## 6. Empêcher la mise en pause du projet (gratuit)

Les projets Supabase gratuits sont mis en pause après **7 jours d'inactivité**.
Le fichier `.github/workflows/keepalive.yml` envoie une petite requête tous les
3 jours pour garder le projet actif. Pour l'activer :

1. Vérifie que GitHub Actions est activé sur ton repo (**Settings → Actions → General → Allow all actions**).
2. Va dans **Settings → Secrets and variables → Actions → New repository secret** et crée :
   - `SUPABASE_URL` : la même valeur que dans `config.js`
   - `SUPABASE_PUBLISHABLE_KEY` : pareil

Le workflow est déjà inclus, il tournera automatiquement à 09h00 UTC tous les 3 jours.

## 7. Lire/exporter les réponses

- **Dashboard → Table Editor → rsvps** : vue web filtrable.
- **Dashboard → Database → Tables → rsvps → Export to CSV** : export rapide.
- Pour un export propre formaté, copie cette requête dans SQL Editor :
  ```sql
  select full_name, attending, activities, companions, diet, message, created_at, updated_at
  from public.rsvps
  order by created_at desc;
  ```
  puis clique sur **Download CSV** en bas du résultat.

> Astuce : les emails des invités ne sont **pas** dans la table `rsvps` (seul
> l'`user_id` y figure). Pour relier une réponse à un email, regarde
> **Authentication → Users**, ou fais une jointure en SQL :
> ```sql
> select u.email, r.full_name, r.attending, r.activities, r.companions
> from public.rsvps r
> join auth.users u on u.id = r.user_id
> order by r.created_at desc;
> ```
