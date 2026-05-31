// ==========================================
// Gemini Math Mobile - Client Script (ES5)
// ==========================================

(function () {
  // Grab DOM elements
  var chatForm = document.getElementById('chat-form');
  var chatInput = document.getElementById('chat-input');
  var sendButton = document.getElementById('send-button');
  var chatContainer = document.getElementById('chat-container');
  var chatMessages = document.getElementById('chat-messages');
  var providerSelect = document.getElementById('provider-select');
  
  // New Multimodal UI elements
  var cameraBtn = document.getElementById('camera-btn');
  var imageInput = document.getElementById('image-input');
  var imagePreviewBar = document.getElementById('image-preview-bar');
  var clearImageBtn = document.getElementById('clear-image-btn');

  // State variable for Base64 image
  var currentBase64 = null;

  // Simple HTML escaping helper
  function escapeHTML(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Scroll chat area to bottom
  function scrollToBottom() {
    setTimeout(function () {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }, 50);
  }

  // Render LaTeX math formulas inside a specific element
  function renderMath(element) {
    if (window.renderMathInElement) {
      window.renderMathInElement(element, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true }
        ],
        throwOnError: false
      });
    }
  }

  // Helper to reset selected image state
  function resetImageState() {
    currentBase64 = null;
    imageInput.value = '';
    imagePreviewBar.style.display = 'none';
  }

  // Append a message bubble to the chat (optional support for uploaded images)
  function appendMessage(sender, text, isSystem, imgBase64) {
    var msgDiv = document.createElement('div');
    
    if (isSystem) {
      msgDiv.className = 'message system-message';
    } else {
      msgDiv.className = 'message ' + sender + '-message';
    }

    var contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    // If an image was sent by the user, embed a visual preview of it first
    if (imgBase64 && sender === 'user') {
      var imgEl = document.createElement('img');
      imgEl.src = imgBase64;
      imgEl.className = 'user-msg-image';
      contentDiv.appendChild(imgEl);
    }

    // Process and add text content
    var textSpan = document.createElement('span');
    if (isSystem) {
      textSpan.innerHTML = text;
    } else {
      // Escape HTML for security, then swap newlines for breaks
      textSpan.innerHTML = escapeHTML(text).replace(/\n/g, '<br>');
    }
    contentDiv.appendChild(textSpan);

    msgDiv.appendChild(contentDiv);
    chatMessages.appendChild(msgDiv);
    
    // Render equations immediately on the new message element
    if (!isSystem) {
      renderMath(contentDiv);
    }
    
    scrollToBottom();
    return msgDiv;
  }

  // Append assistant loading indicator
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

  // Handles form submission
  function sendMessage() {
    var messageText = chatInput.value.trim();
    
    // Allow sending message if we have text or if we have an image
    if (!messageText && !currentBase64) return;

    var provider = providerSelect.value;

    // Block visual inputs on non-compatible cloud models client-side
    if (currentBase64 && provider !== 'gemini') {
      alert('La carga de fotos y análisis visual solo es compatible con el modelo Gemini 2.5 Flash.');
      return;
    }

    // Use default text if submitting image without text query
    if (!messageText && currentBase64) {
      messageText = "Resuelve y analiza este problema matemático.";
    }

    // 1. Display User Message with visual thumbnail if present
    var sentImage = currentBase64;
    appendMessage('user', messageText, false, sentImage);

    // 2. Clear input fields & reset input image preview
    chatInput.value = '';
    resetImageState();
    chatInput.focus();

    // 3. Display Typing indicator
    var typingBubble = appendTypingIndicator();

    // 4. Send request to server backend using standard ES5 XMLHttpRequest
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/chat', true);
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        // Remove typing bubble
        if (typingBubble && typingBubble.parentNode) {
          typingBubble.parentNode.removeChild(typingBubble);
        }

        if (xhr.status === 200) {
          try {
            var responseData = JSON.parse(xhr.responseText);
            var aiResponse = responseData.response || '';
            appendMessage('assistant', aiResponse, false);
          } catch (e) {
            appendMessage('system', 'Error al procesar la respuesta del servidor.', true);
          }
        } else {
          var errorMsg = 'Error en la petición.';
          try {
            var errData = JSON.parse(xhr.responseText);
            if (errData && errData.error) {
              errorMsg = errData.error;
            }
          } catch (e) {}
          appendMessage('system', '<strong>Error:</strong> ' + escapeHTML(errorMsg), true);
        }
      }
    };

    var payload = JSON.stringify({
      message: messageText,
      provider: provider,
      image: sentImage // Base64 string or null
    });

    xhr.send(payload);
  }

  // --- Image Upload Event Listeners ---

  // Trigger click on hidden file input
  cameraBtn.addEventListener('click', function () {
    imageInput.click();
  });

  // Handle selected file change
  imageInput.addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;

    // Check if the provider is Gemini before spending resources processing image
    var provider = providerSelect.value;
    if (provider !== 'gemini') {
      alert('La carga de imágenes solo está soportada por Gemini 2.5 Flash. Cambia de modelo para subir imágenes.');
      imageInput.value = '';
      return;
    }

    var reader = new FileReader();
    reader.onload = function (evt) {
      currentBase64 = evt.target.result; // Data URL string containing Base64 data
      
      // Update UI preview bar status
      imagePreviewBar.style.display = 'flex';
      scrollToBottom();
    };

    reader.readAsDataURL(file);
  });

  // Handle clearing the selected image
  clearImageBtn.addEventListener('click', function () {
    resetImageState();
  });

  // --- General Form Binding ---

  chatForm.addEventListener('submit', function (e) {
    e.preventDefault();
    sendMessage();
  });

  // Keep focus and allow Enter key to submit on mobile if suitable
  chatInput.addEventListener('keydown', function (e) {
    if (e.keyCode === 13 && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Adjust message layout if provider changes
  providerSelect.addEventListener('change', function () {
    // If user changes from Gemini while having an image loaded, warn and reset image
    var provider = providerSelect.value;
    if (provider !== 'gemini' && currentBase64) {
      alert('Se eliminó la imagen cargada porque el modelo seleccionado no admite fotos.');
      resetImageState();
    }
  });

  // Initial layout scroll adjustments
  scrollToBottom();
})();
