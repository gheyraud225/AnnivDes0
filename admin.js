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

const partyActions = () =>
  '<div class="party-actions">' +
    '<button type="button" class="edit-rsvp" data-action="edit-rsvp">Modifier</button>' +
    '<button type="button" class="delete-rsvp" data-action="delete-rsvp">Supprimer</button>' +
  '</div>';

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
        '<div class="party" data-rsvp-id="' + escapeHtml(row.id) + '"><div class="party-head">' +
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
      html += partyActions();
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
        '<div class="party" data-rsvp-id="' + escapeHtml(row.id) + '"><div class="party-head">' +
        '<span class="party-name">' + escapeHtml(row.full_name || "—") + "</span>";
      if (row.email) html += '<span class="party-email">' + escapeHtml(row.email) + "</span>";
      html += "</div>";
      if (row.message) html += '<div class="party-extra"><strong>Message :</strong> ' + escapeHtml(row.message) + "</div>";
      html += partyActions();
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
          '<div class="activity-row-actions">' +
            '<button type="button" class="view-btn" data-action="view">Voir inscrits (' + a.taken + ")</button>" +
            '<button type="button" class="edit-btn" data-action="edit">Modifier</button>' +
            '<button type="button" class="delete-btn" data-action="delete">Supprimer</button>' +
          "</div>" +
        "</div>"
      );
    })
    .join("");
};

// Minutes <-> formats
const minToHHMM = (m) =>
  m == null ? "" : String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
const hhmmToMin = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s || "").trim());
  return m ? (+m[1]) * 60 + (+m[2]) : null;
};
const minToFR = (m) => {
  if (m == null) return "";
  return Math.floor(m / 60) + "h" + String(m % 60).padStart(2, "0");
};

// Dialogue d'édition (création + modification)
const editDialog = $("edit-activity");
const editForm = $("edit-activity-form");
const editLabel = $("edit-label");
const editStart = $("edit-start");
const editEnd = $("edit-end");
const editMax = $("edit-max");
const editDesc = $("edit-desc");
const editStatus = $("edit-status");
const editTitle = $("edit-activity-title");
let editingId = null;

