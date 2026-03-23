// Novus Epoxy - Custom contact form handler
(function() {
  var form = document.getElementById("novus-contact-form");
  if (!form) return;

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
        msg.style.display = "block";
        msg.style.background = "#fee2e2";
        msg.style.color = "#991b1b";
        msg.textContent = "Erreur. Veuillez r\u00e9essayer ou nous appeler au 581-307-2678.";
      }
      btn.disabled = false;
      btn.textContent = "Envoyer ma demande";
    }).catch(function() {
      msg.style.display = "block";
      msg.style.background = "#fee2e2";
      msg.style.color = "#991b1b";
      msg.textContent = "Erreur de connexion. Appelez-nous au 581-307-2678.";
      btn.disabled = false;
      btn.textContent = "Envoyer ma demande";
    });
  });
})();
