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

  presenceRadios.forEach((r) => r.addEventListener("change", syncActivitiesState));
  activities.addEventListener("change", syncActivitiesSummary);
  syncActivitiesState();

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
      syncActivitiesState();
      if (cleanName) {
        const fullname = document.getElementById("fullname");
        if (fullname) fullname.value = cleanName;
      }
    }, 900);
  });
})();
