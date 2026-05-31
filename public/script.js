// ==========================================
// Gemini Math Mobile - Client Script (ES5)
// ==========================================

(function () {
  // ── DOM elements ────────────────────────────────────────────────────────────
  var chatForm         = document.getElementById('chat-form');
  var chatInput        = document.getElementById('chat-input');
  var chatContainer    = document.getElementById('chat-container');
  var chatMessages     = document.getElementById('chat-messages');
  var providerSelect   = document.getElementById('provider-select');
  var cameraBtn        = document.getElementById('camera-btn');
  var imageInput       = document.getElementById('image-input');
  var imagePreviewBar  = document.getElementById('image-preview-bar');
  var clearImageBtn    = document.getElementById('clear-image-btn');
  var sidebarToggle    = document.getElementById('sidebar-toggle');
  var historySidebar   = document.getElementById('history-sidebar');
  var sidebarOverlay   = document.getElementById('sidebar-overlay');
  var historyList      = document.getElementById('history-list');
  var newChatBtn       = document.getElementById('new-chat-btn');
  var geminiKeySelect  = document.getElementById('gemini-key-select');

  // ── State ────────────────────────────────────────────────────────────────────
  var currentBase64   = null;
  var currentSessionId = null;   // active session ID (null = unsaved new chat)
  var sessionMessages = [];      // [{role, text, imgBase64?}] — in-memory log

  // ── Utilities ────────────────────────────────────────────────────────────────

  function generateId() {
    return 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  }

  function escapeHTML(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function scrollToBottom() {
    setTimeout(function () {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }, 50);
  }

  function renderMath(element) {
    if (window.renderMathInElement) {
      window.renderMathInElement(element, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$',  right: '$',  display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true }
        ],
        throwOnError: false
      });
    }
  }

  function resetImageState() {
    currentBase64 = null;
    imageInput.value = '';
    imagePreviewBar.style.display = 'none';
  }

  function formatDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleDateString('es', { day: '2-digit', month: 'short' }) +
           ' ' + d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  }

  // Derive a title from the first user message (truncated)
  function titleFromMessages(messages) {
    for (var i = 0; i < messages.length; i++) {
      if (messages[i].role === 'user' && messages[i].text) {
        var t = messages[i].text.trim().slice(0, 40);
        return t + (messages[i].text.length > 40 ? '…' : '');
      }
    }
    return 'Sin título';
  }

  // ── DOM helpers ──────────────────────────────────────────────────────────────

  function appendMessage(sender, text, isSystem, imgBase64) {
    var msgDiv = document.createElement('div');
    msgDiv.className = isSystem ? 'message system-message' : 'message ' + sender + '-message';

    var contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    if (imgBase64 && sender === 'user') {
      var imgEl = document.createElement('img');
      imgEl.src = imgBase64;
      imgEl.className = 'user-msg-image';
      contentDiv.appendChild(imgEl);
    }

    var textSpan = document.createElement('span');
    if (isSystem) {
      textSpan.innerHTML = text;
    } else {
      textSpan.innerHTML = escapeHTML(text).replace(/\n/g, '<br>');
    }
    contentDiv.appendChild(textSpan);
    msgDiv.appendChild(contentDiv);
    chatMessages.appendChild(msgDiv);

    if (!isSystem) renderMath(contentDiv);
    scrollToBottom();
    return msgDiv;
  }

  function appendTypingIndicator() {
    var msgDiv = document.createElement('div');
    msgDiv.className = 'message assistant-message typing-indicator-wrapper';
    var indicator = document.createElement('div');
    indicator.className = 'typing-indicator';
    for (var i = 0; i < 3; i++) {
      var dot = document.createElement('div');
      dot.className = 'typing-dot';
      indicator.appendChild(dot);
    }
    msgDiv.appendChild(indicator);
    chatMessages.appendChild(msgDiv);
    scrollToBottom();
    return msgDiv;
  }

  // Rebuild the chat UI from sessionMessages array
  function renderSessionMessages() {
    chatMessages.innerHTML = '';
    for (var i = 0; i < sessionMessages.length; i++) {
      var m = sessionMessages[i];
      if (m.role === 'system') {
        appendMessage('system', m.text, true);
      } else {
        appendMessage(m.role, m.text, false, m.imgBase64 || null);
      }
    }
  }

  // ── Sidebar ──────────────────────────────────────────────────────────────────

  function openSidebar() {
    historySidebar.className = 'history-sidebar open';
    sidebarOverlay.className = 'sidebar-overlay active';
    loadHistoryList();
  }

  function closeSidebar() {
    historySidebar.className = 'history-sidebar';
    sidebarOverlay.className = 'sidebar-overlay';
  }

  sidebarToggle.addEventListener('click', function () {
    if (historySidebar.className.indexOf('open') !== -1) {
      closeSidebar();
    } else {
      openSidebar();
    }
  });

  sidebarOverlay.addEventListener('click', closeSidebar);

  // ── History API calls ────────────────────────────────────────────────────────

  function loadHistoryList() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/history', true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4 && xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          renderHistoryList(data.sessions || []);
        } catch (e) {}
      }
    };
    xhr.send();
  }

  function renderHistoryList(sessions) {
    if (!sessions.length) {
      historyList.innerHTML = '<p class="history-empty">Sin conversaciones guardadas.</p>';
      return;
    }

    historyList.innerHTML = '';
    sessions.forEach(function (s) {
      var item = document.createElement('div');
      item.className = 'history-item' + (s.id === currentSessionId ? ' active' : '');
      item.setAttribute('data-id', s.id);

      var info = document.createElement('div');
      info.className = 'history-item-info';

      var title = document.createElement('div');
      title.className = 'history-item-title';
      title.textContent = s.title;

      var meta = document.createElement('div');
      meta.className = 'history-item-meta';
      meta.textContent = formatDate(s.updatedAt) + ' · ' + s.messageCount + ' msg';

      info.appendChild(title);
      info.appendChild(meta);

      var delBtn = document.createElement('button');
      delBtn.className = 'history-item-delete';
      delBtn.textContent = '✕';
      delBtn.setAttribute('data-id', s.id);
      delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteSession(this.getAttribute('data-id'));
      });

      item.appendChild(info);
      item.appendChild(delBtn);

      item.addEventListener('click', function () {
        loadSession(this.getAttribute('data-id'));
      });

      historyList.appendChild(item);
    });
  }

  function saveCurrentSession() {
    if (!sessionMessages.length) return;

    if (!currentSessionId) {
      currentSessionId = generateId();
    }

    var payload = JSON.stringify({
      title: titleFromMessages(sessionMessages),
      messages: sessionMessages
    });

    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/history/' + currentSessionId, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(payload);
  }

  function loadSession(id) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/history/' + id, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4 && xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          currentSessionId = data.id;
          sessionMessages = data.messages || [];
          renderSessionMessages();
          closeSidebar();
        } catch (e) {}
      }
    };
    xhr.send();
  }

  function deleteSession(id) {
    var xhr = new XMLHttpRequest();
    xhr.open('DELETE', '/api/history/' + id, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        if (id === currentSessionId) {
          startNewChat();
        }
        loadHistoryList();
      }
    };
    xhr.send();
  }

  function startNewChat() {
    currentSessionId = null;
    sessionMessages = [];
    chatMessages.innerHTML = '';
    appendMessage('system',
      '<strong>¡Bienvenido a Gemini Math Mobile!</strong><br>' +
      'Diseñado especialmente para iOS 10. Selecciona modelos en la nube o sube imágenes con Gemini 2.5 Flash.',
      true
    );
    resetImageState();
    closeSidebar();
  }

  newChatBtn.addEventListener('click', startNewChat);

  // ── Send message ─────────────────────────────────────────────────────────────

  function sendMessage() {
    var messageText = chatInput.value.trim();
    if (!messageText && !currentBase64) return;

    var provider = providerSelect.value;

    if (!messageText && currentBase64) {
      messageText = 'Resuelve y analiza este problema matemático.';
    }

    var sentImage = currentBase64;

    // Add to in-memory log
    sessionMessages.push({ role: 'user', text: messageText, imgBase64: sentImage || null });

    appendMessage('user', messageText, false, sentImage);
    chatInput.value = '';
    resetImageState();
    chatInput.focus();

    var typingBubble = appendTypingIndicator();

    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/chat', true);
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        if (typingBubble && typingBubble.parentNode) {
          typingBubble.parentNode.removeChild(typingBubble);
        }

        if (xhr.status === 200) {
          try {
            var responseData = JSON.parse(xhr.responseText);
            var aiResponse = responseData.response || '';
            sessionMessages.push({ role: 'assistant', text: aiResponse });
            appendMessage('assistant', aiResponse, false);
            saveCurrentSession(); // auto-save after each exchange
          } catch (e) {
            appendMessage('system', 'Error al procesar la respuesta del servidor.', true);
          }
        } else {
          var errorMsg = 'Error en la petición.';
          try {
            var errData = JSON.parse(xhr.responseText);
            if (errData && errData.error) errorMsg = errData.error;
          } catch (e) {}
          appendMessage('system', '<strong>Error:</strong> ' + escapeHTML(errorMsg), true);
        }
      }
    };

    xhr.send(JSON.stringify({
      message: messageText,
      provider: provider,
      image: sentImage,
      geminiKey: provider === 'gemini' ? geminiKeySelect.value : undefined
    }));
  }

  // ── Image upload ─────────────────────────────────────────────────────────────

  cameraBtn.addEventListener('click', function () {
    imageInput.click();
  });

  imageInput.addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (evt) {
      currentBase64 = evt.target.result;
      imagePreviewBar.style.display = 'flex';
      scrollToBottom();
    };
    reader.readAsDataURL(file);
  });

  clearImageBtn.addEventListener('click', function () {
    resetImageState();
  });

  // ── Form events ───────────────────────────────────────────────────────────────

  chatForm.addEventListener('submit', function (e) {
    e.preventDefault();
    sendMessage();
  });

  chatInput.addEventListener('keydown', function (e) {
    if (e.keyCode === 13 && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Show key selector only when Gemini is active
  function updateGeminiKeyVisibility() {
    geminiKeySelect.style.display = providerSelect.value === 'gemini' ? 'block' : 'none';
  }
  providerSelect.addEventListener('change', updateGeminiKeyVisibility);
  updateGeminiKeyVisibility();

  // ── Init ──────────────────────────────────────────────────────────────────────
  scrollToBottom();
})();