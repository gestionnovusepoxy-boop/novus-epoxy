(function () {
  'use strict';

  // Pointe vers le dashboard Vercel (pas Hostinger)
  var ENDPOINT = 'https://novus-epoxy.vercel.app/api/track';

  var startTime  = Date.now();
  var hiddenAt   = 0;
  var totalHidden = 0;

  function getDuration() {
    return Math.round((Date.now() - startTime - totalHidden) / 1000);
  }

  function send(payload) {
    var data = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([data], { type: 'application/json' }));
    } else {
      fetch(ENDPOINT, { method: 'POST', body: data, keepalive: true }).catch(function () {});
    }
  }

  send({ type: 'pageview', path: location.pathname, referrer: document.referrer || null });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      hiddenAt = Date.now();
    } else if (hiddenAt) {
      totalHidden += Date.now() - hiddenAt;
      hiddenAt = 0;
    }
  });

  window.addEventListener('beforeunload', function () {
    send({ type: 'pageview', path: location.pathname, duration: getDuration() });
  });

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-track]');
    if (!el) return;
    send({ type: 'event', name: el.getAttribute('data-track'), path: location.pathname, value: el.getAttribute('data-track-value') || null });
  });

  window.NovusTrack = {
    event: function (name, value) {
      send({ type: 'event', name: name, path: location.pathname, value: value || null });
    },
  };

  // Fix scroll — quand on clique un lien vers #contact, scroller direct
  // sur les champs du formulaire (pas le titre de section au-dessus)
  function findFormFields() {
    // Chercher le premier input/textarea/select visible dans la section contact
    var section = document.getElementById('contact');
    if (!section) return null;
    var inputs = section.querySelectorAll('input, textarea, select');
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].offsetHeight > 0) return inputs[i];
    }
    // Fallback: chercher un form tag
    var form = section.querySelector('form');
    return form || null;
  }

  function scrollToFormFields(e) {
    var link = e.target.closest('a[href*="#contact"]');
    if (!link) return;
    var target = findFormFields();
    if (target) {
      e.preventDefault();
      var rect = target.getBoundingClientRect();
      var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      window.scrollTo({ top: scrollTop + rect.top - 60, behavior: 'smooth' });
      send({ type: 'event', name: 'scroll_to_form', path: location.pathname });
    }
  }
  document.addEventListener('click', scrollToFormFields);

  // Remove referral/loyalty program popup if present
  function removeReferralPopup() {
    document.querySelectorAll('div, section, aside').forEach(function (el) {
      var text = el.textContent || '';
      if ((text.includes('Programme de r') && text.includes('100')) ||
          (text.includes('Appeler pour r') && el.offsetWidth < 400 && el.offsetHeight < 300)) {
        // Only remove the floating popup, not main page content
        var style = window.getComputedStyle(el);
        if (style.position === 'fixed' || style.position === 'absolute' || style.zIndex > 100) {
          el.remove();
        }
      }
    });
  }
  setTimeout(removeReferralPopup, 1000);
  setTimeout(removeReferralPopup, 3000);

  // Fix au chargement si l'URL contient #contact
  if (location.hash === '#contact') {
    setTimeout(function () {
      var target = findFormFields();
      if (target) {
        var rect = target.getBoundingClientRect();
        var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        window.scrollTo({ top: scrollTop + rect.top - 60, behavior: 'smooth' });
      }
    }, 500);
  }
})();
