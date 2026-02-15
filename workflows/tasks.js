const { task, startTaskServer } = require('@renderinc/sdk/workflows');
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Generate a single stylized portrait via gpt-image-1 (photo → stylized portrait)
task(
  { name: 'generate-single-portrait', retry: { maxRetries: 1, waitDurationMs: 2000 } },
  async function generateSinglePortrait(photoDataUrl, name, title, stylePrompt) {
    const prompt = `A stylized premium trading card portrait of ${name}, ${title}. ${stylePrompt}. Upper body portrait, facing the viewer.`;

    // Convert data URL to File object for the SDK
    const base64Data = photoDataUrl.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');
    const imageFile = await openai.toFile(imageBuffer, 'photo.png', { type: 'image/png' });

    const result = await openai.images.edit({
      model: 'gpt-image-1',
      image: imageFile,
      prompt,
      size: '1024x1024',
      quality: 'low',
    });

    return `data:image/png;base64,${result.data[0].b64_json}`;
  }
);

startTaskServer();
