require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Directory where chat history JSON files are stored
const HISTORY_DIR = path.join(__dirname, 'chat_history');
if (!fs.existsSync(HISTORY_DIR)) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const SYSTEM_PROMPT = `Eres 'Gemini Math Mobile'. Cualquier término matemático, variable suelta ($x$, $y$), fracción, raíz, matriz o ecuación DEBE estar envuelto estrictamente en delimitadores LaTeX: '$ ... $' para texto en línea y '$$ ... $$' para bloques. Sé extremadamente conciso; el cliente es una pantalla de 4 pulgadas (1136x640), usa viñetas o pasos cortos y resalta el resultado final con \\boxed{}. Evita párrafos largos.`;

const OLLAMA_CLOUD_MODELS = {
  math1: process.env.OLLAMA_MODEL_1 || 'llama3.3:cloud',
  math2: process.env.OLLAMA_MODEL_2 || 'qwen3:cloud',
  math3: process.env.OLLAMA_MODEL_3 || 'gemma3:cloud'
};

const OLLAMA_VISION_CAPABLE = {
  math1: true,
  math2: true,
  math3: true
};

const OLLAMA_CLOUD_URL = 'https://ollama.com/v1/chat/completions';

// ── History helpers ───────────────────────────────────────────────────────────

function historyFilePath(id) {
  // Sanitize id to prevent path traversal
  var safe = id.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(HISTORY_DIR, safe + '.json');
}

function readSession(id) {
  try {
    var data = fs.readFileSync(historyFilePath(id), 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
}

function writeSession(id, session) {
  fs.writeFileSync(historyFilePath(id), JSON.stringify(session, null, 2), 'utf8');
}

// ── History endpoints ─────────────────────────────────────────────────────────

// List all sessions (metadata only, no messages)
app.get('/api/history', function (req, res) {
  try {
    var files = fs.readdirSync(HISTORY_DIR).filter(function (f) {
      return f.endsWith('.json');
    });
    var sessions = files.map(function (f) {
      try {
        var data = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, f), 'utf8'));
        return {
          id: data.id,
          title: data.title || 'Sin título',
          updatedAt: data.updatedAt,
          messageCount: (data.messages || []).length
        };
      } catch (e) {
        return null;
      }
    }).filter(Boolean);

    // Sort by most recently updated
    sessions.sort(function (a, b) {
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });

    res.json({ sessions: sessions });
  } catch (e) {
    res.status(500).json({ error: 'Error leyendo el historial.' });
  }
});

// Get a single session (with all messages)
app.get('/api/history/:id', function (req, res) {
  var session = readSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Sesión no encontrada.' });
  res.json(session);
});

// Save / update a session
app.post('/api/history/:id', function (req, res) {
  var id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '');
  var body = req.body;
  if (!body || !body.messages) {
    return res.status(400).json({ error: 'Faltan los mensajes.' });
  }

  var now = new Date().toISOString();
  var existing = readSession(id) || { id: id, createdAt: now };

  var session = {
    id: id,
    title: body.title || existing.title || 'Sin título',
    createdAt: existing.createdAt,
    updatedAt: now,
    messages: body.messages
  };

  writeSession(id, session);
  res.json({ ok: true, session: { id: session.id, title: session.title, updatedAt: session.updatedAt } });
});

// Delete a session
app.delete('/api/history/:id', function (req, res) {
  var fp = historyFilePath(req.params.id);
  try {
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error eliminando la sesión.' });
  }
});

// ── Chat endpoint ─────────────────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const { message, provider, image } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'El mensaje es requerido.' });
  }

  const selectedProvider = provider || 'gemini';
  console.log(`[Chat Request] Provider: ${selectedProvider}, Message length: ${message.length}, Has image: ${!!image}`);

  try {
    if (selectedProvider === 'gemini') {
      // Support up to 3 Gemini keys; client sends geminiKey index (1, 2 or 3)
      const geminiKeys = [
        process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY,
        process.env.GEMINI_API_KEY_2,
        process.env.GEMINI_API_KEY_3
      ].filter(Boolean);

      const keyIndex = Math.max(0, Math.min(parseInt(req.body.geminiKey || '1', 10) - 1, geminiKeys.length - 1));
      const apiKey = geminiKeys[keyIndex];

      if (!apiKey) {
        return res.status(500).json({
          error: 'No hay ninguna GEMINI_API_KEY configurada en el archivo .env del servidor.'
        });
      }

      console.log(`[Gemini] Usando key #${keyIndex + 1}`);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
      const parts = [{ text: message }];

      if (image) {
        let mimeType = 'image/jpeg';
        let base64Data = image;
        if (image.startsWith('data:')) {
          const matches = image.match(/^data:([^;]+);base64,(.+)$/);
          if (matches && matches.length === 3) {
            mimeType = matches[1];
            base64Data = matches[2];
          }
        }
        parts.push({ inlineData: { mimeType, data: base64Data } });
      }

      const payload = {
        contents: [{ parts }],
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }
      };

      const response = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' }
      });

      const aiText = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!aiText) throw new Error('Respuesta vacía o formato inesperado de Gemini API.');
      return res.json({ response: aiText });

    } else if (OLLAMA_CLOUD_MODELS[selectedProvider]) {

      if (image && !OLLAMA_VISION_CAPABLE[selectedProvider]) {
        const modelId = OLLAMA_CLOUD_MODELS[selectedProvider];
        return res.status(400).json({
          error: `El modelo ${modelId} aún no soporta imágenes en Ollama Cloud. Usa Gemini 2.5 Flash para análisis visual.`
        });
      }

      const cloudKey = process.env.OLLAMA_API_KEY;
      if (!cloudKey || cloudKey === 'YOUR_OLLAMA_API_KEY_HERE') {
        return res.status(500).json({
          error: 'Falta la OLLAMA_API_KEY en el archivo .env del servidor. Créala en: https://ollama.com/settings/api-keys'
        });
      }

      const modelId = OLLAMA_CLOUD_MODELS[selectedProvider];

      const userContent = (image && OLLAMA_VISION_CAPABLE[selectedProvider])
        ? [
            { type: 'text', text: message },
            { type: 'image_url', image_url: { url: image } }
          ]
        : message;

      const payload = {
        model: modelId,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent }
        ]
      };

      console.log(`Llamando a Ollama Cloud (${modelId})...`);

      const response = await axios.post(OLLAMA_CLOUD_URL, payload, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cloudKey}`
        },
        timeout: 3000000
      });

      const aiText = response.data.choices?.[0]?.message?.content;
      if (!aiText) throw new Error(`Respuesta vacía o formato inesperado de Ollama Cloud (${modelId}).`);
      return res.json({ response: aiText });

    } else {
      return res.status(400).json({ error: `Proveedor no soportado: ${selectedProvider}` });
    }

  } catch (error) {
    console.error('[Error de API]:', error.message);
    if (error.response) {
      console.error('[Detalles del Error]:', JSON.stringify(error.response.data));
      const errMsg = error.response.data?.error?.message || error.message;
      return res.status(500).json({ error: `Error en ${selectedProvider}: ${errMsg}` });
    }
    return res.status(500).json({
      error: `Error al procesar la petición con ${selectedProvider}: ${error.message}`
    });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`=========================================`);
  console.log(` Gemini Math Mobile backend corriendo`);
  console.log(` Puerto local: http://localhost:${PORT}`);
  console.log(` Para red local (iOS 10): http://<TU_IP_LOCAL>:${PORT}`);
  console.log(` Historial en: ${HISTORY_DIR}`);
  console.log(`=========================================`);
});