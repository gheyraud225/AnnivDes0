(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const rawName = params.get("nom") || params.get("name") || "";

  const sanitize = (value) =>
    value
      .replace(/[<>&"']/g, "")
      .trim()
      .slice(0, 40);

  const prettify = (value) =>
    value
      .split(/[\s-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");

  const cleanName = prettify(sanitize(rawName));
  const nameTarget = document.getElementById("guest-name");

  if (cleanName && nameTarget) {
    nameTarget.textContent = cleanName;
    const fullname = document.getElementById("fullname");
    if (fullname && !fullname.value) fullname.value = cleanName;
  }

  const form = document.getElementById("rsvp-form");
  const status = document.getElementById("form-status");

  if (!form) return;

  const PRESENCE_NAME = "entry.455410023";
  const presenceRadios = form.querySelectorAll('input[name="' + PRESENCE_NAME + '"]');
  const activities = form.querySelector(".activities");
  const activitiesSummary = document.getElementById("activities-summary");

  // Toutes les activités cochées partent dans une seule question texte
  // du Google Form : on peut changer la liste côté site librement.
  const syncActivitiesSummary = () => {
    const checked = Array.from(
      activities.querySelectorAll(".activity-choice:checked")
    ).map((cb) => cb.value);
    activitiesSummary.value = checked.length
      ? checked.join(", ")
      : "Aucune activité cochée";
  };

  const syncActivitiesState = () => {
    const selected = form.querySelector('input[name="' + PRESENCE_NAME + '"]:checked');
    const disabled = selected && selected.value === "Non";
    activities
      .querySelectorAll('input[type="checkbox"]')
      .forEach((cb) => {
        cb.disabled = disabled;
        if (disabled) cb.checked = false;
      });
    activities.style.opacity = disabled ? 0.5 : 1;
    syncActivitiesSummary();
  };

  presenceRadios.forEach((r) => r.addEventListener("change", () => {
    syncActivitiesState();
    syncCompanionsState();
  }));
  activities.addEventListener("change", syncActivitiesSummary);
  syncActivitiesState();

  // ---------------------------------------------------------------
  // Accompagnants : liste interne + dialogue d'ajout
  // ---------------------------------------------------------------

  const companions = []; // [{ name: string, activities: string[] }]

  const guestsField = document.getElementById("guests");
  const companionsList = document.getElementById("companions-list");
  const companionsEmpty = document.getElementById("companions-empty");
  const addCompanionBtn = document.getElementById("add-companion");
  const dialog = document.getElementById("companion-dialog");
  const companionForm = document.getElementById("companion-form");
  const companionNameInput = document.getElementById("companion-name");
  const companionActivitiesHost = document.getElementById("companion-activities");
  const companionCancelBtn = document.getElementById("companion-cancel-btn");
  const companionCloseBtn = document.getElementById("companion-cancel");

  const escapeHtml = (s) =>
    s.replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));

  const initials = (name) =>
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase())
      .join("") || "?";

  const isNotComing = () => {
    const selected = form.querySelector('input[name="' + PRESENCE_NAME + '"]:checked');
    return selected && selected.value === "Non";
  };

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
        syncGuestsField();
      });
      companionsList.appendChild(li);
    });
    companionsEmpty.hidden = companions.length > 0;
  };

  const serializeCompanions = () => {
    if (!companions.length) return "Aucun";
    const header = companions.length === 1 ? "1 accompagnant" : companions.length + " accompagnants";
    const lines = companions.map((c) => {
      const acts = c.activities.length ? " — " + c.activities.join(", ") : "";
      return "• " + c.name + acts;
    });
    return header + "\n" + lines.join("\n");
  };

  const syncGuestsField = () => {
    guestsField.value = serializeCompanions();
  };

  const syncCompanionsState = () => {
    const off = isNotComing();
    addCompanionBtn.disabled = off;
    if (off && companions.length) {
      companions.length = 0;
      renderCompanions();
      syncGuestsField();
    }
  };

  // Construit les cases d'activités du dialogue à partir de celles
  // du formulaire principal. On les régénère à chaque ouverture pour
  // rester synchrone si la liste change.
  const buildCompanionActivities = () => {
    companionActivitiesHost.innerHTML = "";
    const sources = activities.querySelectorAll(".activity-choice");
    sources.forEach((src, idx) => {
      const srcLabel = src.closest(".check-card");
      const inner = srcLabel ? srcLabel.querySelector("span").innerHTML : src.value;
      const label = document.createElement("label");
      label.className = "check-card";
      label.innerHTML =
        '<input type="checkbox" data-companion-activity="' + idx + '" value="' + escapeHtml(src.value) + '" />' +
        "<span>" + inner + "</span>";
      companionActivitiesHost.appendChild(label);
    });
  };

  const openDialog = () => {
    if (isNotComing()) return;
    companionForm.reset();
    buildCompanionActivities();
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      // Fallback (très vieux navigateurs) : visibilité simple
      dialog.setAttribute("open", "");
    }
    // Focus auto sur le champ nom — petit délai pour laisser
    // l'animation démarrer sans voler le scroll.
    setTimeout(() => companionNameInput.focus(), 60);
  };

  const closeDialog = () => {
    if (typeof dialog.close === "function" && dialog.open) {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
    }
    addCompanionBtn.focus({ preventScroll: true });
  };

  addCompanionBtn.addEventListener("click", openDialog);
  companionCancelBtn.addEventListener("click", closeDialog);
  companionCloseBtn.addEventListener("click", closeDialog);

  // Cliquer sur le backdrop ferme le dialogue
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog();
  });

  // Échap est géré nativement par <dialog>, mais on remet le focus proprement
  dialog.addEventListener("close", () => {
    addCompanionBtn.focus({ preventScroll: true });
  });

  companionForm.addEventListener("submit", (event) => {
    event.preventDefault();
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
    syncGuestsField();
    closeDialog();
  });

  syncGuestsField();
  syncCompanionsState();

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

  form.addEventListener("submit", (event) => {
    if (!form.checkValidity()) {
      event.preventDefault();
      form.reportValidity();
      status.className = "form-status error";
      status.textContent = "Merci de remplir les champs obligatoires avant d'envoyer.";
      return;
    }

    syncActivitiesSummary();
    syncGuestsField();

    const submitButton = form.querySelector('button[type="submit"]');
    const firstName = (document.getElementById("fullname").value.trim().split(/\s+/)[0]) || "";

    status.className = "form-status";
    status.textContent = "Envoi en cours…";
    submitButton.disabled = true;

    setTimeout(() => {
      status.className = "form-status success";
      status.textContent = "Réponse envoyée ✓";
      submitButton.disabled = false;
      showToast(
        firstName ? "Merci " + firstName + " !" : "Merci !",
        "Votre réponse est bien partie. On a hâte de vous voir le 29 août !"
      );
      burstConfetti();
      form.reset();
      companions.length = 0;
      renderCompanions();
      syncGuestsField();
      syncActivitiesState();
      syncCompanionsState();
      if (cleanName) {
        const fullname = document.getElementById("fullname");
        if (fullname) fullname.value = cleanName;
      }
    }, 900);
  });
})();
