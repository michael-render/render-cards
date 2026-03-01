const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
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
  try {
    const { Render } = require('@renderinc/sdk');
    return new Render({ token: process.env.RENDER_API_KEY });
  } catch (err) {
    console.warn('Render SDK not available:', err.message);
    return null;
  }
}

// ── Variant session store (in-memory, 15-min TTL) ──
const variantSessions = new Map();
const SESSION_TTL = 15 * 60 * 1000;

function cleanExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of variantSessions) {
    if (now - session.createdAt > SESSION_TTL) variantSessions.delete(id);
  }
}

// ── Shared AI prompt builder ──
function buildCardPrompt(personData) {
  const { name, role, hobby, unpopularOpinion, workHack, emoji, desertIsland, superpower, motivation } = personData;
  return {
    system: `You create fun trading card content for a company offsite. Return JSON with exactly these fields:
{
  "funTitle": "A funny/creative 2-4 word title (NOT their real role). Make it playful and specific to them.",
  "tagline": "A witty one-liner (max 15 words) that captures their personality based on their responses.",
  "resolvedEmoji": "Convert their favorite emoji text (e.g. ':fire:', ':cat-nodding:', ':rocket:') into the closest single Unicode emoji character. If already a Unicode emoji, keep it. If you can't resolve it, use 🤙.",
  "stats": [{"label": "1-2 word label", "value": number}, ...] (exactly 3 stats, values 80-99, make them fun and relevant to their answers)
}
Be creative, funny, and specific to the person. Avoid generic corporate speak.`,
    user: `Generate trading card content for:
Name: ${name}
Role: ${role}
Hobby: ${hobby || 'not provided'}
Unpopular Opinion: ${unpopularOpinion || 'not provided'}
Work Hack: ${workHack || 'not provided'}
Favorite Emoji: ${emoji || 'not provided'}
Desert Island Items: ${desertIsland || 'not provided'}
Mundane Superpower: ${superpower || 'not provided'}
Motivation: ${motivation || 'not provided'}`,
  };
}

function generateRandomVariant(emoji) {
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
  const shuffled = [...statLabels].sort(() => Math.random() - 0.5);
  return {
    funTitle: funTitles[Math.floor(Math.random() * funTitles.length)],
    tagline: taglines[Math.floor(Math.random() * taglines.length)],
    resolvedEmoji: emoji || '🤙',
    stats: shuffled.slice(0, 3).map(label => ({
      label,
      value: Math.floor(Math.random() * 15) + 85,
    })),
  };
}

async function generateAIVariant(openai, personData) {
  const prompt = buildCardPrompt(personData);
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 1.0,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    response_format: { type: 'json_object' },
  });

  const parsed = JSON.parse(completion.choices[0].message.content);
  return {
    funTitle: parsed.funTitle || 'Mystery Human',
    tagline: parsed.tagline || 'Living the dream.',
    resolvedEmoji: parsed.resolvedEmoji || personData.emoji || '🤙',
    stats: Array.isArray(parsed.stats) ? parsed.stats.slice(0, 3) : [],
  };
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

// Generate card content (fun title, tagline, stats) — single variant (used by Regenerate)
router.post('/generate-card', async (req, res) => {
  const personData = req.body;
  const openai = getOpenAI();

  if (!openai) {
    return res.json(generateRandomVariant(personData.emoji));
  }

  try {
    const variant = await generateAIVariant(openai, personData);
    res.json(variant);
  } catch (err) {
    console.error('Card generation error:', err.message);
    res.status(500).json({ error: 'Failed to generate card content' });
  }
});

// ── Multi-variant generation ──

router.post('/generate-card-multi', async (req, res) => {
  const personData = req.body;
  const render = getRender();
  const openai = getOpenAI();

  cleanExpiredSessions();

  // Path 1: Render Workflows — fan out 3 parallel tasks
  if (render) {
    try {
      const sessionId = crypto.randomUUID();
      const workflowSlug = process.env.RENDER_WORKFLOW_SLUG || 'render-cards-workflow';
      const session = { createdAt: Date.now(), status: 'pending', variants: [], taskRunIds: [] };
      variantSessions.set(sessionId, session);

      // Start 3 parallel workflow tasks (startTask returns immediately)
      const taskResults = Array.from({ length: 3 }, () =>
        render.workflows.startTask(`${workflowSlug}/generate-card-content`, [personData])
      );

      const taskRunResults = await Promise.all(taskResults);

      // Collect results in the background via .get()
      Promise.all(taskRunResults.map(async (trr, i) => {
        const completed = await trr.get();
        console.log(`[workflow] Task ${i} done:`, JSON.stringify({
          status: completed.status,
          hasResults: !!completed.results,
          resultsLength: completed.results?.length,
          error: completed.error,
          errorMessage: completed.errorMessage,
        }));
        if (!completed.results || !completed.results[0]) {
          throw new Error(`Task ${i} returned no results (status=${completed.status}, error=${completed.error || completed.errorMessage || 'unknown'})`);
        }
        return completed.results[0];
      })).then(results => {
        console.log(`[workflow] All tasks done, variants=${results.length}`);
        session.status = 'ready';
        session.variants = results;
      }).catch(err => {
        console.error(`[workflow] Task error: ${err.message}`);
        session.status = 'error';
        session.error = 'Workflow tasks failed';
      });

      return res.json({ sessionId });
    } catch (err) {
      console.error('Workflow start error, falling back:', err.message);
      // Fall through to sequential generation
    }
  }

  // Path 2: Sequential AI generation (no Workflows)
  if (openai) {
    try {
      const variants = [];
      for (let i = 0; i < 3; i++) {
        variants.push(await generateAIVariant(openai, personData));
      }
      return res.json({ status: 'ready', variants });
    } catch (err) {
      console.error('Sequential AI generation error:', err.message);
      // Fall through to random
    }
  }

  // Path 3: Random fallback
  const variants = Array.from({ length: 3 }, () => generateRandomVariant(personData.emoji));
  res.json({ status: 'ready', variants });
});

// Poll for variant results
router.get('/variants/:sessionId', (req, res) => {
  const session = variantSessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (session.status === 'ready') {
    variantSessions.delete(req.params.sessionId);
    return res.json({ status: 'ready', variants: session.variants });
  }

  if (session.status === 'error') {
    variantSessions.delete(req.params.sessionId);
    return res.json({ status: 'error', error: session.error });
  }

  res.json({ status: 'pending' });
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
    const buf = Buffer.from(base64Data, 'base64');
    const filePath = path.join(storagePath, `${id}.png`);
    fs.writeFileSync(filePath, buf);

    // Generate thumbnail for gallery (300px wide)
    const thumbPath = path.join(storagePath, `${id}_thumb.png`);
    sharp(buf).resize(300).png({ quality: 80 }).toFile(thumbPath).catch(err => {
      console.error('Thumbnail generation error:', err.message);
    });

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

// Serve thumbnail (falls back to full image if thumbnail doesn't exist)
router.get('/cards/:id/thumbnail', (req, res) => {
  const thumbPath = path.join(storagePath, `${req.params.id}_thumb.png`);
  if (fs.existsSync(thumbPath)) {
    return res.sendFile(thumbPath);
  }
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
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    const thumbPath = path.join(storagePath, `${req.params.id}_thumb.png`);
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
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