const openEdit = (a) => {
  editingId = a ? a.id : null;
  editTitle.textContent = a ? "Modifier l'activité" : "Ajouter une activité";
  editLabel.value = a ? a.label : "";
  // début : start_min si connu, sinon time_sort (rétro-compat)
  const startMin = a ? (a.start_min != null ? a.start_min : (a.time_sort !== 9999 ? a.time_sort : null)) : null;
  editStart.value = minToHHMM(startMin);
  editEnd.value = a ? minToHHMM(a.end_min) : "";
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
  const startMin = hhmmToMin(editStart.value);
  const endMin = hhmmToMin(editEnd.value);
  if (startMin != null && endMin != null && endMin <= startMin) {
    setStatus(editStatus, "error", "L'heure de fin doit être après l'heure de début.");
    return;
  }
  const maxRaw = editMax.value.trim();
  const max = maxRaw === "" ? null : Math.max(0, parseInt(maxRaw, 10) || 0);
  const desc = editDesc.value.trim().slice(0, 300) || null;
  // Libellé horaire auto-généré à partir des heures saisies.
  const timeLabel =
    startMin != null
      ? minToFR(startMin) + (endMin != null ? " – " + minToFR(endMin) : "")
      : "";
  const payload = {
    label,
    time_label: timeLabel,
    time_sort: startMin != null ? startMin : 9999,
    start_min: startMin,
    end_min: endMin,
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

// ---------- liste des inscrits à une activité -------------------------

const registrantsDialog = $("view-registrants");
const registrantsTitle = $("registrants-title");
const registrantsBody = $("registrants-body");

// Renvoie tous les participants (répondants + accompagnants) inscrits à
// l'activité donnée. rsvpsCache doit être rempli (loadDashboard).
const registrantsFor = (activityId) => {
  const list = [];
  rsvpsCache.forEach((row) => {
    if (!row.attending) return;
    if (asActivities(row.activities).includes(activityId)) {
      list.push({ name: row.full_name || row.email || "—", note: "" });
    }
    asCompanions(row.companions).forEach((c) => {
      if ((c.activities || []).includes(activityId)) {
        list.push({
          name: c.name,
          note: "accompagne " + (row.full_name || row.email || "—"),
        });
      }
    });
  });
  list.sort((x, y) => x.name.localeCompare(y.name, "fr"));
  return list;
};

const openRegistrants = (a) => {
  const people = registrantsFor(a.id);
  registrantsTitle.textContent =
    a.label + (a.time_label ? " (" + a.time_label + ")" : "");
  if (!people.length) {
    registrantsBody.innerHTML = '<p class="empty-note">Personne n\'est encore inscrit à cette activité.</p>';
  } else {
    registrantsBody.innerHTML =
      '<p class="registrants-count">' + people.length +
        (people.length > 1 ? " personnes inscrites" : " personne inscrite") + "</p>" +
      '<ol class="registrants-list">' +
      people
        .map((p) =>
          "<li><span>" + escapeHtml(p.name) + "</span>" +
          (p.note ? '<em class="registrants-note">' + escapeHtml(p.note) + "</em>" : "") +
          "</li>")
        .join("") +
      "</ol>";
  }
  if (typeof registrantsDialog.showModal === "function") registrantsDialog.showModal();
  else registrantsDialog.setAttribute("open", "");
};

const closeRegistrants = () => {
  if (typeof registrantsDialog.close === "function" && registrantsDialog.open) registrantsDialog.close();
  else registrantsDialog.removeAttribute("open");
};

$("registrants-close").addEventListener("click", closeRegistrants);
$("registrants-ok").addEventListener("click", closeRegistrants);
registrantsDialog.addEventListener("click", (e) => { if (e.target === registrantsDialog) closeRegistrants(); });

$("activities-admin").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const row = btn.closest(".activity-row");
  const id = row && row.dataset.id;
  const a = activitiesCache.find((x) => x.id === id);
  if (!a) return;
  if (btn.dataset.action === "view") {
    openRegistrants(a);
  } else if (btn.dataset.action === "edit") {
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

let rsvpsCache = new Map(); // id -> row

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
  rsvpsCache = new Map(rows.map((r) => [r.id, r]));
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

// ---------- édition / suppression d'un RSVP ---------------------------

const editRsvpDialog = $("edit-rsvp");
const editRsvpForm = $("edit-rsvp-form");
const rsvpFullname = $("rsvp-fullname");
const rsvpEmailDisplay = $("rsvp-email-display");
const rsvpDiet = $("rsvp-diet");
const rsvpMessage = $("rsvp-message");
const rsvpActivitiesHost = $("rsvp-activities-host");
const rsvpCompanionsList = $("rsvp-companions-list");
const rsvpAddCompanionBtn = $("rsvp-add-companion");
const editRsvpStatus = $("edit-rsvp-status");
const editRsvpDeleteBtn = $("edit-rsvp-delete");

// État local pendant l'édition
let editingRsvp = null;
let editingCompanions = []; // [{ name, activities: [uuid] }]

const renderRsvpActivities = (selectedIds) => {
  // Vide tout sauf la <legend>
  Array.from(rsvpActivitiesHost.querySelectorAll(".check-card")).forEach((el) => el.remove());
  if (!activitiesCache.length) return;
  activitiesCache.forEach((a) => {
    const checked = selectedIds.includes(a.id) ? " checked" : "";
    const label = document.createElement("label");
    label.className = "check-card";
    label.innerHTML =
      '<input type="checkbox" data-activity-id="' + escapeHtml(a.id) + '"' + checked + " />" +
      "<span><strong>" + escapeHtml(a.label) + "</strong>" +
        (a.time_label ? "<em>" + escapeHtml(a.time_label) + "</em>" : "") +
      "</span>";
    rsvpActivitiesHost.appendChild(label);
  });
};

const renderEditingCompanions = () => {
  rsvpCompanionsList.innerHTML = "";
  if (!editingCompanions.length) {
    const li = document.createElement("li");
    li.className = "empty-note";
    li.textContent = "Aucun accompagnant.";
    rsvpCompanionsList.appendChild(li);
    return;
  }
  editingCompanions.forEach((c, i) => {
    const labels = (c.activities || []).map(activityLabel).filter(Boolean);
    const li = document.createElement("li");
    li.className = "companion-mini";
    li.innerHTML =
      '<span class="companion-mini-name">' + escapeHtml(c.name) +
        (labels.length ? ' <span class="companion-mini-acts">— ' + escapeHtml(labels.join(", ")) + "</span>" : "") +
      "</span>" +
      '<button type="button" data-action="edit-comp" aria-label="Modifier">✎</button>' +
      '<button type="button" data-action="del-comp" aria-label="Retirer">×</button>';
    li.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.action === "del-comp") {
          editingCompanions.splice(i, 1);
          renderEditingCompanions();
        } else if (btn.dataset.action === "edit-comp") {
          openCompanionEditor(i);
        }
      });
    });
    rsvpCompanionsList.appendChild(li);
  });
};

