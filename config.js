// Configuration Supabase — chargée depuis script.js
//
// La clé "publishable" (anciennement nommée "anon") est sûre côté client
// TANT QUE la Row-Level Security est active sur toutes les tables exposées
// (voir supabase/schema.sql). Ne JAMAIS coller ici la clé service_role.
//
// Remplacer les deux valeurs ci-dessous par celles de ton projet Supabase :
// Dashboard > Project Settings > API.

export const SUPABASE_URL = "https://VOTRE-PROJET.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "VOTRE_CLE_PUBLISHABLE_ICI";
