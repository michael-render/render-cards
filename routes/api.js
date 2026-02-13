const express = require('express');
const router = express.Router();

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
    const pool = [
      'Leadership', 'Creativity', 'Execution', 'Strategy', 'Impact',
      'Innovation', 'Teamwork', 'Vision', 'Drive', 'Expertise',
      'Communication', 'Problem Solving', 'Adaptability', 'Focus'
    ];
    const shuffled = pool.sort(() => Math.random() - 0.5);
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

    res.json({ image: response.data[0].url });
  } catch (err) {
    console.error('Image generation error:', err.message);
    res.status(500).json({ error: 'Failed to generate image' });
  }
});

module.exports = router;
