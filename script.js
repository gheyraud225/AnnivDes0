// RSVP — front Supabase
//
// Toute la logique d'envoi/lecture passe par Supabase (table public.rsvps).
// Auth : code OTP à 6 chiffres par email. Un invité ↔ une ligne (user_id unique).
//
// L'existant (cases d'activités, dialogue accompagnants, confettis, toast,
// préremplissage depuis ?nom=) est conservé intégralement.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

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

// ---------- éléments du formulaire principal --------------------------

const form = $("rsvp-form");
const status = $("form-status");
const submitButton = $("rsvp-submit");
const fullnameInput = $("fullname");
const emailInput = $("email");
const dietInput = $("diet");
const messageInput = $("message");
const activitiesHost = form.querySelector(".activities");

if (cleanName && !fullnameInput.value) fullnameInput.value = cleanName;

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
    cb.disabled = off;
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

const renderCompanions = () => {
  companionsList.innerHTML = "";
  companions.forEach((c, i) => {
    const li = document.createElement("li");
    li.className = "companion-card";
    const acts = c.activities.length
      ? escapeHtml(c.activities.join(", "))
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

const buildCompanionActivities = (preselected = []) => {
  companionActivitiesHost.innerHTML = "";
  activitiesHost.querySelectorAll(".activity-choice").forEach((src, idx) => {
    const srcLabel = src.closest(".check-card");
    const inner = srcLabel ? srcLabel.querySelector("span").innerHTML : src.value;
    const label = document.createElement("label");
    label.className = "check-card";
    const checked = preselected.includes(src.value) ? " checked" : "";
    label.innerHTML =
      '<input type="checkbox" data-companion-activity="' + idx + '" value="' + escapeHtml(src.value) + '"' + checked + " />" +
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

// ---------- confettis + toast (inchangé) ------------------------------

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

// ---------- modale OTP (auth) -----------------------------------------

const authDialog = $("auth-dialog");
const authForm = $("auth-form");
const authStepEmail = $("auth-step-email");
const authStepCode = $("auth-step-code");
const authEmailInput = $("auth-email");
const authCodeInput = $("auth-code");
const authEmailDisplay = $("auth-email-display");
const authStatus = $("auth-status");
const authSubmit = $("auth-submit");
const authCancel = $("auth-cancel");
const authClose = $("auth-close");
const authResend = $("auth-resend");
const authTitle = $("auth-dialog-title");
const authIntroEmail = $("auth-intro-email");

// Modes possibles de la modale :
//   "save"     → après vérif on enregistre la ligne avec le payload courant
//   "load"     → après vérif on charge la ligne existante et préremplit
// Le payload n'est utile qu'en mode "save".
let authMode = "save";
let pendingPayload = null;
let pendingEmail = "";

const setAuthStep = (step) => {
  authStepEmail.hidden = step !== "email";
  authStepCode.hidden = step !== "code";
  authSubmit.textContent = step === "email" ? "Envoyer le code" : "Valider";
  setStatus(authStatus, "", "");
  setTimeout(() => {
    if (step === "email") authEmailInput.focus();
    if (step === "code") authCodeInput.focus();
  }, 80);
};

const openAuthDialog = (mode, prefillEmail = "") => {
  authMode = mode;
  pendingEmail = "";
  authForm.reset();
  authEmailInput.value = prefillEmail;
  authTitle.textContent =
    mode === "load" ? "Modifier ma réponse" : "Vérifions votre email";
  authIntroEmail.textContent =
    mode === "load"
      ? "Entrez l'email utilisé lors de votre première réponse. On vous envoie un code à 6 chiffres pour vous reconnecter."
      : "On vous envoie un code à 6 chiffres pour confirmer votre réponse.";
  setAuthStep("email");
  if (typeof authDialog.showModal === "function") {
    authDialog.showModal();
  } else {
    authDialog.setAttribute("open", "");
  }
};

const closeAuthDialog = () => {
  if (typeof authDialog.close === "function" && authDialog.open) {
    authDialog.close();
  } else {
    authDialog.removeAttribute("open");
  }
};

authClose.addEventListener("click", closeAuthDialog);
authCancel.addEventListener("click", closeAuthDialog);
authDialog.addEventListener("click", (e) => {
  if (e.target === authDialog) closeAuthDialog();
});

// ---------- communication Supabase ------------------------------------

const sendOtp = async (email) => {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) throw error;
};

const verifyOtp = async (email, token) => {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  });
  if (error) throw error;
  return data;
};

const fetchMyRsvp = async () => {
  const { data, error } = await supabase
    .from("rsvps")
    .select("*")
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

// ---------- préremplissage depuis une ligne existante -----------------

const applyRsvpRow = (row) => {
  if (!row) return;
  fullnameInput.value = row.full_name || "";
  // L'email vient de la session Supabase (cf. refreshAuthUI), pas de la table.
  presenceRadios.forEach((r) => {
    r.checked = (row.attending && r.value === "oui") ||
                (!row.attending && r.value === "non");
  });
  syncActivitiesState();
  const acts = Array.isArray(row.activities) ? row.activities : [];
  activitiesHost.querySelectorAll(".activity-choice").forEach((cb) => {
    cb.checked = acts.includes(cb.value);
  });
  companions.length = 0;
  const cps = Array.isArray(row.companions) ? row.companions : [];
  cps.forEach((c) => {
    if (c && typeof c.name === "string") {
      companions.push({
        name: c.name,
        activities: Array.isArray(c.activities) ? c.activities.filter(a => typeof a === "string") : [],
      });
    }
  });
  renderCompanions();
  syncCompanionsState();
  dietInput.value = row.diet || "";
  messageInput.value = row.message || "";
};

// ---------- état connecté / déconnecté --------------------------------

const signOutBtn = $("sign-out");
const openModifyBtn = $("open-modify");

const refreshAuthUI = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  const loggedIn = !!session;
  signOutBtn.hidden = !loggedIn;
  openModifyBtn.hidden = loggedIn;
  if (loggedIn && session.user.email) {
    emailInput.value = session.user.email;
    emailInput.setAttribute("readonly", "");
  } else {
    emailInput.removeAttribute("readonly");
  }
  submitButton.textContent = loggedIn ? "Mettre à jour ma réponse" : "Envoyer ma réponse";
  let banner = $("welcome-banner");
  if (loggedIn) {
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "welcome-banner";
      banner.className = "welcome-banner";
      banner.innerHTML =
        '<span class="welcome-banner-emoji" aria-hidden="true">👋</span>' +
        '<span></span>';
      form.parentNode.insertBefore(banner, form);
    }
    banner.querySelector("span:last-child").textContent =
      "Bon retour ! Vous pouvez ajuster votre réponse ci-dessous.";
  } else if (banner) {
    banner.remove();
  }
  return loggedIn;
};

signOutBtn.addEventListener("click", async () => {
  await supabase.auth.signOut();
  setStatus(status, "", "");
  await refreshAuthUI();
});

openModifyBtn.addEventListener("click", () => {
  openAuthDialog("load", emailInput.value.trim());
});

// ---------- collecte du payload depuis le formulaire ------------------

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

// ---------- flux : submit principal -----------------------------------

const lockSubmit = (lock, label) => {
  submitButton.disabled = lock;
  if (label) submitButton.textContent = label;
};

const finishSuccess = async (isUpdate) => {
  const firstName = (fullnameInput.value.trim().split(/\s+/)[0]) || "";
  setStatus(status, "success", isUpdate ? "Réponse mise à jour ✓" : "Réponse envoyée ✓");
  showToast(
    firstName ? "Merci " + firstName + " !" : "Merci !",
    isUpdate
      ? "Votre réponse a bien été mise à jour. On a hâte de vous voir le 29 août !"
      : "Votre réponse est bien partie. On a hâte de vous voir le 29 août !",
  );
  burstConfetti();
  await refreshAuthUI();
};

const explainError = (error) => {
  if (!error) return "Une erreur inattendue est survenue.";
  const msg = (error.message || "").toLowerCase();
  if (msg.includes("invalid") && msg.includes("token")) return "Code invalide ou expiré. Réessayez ou demandez un nouveau code.";
  if (msg.includes("expired")) return "Le code a expiré. Demandez-en un nouveau.";
  if (msg.includes("rate") || msg.includes("too many")) return "Trop de tentatives. Patientez quelques instants avant de réessayer.";
  if (msg.includes("network") || msg.includes("fetch")) return "Problème de connexion. Vérifiez votre internet et réessayez.";
  return error.message || "Erreur inconnue.";
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.checkValidity()) {
    form.reportValidity();
    setStatus(status, "error", "Merci de remplir les champs obligatoires.");
    return;
  }
  const email = normalizeEmail(emailInput.value);
  if (!email) {
    emailInput.focus();
    return;
  }

  const payload = collectPayload();

  const { data: { session } } = await supabase.auth.getSession();

  if (session) {
    // Déjà connecté → upsert direct.
    lockSubmit(true, "Mise à jour en cours…");
    setStatus(status, "", "Enregistrement en cours…");
    try {
      await saveRsvp(payload);
      lockSubmit(false, "Mettre à jour ma réponse");
      await finishSuccess(true);
    } catch (err) {
      console.error(err);
      lockSubmit(false, "Mettre à jour ma réponse");
      setStatus(status, "error", explainError(err));
    }
    return;
  }

  // Pas de session → on demande le code OTP, puis on enregistre.
  pendingPayload = payload;
  openAuthDialog("save", email);
  // On déclenche aussi l'envoi du code immédiatement pour gagner un tour
  // (le bouton "Envoyer le code" du dialog déclenche la même action si
  // l'utilisateur préfère réagir manuellement).
  authEmailInput.value = email;
  await triggerSendOtp();
});

