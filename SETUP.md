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

Par défaut, Supabase envoie un **lien magique** au lieu d'un code, et son service
email gratuit n'envoie qu'à ton organisation. Il faut donc un SMTP custom, puis
ajuster le template. C'est l'étape la plus importante.

### 3.a — Brancher un SMTP custom (OBLIGATOIRE)

> ⚠️ Depuis septembre 2024, le service email **par défaut** de Supabase :
> - **n'envoie qu'aux adresses membres de ton organisation Supabase** (tes
>   invités ne recevraient donc jamais le mail), et
> - **interdit d'éditer les templates** (donc impossible d'afficher un code
>   à 6 chiffres `{{ .Token }}`).
>
> Il faut donc impérativement configurer ton propre SMTP. Le plus simple
> quand on a un Gmail et un faible volume (quelques dizaines d'invités) :
> utiliser le SMTP de Gmail. Alternatives sans domaine : Brevo (300/j gratuit,
> vérif d'un simple expéditeur) ou SendGrid (100/j, single sender). Avec un
> domaine à toi : Resend.

**Option Gmail (recommandée ici) :**

1. Sur ton compte Google : **Compte Google → Sécurité → Validation en 2 étapes**
   doit être **activée** (obligatoire pour générer un mot de passe d'application).
2. Toujours dans Sécurité, ouvre **Mots de passe des applications**, crée-en un
   (nom libre, ex. « Supabase ») et copie le mot de passe à 16 caractères.
3. Dans Supabase : **Authentication → Emails → SMTP Settings** (ou le bouton
   **Set up SMTP**), active *Enable Custom SMTP* et renseigne :
   - **Sender email** : ton adresse Gmail (ex. `mayorr27@gmail.com`)
   - **Sender name** : ex. `Anniversaires Corcelles`
   - **Host** : `smtp.gmail.com`
   - **Port** : `465`
   - **Username** : ton adresse Gmail complète
   - **Password** : le mot de passe d'application à 16 caractères (PAS ton mot de passe Gmail habituel)
4. Enregistre. L'édition des templates est maintenant débloquée.

### 3.b — Mettre le code à 6 chiffres dans le template

1. Va dans **Authentication → Emails → Templates → « Magic link or OTP »**.
2. Onglet **Source** du corps, **remplace tout le contenu** (qui contient
   actuellement un lien `{{ .ConfirmationURL }}`) par un code `{{ .Token }}`.
   Exemple :

   ```html
   <h2>Votre code de connexion</h2>
   <p>Voici votre code pour confirmer votre réponse à l'invitation du 29 août :</p>
   <p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
   <p>Ce code est valable 1 heure. Si vous n'êtes pas à l'origine de cette
   demande, vous pouvez ignorer ce message.</p>
   ```

   Tu peux aussi adapter le **Subject**, ex. `Votre code pour l'invitation`.

   > ⚠️ Tant que le template contient `{{ .ConfirmationURL }}`, Supabase envoie
   > un lien magique au lieu d'un code, et le site ne pourra pas valider l'OTP.

3. **Authentication → Sign In / Providers → Email** : vérifie qu'**Email** est
   activé et **désactive « Confirm email »**. Ainsi, un nouvel invité reçoit
   directement le code (sinon Supabase envoie d'abord un mail « Confirm signup »
   séparé pour les premières réponses).

4. **Authentication → URL Configuration** :
   - **Site URL** : ton URL GitHub Pages, ex. `https://gheyraud225.github.io/AnnivDes0/`.
   - **Redirect URLs** : ajoute la même URL (ça ne sert pas pour l'OTP, mais évite les warnings).

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
2. Remplis le formulaire avec un email **différent** de ton compte Supabase
   (pour vérifier que le SMTP envoie bien à n'importe qui), clique **Envoyer ma réponse**.
3. Tu devrais recevoir un mail avec un code à 6 chiffres → entre-le dans la fenêtre.
   - Si tu reçois un **lien** au lieu d'un code → le template contient encore
     `{{ .ConfirmationURL }}` (revois l'étape 3.b).
   - Si tu ne reçois **rien** → le SMTP n'est pas (bien) configuré, regarde
     **Authentication → Emails → Logs** dans Supabase, et tes spams.
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
