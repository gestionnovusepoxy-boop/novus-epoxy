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
    #ne-chat-header button { background:none; border:none; color:#64748b; cursor:pointer; font-size:20px; padding:0 4px; }
    #ne-chat-msgs { flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:12px; max-height:340px; }
    #ne-chat-msgs::-webkit-scrollbar { width:4px; }
    #ne-chat-msgs::-webkit-scrollbar-thumb { background:#334155; border-radius:4px; }
    .ne-msg { max-width:85%; padding:10px 14px; border-radius:12px; font-size:14px; line-height:1.5; word-wrap:break-word; }
    .ne-msg.user { background:#f59e0b; color:#0f172a; align-self:flex-end; border-bottom-right-radius:4px; }
    .ne-msg.assistant { background:#1e293b; color:#e2e8f0; align-self:flex-start; border-bottom-left-radius:4px; }
    .ne-msg.typing { color:#64748b; font-style:italic; }
    .ne-quick { display:flex; flex-wrap:wrap; gap:6px; align-self:flex-start; max-width:90%; }
    .ne-quick button { background:#1e293b; border:1px solid #f59e0b; color:#f59e0b; border-radius:20px; padding:6px 14px; font-size:13px; cursor:pointer; transition:all 0.2s; font-family:inherit; }
    .ne-quick button:hover { background:#f59e0b; color:#0f172a; }
    #ne-chat-input { display:flex; padding:12px; border-top:1px solid #334155; gap:8px; }
    #ne-chat-input input { flex:1; background:#1e293b; border:1px solid #334155; border-radius:8px; padding:10px 14px; color:white; font-size:14px; outline:none; }
    #ne-chat-input input:focus { border-color:#f59e0b; }
    #ne-chat-input input::placeholder { color:#64748b; }
    #ne-chat-input button { background:#f59e0b; border:none; border-radius:8px; padding:10px 16px; cursor:pointer; display:flex; align-items:center; }
    #ne-chat-input button:disabled { opacity:0.5; cursor:default; }
    #ne-chat-input button svg { width:18px; height:18px; fill:#0f172a; }
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
      <div><h3>Novus Epoxy</h3><span>Assistant en ligne</span></div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button id="ne-chat-reset" style="background:none;border:none;color:#475569;cursor:pointer;font-size:11px;padding:0;">↺</button>
        <button id="ne-chat-close">&times;</button>
      </div>
    </div>
    <div id="ne-chat-msgs"></div>
    <div id="ne-chat-input">
      <input type="text" id="ne-chat-field" placeholder="Ecrivez votre message..." autocomplete="off" />
      <button id="ne-chat-send"><svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>
    </div>
  `;
  document.body.appendChild(box);

  var msgs = document.getElementById('ne-chat-msgs');
  var field = document.getElementById('ne-chat-field');
  var sendBtn = document.getElementById('ne-chat-send');
  var isOpen = false;
  var sending = false;

  function addMsg(role, text) {
    var div = document.createElement('div');
    div.className = 'ne-msg ' + role;
    div.textContent = text;
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

  function showWelcome() {
    addMsg('assistant', 'Bonjour! Quel type de plancher epoxy vous interesse?');
    addQuickReplies(['Flocon (Flake)', 'Metallique', 'Commercial', 'Je ne sais pas encore']);
  }

  // Load history
  function loadHistory() {
    fetch(API + '/api/chat/history?visitor_id=' + encodeURIComponent(visitorId))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.messages && data.messages.length > 0) {
          data.messages.forEach(function(m) { addMsg(m.role, m.content); });
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

      // Show quick replies based on context
      var lower = reply.toLowerCase();
      if (lower.includes('quel espace') || lower.includes('quelle piece') || lower.includes('quel endroit') || lower.includes('garage') && lower.includes('sous-sol') && lower.includes('?')) {
        addQuickReplies(['Garage', 'Sous-sol', 'Commercial / Entrepot', 'Autre']);
      } else if (lower.includes('etat') && (lower.includes('plancher') || lower.includes('beton') || lower.includes('sol'))) {
        addQuickReplies(['Beton brut', 'Peinture existante', 'Epoxy a refaire', 'Je ne sais pas']);
      } else if ((lower.includes('quel type') || lower.includes('quel style') || lower.includes('quel fini')) && !lower.includes('espace')) {
        addQuickReplies(['Flocon (Flake)', 'Metallique', 'Commercial']);
      }
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
    sessionStorage.removeItem('ne_chat_opened');
    visitorId = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('ne_vid', visitorId);
    msgs.innerHTML = '';
    showWelcome();
  });

  sendBtn.addEventListener('click', sendMessage);
  field.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') sendMessage();
  });

  // Auto-open after 3 seconds (only once per session)
  if (!sessionStorage.getItem('ne_chat_opened')) {
    setTimeout(function() {
      openChat();
      sessionStorage.setItem('ne_chat_opened', '1');
    }, 3000);
  }
})();