// ---------- flux : étapes de la modale auth ---------------------------

const triggerSendOtp = async () => {
  const email = normalizeEmail(authEmailInput.value);
  if (!email || !authEmailInput.checkValidity()) {
    authEmailInput.focus();
    authEmailInput.reportValidity();
    return;
  }
  authSubmit.disabled = true;
  setStatus(authStatus, "", "Envoi du code en cours…");
  try {
    await sendOtp(email);
    pendingEmail = email;
    authEmailDisplay.textContent = email;
    setAuthStep("code");
    setStatus(authStatus, "success", "Code envoyé. Vérifiez votre boîte mail.");
  } catch (err) {
    console.error(err);
    setStatus(authStatus, "error", explainError(err));
  } finally {
    authSubmit.disabled = false;
  }
};

const triggerVerifyOtp = async () => {
  const token = (authCodeInput.value || "").replace(/\D/g, "").slice(0, 6);
  if (token.length !== 6) {
    authCodeInput.focus();
    setStatus(authStatus, "error", "Entrez le code à 6 chiffres reçu par email.");
    return;
  }
  authSubmit.disabled = true;
  setStatus(authStatus, "", "Vérification en cours…");
  try {
    await verifyOtp(pendingEmail, token);
    setStatus(authStatus, "success", "Code accepté ✓");

    if (authMode === "save") {
      // Enregistre la réponse en attente avec la nouvelle session.
      // Si le payload a été perdu (très improbable, ex. rechargement),
      // on recollecte depuis le formulaire courant.
      const toSave = pendingPayload || collectPayload();
      try {
        // Détermine si une ligne existait déjà avant l'upsert,
        // pour adapter le toast de confirmation.
        const existing = await fetchMyRsvp();
        await saveRsvp(toSave);
        closeAuthDialog();
        pendingPayload = null;
        await finishSuccess(!!existing);
      } catch (err) {
        console.error(err);
        setStatus(authStatus, "error", explainError(err));
      }
    } else {
      // Mode "load" : on récupère la ligne existante et préremplit.
      try {
        const row = await fetchMyRsvp();
        if (row) {
          applyRsvpRow(row);
          closeAuthDialog();
          await refreshAuthUI();
          setStatus(status, "success", "Réponse chargée. Modifiez-la puis enregistrez.");
          const rsvpSection = document.getElementById("rsvp");
          if (rsvpSection) rsvpSection.scrollIntoView({ behavior: "smooth", block: "start" });
        } else {
          closeAuthDialog();
          await refreshAuthUI();
          setStatus(status, "", "Aucune réponse trouvée pour cet email — remplissez le formulaire pour la première fois.");
        }
      } catch (err) {
        console.error(err);
        setStatus(authStatus, "error", explainError(err));
      }
    }
  } catch (err) {
    console.error(err);
    setStatus(authStatus, "error", explainError(err));
  } finally {
    authSubmit.disabled = false;
  }
};

authForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (authStepEmail.hidden) {
    triggerVerifyOtp();
  } else {
    triggerSendOtp();
  }
});

authResend.addEventListener("click", () => {
  authCodeInput.value = "";
  triggerSendOtp();
});

// ---------- initialisation : si déjà connecté, on charge la réponse ----

const init = async () => {
  try {
    const loggedIn = await refreshAuthUI();
    if (loggedIn) {
      const row = await fetchMyRsvp();
      if (row) applyRsvpRow(row);
    }
  } catch (err) {
    console.error(err);
  }
};

supabase.auth.onAuthStateChange(() => {
  refreshAuthUI().catch(() => { /* noop */ });
});

init();
