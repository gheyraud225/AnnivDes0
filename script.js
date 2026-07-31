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

const canonicalLabel = (a) => a.label + (a.time_label ? " (" + a.time_label + ")" : "");
const isFull = (a) => a.max_participants != null && a.taken >= a.max_participants;

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
  activitiesData.forEach((a) => {
    const full = isFull(a);
    const alreadyMine = preselected.includes(a.id);
    // Verrouillée si pleine, sauf si l'invité y était déjà inscrit
    // (on lui garde sa place).
    const locked = full && !alreadyMine;
    const label = document.createElement("label");
    label.className = "check-card" + (locked ? " is-locked" : "");
    if (locked) label.title = "Cette activité est complète";
    const timeSuffix = a.time_label
      ? a.time_label + (locked ? " · complet" : "")
      : (locked ? "complet" : "");
    label.innerHTML =
      '<input type="checkbox" class="activity-choice" value="' + escapeHtml(a.id) + '"' +
        (locked ? ' data-locked="true" disabled' : "") +
        (alreadyMine ? " checked" : "") + " />" +
      "<span><strong>" + escapeHtml(a.label) + "</strong>" +
        (timeSuffix ? "<em>" + escapeHtml(timeSuffix) + "</em>" : "") +
      "</span>";
    activitiesHost.appendChild(label);
  });
};

const activityById = (id) => activitiesData.find((a) => a.id === id);

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
  activitiesHost.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    const locked = cb.dataset.locked === "true";
    cb.disabled = off || locked;
    // Décocher quand on dit "Non" ; garder la case si elle est verrouillée
    // (un invité déjà inscrit à une activité complète conserve sa place).
    if (off) cb.checked = false;
  });
  activitiesHost.style.opacity = off ? 0.5 : 1;
};

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
};

const syncCompanionsState = () => {
  const off = isNotComing();
  addCompanionBtn.disabled = off;
  if (off && companions.length) {
    companions.length = 0;
    renderCompanions();
  }
};

const buildCompanionActivities = () => {
  companionActivitiesHost.innerHTML = "";
  activitiesHost.querySelectorAll(".activity-choice").forEach((src, idx) => {
    const srcLabel = src.closest(".check-card");
    const inner = srcLabel ? srcLabel.querySelector("span").innerHTML : src.value;
    const locked = src.dataset.locked === "true";
    const label = document.createElement("label");
    label.className = "check-card" + (locked ? " is-locked" : "");
    label.innerHTML =
      '<input type="checkbox" data-companion-activity="' + idx + '" value="' +
        escapeHtml(src.value) + '"' + (locked ? " disabled" : "") + " />" +
      "<span>" + inner + "</span>";
    companionActivitiesHost.appendChild(label);
  });
};

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
    await saveRsvp(payload);
    const wasUpdate = isUpdate;
    isUpdate = true; // toute soumission ultérieure sera une mise à jour
    submitButton.textContent = "Mettre à jour ma réponse";
    // Rafraîchit les compteurs : une activité peut être passée à "complet"
    // suite à notre propre inscription.
    await loadActivities();
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
    // Charge les activités RSVP (cases à cocher). Le programme affiché
    // plus haut est statique, indépendant de la base.
    await loadActivities();
    renderActivityChoices();

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
