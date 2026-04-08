// Novus Epoxy - Site fixes (nav links, smooth scroll, OG tags, form accents)
(function() {
  if (window.__novusSiteFixesLoaded) return;
  window.__novusSiteFixesLoaded = true;
  // Fix gallery page — replace broken images with portfolio photos served from /gallery/
  var CDN_BASE = 'https://novus-epoxy.vercel.app/gallery/';
  var galleryPhotos = [
    CDN_BASE + 'metallique-brillant.jpg',
    CDN_BASE + 'metallique-commercial-1.jpg',
    CDN_BASE + 'metallique-or-angle.jpg',
    CDN_BASE + 'flake-garage-pierre.jpg',
    CDN_BASE + 'flake-sous-sol-gris.jpg',
    CDN_BASE + 'metallique-texture-or-noir.jpg',
    CDN_BASE + 'metallique-closeup-or.jpg',
    CDN_BASE + 'metallique-multicolore.jpg',
  ];
  var galIdx = 0;
  document.addEventListener('error', function(e) {
    if (e.target.tagName === 'IMG' && e.target.classList.contains('gallery-img')) {
      e.target.src = galleryPhotos[galIdx % galleryPhotos.length];
      galIdx++;
    }
  }, true);

  // Replace favicon
  var faviconUrl = 'https://novus-epoxy.vercel.app/logo.jpg';
  var link = document.querySelector("link[rel~='icon']") || document.createElement('link');
  link.type = 'image/jpeg';
  link.rel = 'icon';
  link.href = faviconUrl;
  document.head.appendChild(link);

  // Replace header + footer logos with full Novus Epoxy logo
  var newLogoUrl = 'https://novus-epoxy.vercel.app/logo.jpg';
  function replaceLogo() {
    var imgs = document.querySelectorAll('.logo-img, .footer-logo-img');
    imgs.forEach(function(img) {
      img.src = newLogoUrl;
      img.style.maxHeight = '80px';
      img.style.width = 'auto';
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', replaceLogo);
  } else {
    replaceLogo();
  }

  // Fix nav + footer links
  var navMap = {
    'Accueil': '#hero',
    'Avantages': '#advantages',
    'R\u00e9alisations': '#gallery',
    'Realisations': '#gallery',
    'Contact': '#contact'
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
      var href = this.getAttribute('href');
      var target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        // Pour la section contact, scroller direct sur le formulaire (pas le titre)
        if (href === '#contact' || href === '#ghl-form') {
          var formEl = target.querySelector('#novus-contact-form, form, #novus-form-wrapper');
          if (formEl) {
            var rect = formEl.getBoundingClientRect();
            window.scrollTo({ top: window.pageYOffset + rect.top - 40, behavior: 'smooth' });
            return;
          }
        }
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

  // Color catalog link — appears when Flake, Couleur unie, or Quartz is selected
  var serviceSelect = document.querySelector('#novus-contact-form select');
  if (serviceSelect) {
    // Color link (for flake, couleur unie, quartz)
    var colorLink = document.createElement('a');
    colorLink.target = '_blank';
    colorLink.rel = 'noopener';
    colorLink.style.cssText = 'display:none;margin:8px 0 4px;padding:10px 16px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;text-align:center;cursor:pointer;transition:all 0.3s;';
    colorLink.onmouseenter = function() { this.style.transform = 'scale(1.02)'; };
    colorLink.onmouseleave = function() { this.style.transform = 'scale(1)'; };
    serviceSelect.parentNode.insertBefore(colorLink, serviceSelect.nextSibling);

    // Info note (for metallique)
    var metalNote = document.createElement('div');
    metalNote.style.cssText = 'display:none;margin:8px 0 4px;padding:10px 16px;background:#1e293b;color:#f8fafc;border-radius:8px;font-size:13px;line-height:1.5;border:1px solid #334155;';
    metalNote.innerHTML = '\ud83c\udfa8 Les couleurs m\u00e9talliques sont choisies en personne avec Jason pour un r\u00e9sultat parfait. Il vous contactera apr\u00e8s votre soumission!';
    serviceSelect.parentNode.insertBefore(metalNote, colorLink.nextSibling);

    function checkColorService() {
      var val = (serviceSelect.value || '').toLowerCase();
      var text = (serviceSelect.options[serviceSelect.selectedIndex]?.text || '').toLowerCase();
      var isFlake = val.includes('flake') || val.includes('flocon') || text.includes('flake') || text.includes('flocon');
      var isCouleurUnie = val.includes('couleur') || val.includes('unie') || text.includes('couleur') || text.includes('unie');
      var isQuartz = val.includes('quartz') || text.includes('quartz');
      var isMetallique = val.includes('metallique') || val.includes('m\u00e9tallique') || text.includes('metallique') || text.includes('m\u00e9tallique');

      // Show color link for flake, couleur unie, quartz
      if (isFlake || isCouleurUnie || isQuartz) {
        colorLink.style.display = 'block';
        var tab = 'flake';
        if (isCouleurUnie) tab = 'solid';
        else if (isQuartz) tab = 'quartz';
        colorLink.href = 'https://novus-epoxy.vercel.app/couleurs?tab=' + tab + '&locked=1';
        colorLink.textContent = '\ud83c\udfa8 Choisissez votre couleur';
      } else {
        colorLink.style.display = 'none';
      }

      // Show metallic note
      metalNote.style.display = isMetallique ? 'block' : 'none';
    }
    serviceSelect.addEventListener('change', checkColorService);
    checkColorService();

    // Show chosen color badge if saved in localStorage — right after service select
    var chosenBadge = document.createElement('div');
    chosenBadge.style.cssText = 'display:none;margin:10px 0;padding:12px 16px;background:#065f46;color:#d1fae5;border-radius:8px;font-size:15px;font-weight:700;border:2px solid #10b981;text-align:center;';
    colorLink.parentNode.insertBefore(chosenBadge, colorLink.nextSibling);

    // Hidden input to include color in form data
    var colorInput = document.querySelector('#novus-contact-form input[name="couleur"]');
    if (!colorInput) {
      colorInput = document.createElement('input');
      colorInput.type = 'hidden';
      colorInput.name = 'couleur';
      var form = document.getElementById('novus-contact-form');
      if (form) form.appendChild(colorInput);
    }

    // Check URL params for color (cross-domain fallback since localStorage doesn't share)
    (function() {
      try {
        var params = new URLSearchParams(window.location.search);
        var colorName = params.get('color');
        var colorCode = params.get('code');
        if (colorName) {
          var data = { name: colorName, code: colorCode || '', type: params.get('type') || '', ts: Date.now() };
          localStorage.setItem('ne_color_chosen', JSON.stringify(data));
          // Clean URL params without reloading
          var clean = window.location.pathname + window.location.hash;
          window.history.replaceState({}, '', clean);
        }
      } catch(e) {}
    })();

    function showChosenColor() {
      try {
        var stored = localStorage.getItem('ne_color_chosen');
        if (stored) {
          var data = JSON.parse(stored);
          // Only show if chosen less than 2 hours ago
          if (data.name && data.ts && (Date.now() - data.ts) < 7200000) {
            chosenBadge.textContent = '\u2705 Couleur choisie: ' + data.name + (data.code ? ' (' + data.code + ')' : '');
            chosenBadge.style.display = 'block';
            if (colorInput) colorInput.value = data.name + (data.code ? ' (' + data.code + ')' : '');
            return;
          }
        }
      } catch(e) {}
      chosenBadge.style.display = 'none';
      if (colorInput) colorInput.value = '';
    }
    showChosenColor();
    // Check again when user comes back from color page tab
    window.addEventListener('focus', showChosenColor);
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) showChosenColor();
    });
    // Also poll every 2 seconds in case events don't fire
    setInterval(showChosenColor, 2000);
  }

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
      { src: CDN + 'metallique-commercial-1.jpg', title: 'Plancher m\u00e9tallique commercial', type: 'M\u00e9tallique' },
      { src: CDN + 'metallique-commercial-2.jpg', title: 'Espace commercial \u00e9poxy noir et or', type: 'M\u00e9tallique' },
      { src: CDN + 'metallique-closeup-or.jpg', title: 'Finition m\u00e9tallique or \u2014 effet miroir', type: 'M\u00e9tallique' },
      { src: CDN + 'metallique-texture-or-noir.jpg', title: 'Texture veines or et noir', type: 'M\u00e9tallique' },
      { src: CDN + 'metallique-brillant.jpg', title: 'Plancher m\u00e9tallique brillant', type: 'M\u00e9tallique' },
      { src: CDN + 'metallique-or-angle.jpg', title: '\u00c9poxy m\u00e9tallique or \u2014 vue rapproch\u00e9e', type: 'M\u00e9tallique' },
      { src: CDN + 'metallique-marbre-blanc.jpg', title: 'Sous-sol m\u00e9tallique marbr\u00e9 blanc', type: 'M\u00e9tallique' },
      { src: CDN + 'couleur-unie-blanc.jpg', title: 'Plancher couleur unie blanc brillant', type: 'Couleur unie' },
      { src: CDN + 'metallique-multicolore.jpg', title: 'M\u00e9tallique turquoise, or et rouge', type: 'M\u00e9tallique' },
      { src: CDN + 'flake-sous-sol-gris.jpg', title: 'Garage double finition flake gris', type: 'Flake' },
      { src: CDN + 'flake-garage-pierre.jpg', title: 'Garage flake gris \u2014 fini professionnel', type: 'Flake' },
      { src: CDN + 'metallique-brillant.jpg', title: 'M\u00e9tallique noir et argent \u2014 effet miroir', type: 'M\u00e9tallique' },
      { src: CDN + 'metallique-commercial-1.jpg', title: 'Cuisine commerciale \u00e9poxy gris', type: 'Commercial' },
      { src: CDN + 'metallique-or-angle.jpg', title: 'Grand espace m\u00e9tallique noir et or', type: 'M\u00e9tallique' },
      { src: CDN + 'flake-garage-pierre.jpg', title: 'Escalier entr\u00e9e finition flake', type: 'Flake' },
      { src: CDN + 'flake-sous-sol-gris.jpg', title: 'Balcon ext\u00e9rieur finition flake', type: 'Flake' },
      { src: CDN + 'metallique-texture-or-noir.jpg', title: 'Garage flake noir \u2014 style showroom', type: 'Flake' },
      { src: CDN + 'flake-garage-pierre.jpg', title: 'Garage double flake bleu-gris', type: 'Flake' },
      { src: CDN + 'flake-sous-sol-gris.jpg', title: 'Sous-sol r\u00e9sidentiel flake gris', type: 'Flake' }
    ];

    // Filter buttons
    var types = ['Tout', 'M\u00e9tallique', 'Flake', 'Commercial', 'Couleur unie'];
    var filterBar = document.createElement('div');
    filterBar.style.cssText = 'display:flex;justify-content:center;gap:10px;padding:10px 5%;max-width:1400px;margin:0 auto;flex-wrap:wrap;';
    var activeFilter = 'Tout';

    function renderGallery(filter) {
      activeFilter = filter;
      // Update button styles
      filterBar.querySelectorAll('button').forEach(function(btn) {
        var isActive = btn.textContent === filter;
        btn.style.cssText = 'padding:8px 20px;border-radius:25px;border:2px solid #c8a96e;cursor:pointer;font-weight:600;font-size:14px;transition:all 0.3s;' +
          (isActive ? 'background:#c8a96e;color:#000;' : 'background:transparent;color:#c8a96e;');
      });
      // Filter photos
      grid.innerHTML = '';
      var filtered = filter === 'Tout' ? photos : photos.filter(function(p) { return p.type === filter; });
      filtered.forEach(function(p) { grid.appendChild(createCard(p)); });
    }

    types.forEach(function(t) {
      var btn = document.createElement('button');
      btn.textContent = t;
      btn.addEventListener('click', function() { renderGallery(t); });
      filterBar.appendChild(btn);
    });

    var grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;padding:20px 5%;max-width:1400px;margin:0 auto;';

    function createCard(p) {
      var card = document.createElement('div');
      card.style.cssText = 'position:relative;border-radius:12px;overflow:hidden;cursor:pointer;box-shadow:0 4px 15px rgba(0,0,0,0.2);transition:transform 0.3s;';
      card.onmouseenter = function() { this.style.transform = 'scale(1.03)'; };
      card.onmouseleave = function() { this.style.transform = 'scale(1)'; };

      var img = document.createElement('img');
      img.src = p.src;
      img.alt = p.title;
      img.loading = 'lazy';
      img.style.cssText = 'width:100%;height:280px;object-fit:cover;display:block;';

      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:absolute;bottom:0;left:0;right:0;padding:12px 16px;background:linear-gradient(transparent,rgba(0,0,0,0.8));color:#fff;';
      overlay.innerHTML = '<div style="font-weight:600;font-size:14px;">' + p.title + '</div><div style="font-size:12px;opacity:0.8;margin-top:2px;">' + p.type + '</div>';

      card.appendChild(img);
      card.appendChild(overlay);

      // Lightbox on click
      card.addEventListener('click', function() {
        var lb = document.createElement('div');
        lb.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:pointer;';
        var bigImg = document.createElement('img');
        bigImg.src = p.src;
        bigImg.style.cssText = 'max-width:90%;max-height:90%;border-radius:8px;box-shadow:0 0 40px rgba(0,0,0,0.5);';
        lb.appendChild(bigImg);
        lb.addEventListener('click', function() { document.body.removeChild(lb); });
        document.body.appendChild(lb);
      });
      return card;
    }

    // Initial render with all photos
    renderGallery('Tout');

    // Clear existing content and add gallery
    var existingContent = gallerySection.querySelector('.gallery-grid, .portfolio-grid');
    if (existingContent) {
      existingContent.parentNode.replaceChild(filterBar, existingContent);
      filterBar.parentNode.insertBefore(grid, filterBar.nextSibling);
    } else {
      gallerySection.appendChild(filterBar);
      gallerySection.appendChild(grid);
    }

    // ── Video section — only featured videos (quality 9-10/10) ──
    fetch('https://novus-epoxy.vercel.app/api/portfolio/videos')
      .then(function(res) { return res.json(); })
      .then(function(videos) {
        if (!videos || !videos.length) return;

        var section = document.createElement('div');
        section.style.cssText = 'margin-top:60px;padding:0 5%;max-width:1400px;margin-left:auto;margin-right:auto;';

        var title = document.createElement('h3');
        title.textContent = 'Nos r\u00e9alisations en vid\u00e9o';
        title.style.cssText = 'text-align:center;color:#c8a96e;font-size:28px;font-weight:700;margin-bottom:8px;';

        var sub = document.createElement('p');
        sub.textContent = 'D\u00e9couvrez le rendu r\u00e9el de nos planchers \u00e9poxy';
        sub.style.cssText = 'text-align:center;color:#999;font-size:16px;margin-bottom:30px;';

        var vGrid = document.createElement('div');
        vGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:20px;';

        section.appendChild(title);
        section.appendChild(sub);
        section.appendChild(vGrid);

        var typeMap = { 'flake': 'Flake', 'metallique': 'M\u00e9tallique', 'commercial': 'Commercial', 'couleur_unie': 'Couleur unie', 'quartz': 'Quartz' };

        videos.forEach(function(v) {
          var card = document.createElement('div');
          card.style.cssText = 'border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.3);background:#111;';

          var vid = document.createElement('video');
          vid.src = v.url;
          vid.setAttribute('controls', '');
          vid.setAttribute('preload', 'metadata');
          vid.setAttribute('playsinline', '');
          vid.muted = true;
          vid.style.cssText = 'width:100%;height:300px;object-fit:cover;display:block;background:#000;';

          var info = document.createElement('div');
          info.style.cssText = 'padding:14px 16px;';
          info.innerHTML = '<div style="font-weight:600;font-size:15px;color:#fff;">' + v.titre + '</div>' +
            '<div style="font-size:13px;color:#c8a96e;margin-top:4px;">' + (typeMap[v.type] || v.type) + '</div>';

          card.appendChild(vid);
          card.appendChild(info);
          vGrid.appendChild(card);
        });

        grid.parentNode.insertBefore(section, grid.nextSibling);
      })
      .catch(function() { /* no videos yet */ });
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
