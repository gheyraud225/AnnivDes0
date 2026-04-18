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
  const hiddenLinkName = document.getElementById("guest-link-name");

  if (cleanName) {
    nameTarget.textContent = cleanName;
    hiddenLinkName.value = cleanName;
    const fullname = document.getElementById("fullname");
    if (fullname && !fullname.value) fullname.value = cleanName;
  }

  const form = document.getElementById("rsvp-form");
  const status = document.getElementById("form-status");

  if (!form) return;

  const presenceRadios = form.querySelectorAll('input[name="entry.PRESENCE"]');
  const activities = form.querySelector(".activities");

  const syncActivitiesState = () => {
    const selected = form.querySelector('input[name="entry.PRESENCE"]:checked');
    const disabled = selected && selected.value.startsWith("Non");
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
    if (!form.checkValidity()) return;

    if (form.action.includes("FORM_ACTION_URL")) {
      event.preventDefault();
      status.className = "form-status error";
      status.textContent =
        "Formulaire pas encore connecté à Google Sheets — voir les instructions dans index.html.";
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
        document.getElementById("fullname").value = cleanName;
        hiddenLinkName.value = cleanName;
      }
    }, 900);
  });
})();
