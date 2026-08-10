// RSVP — front Supabase (email + mot de passe, sans confirmation)
//
// La connexion se fait avec email + mot de passe via Supabase Auth, avec
// "Confirm email" désactivé côté Supabase. Aucun mail n'est jamais envoyé,
// donc aucun SMTP n'est requis. L'email sert uniquement d'identifiant.
//
// Chaque invité ↔ une ligne dans public.rsvps (user_id unique). Une fois
// connecté, le formulaire est prérempli avec la réponse existante et le
// bouton submit devient "Mettre à jour".

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

// config.js encore sur les valeurs d'exemple ? On le détecte pour afficher
// un message clair plutôt qu'une erreur réseau obscure.
const IS_CONFIGURED =
  !!SUPABASE_URL &&
  !!SUPABASE_PUBLISHABLE_KEY &&
  !/VOTRE-PROJET/i.test(SUPABASE_URL) &&
  !/VOTRE_CLE/i.test(SUPABASE_PUBLISHABLE_KEY);

// ---------- helpers ---------------------------------------------------

const $ = (id) => document.getElementById(id);

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

const initials = (name) =>
  String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("") || "?";

const sanitize = (value) =>
  String(value || "").replace(/[<>&"']/g, "").trim().slice(0, 40);

const prettify = (value) =>
  String(value || "")
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");

const normalizeEmail = (e) => String(e || "").trim().toLowerCase();

const setStatus = (el, kind, text) => {
  el.className = kind ? "form-status " + kind : "form-status";
  el.textContent = text || "";
};

// ---------- greeting personnalisé ?nom= -------------------------------

const params = new URLSearchParams(window.location.search);
const cleanName = prettify(sanitize(params.get("nom") || params.get("name") || ""));
const nameTarget = $("guest-name");
if (cleanName && nameTarget) nameTarget.textContent = cleanName;

// ---------- éléments DOM ---------------------------------------------

const authBlock = $("auth-block");
const authForm = $("auth-form");
const authEmail = $("auth-email");
const authPassword = $("auth-password");
const authStatus = $("auth-status");
const authSignUpBtn = $("auth-signup");
const authSignInBtn = $("auth-signin");

const rsvpBlock = $("rsvp-block");
const signOutBtn = $("sign-out");
const authIdentity = $("auth-identity");

const form = $("rsvp-form");
const status = $("form-status");
const submitButton = $("rsvp-submit");
const fullnameInput = $("fullname");
const dietInput = $("diet");
const messageInput = $("message");
const activitiesHost = form.querySelector(".activities");
const activitiesLegend = activitiesHost.querySelector("legend");

// Liste des activités courantes, [{ id, label, time_label, max_participants, taken, ... }],
// remplie par loadActivities() avant tout rendu.
let activitiesData = [];

// Heure affichée d'une activité : dérivée de start_min / end_min (source de
// vérité), avec repli sur l'ancien libellé texte. Pas de fin -> juste le début.
const minToFR = (m) => Math.floor(m / 60) + "h" + String(m % 60).padStart(2, "0");
const activityTimeText = (a) => {
  if (a.start_min != null && a.end_min != null) return minToFR(a.start_min) + " – " + minToFR(a.end_min);
  if (a.start_min != null) return minToFR(a.start_min);
  return a.time_label || "";
};

const canonicalLabel = (a) => {
  const t = activityTimeText(a);
  return a.label + (t ? " (" + t + ")" : "");
};
// --- Capacité ----------------------------------------------------------
// a.taken vient de la base et inclut MES propres inscriptions déjà
// enregistrées. Comme mon nouvel envoi les remplace, il faut les retrancher
// pour connaître les places réellement occupées par les AUTRES, puis y
// ajouter ce que ma réponse en cours consomme (moi + mes accompagnants).
let savedMineCounts = new Map();

const countMineSaved = (row) => {
  const m = new Map();
  const add = (id) => { if (id) m.set(id, (m.get(id) || 0) + 1); };
  if (row && row.attending) {
    (Array.isArray(row.activities) ? row.activities : []).forEach(add);
    (Array.isArray(row.companions) ? row.companions : []).forEach((c) => {
      (Array.isArray(c && c.activities) ? c.activities : []).forEach(add);
    });
  }
  return m;
};

const takenByOthers = (a) => Math.max(0, (a.taken || 0) - (savedMineCounts.get(a.id) || 0));

// Places consommées par les accompagnants déjà ajoutés dans cette session.
const companionsCount = (activityId) =>
  companions.reduce((n, c) => n + ((c.activities || []).includes(activityId) ? 1 : 0), 0);

// Le répondant principal a-t-il coché cette activité ?
const mainCount = (activityId) => {
  const cb = activitiesHost.querySelector('.activity-choice[value="' + activityId + '"]');
  return cb && cb.checked ? 1 : 0;
};

// Occupation "hors conteneur" selon le contexte d'édition.
const externalForMain = (id) => {
  const a = activityById(id);
  return (a ? takenByOthers(a) : 0) + companionsCount(id);
};
const externalForCompanion = (id) => {
  const a = activityById(id);
  return (a ? takenByOthers(a) : 0) + mainCount(id) + companionsCount(id);
};

// Activité positionnée dans le temps ? (au moins une heure de début)
const isPositioned = (a) => a && a.start_min != null;
// Deux activités entrent-elles en conflit horaire ?
// Une activité sans fin est traitée comme un instant (son heure de début) :
// elle entre en conflit si ce moment tombe dans l'intervalle [début, fin[ de
// l'autre. Deux plages qui se touchent (l'une finit quand l'autre commence)
// ne sont PAS en conflit.
const conflictsInTime = (a, b) => {
  if (!isPositioned(a) || !isPositioned(b)) return false;
  const aPoint = a.end_min == null;
  const bPoint = b.end_min == null;
  if (aPoint && bPoint) return a.start_min === b.start_min;
  if (aPoint) return a.start_min >= b.start_min && a.start_min < b.end_min;
  if (bPoint) return b.start_min >= a.start_min && b.start_min < a.end_min;
  return a.start_min < b.end_min && b.start_min < a.end_min;
};

// Verrouille, dans un conteneur de cases .activity-choice, celles qui
// chevauchent une activité déjà cochée (et laisse les cases pleines gérées
// par data-locked). Les cases cochées restent activables pour être décochées.
// Affiche/retire une petite note explicative dans une carte de case.
const setOverlapNote = (card, text) => {
  const span = card && card.querySelector("span");
  if (!span) return;
  let note = span.querySelector(".overlap-note");
  if (text) {
    if (!note) {
      note = document.createElement("em");
      note.className = "overlap-note";
      span.appendChild(note);
    }
    note.textContent = text;
  } else if (note) {
    note.remove();
  }
};

// Applique les verrous d'une liste de cases : complet (capacité) puis
// chevauchement horaire. externalUsed(id) = places déjà prises en dehors de
// ce conteneur (autres invités + le reste de ma réponse).
// Une case cochée reste toujours activable, pour pouvoir la décocher.
const applyChoiceLocks = (host, externalUsed) => {
  const boxes = Array.from(host.querySelectorAll(".activity-choice"));
  const chosen = boxes
    .filter((b) => b.checked)
    .map((b) => activityById(b.value))
    .filter((a) => isPositioned(a));

  boxes.forEach((b) => {
    const card = b.closest(".check-card");
    const a = activityById(b.value);
    if (!card || !a) return;

    if (b.checked) {
      b.disabled = false;
      card.classList.remove("is-locked", "is-overlap");
      card.removeAttribute("title");
      setOverlapNote(card, "");
      return;
    }

    const noRoom =
      a.max_participants != null && externalUsed(a.id) >= a.max_participants;
    const conflict = isPositioned(a)
      ? chosen.find((r) => r.id !== a.id && conflictsInTime(a, r))
      : null;

    b.disabled = noRoom || !!conflict;
    card.classList.toggle("is-locked", noRoom);
    card.classList.toggle("is-overlap", !noRoom && !!conflict);

    if (noRoom) {
      card.title = "Cette activité est complète";
      setOverlapNote(card, "⛔ Complet — plus de place disponible");
    } else if (conflict) {
      const msg = "⛔ Chevauche « " + conflict.label + " » que vous avez déjà choisi";
      card.title = msg;
      setOverlapNote(card, msg);
    } else {
      card.removeAttribute("title");
      setOverlapNote(card, "");
    }
  });
};

// Rafraîchit les verrous du formulaire principal (appelé quand la liste
// d'accompagnants change : ils consomment les mêmes places).
const refreshMainLocks = () => {
  if (isNotComing()) return;
  applyChoiceLocks(activitiesHost, externalForMain);
};

const loadActivities = async () => {
  if (!IS_CONFIGURED) return;
  const { data, error } = await supabase.rpc("list_activities_with_counts");
  if (error) { console.error(error); activitiesData = []; return; }
  activitiesData = Array.isArray(data) ? data : [];
};

const renderActivityChoices = (preselected = []) => {
  if (!activitiesHost) return;
  // On vide tout sauf la <legend>
  Array.from(activitiesHost.querySelectorAll(".check-card, .empty-note")).forEach((el) => el.remove());
  if (!activitiesData.length) {
    const p = document.createElement("p");
    p.className = "empty-note";
    p.textContent = "Aucune activité disponible pour l'instant.";
    activitiesHost.appendChild(p);
    return;
  }
  // L'état "complet" / "chevauchement" est calculé par applyChoiceLocks,
  // pas figé ici : il dépend aussi des accompagnants ajoutés en cours de route.
  activitiesData.forEach((a) => {
    const alreadyMine = preselected.includes(a.id);
    const t = activityTimeText(a);
    const label = document.createElement("label");
    label.className = "check-card";
    label.innerHTML =
      '<input type="checkbox" class="activity-choice" value="' + escapeHtml(a.id) + '"' +
        (alreadyMine ? " checked" : "") + " />" +
      "<span><strong>" + escapeHtml(a.label) + "</strong>" +
        (t ? "<em>" + escapeHtml(t) + "</em>" : "") +
      "</span>";
    activitiesHost.appendChild(label);
  });
  refreshMainLocks();
};

const activityById = (id) => activitiesData.find((a) => a.id === id);

// --- Programme statique : on met à jour SEULEMENT l'heure de chaque carte
//     (.activity-detail-time) depuis la base. Le reste reste écrit en dur.
//     Lien carte <-> activité par data-activity == label (insensible à la
//     casse ; pour un label présent plusieurs fois, on associe dans l'ordre).
//     Sans correspondance en base, l'heure écrite en dur est conservée.
const updateProgrammeTimes = () => {
  const cards = document.querySelectorAll(".activity-detail[data-activity]");
  if (!cards.length || !activitiesData.length) return;
  const byLabel = new Map();
  activitiesData.forEach((a) => {
    const k = (a.label || "").trim().toLowerCase();
    if (!byLabel.has(k)) byLabel.set(k, []);
    byLabel.get(k).push(a);
  });
  const cursor = new Map();
  cards.forEach((card) => {
    const k = (card.dataset.activity || "").trim().toLowerCase();
    const list = byLabel.get(k);
    if (!list || !list.length) return;
    const i = cursor.get(k) || 0;
    const a = list[Math.min(i, list.length - 1)];
    cursor.set(k, i + 1);
    const t = activityTimeText(a);
    const el = card.querySelector(".activity-detail-time");
    if (t && el) el.textContent = t;
  });
};

const PRESENCE = "presence";
const presenceRadios = form.querySelectorAll('input[name="' + PRESENCE + '"]');

const getPresence = () => {
  const sel = form.querySelector('input[name="' + PRESENCE + '"]:checked');
  return sel ? sel.value : null;
};

const isNotComing = () => getPresence() === "non";

const getCheckedActivities = () =>
  Array.from(activitiesHost.querySelectorAll(".activity-choice:checked"))
    .map((cb) => cb.value);

const syncActivitiesState = () => {
  const off = isNotComing();
  if (off) {
    activitiesHost.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.disabled = true;
      cb.checked = false;
    });
    activitiesHost.querySelectorAll(".check-card").forEach((c) => {
      c.classList.remove("is-overlap", "is-locked");
      setOverlapNote(c, "");
    });
    activitiesHost.style.opacity = 0.5;
    return;
  }
  activitiesHost.style.opacity = 1;
  applyChoiceLocks(activitiesHost, externalForMain);
};

