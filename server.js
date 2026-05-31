require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS so client devices on local network can connect
app.use(cors());

// Configure JSON body parser to accept larger base64 payloads (10MB)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Serve static assets from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Strict mathematical system prompt with \boxed{} requirement
const SYSTEM_PROMPT = `Eres 'Gemini Math Mobile'. Cualquier término matemático, variable suelta ($x$, $y$), fracción, raíz, matriz o ecuación DEBE estar envuelto estrictamente en delimitadores LaTeX: '$ ... $' para texto en línea y '$$ ... $$' para bloques. Sé extremadamente conciso; el cliente es una pantalla de 4 pulgadas (1136x640), usa viñetas o pasos cortos y resalta el resultado final con \\boxed{}. Evita párrafos largos.`;

// --- Ollama Cloud model configuration ---
// These model IDs use the :cloud suffix to run on Ollama's cloud infrastructure.
// See available models at: https://ollama.com/search?c=cloud
const OLLAMA_CLOUD_MODELS = {
  math1: process.env.OLLAMA_MODEL_1 || 'kimi-k2.6:cloud',
  math2: process.env.OLLAMA_MODEL_2 || 'qwen3.5:cloud',
  math3: process.env.OLLAMA_MODEL_3 || 'gemma4:31b:cloud'
};

// Ollama Cloud OpenAI-compatible endpoint
const OLLAMA_CLOUD_URL = 'https://ollama.com/v1/chat/completions';

app.post('/api/chat', async (req, res) => {
  const { message, provider, image } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'El mensaje es requerido.' });
  }

  const selectedProvider = provider || 'gemini';
  console.log(`[Chat Request] Provider: ${selectedProvider}, Message length: ${message.length}, Has image: ${!!image}`);

  try {
    // ── Gemini 2.5 Flash (multimodal) ────────────────────────────────────────
    if (selectedProvider === 'gemini') {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
        return res.status(500).json({
          error: 'Falta la GEMINI_API_KEY en el archivo .env del servidor.'
        });
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

      const parts = [{ text: message }];

      // Handle image multimodal payload if present
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

    // ── Ollama Cloud models (OpenAI-compatible API) ───────────────────────────
    } else if (OLLAMA_CLOUD_MODELS[selectedProvider]) {

      // Images are only supported on Gemini 2.5 Flash
      if (image) {
        return res.status(400).json({
          error: 'La carga de fotos y análisis visual solo es compatible con el modelo Gemini 2.5 Flash.'
        });
      }

      const cloudKey = process.env.OLLAMA_API_KEY;
      if (!cloudKey || cloudKey === 'YOUR_OLLAMA_API_KEY_HERE') {
        return res.status(500).json({
          error: 'Falta la OLLAMA_API_KEY en el archivo .env del servidor. Créala en: https://ollama.com/settings/api-keys'
        });
      }

      const modelId = OLLAMA_CLOUD_MODELS[selectedProvider];

      const payload = {
        model: modelId,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: message }
        ]
      };

      console.log(`Llamando a Ollama Cloud (${modelId})...`);

      const response = await axios.post(OLLAMA_CLOUD_URL, payload, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cloudKey}`
        },
        timeout: 30000
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

// Fallback to index.html for SPA behavior
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`=========================================`);
  console.log(` Gemini Math Mobile backend corriendo`);
  console.log(` Puerto local: http://localhost:${PORT}`);
  console.log(` Para red local (iOS 10): http://<TU_IP_LOCAL>:${PORT}`);
  console.log(`=========================================`);
});