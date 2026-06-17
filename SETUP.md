# Mise en route — Supabase

Ce site est statique (GitHub Pages) mais il enregistre les RSVP dans une base
Supabase. La connexion des invités se fait par un code à 6 chiffres envoyé par
email. Suis les étapes ci-dessous une seule fois.

## 1. Créer le projet Supabase

1. Va sur [supabase.com](https://supabase.com), connecte-toi, clique **New project**.
2. Donne un nom (ex. *anniv-corcelles*), choisis un mot de passe DB (tu n'en auras pas besoin pour ce site), prends la région la plus proche (Europe Central / Frankfurt convient).
3. Attends la fin du provisionnement (≈ 1 minute).

## 2. Créer la table et la sécurité

1. Dans le dashboard, va dans **SQL Editor** → **New query**.
2. Copie-colle le contenu de `supabase/schema.sql`, puis clique **Run**.
3. Vérifie sous **Database → Tables** que `rsvps` apparaît, et sous **Authentication → Policies** qu'il y a bien `rsvps_select_own`, `rsvps_insert_own` et `rsvps_update_own`.

## 3. Configurer l'auth par OTP (code à 6 chiffres)

Par défaut, Supabase envoie un **lien magique** au lieu d'un code. On veut un code.

1. Dans le dashboard, va dans **Authentication → Providers → Email** : vérifie qu'**Email** est activé. Désactive *Confirm email* si tu veux que les nouveaux invités n'aient pas à cliquer sur un lien d'activation.
2. Va dans **Authentication → Email Templates → Magic Link**.
3. Dans le corps du mail, **remplace `{{ .ConfirmationURL }}` par `{{ .Token }}`**. Exemple de template suggéré :

   ```
   Bonjour,

   Voici votre code de connexion pour l'invitation du 29 août :

   {{ .Token }}

   Ce code est valable 1 heure. Si vous n'êtes pas à l'origine de cette
   demande, vous pouvez ignorer ce message.
   ```

   > ⚠️ Tant que le template contient `{{ .ConfirmationURL }}`, Supabase envoie un lien magique — l'OTP ne marchera pas.

4. Va dans **Authentication → URL Configuration** :
   - **Site URL** : mets ton URL GitHub Pages, par exemple `https://gheyraud225.github.io/AnnivDes0/`.
   - **Redirect URLs** : ajoute aussi la même URL (ça ne sert pas pour l'OTP, mais évite les warnings).

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
2. Remplis le formulaire avec ton vrai email, clique **Envoyer ma réponse**.
3. Tu devrais recevoir un mail avec un code à 6 chiffres → entre-le dans la fenêtre.
4. Confettis + toast → la ligne apparaît dans **Database → rsvps**.
5. Reviens plus tard sur un autre appareil → clique **Modifier une réponse déjà envoyée** → entre le même email → code → le formulaire est prérempli avec ta réponse précédente.

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
