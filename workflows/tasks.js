const { task, startTaskServer } = require('@renderinc/sdk/workflows');
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Generate a single stylized portrait via gpt-image-1 (photo → stylized portrait)
task(
  { name: 'generate-single-portrait', retry: { maxRetries: 1, waitDurationMs: 2000 } },
  async function generateSinglePortrait(photoDataUrl, name, title, stylePrompt) {
    const prompt = `A stylized premium trading card portrait of ${name}, ${title}. ${stylePrompt}. Upper body portrait, facing the viewer.`;

    const result = await openai.images.edit({
      model: 'gpt-image-1',
      image: photoDataUrl,
      prompt,
      input_fidelity: 'high',
      size: '1024x1024',
      quality: 'medium',
    });

    return `data:image/png;base64,${result.data[0].b64_json}`;
  }
);

startTaskServer();
