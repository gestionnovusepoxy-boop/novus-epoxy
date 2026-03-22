(function() {
  var API = 'https://novus-epoxy.vercel.app';
  var visitorId = localStorage.getItem('ne_vid') || ('v_' + Math.random().toString(36).slice(2) + Date.now().toString(36));
  localStorage.setItem('ne_vid', visitorId);

  // Inject styles
  var style = document.createElement('style');
  style.textContent = `
    #ne-chat-btn { position:fixed; bottom:24px; right:24px; width:60px; height:60px; border-radius:50%; background:linear-gradient(135deg,#f59e0b,#d97706); border:none; cursor:pointer; box-shadow:0 4px 20px rgba(245,158,11,0.4); z-index:9999; display:flex; align-items:center; justify-content:center; transition:transform 0.2s; }
    #ne-chat-btn:hover { transform:scale(1.1); }
    #ne-chat-btn svg { width:28px; height:28px; fill:white; }
    #ne-chat-box { position:fixed; bottom:96px; right:24px; width:380px; max-height:520px; background:#0f172a; border:1px solid #334155; border-radius:16px; box-shadow:0 10px 40px rgba(0,0,0,0.5); z-index:9999; display:none; flex-direction:column; overflow:hidden; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
    #ne-chat-box.open { display:flex; }
    #ne-chat-header { background:#1e293b; padding:16px; border-bottom:1px solid #334155; display:flex; align-items:center; justify-content:space-between; }
    #ne-chat-header h3 { color:white; font-size:15px; font-weight:600; margin:0; }
    #ne-chat-header span { color:#f59e0b; font-size:11px; }
    #ne-chat-header button { background:none; border:none; color:#94a3b8; cursor:pointer; font-size:26px; padding:4px 6px; }
    #ne-chat-header button:hover { color:#f59e0b; }
    #ne-chat-msgs { flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:12px; max-height:340px; }
    #ne-chat-msgs::-webkit-scrollbar { width:4px; }
    #ne-chat-msgs::-webkit-scrollbar-thumb { background:#334155; border-radius:4px; }
    .ne-msg { max-width:85%; padding:10px 14px; border-radius:12px; font-size:14px; line-height:1.5; word-wrap:break-word; }
    .ne-msg.user { background:#f59e0b; color:#0f172a; align-self:flex-end; border-bottom-right-radius:4px; }
    .ne-msg.assistant { background:#1e293b; color:#e2e8f0; align-self:flex-start; border-bottom-left-radius:4px; }
    .ne-msg.typing { color:#64748b; font-style:italic; }
    .ne-msg img { max-width:100%; border-radius:8px; margin-top:4px; cursor:pointer; }
    .ne-quick { display:flex; flex-wrap:wrap; gap:6px; align-self:flex-start; max-width:90%; }
    .ne-quick button { background:#1e293b; border:1px solid #f59e0b; color:#f59e0b; border-radius:20px; padding:6px 14px; font-size:13px; cursor:pointer; transition:all 0.2s; font-family:inherit; }
    .ne-quick button:hover { background:#f59e0b; color:#0f172a; }
    #ne-chat-input { display:flex; padding:12px; border-top:1px solid #334155; gap:8px; align-items:center; }
    #ne-chat-input input[type="text"] { flex:1; background:#1e293b; border:1px solid #334155; border-radius:8px; padding:10px 14px; color:white; font-size:14px; outline:none; }
    #ne-chat-input input[type="text"]:focus { border-color:#f59e0b; }
    #ne-chat-input input[type="text"]::placeholder { color:#64748b; }
    #ne-chat-input button { background:#f59e0b; border:none; border-radius:8px; padding:10px 16px; cursor:pointer; display:flex; align-items:center; }
    #ne-chat-input button:disabled { opacity:0.5; cursor:default; }
    #ne-chat-input button svg { width:18px; height:18px; fill:#0f172a; }
    #ne-chat-photo-btn { background:none !important; border:none; padding:8px; cursor:pointer; display:flex; align-items:center; }
    #ne-chat-input #ne-chat-photo-btn svg { width:26px; height:26px; fill:#f59e0b !important; }
    #ne-chat-input #ne-chat-photo-btn:hover svg { fill:#fbbf24 !important; }
    @media(max-width:480px) { #ne-chat-box { right:8px; left:8px; bottom:80px; width:auto; max-height:70vh; } }
  `;
  document.head.appendChild(style);

  // Chat button
  var btn = document.createElement('button');
  btn.id = 'ne-chat-btn';
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>';
  document.body.appendChild(btn);

  // Chat box
  var box = document.createElement('div');
  box.id = 'ne-chat-box';
  box.innerHTML = `
    <div id="ne-chat-header">
      <div><h3>Nova — Novus Epoxy</h3><span>En ligne</span></div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button id="ne-chat-reset" title="Recommencer">↺</button>
        <button id="ne-chat-close">&times;</button>
      </div>
    </div>
    <div id="ne-chat-msgs"></div>
    <div id="ne-chat-input">
      <button id="ne-chat-photo-btn" title="Envoyer une photo"><svg viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg></button>
      <input type="file" id="ne-chat-file" accept="image/*" style="display:none;" />
      <input type="text" id="ne-chat-field" placeholder="Ecrivez votre message..." autocomplete="off" />
      <button id="ne-chat-send"><svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>
    </div>
  `;
  document.body.appendChild(box);

  var msgs = document.getElementById('ne-chat-msgs');
  var field = document.getElementById('ne-chat-field');
  var sendBtn = document.getElementById('ne-chat-send');
  var photoBtn = document.getElementById('ne-chat-photo-btn');
  var fileInput = document.getElementById('ne-chat-file');
  var isOpen = false;
  var sending = false;

  function addMsg(role, text) {
    var div = document.createElement('div');
    div.className = 'ne-msg ' + role;

    // Check if message contains an image URL (from photo upload)
    var imgMatch = text.match(/\[Photo envoy[ée]+e?\]\s*(https?:\/\/[^\s]+)/i);
    if (imgMatch) {
      var img = document.createElement('img');
      img.src = imgMatch[1];
      img.alt = 'Photo';
      img.onclick = function() { window.open(img.src, '_blank'); };
      div.appendChild(img);
      msgs.appendChild(div);
      msgs.scrollTop = msgs.scrollHeight;
      return div;
    }

    // Make links clickable in assistant messages (safe DOM manipulation)
    if (role === 'assistant' && text.match(/https?:\/\//)) {
      var parts = text.split(/(https?:\/\/[^\s]+)/g);
      parts.forEach(function(part) {
        if (part.match(/^https?:\/\//)) {
          var a = document.createElement('a');
          a.href = part;
          a.textContent = part;
          a.target = '_blank';
          a.rel = 'noopener';
          a.style.cssText = 'color:#f59e0b;text-decoration:underline;word-break:break-all;';
          div.appendChild(a);
        } else {
          div.appendChild(document.createTextNode(part));
        }
      });
    } else {
      div.textContent = text;
    }
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  function addQuickReplies(options) {
    var div = document.createElement('div');
    div.className = 'ne-quick';
    options.forEach(function(opt) {
      var b = document.createElement('button');
      b.textContent = opt;
      b.addEventListener('click', function() {
        div.remove();
        field.value = opt;
        sendMessage();
      });
      div.appendChild(b);
    });
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  // Detect which quick replies to show based on the last assistant message
  function showQuickRepliesForMsg(text) {
    var lower = text.toLowerCase();
    var hasLink = lower.includes('novus-epoxy.vercel.app/couleurs');
    // Remove existing quick replies first
    var existing = msgs.querySelectorAll('.ne-quick');
    existing.forEach(function(q) { q.remove(); });

    // Skip quick replies for questions about measurements/pi²
    if ((lower.includes('pied') || lower.includes('pi²') || lower.includes('mesure')) && lower.includes('?')) {
      return;
    }

    if (lower.includes('quel') && (lower.includes('espace') || lower.includes('piece') || lower.includes('endroit')) && lower.includes('?')) {
      addQuickReplies(['Garage', 'Sous-sol', 'Balcon', 'Commercial', 'Industriel']);
    } else if ((lower.includes('quel type') || lower.includes('quel style') || lower.includes('quel fini')) && lower.includes('?') && !hasLink) {
      addQuickReplies(['Flocon', 'Metallique', 'Couleur unie', 'Antiderapant', 'Commercial']);
    } else if ((lower.includes('surface') || lower.includes('plancher') || lower.includes('sol') || lower.includes('beton') || lower.includes('etat')) && lower.includes('?') && !hasLink) {
      addQuickReplies(['Beton', 'Bois', 'Peinture existante', 'Epoxy a refaire']);
    } else if (lower.includes('parler') && (lower.includes('humain') || lower.includes('quelqu'))) {
      addQuickReplies(['Oui, parler a quelqu\'un', 'Non ca va, continue']);
    } else if ((lower.includes('tout est exact') || lower.includes('est-ce que tout') || lower.includes('confirmer') || lower.includes('tout est bon') || lower.includes('est-ce exact')) && lower.includes('?')) {
      addQuickReplies(['Oui c\'est exact!', 'Non, corriger']);
    }
  }

  function showWelcome() {
    addMsg('assistant', 'Salut! Moi c\'est Nova de Novus Epoxy. C\'est pour quel type d\'espace que tu regardes de l\'epoxy?');
    addQuickReplies(['Garage', 'Sous-sol', 'Balcon', 'Commercial', 'Industriel']);
  }

  // Load history
  function loadHistory() {
    fetch(API + '/api/chat/history?visitor_id=' + encodeURIComponent(visitorId))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.messages && data.messages.length > 0) {
          data.messages.forEach(function(m) { addMsg(m.role, m.content); });
          knownMsgCount = data.messages.length;
          // Show quick replies for the last assistant message
          var lastA = data.messages.filter(function(m) { return m.role === 'assistant'; }).pop();
          if (lastA) showQuickRepliesForMsg(lastA.content);
        } else {
          showWelcome();
        }
      })
      .catch(function() {
        showWelcome();
      });
  }

  function sendMessage() {
    var text = field.value.trim();
    if (!text || sending) return;
    sending = true;
    sendBtn.disabled = true;
    field.value = '';

    // Remove any quick reply buttons
    var quickBtns = msgs.querySelectorAll('.ne-quick');
    quickBtns.forEach(function(q) { q.remove(); });

    addMsg('user', text);
    var typing = addMsg('assistant', '...');
    typing.classList.add('typing');

    fetch(API + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, visitor_id: visitorId })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      msgs.removeChild(typing);
      var reply = data.reply || 'Desolee, une erreur est survenue.';
      addMsg('assistant', reply);
      // Update count so polling doesn't duplicate these messages
      knownMsgCount += 2;

      // Show contextual quick replies based on Nova's response
      showQuickRepliesForMsg(reply);
    })
    .catch(function() {
      msgs.removeChild(typing);
      addMsg('assistant', 'Erreur de connexion. Reessayez.');
    })
    .finally(function() {
      sending = false;
      sendBtn.disabled = false;
      field.focus();
    });
  }

  // Photo upload
  photoBtn.addEventListener('click', function() {
    if (sending) return;
    fileInput.click();
  });

  fileInput.addEventListener('change', function() {
    var file = fileInput.files[0];
    if (!file || sending) return;
    fileInput.value = '';

    sending = true;
    sendBtn.disabled = true;

    // Remove any quick reply buttons
    var quickBtns = msgs.querySelectorAll('.ne-quick');
    quickBtns.forEach(function(q) { q.remove(); });

    // Show image preview immediately
    var previewDiv = document.createElement('div');
    previewDiv.className = 'ne-msg user';
    var previewImg = document.createElement('img');
    previewImg.style.cssText = 'max-width:100%;border-radius:8px;opacity:0.6;';
    previewImg.alt = 'Envoi en cours...';
    var reader = new FileReader();
    reader.onload = function(e) { previewImg.src = e.target.result; };
    reader.readAsDataURL(file);
    previewDiv.appendChild(previewImg);
    msgs.appendChild(previewDiv);
    msgs.scrollTop = msgs.scrollHeight;

    var typing = addMsg('assistant', '...');
    typing.classList.add('typing');

    var formData = new FormData();
    formData.append('photo', file);
    formData.append('visitor_id', visitorId);

    fetch(API + '/api/chat/upload', {
      method: 'POST',
      body: formData
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      // Update preview to full opacity
      previewImg.style.opacity = '1';
      msgs.removeChild(typing);

      if (data.reply) {
        addMsg('assistant', data.reply);
      }
    })
    .catch(function() {
      previewImg.style.opacity = '1';
      msgs.removeChild(typing);
      addMsg('assistant', 'Erreur lors de l\'envoi de la photo. Reessayez.');
    })
    .finally(function() {
      sending = false;
      sendBtn.disabled = false;
    });
  });

  function openChat() {
    if (isOpen) return;
    isOpen = true;
    box.classList.add('open');
    if (msgs.children.length === 0) loadHistory();
  }

  btn.addEventListener('click', function() {
    if (isOpen) {
      isOpen = false;
      box.classList.remove('open');
    } else {
      openChat();
      field.focus();
    }
  });

  document.getElementById('ne-chat-close').addEventListener('click', function() {
    isOpen = false;
    box.classList.remove('open');
  });

  document.getElementById('ne-chat-reset').addEventListener('click', function() {
    localStorage.removeItem('ne_vid');
    visitorId = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('ne_vid', visitorId);
    msgs.innerHTML = '';
    showWelcome();
  });

  sendBtn.addEventListener('click', sendMessage);
  field.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') sendMessage();
  });

  // Poll for new admin replies every 8s when chat is open
  var knownMsgCount = 0;
  setInterval(function() {
    if (!isOpen || sending) return;
    fetch(API + '/api/chat/history?visitor_id=' + encodeURIComponent(visitorId))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.messages) return;
        if (knownMsgCount === 0) {
          knownMsgCount = data.messages.length;
          return;
        }
        if (data.messages.length > knownMsgCount) {
          var newMsgs = data.messages.slice(knownMsgCount);
          newMsgs.forEach(function(m) { addMsg(m.role, m.content); });
          knownMsgCount = data.messages.length;
          // Show quick replies for the last assistant message
          var lastAssistant = newMsgs.filter(function(m) { return m.role === 'assistant'; }).pop();
          if (lastAssistant) showQuickRepliesForMsg(lastAssistant.content);
        }
      })
      .catch(function() {});
  }, 8000);

  // Fast poll when waiting for color choice — check every 2s for 2min after link clicked
  var fastPollTimer = null;
  var waitingForColor = false;
  function startFastPoll() {
    waitingForColor = true;
    if (fastPollTimer) return;
    var elapsed = 0;
    fastPollTimer = setInterval(function() {
      elapsed += 2000;
      if (elapsed > 120000) { clearInterval(fastPollTimer); fastPollTimer = null; waitingForColor = false; return; }
      fetch(API + '/api/chat/history?visitor_id=' + encodeURIComponent(visitorId))
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (!data.messages || data.messages.length <= knownMsgCount) return;
          // Clear chat and reload all messages to avoid duplicates
          msgs.innerHTML = '';
          data.messages.forEach(function(m) { addMsg(m.role, m.content); });
          knownMsgCount = data.messages.length;
          // Show quick replies for the last assistant message
          var lastA = data.messages.filter(function(m) { return m.role === 'assistant'; }).pop();
          if (lastA) showQuickRepliesForMsg(lastA.content);
          clearInterval(fastPollTimer);
          fastPollTimer = null;
        })
        .catch(function() {});
    }, 2000);
  }

  // Intercept clicks on color catalog links to start fast polling
  msgs.addEventListener('click', function(e) {
    var target = e.target;
    if (target.tagName === 'A' && target.href && target.href.includes('/couleurs')) {
      startFastPoll();
    }
  });

  // Check for new messages (used on focus/visibility change)
  function refreshMessages() {
    fetch(API + '/api/chat/history?visitor_id=' + encodeURIComponent(visitorId))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.messages || data.messages.length <= knownMsgCount) return;
        msgs.innerHTML = '';
        data.messages.forEach(function(m) { addMsg(m.role, m.content); });
        knownMsgCount = data.messages.length;
        waitingForColor = false;
        // Show quick replies for the last assistant message
        var lastA = data.messages.filter(function(m) { return m.role === 'assistant'; }).pop();
        if (lastA) showQuickRepliesForMsg(lastA.content);
      })
      .catch(function() {});
  }

  // When user returns to this tab — always check for new messages
  window.addEventListener('focus', refreshMessages);
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) refreshMessages();
  });

  // Detect return from color selection page (chatResume parameter)
  var urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('chatResume')) {
    // Clean URL without reload
    history.replaceState({}, '', window.location.pathname);
    // Force reload all messages and open chat
    setTimeout(function() {
      // Clear existing content so loadHistory runs fresh
      msgs.innerHTML = '';
      knownMsgCount = 0;
      isOpen = false;
      openChat();
      // Also start fast polling in case Claude is still responding
      startFastPoll();
    }, 500);
  } else {
    // Auto-open after 5 seconds on every page load
    setTimeout(function() {
      openChat();
    }, 5000);
  }
})();
