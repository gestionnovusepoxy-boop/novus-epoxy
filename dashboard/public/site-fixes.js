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

  // Inject photo gallery into #gallery section
  var gallerySection = document.getElementById('gallery');
  if (gallerySection) {
    var CDN = 'https://novus-epoxy.vercel.app/gallery/';
    var photos = [
      { src: 'metallique-commercial-1.jpg', title: 'Plancher m\u00e9tallique commercial', type: 'M\u00e9tallique' },
      { src: 'metallique-commercial-2.jpg', title: 'Espace commercial \u00e9poxy noir et or', type: 'M\u00e9tallique' },
      { src: 'metallique-closeup-or.jpg', title: 'Finition m\u00e9tallique or \u2014 effet miroir', type: 'M\u00e9tallique' },
      { src: 'metallique-texture-or-noir.jpg', title: 'Texture veines or et noir', type: 'M\u00e9tallique' },
      { src: 'metallique-brillant.jpg', title: 'Plancher m\u00e9tallique brillant', type: 'M\u00e9tallique' },
      { src: 'metallique-or-angle.jpg', title: '\u00c9poxy m\u00e9tallique or \u2014 vue rapproch\u00e9e', type: 'M\u00e9tallique' },
      { src: 'metallique-marbre-blanc.jpg', title: 'Sous-sol m\u00e9tallique marbr\u00e9 blanc', type: 'M\u00e9tallique' },
      { src: 'couleur-unie-blanc.jpg', title: 'Plancher couleur unie blanc brillant', type: 'Couleur unie' },
      { src: 'metallique-multicolore.jpg', title: 'M\u00e9tallique turquoise, or et rouge', type: 'M\u00e9tallique' },
      { src: 'flake-sous-sol-gris.jpg', title: 'Sous-sol finition flake gris', type: 'Flake' },
      { src: 'flake-garage-pierre.jpg', title: 'Garage flake avec mur de pierre', type: 'Flake' }
    ];

    var grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;padding:20px 5%;max-width:1400px;margin:0 auto;';

    photos.forEach(function(p) {
      var card = document.createElement('div');
      card.style.cssText = 'position:relative;border-radius:12px;overflow:hidden;cursor:pointer;box-shadow:0 4px 15px rgba(0,0,0,0.2);transition:transform 0.3s;';
      card.onmouseenter = function() { this.style.transform = 'scale(1.03)'; };
      card.onmouseleave = function() { this.style.transform = 'scale(1)'; };

      var img = document.createElement('img');
      img.src = CDN + p.src;
      img.alt = p.title;
      img.loading = 'lazy';
      img.style.cssText = 'width:100%;height:280px;object-fit:cover;display:block;';

      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:absolute;bottom:0;left:0;right:0;padding:12px 16px;background:linear-gradient(transparent,rgba(0,0,0,0.8));color:#fff;';
      overlay.innerHTML = '<div style="font-weight:600;font-size:14px;">' + p.title + '</div><div style="font-size:12px;opacity:0.8;margin-top:2px;">' + p.type + '</div>';

      card.appendChild(img);
      card.appendChild(overlay);
      grid.appendChild(card);

      // Lightbox on click
      card.addEventListener('click', function() {
        var lb = document.createElement('div');
        lb.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:pointer;';
        var bigImg = document.createElement('img');
        bigImg.src = CDN + p.src;
        bigImg.style.cssText = 'max-width:90%;max-height:90%;border-radius:8px;box-shadow:0 0 40px rgba(0,0,0,0.5);';
        lb.appendChild(bigImg);
        lb.addEventListener('click', function() { document.body.removeChild(lb); });
        document.body.appendChild(lb);
      });
    });

    // Clear existing content and add gallery
    var existingContent = gallerySection.querySelector('.gallery-grid, .portfolio-grid');
    if (existingContent) {
      existingContent.parentNode.replaceChild(grid, existingContent);
    } else {
      gallerySection.appendChild(grid);
    }
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
