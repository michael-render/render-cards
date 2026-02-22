const { task, startTaskServer } = require('@renderinc/sdk/workflows');
const { Render } = require('@renderinc/sdk');
const crypto = require('crypto');
const OpenAI = require('openai');
const { toFile } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const render = new Render({ token: process.env.RENDER_API_KEY });

const OWNER_ID = process.env.RENDER_OWNER_ID || '';
const REGION = 'oregon';

// Generate a single stylized portrait via gpt-image-1 (photo from object storage)
// Returns an object storage key for the result (not the full base64, to avoid size limits)
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

    // Upload result to object storage (returning large base64 as task result is unreliable)
    const resultKey = `portraits/result-${crypto.randomUUID()}.png`;
    const resultBuffer = Buffer.from(result.data[0].b64_json, 'base64');

    const presignResp = await fetch(`https://api.render.com/v1/objects/${OWNER_ID}/${REGION}/${resultKey}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${process.env.RENDER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sizeBytes: resultBuffer.length }),
    });
    if (!presignResp.ok) throw new Error(`Failed to get upload URL: ${presignResp.status}`);
    const { url: uploadUrl } = await presignResp.json();

    await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Length': resultBuffer.length.toString() },
      body: resultBuffer,
    });
    console.log(`[task] Uploaded result to ${resultKey} (${resultBuffer.length} bytes)`);

    return resultKey;
  }
);

startTaskServer();
