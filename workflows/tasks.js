const { task, startTaskServer } = require('@renderinc/sdk/workflows');
const { Render } = require('@renderinc/sdk');
const OpenAI = require('openai');
const { toFile } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const render = new Render({ token: process.env.RENDER_API_KEY });

const OWNER_ID = process.env.RENDER_OWNER_ID || '';
const REGION = 'oregon';

// Generate a single stylized portrait via gpt-image-1 (photo from object storage)
task(
  { name: 'generate-single-portrait', retry: { maxRetries: 1, waitDurationMs: 2000 } },
  async function generateSinglePortrait(objectKey, name, title, stylePrompt) {
    console.log(`[task] Starting portrait for ${name}, fetching photo: ${objectKey}`);

    // Download photo from Render Object Storage
    const obj = await render.experimental.storage.objects.get({
      ownerId: OWNER_ID,
      region: REGION,
      key: objectKey,
    });
    console.log(`[task] Downloaded photo: ${obj.size} bytes`);

    const prompt = `A stylized premium trading card portrait of ${name}, ${title}. ${stylePrompt}. Upper body portrait, facing the viewer.`;

    // Convert buffer to File object for the SDK
    const imageFile = await toFile(obj.data, 'photo.png', { type: 'image/png' });
    console.log('[task] Calling images.edit...');

    const result = await openai.images.edit({
      model: 'gpt-image-1',
      image: imageFile,
      prompt,
      size: '1024x1024',
      quality: 'low',
    });

    console.log('[task] images.edit completed successfully');
    return `data:image/png;base64,${result.data[0].b64_json}`;
  }
);

startTaskServer();
