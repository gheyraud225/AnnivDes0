// Tableau de bord admin.
//
// Sécurité : tout passe par la RLS Supabase. Cette page appelle la fonction
// RPC admin_list_rsvps() qui ne renvoie de données qu'aux comptes présents
// dans public.admins. Ouvrir la page sans être admin n'expose rien.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

const IS_CONFIGURED =
  !!SUPABASE_URL &&
  !!SUPABASE_PUBLISHABLE_KEY &&
  !/VOTRE-PROJET/i.test(SUPABASE_URL) &&
  !/VOTRE_CLE/i.test(SUPABASE_PUBLISHABLE_KEY);

const $ = (id) => document.getElementById(id);

const escapeHtml = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

const setStatus = (el, kind, text) => {
  el.className = kind ? "form-status " + kind : "form-status";
  el.textContent = text || "";
};

// ---------- vues ------------------------------------------------------

const viewAuth = $("view-auth");
const viewDenied = $("view-denied");
const viewDash = $("view-dash");

const showOnly = (el) => {
  [viewAuth, viewDenied, viewDash].forEach((v) => { v.hidden = v !== el; });
};

// ---------- auth ------------------------------------------------------

const authForm = $("admin-auth-form");
const emailInput = $("admin-email");
const passwordInput = $("admin-password");
const authStatus = $("admin-auth-status");
const signinBtn = $("admin-signin");

const explainError = (error) => {
  if (!error) return "Une erreur inattendue est survenue.";
  const msg = (error.message || "").toLowerCase();
  if (msg.includes("invalid login")) return "Email ou mot de passe incorrect.";
  if (msg.includes("rate") || msg.includes("too many")) return "Trop de tentatives. Patientez un instant.";
  if (msg.includes("network") || msg.includes("fetch")) return "Problème de connexion. Vérifiez votre internet.";
  return error.message || "Erreur inconnue.";
};

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!IS_CONFIGURED) {
    setStatus(authStatus, "error", "config.js n'est pas renseigné (SUPABASE_URL / clé).");
    return;
  }
  const email = emailInput.value.trim().toLowerCase();
  const password = passwordInput.value;
  signinBtn.disabled = true;
  setStatus(authStatus, "", "Connexion en cours…");
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    setStatus(authStatus, "", "");
    authForm.reset();
    await routeAfterAuth();
  } catch (err) {
    console.error(err);
    setStatus(authStatus, "error", explainError(err));
  } finally {
    signinBtn.disabled = false;
  }
});

const signOut = async () => {
  await supabase.auth.signOut();
  showOnly(viewAuth);
  setTimeout(() => emailInput.focus(), 60);
};

$("signout").addEventListener("click", signOut);
$("denied-signout").addEventListener("click", signOut);
$("refresh").addEventListener("click", () => loadDashboard());

// ---------- helpers data ---------------------------------------------

const asActivities = (v) => (Array.isArray(v) ? v.filter((a) => typeof a === "string") : []);
const asCompanions = (v) =>
  Array.isArray(v)
    ? v.filter((c) => c && typeof c.name === "string").map((c) => ({
        name: c.name,
        activities: asActivities(c.activities),
      }))
    : [];

// Trie les activités par l'heure entre parenthèses si présente, sinon alpha.
const activityTime = (label) => {
  const m = /\((\d{1,2})h(\d{2})\)/.exec(label);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 9999;
};
const sortActivities = (arr) =>
  arr.slice().sort((a, b) => activityTime(a) - activityTime(b) || a.localeCompare(b));

const partySize = (row) => 1 + asCompanions(row.companions).length;

// ---------- rendu -----------------------------------------------------

const renderStats = (present, absent, headcount, activityTotal) => {
  const cards = [
    [headcount, headcount > 1 ? "personnes attendues" : "personne attendue"],
    [present.length, present.length > 1 ? "réponses « oui »" : "réponse « oui »"],
    [absent.length, "ne viennent pas"],
    [activityTotal, "inscriptions activités"],
  ];
  $("stats").innerHTML = cards
    .map(([n, label]) =>
      '<div class="stat-card"><div class="stat-num">' + n +
      '</div><div class="stat-label">' + escapeHtml(label) + "</div></div>")
    .join("");
};

const renderActivityCounts = (tally) => {
  const host = $("activity-counts");
  const entries = sortActivities(Array.from(tally.keys())).map((k) => [k, tally.get(k)]);
  if (!entries.length) {
    host.innerHTML = '<p class="empty-note">Aucune inscription à une activité pour l\'instant.</p>';
    return;
  }
  const max = Math.max(...entries.map(([, n]) => n));
  host.innerHTML = entries
    .map(([name, n]) => {
      const pct = max ? Math.round((n / max) * 100) : 0;
      return (
        '<div class="act-row">' +
        '<span class="act-name">' + escapeHtml(name) + "</span>" +
        '<span class="act-count">' + n + "</span>" +
        '<span class="act-bar"><span style="width:' + pct + '%"></span></span>' +
        "</div>"
      );
    })
    .join("");
};