const openEditRsvp = (row) => {
  editingRsvp = row;
  rsvpFullname.value = row.full_name || "";
  rsvpEmailDisplay.textContent = row.email ? "Compte : " + row.email : "";
  rsvpDiet.value = row.diet || "";
  rsvpMessage.value = row.message || "";
  editRsvpForm.querySelectorAll('input[name="rsvp-presence"]').forEach((r) => {
    r.checked = (row.attending && r.value === "oui") || (!row.attending && r.value === "non");
  });
  renderRsvpActivities(asActivities(row.activities));
  editingCompanions = asCompanions(row.companions).map((c) => ({
    name: c.name,
    activities: asActivities(c.activities),
  }));
  renderEditingCompanions();
  setStatus(editRsvpStatus, "", "");
  if (typeof editRsvpDialog.showModal === "function") editRsvpDialog.showModal();
  else editRsvpDialog.setAttribute("open", "");
  setTimeout(() => rsvpFullname.focus(), 60);
};

const closeEditRsvp = () => {
  if (typeof editRsvpDialog.close === "function" && editRsvpDialog.open) editRsvpDialog.close();
  else editRsvpDialog.removeAttribute("open");
};

$("edit-rsvp-close").addEventListener("click", closeEditRsvp);
$("edit-rsvp-cancel").addEventListener("click", closeEditRsvp);
editRsvpDialog.addEventListener("click", (e) => { if (e.target === editRsvpDialog) closeEditRsvp(); });

editRsvpForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!editingRsvp) return;
  const attending = editRsvpForm.querySelector('input[name="rsvp-presence"]:checked').value === "oui";
  const activities = attending
    ? Array.from(rsvpActivitiesHost.querySelectorAll('input[type="checkbox"]:checked'))
        .map((cb) => cb.dataset.activityId)
    : [];
  const companions = attending
    ? editingCompanions.map((c) => ({
        name: c.name.slice(0, 60),
        activities: (c.activities || []).slice(0),
      }))
    : [];
  const payload = {
    full_name: rsvpFullname.value.trim().slice(0, 80),
    attending,
    activities,
    companions,
    diet: rsvpDiet.value.trim().slice(0, 200) || null,
    message: rsvpMessage.value.trim().slice(0, 1000) || null,
  };
  setStatus(editRsvpStatus, "", "Enregistrement…");
  const { error } = await supabase.from("rsvps").update(payload).eq("id", editingRsvp.id);
  if (error) {
    console.error(error);
    setStatus(editRsvpStatus, "error", explainError(error));
    return;
  }
  closeEditRsvp();
  await loadDashboard();
});

