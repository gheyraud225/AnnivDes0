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
      const acts = sortActivities(asActivities(row.activities).map(activityLabel).filter(Boolean));
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
            '<div class="chips">' + chips(sortActivities(c.activities.map(activityLabel).filter(Boolean))) + "</div></div>";
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

// ---------- activités : CRUD + cache local ----------------------------

let activitiesCache = []; // [{ id, label, time_label, time_sort, description, max_participants, taken, ... }]
const activityLabel = (id) => {
  const a = activitiesCache.find((x) => x.id === id);
  return a ? (a.label + (a.time_label ? " (" + a.time_label + ")" : "")) : null;
};

const parseTimeSort = (s) => {
  if (!s) return 9999;
  const m = /^\s*(\d{1,2})\s*[h:.]\s*(\d{0,2})\s*$/i.exec(s);
  if (!m) return 9999;
  const h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  if (Number.isNaN(h) || Number.isNaN(min)) return 9999;
  return h * 60 + min;
};

const loadActivities = async () => {
  const { data, error } = await supabase.rpc("list_activities_with_counts");
  if (error) { console.error(error); activitiesCache = []; return; }
  activitiesCache = Array.isArray(data) ? data : [];
};

const renderActivitiesAdmin = () => {
  const host = $("activities-admin");
  if (!activitiesCache.length) {
    host.innerHTML = '<p class="empty-note">Aucune activité. Ajoutez-en une ci-dessous.</p>';
    return;
  }
  host.innerHTML = activitiesCache
    .map((a) => {
      const max = a.max_participants;
      const meta =
        (a.time_label ? a.time_label + " · " : "") +
        (max == null
          ? a.taken + " inscrit" + (a.taken > 1 ? "s" : "") + " (illimité)"
          : a.taken + "/" + max +
            (a.taken >= max ? ' <span class="full">complet</span>' : ""));
      return (
        '<div class="activity-row" data-id="' + escapeHtml(a.id) + '">' +
          '<div class="activity-row-main">' +
            '<div class="activity-row-label">' + escapeHtml(a.label) + "</div>" +
            '<div class="activity-row-meta">' + meta + "</div>" +
          "</div>" +
          '<button type="button" class="edit-btn" data-action="edit">Modifier</button>' +
          '<button type="button" class="delete-btn" data-action="delete">Supprimer</button>' +
        "</div>"
      );
    })
    .join("");
};

// Dialogue d'édition (création + modification)
const editDialog = $("edit-activity");
const editForm = $("edit-activity-form");
const editLabel = $("edit-label");
const editTime = $("edit-time");
const editMax = $("edit-max");
const editDesc = $("edit-desc");
const editStatus = $("edit-status");
const editTitle = $("edit-activity-title");
let editingId = null;

const openEdit = (a) => {
  editingId = a ? a.id : null;
  editTitle.textContent = a ? "Modifier l'activité" : "Ajouter une activité";
  editLabel.value = a ? a.label : "";
  editTime.value = a ? a.time_label : "";
  editMax.value = a && a.max_participants != null ? String(a.max_participants) : "";
  editDesc.value = a ? (a.description || "") : "";
  setStatus(editStatus, "", "");
  if (typeof editDialog.showModal === "function") editDialog.showModal();
  else editDialog.setAttribute("open", "");
  setTimeout(() => editLabel.focus(), 60);
};
const closeEdit = () => {
  if (typeof editDialog.close === "function" && editDialog.open) editDialog.close();
  else editDialog.removeAttribute("open");
};

$("edit-close").addEventListener("click", closeEdit);
$("edit-cancel").addEventListener("click", closeEdit);
editDialog.addEventListener("click", (e) => { if (e.target === editDialog) closeEdit(); });

editForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const label = editLabel.value.trim().slice(0, 80);
  if (!label) { editLabel.focus(); return; }
  const time = editTime.value.trim().slice(0, 10);
  const maxRaw = editMax.value.trim();
  const max = maxRaw === "" ? null : Math.max(0, parseInt(maxRaw, 10) || 0);
  const desc = editDesc.value.trim().slice(0, 300) || null;
  const payload = {
    label,
    time_label: time,
    time_sort: parseTimeSort(time),
    max_participants: max,
    description: desc,
  };
  setStatus(editStatus, "", "Enregistrement…");
  try {
    if (editingId) {
      const { error } = await supabase.from("activities").update(payload).eq("id", editingId);
      if (error) throw error;
    } else {
      // position = max(position) + 1 pour rester en fin de liste si time_sort
      // est identique à une autre
      payload.position = activitiesCache.reduce((m, a) => Math.max(m, a.position || 0), 0) + 1;
      const { error } = await supabase.from("activities").insert(payload);
      if (error) throw error;
    }
    closeEdit();
    await loadDashboard();
  } catch (err) {
    console.error(err);
    setStatus(editStatus, "error", explainError(err));
  }
});

$("add-activity").addEventListener("click", () => openEdit(null));

$("activities-admin").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const row = btn.closest(".activity-row");
  const id = row && row.dataset.id;
  const a = activitiesCache.find((x) => x.id === id);
  if (!a) return;
  if (btn.dataset.action === "edit") {
    openEdit(a);
  } else if (btn.dataset.action === "delete") {
    const confirmMsg = a.taken > 0
      ? "Supprimer « " + a.label + " » ? " + a.taken + " inscription(s) existante(s) seront orphelines."
      : "Supprimer « " + a.label + " » ?";
    if (!window.confirm(confirmMsg)) return;
    const { error } = await supabase.from("activities").delete().eq("id", id);
    if (error) {
      console.error(error);
      alert("Erreur : " + explainError(error));
      return;
    }
    await loadDashboard();
  }
});

// ---------- chargement ------------------------------------------------

const loadDashboard = async () => {
  setStatus($("dash-status"), "", "Chargement…");
  await loadActivities();
  renderActivitiesAdmin();

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

  // Décompte par activité (répondant principal + accompagnants), mappé via le cache.
  const tally = new Map();
  const add = (acts) => asActivities(acts).forEach((id) => {
    const label = activityLabel(id);
    if (!label) return; // activité supprimée : on ignore
    tally.set(label, (tally.get(label) || 0) + 1);
  });
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
