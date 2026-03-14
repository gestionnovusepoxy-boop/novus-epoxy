(function () {
  'use strict';

  var ENDPOINT = 'https://novusepoxy.ca/api/track.php';

  // Durée de visite
  var startTime = Date.now();
  var hidden = false;
  var hiddenAt = 0;
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

  // Pageview initial
  send({
    type: 'pageview',
    path: location.pathname,
    referrer: document.referrer || null,
  });

  // Durée de visite à la fermeture
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      hidden = true;
      hiddenAt = Date.now();
    } else {
      if (hidden) {
        totalHidden += Date.now() - hiddenAt;
        hidden = false;
      }
    }
  });

  window.addEventListener('beforeunload', function () {
    send({
      type: 'pageview',
      path: location.pathname,
      duration: getDuration(),
    });
  });

  // Tracking d'événements via [data-track] attributes
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-track]');
    if (!el) return;
    send({
      type: 'event',
      name: el.getAttribute('data-track'),
      path: location.pathname,
      value: el.getAttribute('data-track-value') || null,
    });
  });

  // API publique
  window.NovusTrack = {
    event: function (name, value) {
      send({
        type: 'event',
        name: name,
        path: location.pathname,
        value: value || null,
      });
    },
  };
})();
