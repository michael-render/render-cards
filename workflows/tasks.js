const { task, startTaskServer } = require('@renderinc/sdk/workflows');
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Generate a single stylized portrait via DALL-E 3
task(
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

startTaskServer();
