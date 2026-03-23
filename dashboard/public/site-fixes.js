// Novus Epoxy - Site fixes (nav links, smooth scroll)
(function() {
  // Fix nav + footer links
  var navMap = {
    'Accueil': '#hero',
    'Avantages': '#advantages',
    'Réalisations': '#gallery',
    'Realisations': '#gallery',
    'Contact': '#ghl-form'
  };

  document.querySelectorAll('a').forEach(function(a) {
    var text = a.textContent.trim();
    if (navMap[text] && (a.getAttribute('href') === '#' || !a.getAttribute('href'))) {
      a.setAttribute('href', navMap[text]);
    }
  });

  // Smooth scroll for all anchor links
  document.querySelectorAll('a[href^="#"]').forEach(function(a) {
    a.addEventListener('click', function(e) {
      var target = document.querySelector(this.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
})();
