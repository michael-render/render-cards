const express = require('express');
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

// Feature detection
router.get('/health', (req, res) => {
  res.json({ aiEnabled: !!process.env.OPENAI_API_KEY });
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

// Enhance uploaded photo: vision description → DALL-E stylized portrait
router.post('/enhance-photo', async (req, res) => {
  const { photo, name, title } = req.body;
  const openai = getOpenAI();

  if (!openai || !photo) {
    return res.json({ image: null });
  }

  try {
    // Step 1: Use GPT-4o-mini vision to describe the person in the photo
    const visionRes = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: 'Describe this person\'s physical appearance concisely: hair color/style, skin tone, facial features, expression, glasses, facial hair, and any distinguishing characteristics. Keep it to 2-3 sentences.'
      }, {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: photo } }
        ]
      }]
    });

    const description = visionRes.choices[0].message.content;

    // Step 2: Generate a stylized trading card portrait with DALL-E 3
    const dallePrompt = `A stylized premium trading card portrait of ${name}, ${title}. Based on this appearance: ${description}. Painted in a dramatic, collectible card style with rich gold and dark tones, cinematic lighting, and a polished background. Upper body portrait, facing the viewer.`;

    const imageRes = await openai.images.generate({
      model: 'dall-e-3',
      prompt: dallePrompt,
      n: 1,
      size: '1024x1024',
      quality: 'standard'
    });

    // Fetch the image and convert to base64 data URL to avoid client-side CORS issues
    const imageUrl = imageRes.data[0].url;
    const imgResp = await fetch(imageUrl);
    const arrBuf = await imgResp.arrayBuffer();
    const base64 = Buffer.from(arrBuf).toString('base64');
    const dataUrl = `data:image/png;base64,${base64}`;

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
