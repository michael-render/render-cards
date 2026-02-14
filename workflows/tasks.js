const { task, startTaskServer } = require('@renderinc/sdk');
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const STYLE_PROMPTS = [
  'Dramatic collectible card style with rich gold and dark tones, cinematic lighting',
  'Watercolor artistic style with soft flowing colors and painterly brushstrokes',
  'Bold comic book pop art style with strong outlines, vibrant flat colors, and dynamic energy',
];

// Subtask: generate a single stylized portrait via DALL-E 3
const generateSinglePortrait = task(
  { name: 'generate-single-portrait', retry: { maxRetries: 1, waitDurationMs: 2000 } },
  async function generateSinglePortrait(description, name, title, stylePrompt) {
    const dallePrompt = `A stylized premium trading card portrait of ${name}, ${title}. Based on this appearance: ${description}. Painted in a ${stylePrompt} and a polished background. Upper body portrait, facing the viewer.`;

    const imageRes = await openai.images.generate({
      model: 'dall-e-3',
      prompt: dallePrompt,
      n: 1,
      size: '1024x1024',
      quality: 'standard',
    });

    const imageUrl = imageRes.data[0].url;
    const resp = await fetch(imageUrl);
    const arrBuf = await resp.arrayBuffer();
    const base64 = Buffer.from(arrBuf).toString('base64');
    return `data:image/png;base64,${base64}`;
  }
);

// Parent task: fan out 3 subtasks in parallel with different styles
task(
  { name: 'generate-portraits' },
  async function generatePortraits(description, name, title) {
    const results = await Promise.all(
      STYLE_PROMPTS.map((style) => generateSinglePortrait(description, name, title, style))
    );
    return results;
  }
);

startTaskServer();