editRsvpDeleteBtn.addEventListener("click", async () => {
  if (!editingRsvp) return;
  if (!window.confirm("Supprimer définitivement la réponse de " + (editingRsvp.full_name || editingRsvp.email || "cet invité") + " ?")) return;
  const { error } = await supabase.from("rsvps").delete().eq("id", editingRsvp.id);
  if (error) {
    console.error(error);
    setStatus(editRsvpStatus, "error", explainError(error));
    return;
  }
  closeEditRsvp();
  await loadDashboard();
});

// ---------- mini-dialogue : accompagnant ------------------------------

const editCompDialog = $("edit-companion");
const editCompForm = $("edit-companion-form");
const compName = $("comp-name");
const compActivitiesHost = $("comp-activities-host");
const editCompTitle = $("edit-companion-title");
const editCompSave = $("edit-companion-save");
let editingCompanionIndex = null;

const renderCompActivities = (selectedIds) => {
  Array.from(compActivitiesHost.querySelectorAll(".check-card")).forEach((el) => el.remove());
  if (!activitiesCache.length) return;
  activitiesCache.forEach((a) => {
    const checked = selectedIds.includes(a.id) ? " checked" : "";
    const label = document.createElement("label");
    label.className = "check-card";
    label.innerHTML =
      '<input type="checkbox" data-activity-id="' + escapeHtml(a.id) + '"' + checked + " />" +
      "<span><strong>" + escapeHtml(a.label) + "</strong>" +
        (a.time_label ? "<em>" + escapeHtml(a.time_label) + "</em>" : "") +
      "</span>";
    compActivitiesHost.appendChild(label);
  });
};

const openCompanionEditor = (index) => {
  editingCompanionIndex = index;
  const existing = index != null ? editingCompanions[index] : null;
  editCompTitle.textContent = existing ? "Modifier l'accompagnant" : "Ajouter un accompagnant";
  editCompSave.textContent = existing ? "Enregistrer" : "Ajouter";
  compName.value = existing ? existing.name : "";
  renderCompActivities(existing ? existing.activities : []);
  if (typeof editCompDialog.showModal === "function") editCompDialog.showModal();
  else editCompDialog.setAttribute("open", "");
  setTimeout(() => compName.focus(), 60);
};

const closeCompanionEditor = () => {
  if (typeof editCompDialog.close === "function" && editCompDialog.open) editCompDialog.close();
  else editCompDialog.removeAttribute("open");
};

$("edit-companion-close").addEventListener("click", closeCompanionEditor);
$("edit-companion-cancel").addEventListener("click", closeCompanionEditor);
editCompDialog.addEventListener("click", (e) => { if (e.target === editCompDialog) closeCompanionEditor(); });

editCompForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = compName.value.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!name) { compName.focus(); return; }
  const acts = Array.from(compActivitiesHost.querySelectorAll('input[type="checkbox"]:checked'))
    .map((cb) => cb.dataset.activityId);
  if (editingCompanionIndex == null) {
    editingCompanions.push({ name, activities: acts });
  } else {
    editingCompanions[editingCompanionIndex] = { name, activities: acts };
  }
  closeCompanionEditor();
  renderEditingCompanions();
});

rsvpAddCompanionBtn.addEventListener("click", () => openCompanionEditor(null));

// Délégation : clic sur "Modifier" / "Supprimer" d'une carte invité.
const handlePartyClick = (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const party = btn.closest(".party");
  if (!party) return;
  const id = party.dataset.rsvpId;
  const row = rsvpsCache.get(id);
  if (!row) return;
  if (btn.dataset.action === "edit-rsvp") {
    openEditRsvp(row);
  } else if (btn.dataset.action === "delete-rsvp") {
    if (!window.confirm("Supprimer la réponse de " + (row.full_name || row.email || "cet invité") + " ?")) return;
    supabase.from("rsvps").delete().eq("id", id).then(({ error }) => {
      if (error) { console.error(error); alert("Erreur : " + explainError(error)); return; }
      loadDashboard();
    });
  }
};
$("present-list").addEventListener("click", handlePartyClick);
$("absent-list").addEventListener("click", handlePartyClick);

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
