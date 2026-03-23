// Novus Epoxy - Site fixes (nav links, smooth scroll, OG tags, form accents)
(function() {
  // Fix nav + footer links
  var navMap = {
    'Accueil': '#hero',
    'Avantages': '#advantages',
    'R\u00e9alisations': '#gallery',
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

  // Fix form dropdown accents
  var accentMap = {
    'Finition Metallique': 'Finition M\u00e9tallique',
    'Reparation beton / Auto-nivelant': 'R\u00e9paration b\u00e9ton / Auto-nivelant',
    'Reparation beton': 'R\u00e9paration b\u00e9ton / Auto-nivelant'
  };
  document.querySelectorAll('#novus-contact-form option').forEach(function(opt) {
    if (accentMap[opt.textContent]) {
      var newText = accentMap[opt.textContent];
      opt.textContent = newText;
      if (accentMap[opt.value]) opt.value = newText;
    }
  });

  // Fix labels
  document.querySelectorAll('#novus-contact-form label').forEach(function(lbl) {
    lbl.textContent = lbl.textContent
      .replace('Telephone', 'T\u00e9l\u00e9phone')
      .replace('Surface estimee (pi2)', 'Surface estim\u00e9e (pi\u00b2)')
      .replace('Surface estimee', 'Surface estim\u00e9e');
  });

  // Fix placeholders
  document.querySelectorAll('#novus-contact-form input').forEach(function(inp) {
    if (inp.placeholder === 'Quebec, Levis...') inp.placeholder = 'Qu\u00e9bec, L\u00e9vis...';
  });

  // Add Open Graph meta tags for Facebook/LinkedIn sharing
  var ogTags = {
    'og:title': 'Novus Epoxy \u2014 Planchers \u00c9poxy Haut de Gamme \u00e0 Qu\u00e9bec',
    'og:description': 'Experts en planchers \u00e9poxy depuis 15 ans. Finitions m\u00e9tallique, flake, quartz et couleur unie. Garantie 10 ans. Soumission gratuite!',
    'og:type': 'website',
    'og:url': 'https://novusepoxy.ca',
    'og:locale': 'fr_CA',
    'og:site_name': 'Novus Epoxy'
  };
  Object.keys(ogTags).forEach(function(prop) {
    if (!document.querySelector('meta[property="' + prop + '"]')) {
      var meta = document.createElement('meta');
      meta.setAttribute('property', prop);
      meta.setAttribute('content', ogTags[prop]);
      document.head.appendChild(meta);
    }
  });

  // Add robots meta for SEO
  if (!document.querySelector('meta[name="robots"]')) {
    var robots = document.createElement('meta');
    robots.setAttribute('name', 'robots');
    robots.setAttribute('content', 'index, follow');
    document.head.appendChild(robots);
  }

  // Fix social links (Facebook, Instagram, LinkedIn)
  var socialMap = {
    'fa-facebook-f': 'https://www.facebook.com/novusepoxy',
    'fa-instagram': 'https://www.instagram.com/novusepoxy',
    'fa-linkedin-in': 'https://www.linkedin.com/company/novusepoxy'
  };
  document.querySelectorAll('a').forEach(function(a) {
    var icon = a.querySelector('i');
    if (icon) {
      Object.keys(socialMap).forEach(function(cls) {
        if (icon.classList.contains(cls) && (a.getAttribute('href') === '#' || !a.getAttribute('href'))) {
          a.setAttribute('href', socialMap[cls]);
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener');
        }
      });
    }
  });
})();
