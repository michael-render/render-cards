const { task, startTaskServer } = require('@renderinc/sdk');

function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) return null;
  const OpenAI = require('openai');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

task({ name: 'generate-card-content' }, async (personData) => {
  const { name, role, hobby, unpopularOpinion, workHack, emoji, desertIsland, superpower, motivation } = personData;
  const openai = getOpenAI();

  if (!openai) {
    // Random fallback
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

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 1.0,
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
    response_format: { type: 'json_object' },
  });

  const parsed = JSON.parse(completion.choices[0].message.content);
  return {
    funTitle: parsed.funTitle || 'Mystery Human',
    tagline: parsed.tagline || 'Living the dream.',
    resolvedEmoji: parsed.resolvedEmoji || emoji || '🤙',
    stats: Array.isArray(parsed.stats) ? parsed.stats.slice(0, 3) : [],
  };
});

startTaskServer();
