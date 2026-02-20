const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { pool } = require('../db');
const router = express.Router();

const storagePath = process.env.CARD_STORAGE_PATH || path.join(__dirname, '..', 'card-images');

function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) return null;
  const OpenAI = require('openai');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function getRender() {
  if (!process.env.RENDER_API_KEY) return null;
  const { Render } = require('@renderinc/sdk');
  return new Render({ token: process.env.RENDER_API_KEY });
}

// ── Portrait Session Store (in-memory, 15-min TTL) ──
const portraitSessions = new Map();
const SESSION_TTL = 15 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of portraitSessions) {
    if (now - session.createdAt > SESSION_TTL) portraitSessions.delete(id);
  }
}, 60 * 1000);

// Health check — verifies DB is reachable before Render routes traffic
router.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ aiEnabled: !!process.env.OPENAI_API_KEY });
  } catch (err) {
    res.status(503).json({ error: 'Database not ready' });
  }
});

// Generate stats via GPT or fallback to random
router.post('/generate-stats', async (req, res) => {
  const { name, title, skills } = req.body;
  const openai = getOpenAI();

  if (!openai) {
    const labels = [
      'Leadership', 'Creativity', 'Execution', 'Strategy', 'Impact',
      'Innovation', 'Teamwork', 'Vision', 'Drive', 'Expertise',
      'Communication', 'Problem Solving', 'Adaptability', 'Focus'
    ];
    const shuffled = labels.sort(() => Math.random() - 0.5);
    const stats = shuffled.slice(0, 3).map(label => ({
      label,
      value: Math.floor(Math.random() * 10) + 90
    }));
    return res.json({ stats });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: 'You generate trading card stats. Return exactly 3 stats as JSON array: [{"label": "short label", "value": number}]. Labels should be 1-2 words, values 85-99. Make them relevant to the person\'s role.'
      }, {
        role: 'user',
        content: `Generate 3 trading card stats for ${name}, ${title}. Their skills include: ${skills.join(', ')}.`
      }],
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
    const stats = parsed.stats || parsed;
    res.json({ stats: Array.isArray(stats) ? stats.slice(0, 3) : [] });
  } catch (err) {
    console.error('Stats generation error:', err.message);
    res.status(500).json({ error: 'Failed to generate stats' });
  }
});

// Enhance uploaded photo: gpt-image-1 stylized portrait (photo → portrait directly)
router.post('/enhance-photo', async (req, res) => {
  const { photo, name, title } = req.body;
  const openai = getOpenAI();

  if (!openai || !photo) {
    return res.json({ image: null });
  }

  try {
    const prompt = `A stylized premium trading card portrait of ${name}, ${title}. Dramatic collectible card style with rich gold and dark tones, cinematic rim lighting, intense atmosphere. Upper body portrait, facing the viewer.`;

    // Convert data URL to File object for the SDK
    const base64Data = photo.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');
    const { toFile } = require('openai');
    const imageFile = await toFile(imageBuffer, 'photo.png', { type: 'image/png' });

    const result = await openai.images.edit({
      model: 'gpt-image-1',
      image: imageFile,
      prompt,
      size: '1024x1024',
      quality: 'low',
    });

    const dataUrl = `data:image/png;base64,${result.data[0].b64_json}`;
    res.json({ image: dataUrl });
  } catch (err) {
    console.error('Photo enhancement error:', err.message);
    res.json({ image: null });
  }
});

// Generate AI headshot via DALL-E
router.post('/generate-image', async (req, res) => {
  const { description } = req.body;
  const openai = getOpenAI();

  if (!openai) {
    return res.json({ image: null, message: 'AI not available. Please upload a photo instead.' });
  }

  try {
    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt: `Professional corporate headshot portrait of ${description}. Clean background, studio lighting, business attire, photorealistic style. Suitable for a premium trading card.`,
      n: 1,
      size: '1024x1024',
      quality: 'standard'
    });

    // Fetch the image and convert to base64 data URL to avoid client-side CORS issues
    const imageUrl = response.data[0].url;
    const imgResp = await fetch(imageUrl);
    const arrBuf = await imgResp.arrayBuffer();
    const base64 = Buffer.from(arrBuf).toString('base64');
    const dataUrl = `data:image/png;base64,${base64}`;

    res.json({ image: dataUrl });
  } catch (err) {
    console.error('Image generation error:', err.message);
    res.status(500).json({ error: 'Failed to generate image' });
  }
});

// ── Multi-Portrait via Render Workflows + Object Storage ──

const PORTRAIT_STYLES = [
  'Dramatic collectible card style with rich gold and dark tones, cinematic rim lighting, intense atmosphere',
  'Premium card portrait with warm cinematic lighting, rich amber and dark tones, refined detail',
  'Bold collectible card style with deep shadows, golden accents, sharp dramatic lighting',
];

const OWNER_ID = process.env.RENDER_OWNER_ID || '';
const REGION = 'oregon';

