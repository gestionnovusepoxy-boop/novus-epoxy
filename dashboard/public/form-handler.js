// Novus Epoxy - Custom contact form handler with email fallback
(function() {
  var form = document.getElementById("novus-contact-form");
  if (!form) return;

  function buildMailto(data) {
    var subject = encodeURIComponent("Demande de soumission - " + (data.nom || "Client"));
    var body = encodeURIComponent(
      "Nom: " + (data.nom || "") + "\n" +
      "Courriel: " + (data.email || "") + "\n" +
      "Telephone: " + (data.telephone || "") + "\n" +
      "Service: " + (data.service || "") + "\n" +
      "Type: " + (data.type_projet || "") + "\n" +
      "Superficie: " + (data.superficie || "") + " pi2\n" +
      "Adresse: " + (data.adresse || "") + "\n" +
      "Ville: " + (data.ville || "") + "\n"
    );
    return "mailto:gestionnovusepoxy@gmail.com?subject=" + subject + "&body=" + body;
  }

  form.addEventListener("submit", function(e) {
    e.preventDefault();
    var btn = document.getElementById("novus-submit-btn");
    var msg = document.getElementById("novus-form-msg");
    btn.disabled = true;
    btn.textContent = "Envoi en cours...";
    msg.style.display = "none";

    var fd = new FormData(form);
    var data = {};
    fd.forEach(function(v, k) { data[k] = v; });

    fetch("https://novus-epoxy.vercel.app/api/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }).then(function(r) {
      if (r.ok) {
        msg.style.display = "block";
        msg.style.background = "#dcfce7";
        msg.style.color = "#166534";
        msg.textContent = "Merci! Votre demande a \u00e9t\u00e9 envoy\u00e9e. Nous vous contacterons sous 24h.";
        form.reset();
      } else {
        // API error — fallback to email
        msg.style.display = "block";
        msg.style.background = "#fef3c7";
        msg.style.color = "#92400e";
        msg.innerHTML = 'Un probl\u00e8me est survenu. <a href="' + buildMailto(data) + '" style="color:#d97706;text-decoration:underline;font-weight:bold;">Cliquez ici pour envoyer par courriel</a> ou appelez-nous au 581-307-5983.';
      }
      btn.disabled = false;
      btn.textContent = "Envoyer ma demande";
    }).catch(function() {
      // Network error — fallback to email
      msg.style.display = "block";
      msg.style.background = "#fef3c7";
      msg.style.color = "#92400e";
      msg.innerHTML = 'Erreur de connexion. <a href="' + buildMailto(data) + '" style="color:#d97706;text-decoration:underline;font-weight:bold;">Cliquez ici pour envoyer par courriel</a> ou appelez-nous au 581-307-5983.';
      btn.disabled = false;
      btn.textContent = "Envoyer ma demande";
    });
  });
})();
