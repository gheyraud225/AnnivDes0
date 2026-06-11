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
  };

  presenceRadios.forEach((r) => r.addEventListener("change", syncActivitiesState));
  syncActivitiesState();

  form.addEventListener("submit", (event) => {
    if (!form.checkValidity()) {
      event.preventDefault();
      form.reportValidity();
      status.className = "form-status error";
      status.textContent = "Merci de remplir les champs obligatoires avant d'envoyer.";
      return;
    }

    status.className = "form-status";
    status.textContent = "Envoi en cours…";

    setTimeout(() => {
      status.className = "form-status success";
      status.textContent =
        "Merci, votre réponse est bien arrivée ! On a hâte de vous voir.";
      form.reset();
      syncActivitiesState();
      if (cleanName) {
        const fullname = document.getElementById("fullname");
        if (fullname) fullname.value = cleanName;
      }
    }, 900);
  });
})();