// Recalcule capacité + chevauchements à chaque coche/décoche.
activitiesHost.addEventListener("change", (e) => {
  if (e.target.classList && e.target.classList.contains("activity-choice")) {
    applyChoiceLocks(activitiesHost, externalForMain);
  }
});

// ---------- accompagnants --------------------------------------------

const companions = []; // [{ name, activities: string[] }]

const companionsList = $("companions-list");
const companionsEmpty = $("companions-empty");
const addCompanionBtn = $("add-companion");
const companionDialog = $("companion-dialog");
const companionForm = $("companion-form");
const companionNameInput = $("companion-name");
const companionActivitiesHost = $("companion-activities");
const companionCancelBtn = $("companion-cancel-btn");
const companionCloseBtn = $("companion-cancel");

const labelsFromIds = (ids) =>
  (ids || [])
    .map((id) => {
      const a = activityById(id);
      return a ? canonicalLabel(a) : null;
    })
    .filter(Boolean);

const renderCompanions = () => {
  companionsList.innerHTML = "";
  companions.forEach((c, i) => {
    const li = document.createElement("li");
    li.className = "companion-card";
    const labels = labelsFromIds(c.activities);
    const acts = labels.length
      ? escapeHtml(labels.join(", "))
      : "Aucune activité";
    li.innerHTML =
      '<span class="companion-avatar" aria-hidden="true">' + escapeHtml(initials(c.name)) + "</span>" +
      '<div class="companion-info">' +
        '<span class="companion-name">' + escapeHtml(c.name) + "</span>" +
        '<span class="companion-activities-summary">' + acts + "</span>" +
      "</div>" +
      '<button type="button" class="companion-remove" aria-label="Retirer ' + escapeHtml(c.name) + '">×</button>';
    li.querySelector(".companion-remove").addEventListener("click", () => {
      companions.splice(i, 1);
      renderCompanions();
    });
    companionsList.appendChild(li);
  });
  companionsEmpty.hidden = companions.length > 0;
  // Les accompagnants consomment les mêmes places que moi : on recalcule.
  refreshMainLocks();
};

