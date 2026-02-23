const { task, startTaskServer } = require('@renderinc/sdk/workflows');
const { Render } = require('@renderinc/sdk');
const crypto = require('crypto');
const OpenAI = require('openai');
const { toFile } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const render = new Render({ token: process.env.RENDER_API_KEY });

const OWNER_ID = process.env.RENDER_OWNER_ID || '';
const REGION = 'oregon';

// ── Helper: upload a buffer to object storage via presigned URL ──
async function uploadToStorage(key, buffer) {
  const presignResp = await fetch(`https://api.render.com/v1/objects/${OWNER_ID}/${REGION}/${key}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${process.env.RENDER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sizeBytes: buffer.length }),
  });
  if (!presignResp.ok) throw new Error(`Failed to get upload URL: ${presignResp.status}`);
  const { url: uploadUrl } = await presignResp.json();

  await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Length': buffer.length.toString() },
    body: buffer,
  });
}

// ── Helper: download from object storage ──
async function downloadFromStorage(key) {
  const obj = await render.experimental.storage.objects.get({
    ownerId: OWNER_ID,
    region: REGION,
    key,
  });
  return obj;
}

// ── Helper: delete from object storage (fire-and-forget) ──
function deleteFromStorage(key) {
  render.experimental.storage.objects.delete({
    ownerId: OWNER_ID, region: REGION, key,
  }).catch(() => {});
}

// ── Task 1: generate-portrait ──
// Downloads photo, generates stylized portrait via gpt-image-1, uploads result
const generatePortrait = task(
  { name: 'generate-portrait', retry: { maxRetries: 1, waitDurationMs: 2000 } },
  async function generatePortrait(objectKey, name, title, stylePrompt) {
    console.log(`[generate] Starting portrait for ${name}, fetching photo: ${objectKey}`);

    const obj = await downloadFromStorage(objectKey);
    console.log(`[generate] Downloaded photo: ${obj.size} bytes`);

    const prompt = `A stylized premium trading card portrait of ${name}, ${title}. ${stylePrompt}. Upper body portrait, facing the viewer.`;

    const imageFile = await toFile(obj.data, 'photo.png', { type: 'image/png' });
    console.log('[generate] Calling images.edit...');

    const result = await openai.images.edit({
      model: 'gpt-image-1',
      image: imageFile,
      prompt,
      size: '1024x1024',
      quality: 'low',
    });

    console.log('[generate] images.edit completed successfully');

    const resultKey = `portraits/result-${crypto.randomUUID()}.png`;
    const resultBuffer = Buffer.from(result.data[0].b64_json, 'base64');

    await uploadToStorage(resultKey, resultBuffer);
    console.log(`[generate] Uploaded result to ${resultKey} (${resultBuffer.length} bytes)`);

    return resultKey;
  }
);

// ── Task 2: verify-likeness ──
// Compares original photo and generated portrait via GPT-4o-mini vision
const verifyLikeness = task(
  { name: 'verify-likeness' },
  async function verifyLikeness(originalKey, portraitKey) {
    console.log(`[verify] Comparing ${originalKey} vs ${portraitKey}`);

    const [originalObj, portraitObj] = await Promise.all([
      downloadFromStorage(originalKey),
      downloadFromStorage(portraitKey),
    ]);

    const originalB64 = originalObj.data.toString('base64');
    const portraitB64 = portraitObj.data.toString('base64');

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'I have two images: the first is an original photo of a person, and the second is a stylized portrait generated from that photo. Is the person in the portrait recognizably the same person as in the original photo? Consider facial structure, key features, and overall likeness. Respond with JSON: {"match": true/false, "reason": "brief explanation"}',
          },
          {
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${originalB64}` },
          },
          {
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${portraitB64}` },
          },
        ],
      }],
      response_format: { type: 'json_object' },
      max_tokens: 200,
    });

    const result = JSON.parse(response.choices[0].message.content);
    console.log(`[verify] match=${result.match}, reason=${result.reason}`);
    return result;
  }
);

// ── Task 3: generate-verified-portrait (orchestrator) ──
// Generates a portrait and verifies likeness, retrying up to 3 total attempts
task(
  { name: 'generate-verified-portrait' },
  async function generateVerifiedPortrait(objectKey, name, title, stylePrompt) {
    const MAX_ATTEMPTS = 3;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      console.log(`[orchestrator] Attempt ${attempt}/${MAX_ATTEMPTS} for ${name}`);

      const resultKey = await generatePortrait(objectKey, name, title, stylePrompt);

      // On the final attempt, skip verification — return whatever we got
      if (attempt === MAX_ATTEMPTS) {
        console.log(`[orchestrator] Final attempt, skipping verification`);
        return resultKey;
      }

      const verification = await verifyLikeness(objectKey, resultKey);

      if (verification.match) {
        console.log(`[orchestrator] Likeness verified on attempt ${attempt}`);
        return resultKey;
      }

      // Failed verification — delete the bad portrait and retry
      console.log(`[orchestrator] Likeness failed on attempt ${attempt}, retrying...`);
      deleteFromStorage(resultKey);
    }
  }
);

startTaskServer();
