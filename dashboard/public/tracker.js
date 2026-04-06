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


})();