const syncCompanionsState = () => {
  const off = isNotComing();
  addCompanionBtn.disabled = off;
  if (off && companions.length) {
    companions.length = 0;
    renderCompanions();
  }
};

// Reconstruit les cases de la fenêtre d'accompagnant à partir des données
// (et non en clonant celles du principal), pour ne PAS hériter des blocages
// de chevauchement liés aux choix de la personne principale. Chaque
// accompagnant repart d'une sélection vierge ; seul l'état "complet" (global)
// est repris.
const buildCompanionActivities = () => {
  companionActivitiesHost.innerHTML = "";
  activitiesData.forEach((a) => {
    const t = activityTimeText(a);
    const label = document.createElement("label");
    label.className = "check-card";
    label.innerHTML =
      '<input type="checkbox" class="activity-choice" value="' + escapeHtml(a.id) + '" />' +
      "<span><strong>" + escapeHtml(a.label) + "</strong>" +
        (t ? "<em>" + escapeHtml(t) + "</em>" : "") +
      "</span>";
    companionActivitiesHost.appendChild(label);
  });
  // Places restantes en tenant compte de moi + des accompagnants déjà ajoutés.
  applyChoiceLocks(companionActivitiesHost, externalForCompanion);
};

// Capacité + chevauchements dans la fenêtre d'accompagnant.
companionActivitiesHost.addEventListener("change", (e) => {
  if (e.target.classList && e.target.classList.contains("activity-choice")) {
    applyChoiceLocks(companionActivitiesHost, externalForCompanion);
  }
});