router.post('/enhance-photo-multi', async (req, res) => {
  const { photo, name, title } = req.body;
  const render = getRender();

  if (!process.env.OPENAI_API_KEY || !render || !photo) {
    return res.status(400).json({ error: 'AI or Workflows not available' });
  }

  try {
    // Upload photo to object storage so workflow tasks can access it
    const objectKey = `portraits/${crypto.randomUUID()}.png`;
    const base64Data = photo.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');

    await render.experimental.storage.objects.put({
      ownerId: OWNER_ID,
      region: REGION,
      key: objectKey,
      data: imageBuffer,
      contentType: 'image/png',
    });
    console.log(`[portraits] Uploaded photo to object storage: ${objectKey} (${imageBuffer.length} bytes)`);

    // Create session in pending state
    const sessionId = crypto.randomUUID();
    portraitSessions.set(sessionId, {
      status: 'pending',
      createdAt: Date.now(),
    });

    // Start 3 workflow tasks, passing the object key (not the photo data)
    const headers = {
      'Authorization': `Bearer ${process.env.RENDER_API_KEY}`,
      'Content-Type': 'application/json',
    };

    const startPromises = PORTRAIT_STYLES.map((style) =>
      fetch('https://api.render.com/v1/task-runs', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          task: 'render-cards-workflow/generate-single-portrait',
          input: [objectKey, name, title, style],
        }),
      }).then(r => r.json())
    );

    const taskRuns = await Promise.all(startPromises);
    const taskRunIds = taskRuns.map(r => r.id);
    console.log(`[portraits] Started 3 tasks: ${taskRunIds.join(', ')}`);

    // Wait for all 3 in background, then clean up object storage
    Promise.all(
      taskRunIds.map(id => render.workflows.waitForTask(id))
    ).then((results) => {
      console.log(`[portraits] All 3 completed for session ${sessionId}`);
      const session = portraitSessions.get(sessionId);
      if (!session) return;
      const images = results.map(r => r.results?.[0] || r.results);
      session.status = 'ready';
      session.images = images;

      // Clean up uploaded photo
      render.experimental.storage.objects.delete({
        ownerId: OWNER_ID, region: REGION, key: objectKey,
      }).catch(() => {});
    }).catch((err) => {
      console.error(`[portraits] Error: ${err.message}`);
      const session = portraitSessions.get(sessionId);
      if (session) {
        session.status = 'failed';
        session.error = err.message;
      }
    });

    res.json({ sessionId });
  } catch (err) {
    console.error('Multi-portrait error:', err.message);
    res.status(500).json({ error: 'Failed to generate portraits' });
  }
});

router.get('/portraits/:sessionId', (req, res) => {
  const session = portraitSessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session expired or not found' });
  }
  if (session.status === 'pending') {
    return res.json({ status: 'pending' });
  }
  if (session.status === 'failed') {
    return res.status(500).json({ status: 'failed', error: session.error });
  }
  res.json({ status: 'ready', images: session.images });
});

router.get('/portraits/:sessionId/:index', (req, res) => {
  const session = portraitSessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session expired or not found' });
  }
  if (session.status !== 'ready') {
    return res.status(400).json({ error: 'Portraits not ready yet' });
  }
  const idx = parseInt(req.params.index, 10);
  if (isNaN(idx) || idx < 0 || idx >= session.images.length) {
    return res.status(400).json({ error: 'Invalid index' });
  }
  res.json({ image: session.images[idx] });
});

// ── Card Persistence Routes ──

// Save card PNG + metadata
router.post('/cards', async (req, res) => {
  try {
    const { name, title, skills, stats, photo_url, image } = req.body;

    if (!name || !title || !image) {
      return res.status(400).json({ error: 'name, title, and image are required' });
    }

    const result = await pool.query(
      `INSERT INTO cards (name, title, skills, stats, photo_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [name, title, JSON.stringify(skills || []), JSON.stringify(stats || []), photo_url || null]
    );

    const id = result.rows[0].id;

    // Decode base64 PNG and write to disk
    const base64Data = image.replace(/^data:image\/png;base64,/, '');
    const filePath = path.join(storagePath, `${id}.png`);
    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

    res.json({ id });
  } catch (err) {
    console.error('Save card error:', err.message);
    res.status(500).json({ error: 'Failed to save card' });
  }
});

// List all cards for gallery
router.get('/cards', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, title, created_at FROM cards ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List cards error:', err.message);
    res.status(500).json({ error: 'Failed to list cards' });
  }
});

// Serve card PNG from disk
router.get('/cards/:id/image', (req, res) => {
  const filePath = path.join(storagePath, `${req.params.id}.png`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Image not found' });
  }
  res.sendFile(filePath);
});

// Get single card metadata
router.get('/cards/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM cards WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Card not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get card error:', err.message);
    res.status(500).json({ error: 'Failed to get card' });
  }
});

module.exports = router;
