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

// Health check — verifies DB is reachable before Render routes traffic
router.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ aiEnabled: !!process.env.OPENAI_API_KEY });
  } catch (err) {
    res.status(503).json({ error: 'Database not ready' });
  }
});

// Generate card content (fun title, tagline, stats) from prompt responses
router.post('/generate-card', async (req, res) => {
  const { name, role, hobby, unpopularOpinion, workHack, emoji, desertIsland, superpower, motivation } = req.body;
  const openai = getOpenAI();

  if (!openai) {
    // Fallback: random fun content
    const funTitles = [
      'Chaos Coordinator', 'Vibe Architect', 'Snack Strategist',
      'Meeting Survivor', 'Slack Ninja', 'Deploy Button Masher',
      'Bug Whisperer', 'Coffee-Powered Engine', 'Keyboard Warrior',
    ];
    const taglines = [
      'Bringing the energy since day one.',
      'Will debug for snacks.',
      'Probably thinking about lunch.',
      'Living proof that caffeine works.',
    ];
    const statLabels = [
      'Vibes', 'Hustle', 'Snack Game', 'Emoji Fluency', 'Hot Takes',
      'Island Readiness', 'Chill Factor', 'Team Spirit', 'Curiosity',
      'Wit', 'Boldness', 'Focus', 'Creativity', 'Resilience',
    ];
    const shuffled = statLabels.sort(() => Math.random() - 0.5);
    return res.json({
      funTitle: funTitles[Math.floor(Math.random() * funTitles.length)],
      tagline: taglines[Math.floor(Math.random() * taglines.length)],
      resolvedEmoji: emoji || '🤙',
      stats: shuffled.slice(0, 3).map(label => ({
        label,
        value: Math.floor(Math.random() * 15) + 85
      })),
    });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: `You create fun trading card content for a company offsite. Return JSON with exactly these fields:
{
  "funTitle": "A funny/creative 2-4 word title (NOT their real role). Make it playful and specific to them.",
  "tagline": "A witty one-liner (max 15 words) that captures their personality based on their responses.",
  "resolvedEmoji": "Convert their favorite emoji text (e.g. ':fire:', ':cat-nodding:', ':rocket:') into the closest single Unicode emoji character. If already a Unicode emoji, keep it. If you can't resolve it, use 🤙.",
  "stats": [{"label": "1-2 word label", "value": number}, ...] (exactly 3 stats, values 80-99, make them fun and relevant to their answers)
}
Be creative, funny, and specific to the person. Avoid generic corporate speak.`
      }, {
        role: 'user',
        content: `Generate trading card content for:
Name: ${name}
Role: ${role}
Hobby: ${hobby || 'not provided'}
Unpopular Opinion: ${unpopularOpinion || 'not provided'}
Work Hack: ${workHack || 'not provided'}
Favorite Emoji: ${emoji || 'not provided'}
Desert Island Items: ${desertIsland || 'not provided'}
Mundane Superpower: ${superpower || 'not provided'}
Motivation: ${motivation || 'not provided'}`
      }],
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
    res.json({
      funTitle: parsed.funTitle || 'Mystery Human',
      tagline: parsed.tagline || 'Living the dream.',
      resolvedEmoji: parsed.resolvedEmoji || emoji || '🤙',
      stats: Array.isArray(parsed.stats) ? parsed.stats.slice(0, 3) : [],
    });
  } catch (err) {
    console.error('Card generation error:', err.message);
    res.status(500).json({ error: 'Failed to generate card content' });
  }
});

// ── Card Persistence Routes ──

// Save card PNG + metadata
router.post('/cards', async (req, res) => {
  try {
    const { name, role, funTitle, tagline, responses, stats, image } = req.body;

    if (!name || !image) {
      return res.status(400).json({ error: 'name and image are required' });
    }

    const result = await pool.query(
      `INSERT INTO cards (name, title, fun_title, tagline, responses, stats)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        name,
        role || '',
        funTitle || '',
        tagline || '',
        JSON.stringify(responses || {}),
        JSON.stringify(stats || []),
      ]
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
      'SELECT id, name, title, fun_title, created_at FROM cards ORDER BY created_at DESC'
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

// Delete a card
router.delete('/cards/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM cards WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Card not found' });
    }
    const filePath = path.join(storagePath, `${req.params.id}.png`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Delete card error:', err.message);
    res.status(500).json({ error: 'Failed to delete card' });
  }
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