const openCompanionDialog = () => {
  if (isNotComing()) return;
  companionForm.reset();
  buildCompanionActivities();
  if (typeof companionDialog.showModal === "function") {
    companionDialog.showModal();
  } else {
    companionDialog.setAttribute("open", "");
  }
  setTimeout(() => companionNameInput.focus(), 60);
};

const closeCompanionDialog = () => {
  if (typeof companionDialog.close === "function" && companionDialog.open) {
    companionDialog.close();
  } else {
    companionDialog.removeAttribute("open");
  }
  addCompanionBtn.focus({ preventScroll: true });
};

addCompanionBtn.addEventListener("click", openCompanionDialog);
companionCancelBtn.addEventListener("click", closeCompanionDialog);
companionCloseBtn.addEventListener("click", closeCompanionDialog);
companionDialog.addEventListener("click", (e) => {
  if (e.target === companionDialog) closeCompanionDialog();
});

companionForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = companionNameInput.value.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!name) {
    companionNameInput.focus();
    companionNameInput.reportValidity();
    return;
  }
  const checkedActs = Array.from(
    companionActivitiesHost.querySelectorAll('input[type="checkbox"]:checked')
  ).map((cb) => cb.value);
  companions.push({ name, activities: checkedActs });
  renderCompanions();
  closeCompanionDialog();
});