const chips = (acts) => {
  if (!acts.length) return '<span class="chip chip--none">aucune activité</span>';
  return acts.map((a) => '<span class="chip">' + escapeHtml(a) + "</span>").join("");
};

const renderPresent = (present) => {
  const host = $("present-list");
  if (!present.length) {
    host.innerHTML = '<p class="empty-note">Personne n\'a encore confirmé.</p>';
    return;
  }
  host.innerHTML = present
    .map((row) => {
      const comps = asCompanions(row.companions);
      const acts = sortActivities(asActivities(row.activities));
      const size = 1 + comps.length;
      let html =
        '<div class="party"><div class="party-head">' +
        '<span class="party-name">' + escapeHtml(row.full_name || "—") + "</span>";
      if (row.email) html += '<span class="party-email">' + escapeHtml(row.email) + "</span>";
      html += '<span class="badge badge--total">' + size + " pers.</span></div>";
      html += '<div class="chips">' + chips(acts) + "</div>";
      if (comps.length) {
        html += '<div class="sub">';
        comps.forEach((c) => {
          html +=
            '<div class="sub-person"><div class="sub-name">' + escapeHtml(c.name) + "</div>" +
            '<div class="chips">' + chips(sortActivities(c.activities)) + "</div></div>";
        });
        html += "</div>";
      }
      if (row.diet) html += '<div class="party-extra"><strong>Régime :</strong> ' + escapeHtml(row.diet) + "</div>";
      if (row.message) html += '<div class="party-extra"><strong>Message :</strong> ' + escapeHtml(row.message) + "</div>";
      html += "</div>";
      return html;
    })
    .join("");
};

const renderAbsent = (absent) => {
  const host = $("absent-list");
  if (!absent.length) {
    host.innerHTML = '<p class="empty-note">Aucun refus pour l\'instant.</p>';
    return;
  }
  host.innerHTML = absent
    .map((row) => {
      let html =
        '<div class="party"><div class="party-head">' +
        '<span class="party-name">' + escapeHtml(row.full_name || "—") + "</span>";
      if (row.email) html += '<span class="party-email">' + escapeHtml(row.email) + "</span>";
      html += "</div>";
      if (row.message) html += '<div class="party-extra"><strong>Message :</strong> ' + escapeHtml(row.message) + "</div>";
      html += "</div>";
      return html;
    })
    .join("");
};

// ---------- chargement ------------------------------------------------

const loadDashboard = async () => {
  setStatus($("dash-status"), "", "Chargement…");
  const { data, error } = await supabase.rpc("admin_list_rsvps");
  if (error) {
    console.error(error);
    setStatus($("dash-status"), "error", "Erreur de chargement : " + explainError(error));
    return;
  }
  const rows = Array.isArray(data) ? data : [];
  const present = rows.filter((r) => r.attending);
  const absent = rows.filter((r) => !r.attending);

  let headcount = 0;
  present.forEach((r) => { headcount += partySize(r); });

  // Décompte par activité (répondant principal + accompagnants).
  const tally = new Map();
  const add = (acts) => asActivities(acts).forEach((a) => tally.set(a, (tally.get(a) || 0) + 1));
  present.forEach((r) => {
    add(r.activities);
    asCompanions(r.companions).forEach((c) => add(c.activities));
  });
  let activityTotal = 0;
  tally.forEach((n) => { activityTotal += n; });

  renderStats(present, absent, headcount, activityTotal);
  renderActivityCounts(tally);
  renderPresent(present);
  renderAbsent(absent);
  $("present-title").textContent = "Présents (" + present.length + ")";
  $("absent-title").textContent = "Ne viennent pas (" + absent.length + ")";
  setStatus($("dash-status"), "", "");
};

// ---------- routage ---------------------------------------------------

const routeAfterAuth = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    showOnly(viewAuth);
    setTimeout(() => emailInput.focus(), 60);
    return;
  }
  // Admin ?
  const { data: isAdmin, error } = await supabase.rpc("is_admin");
  if (error) {
    console.error(error);
    showOnly(viewDenied);
    return;
  }
  if (!isAdmin) {
    showOnly(viewDenied);
    return;
  }
  $("admin-id").textContent = session.user.email || "";
  showOnly(viewDash);
  await loadDashboard();
};

const init = async () => {
  if (!IS_CONFIGURED) {
    showOnly(viewAuth);
    setStatus(authStatus, "error", "config.js n'est pas renseigné (SUPABASE_URL / clé).");
    return;
  }
  await routeAfterAuth();
};

init();