presenceRadios.forEach((r) => r.addEventListener("change", () => {
  syncActivitiesState();
  syncCompanionsState();
}));
syncActivitiesState();
syncCompanionsState();

// ---------- confettis + toast ----------------------------------------

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const burstConfetti = () => {
  if (reducedMotion) return;
  const colors = ["#ff4f8b", "#ff8a5b", "#ffd14f", "#3ecfcf", "#7a5cff"];
  const burst = document.createElement("div");
  burst.className = "confetti-burst";
  burst.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 36; i++) {
    const piece = document.createElement("i");
    piece.style.setProperty("--x", Math.random() * 100 + "vw");
    piece.style.setProperty("--delay", Math.random() * 0.4 + "s");
    piece.style.setProperty("--fall", 2 + Math.random() * 1.5 + "s");
    piece.style.setProperty("--spin", (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 360) + "deg");
    piece.style.setProperty("--size", 6 + Math.random() * 7 + "px");
    piece.style.background = colors[i % colors.length];
    if (i % 3 === 0) piece.style.borderRadius = "50%";
    burst.appendChild(piece);
  }
  document.body.appendChild(burst);
  setTimeout(() => burst.remove(), 4500);
};

let toastTimer;
const showToast = (title, text) => {
  let toast = document.getElementById("rsvp-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "rsvp-toast";
    toast.className = "toast";
    toast.setAttribute("role", "status");
    toast.innerHTML = '<span class="toast-emoji" aria-hidden="true">🎉</span><div><strong></strong><p></p></div>';
    document.body.appendChild(toast);
  }
  toast.querySelector("strong").textContent = title;
  toast.querySelector("p").textContent = text;
  requestAnimationFrame(() => toast.classList.add("visible"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 6000);
};

// ---------- communication Supabase ------------------------------------

const fetchMyRsvp = async () => {
  // On filtre explicitement par user_id : un admin voit toutes les lignes via
  // la RLS, donc sans ce filtre maybeSingle() ramasserait potentiellement
  // d'autres invités.
  const { data: userData } = await supabase.auth.getUser();
  const user = userData && userData.user;
  if (!user) return null;
  const { data, error } = await supabase
    .from("rsvps")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
};

const saveRsvp = async (payload) => {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData && userData.user;
  if (!user) throw new Error("Pas de session active");
  const row = { ...payload, user_id: user.id };
  const { data, error } = await supabase
    .from("rsvps")
    .upsert(row, { onConflict: "user_id" })
    .select()
    .single();
  if (error) throw error;
  return data;
};

// ---------- préremplissage --------------------------------------------

const applyRsvpRow = (row) => {
  if (!row) return;
  // Mes inscriptions déjà en base : elles comptent dans a.taken alors que mon
  // prochain envoi les remplacera. On les mémorise pour ne pas me bloquer
  // sur mes propres places.
  savedMineCounts = countMineSaved(row);
  fullnameInput.value = row.full_name || "";
  presenceRadios.forEach((r) => {
    r.checked = (row.attending && r.value === "oui") ||
                (!row.attending && r.value === "non");
  });
  const acts = Array.isArray(row.activities) ? row.activities : [];
  renderActivityChoices(acts);
  syncActivitiesState();
  companions.length = 0;
  const cps = Array.isArray(row.companions) ? row.companions : [];
  cps.forEach((c) => {
    if (c && typeof c.name === "string") {
      companions.push({
        name: c.name,
        activities: Array.isArray(c.activities)
          ? c.activities.filter((a) => typeof a === "string")
          : [],
      });
    }
  });
  renderCompanions();
  syncCompanionsState();
  dietInput.value = row.diet || "";
  messageInput.value = row.message || "";
};

// ---------- bascule UI connecté / déconnecté -------------------------

const explainError = (error) => {
  if (!error) return "Une erreur inattendue est survenue.";
  const msg = (error.message || "").toLowerCase();
  if (msg.includes("invalid login")) return "Email ou mot de passe incorrect.";
  if (msg.includes("already registered") || msg.includes("user already")) return "Cet email a déjà un accès. Cliquez sur Se connecter.";
  if (msg.includes("password should be at least")) return "Le mot de passe doit faire au moins 6 caractères.";
  if (msg.includes("rate") || msg.includes("too many")) return "Trop de tentatives. Patientez quelques instants.";
  if (msg.includes("network") || msg.includes("fetch")) return "Problème de connexion. Vérifiez votre internet.";
  return error.message || "Erreur inconnue.";
};

let isUpdate = false; // true si une ligne rsvp existait déjà au chargement

const showAuth = () => {
  rsvpBlock.hidden = true;
  authBlock.hidden = false;
};

const showRsvp = (email) => {
  authBlock.hidden = true;
  rsvpBlock.hidden = false;
  authIdentity.innerHTML = "Connecté en tant que <strong>" + escapeHtml(email || "") + "</strong>";
  submitButton.textContent = isUpdate ? "Mettre à jour ma réponse" : "Envoyer ma réponse";
  // Préremplissage du nom depuis ?nom= si le champ est encore vide.
  if (cleanName && !fullnameInput.value) fullnameInput.value = cleanName;
};

const loadAndShowConnected = async (session) => {
  // Rafraîchit la liste d'activités à chaque connexion (l'admin a pu en
  // ajouter ou changer un max entre-temps).
  await loadActivities();

  let row = null;
  try {
    row = await fetchMyRsvp();
  } catch (err) {
    console.error(err);
  }
  isUpdate = !!row;
  if (row) {
    applyRsvpRow(row);
  } else {
    savedMineCounts = new Map();
    renderActivityChoices();
  }
  showRsvp(session.user.email);
};

// ---------- auth handlers --------------------------------------------

const lockAuthForm = (lock) => {
  authSignUpBtn.disabled = lock;
  authSignInBtn.disabled = lock;
  authEmail.disabled = lock;
  authPassword.disabled = lock;
};

const handleAuth = async (mode) => {
  if (!IS_CONFIGURED) {
    setStatus(authStatus, "error",
      "Le site n'est pas encore relié à Supabase : renseignez SUPABASE_URL et la clé dans config.js.");
    return;
  }
  const email = normalizeEmail(authEmail.value);
  const password = authPassword.value;

  if (!email || !authEmail.checkValidity()) {
    authEmail.focus();
    authEmail.reportValidity();
    return;
  }
  if (password.length < 6) {
    authPassword.focus();
    setStatus(authStatus, "error", "Le mot de passe doit faire au moins 6 caractères.");
    return;
  }

  lockAuthForm(true);
  setStatus(authStatus, "", mode === "signup" ? "Création en cours…" : "Connexion en cours…");

  try {
    const result =
      mode === "signup"
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;

    // Avec "Confirm email" OFF, signUp renvoie directement une session.
    const session = result.data && result.data.session;
    if (!session) {
      // Filet : si la confirmation par email est encore active, signUp ne
      // crée pas de session — on l'explique clairement.
      setStatus(authStatus, "error",
        "Compte créé, mais la connexion automatique a échoué. Désactivez \"Confirm email\" dans Supabase puis réessayez.");
      lockAuthForm(false);
      return;
    }

    setStatus(authStatus, "", "");
    authForm.reset();
    await loadAndShowConnected(session);
  } catch (err) {
    console.error(err);
    setStatus(authStatus, "error", explainError(err));
  } finally {
    lockAuthForm(false);
  }
};

authSignUpBtn.addEventListener("click", () => handleAuth("signup"));
authForm.addEventListener("submit", (e) => {
  e.preventDefault();
  handleAuth("signin");
});

signOutBtn.addEventListener("click", async () => {
  await supabase.auth.signOut();
  savedMineCounts = new Map();
  companions.length = 0;
  renderCompanions();
  form.reset();
  syncActivitiesState();
  syncCompanionsState();
  isUpdate = false;
  setStatus(status, "", "");
  setStatus(authStatus, "", "");
  showAuth();
  setTimeout(() => authEmail.focus(), 60);
});

// ---------- submit RSVP -----------------------------------------------

const collectPayload = () => {
  const attending = getPresence() === "oui";
  return {
    full_name: fullnameInput.value.trim().slice(0, 80),
    attending,
    activities: attending ? getCheckedActivities() : [],
    companions: attending
      ? companions.map((c) => ({
          name: c.name.slice(0, 60),
          activities: c.activities.slice(0),
        }))
      : [],
    diet: dietInput.value.trim().slice(0, 200) || null,
    message: messageInput.value.trim().slice(0, 1000) || null,
  };
};

const finishSuccess = (wasUpdate) => {
  const firstName = (fullnameInput.value.trim().split(/\s+/)[0]) || "";
  setStatus(status, "success", wasUpdate ? "Réponse mise à jour ✓" : "Réponse envoyée ✓");
  showToast(
    firstName ? "Merci " + firstName + " !" : "Merci !",
    wasUpdate
      ? "Votre réponse a bien été mise à jour. On a hâte de vous voir le 29 août !"
      : "Votre réponse est bien partie. On a hâte de vous voir le 29 août !",
  );
  burstConfetti();
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.checkValidity()) {
    form.reportValidity();
    setStatus(status, "error", "Merci de remplir les champs obligatoires.");
    return;
  }
  const payload = collectPayload();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    setStatus(status, "error", "Votre session a expiré. Reconnectez-vous.");
    showAuth();
    return;
  }
  submitButton.disabled = true;
  const originalLabel = submitButton.textContent;
  submitButton.textContent = isUpdate ? "Mise à jour en cours…" : "Envoi en cours…";
  setStatus(status, "", "");
  try {
    // Dernière vérification des places avec des compteurs frais : quelqu'un a
    // pu remplir une activité entre l'ouverture de la page et l'envoi.
    await loadActivities();
    const over = [];
    const wanted = new Map();
    const bump = (id) => wanted.set(id, (wanted.get(id) || 0) + 1);
    payload.activities.forEach(bump);
    payload.companions.forEach((c) => (c.activities || []).forEach(bump));
    wanted.forEach((n, id) => {
      const a = activityById(id);
      if (!a || a.max_participants == null) return;
      if (takenByOthers(a) + n > a.max_participants) over.push(a.label);
    });
    if (over.length) {
      submitButton.textContent = originalLabel;
      setStatus(status, "error",
        "Plus assez de places pour : " + over.join(", ") +
        ". Ajustez vos choix (les places viennent d'être prises).");
      renderActivityChoices(getCheckedActivities());
      syncActivitiesState();
      return;
    }

    await saveRsvp(payload);
    const wasUpdate = isUpdate;
    isUpdate = true; // toute soumission ultérieure sera une mise à jour
    submitButton.textContent = "Mettre à jour ma réponse";
    // Rafraîchit les compteurs : une activité peut être passée à "complet"
    // suite à notre propre inscription.
    await loadActivities();
    savedMineCounts = countMineSaved(payload);
    const myActs = getCheckedActivities();
    renderActivityChoices(myActs);
    syncActivitiesState();
    renderCompanions();
    finishSuccess(wasUpdate);
  } catch (err) {
    console.error(err);
    submitButton.textContent = originalLabel;
    setStatus(status, "error", explainError(err));
  } finally {
    submitButton.disabled = false;
  }
});

// ---------- initialisation -------------------------------------------

const init = async () => {
  if (!IS_CONFIGURED) {
    showAuth();
    setStatus(authStatus, "error",
      "Le site n'est pas encore relié à Supabase : renseignez SUPABASE_URL et la clé dans config.js.");
    return;
  }
  try {
    // Charge les activités (cases à cocher RSVP + heures du programme).
    await loadActivities();
    renderActivityChoices();
    updateProgrammeTimes(); // met à jour uniquement les heures du programme

    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      await loadAndShowConnected(session);
    } else {
      showAuth();
    }
  } catch (err) {
    console.error(err);
    showAuth();
  }
};

supabase.auth.onAuthStateChange((event, session) => {
  // Pas de reload UI ici : c'est handleAuth / signOut qui gèrent les transitions.
  // Cette écoute sert juste de filet pour les expirations de token.
  if (!session && !authBlock.hidden) return;
  if (!session && rsvpBlock.hidden === false) {
    showAuth();
  }
});

init();
