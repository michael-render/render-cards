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
  { name: 'generate-portrait' },
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

// ── Verify likeness (plain function, not a subtask) ──
// Compares original photo and generated portrait via GPT-4o-mini vision.
// Runs inline in the orchestrator to avoid subtask worker issues with object storage.
async function verifyLikeness(originalB64, portraitB64) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a strict quality-control judge for AI-generated portraits. Your job is to REJECT portraits that don\'t look like the original person. Be critical — when in doubt, reject. Most AI portraits fail to preserve likeness, so "match": false should be your default unless the resemblance is clearly strong.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Image 1 is the original photo. Image 2 is a stylized portrait that should depict the same person.

Score each criterion pass/fail:
1. FACE SHAPE: Does the portrait preserve the original face shape (round, oval, square, etc.)?
2. SKIN TONE: Is the skin tone consistent with the original?
3. HAIR: Does the hair color, style, and length match?
4. DISTINGUISHING FEATURES: Are distinctive features preserved (glasses, facial hair, nose shape, etc.)?
5. OVERALL IMPRESSION: Would someone who knows this person recognize them in the portrait?

Respond with JSON: {"match": true/false, "passed": <number of criteria passed out of 5>, "reason": "which criteria failed and why"}
Set "match": true ONLY if at least 4 of 5 criteria pass.`,
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
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 300,
  });

  const result = JSON.parse(response.choices[0].message.content);
  console.log(`[verify] match=${result.match}, passed=${result.passed}/5, reason=${result.reason}`);
  return result;
}

// ── Task 2: generate-verified-portrait (orchestrator) ──
// Generates a portrait and verifies likeness, retrying up to 3 total attempts
task(
  { name: 'generate-verified-portrait' },
  async function generateVerifiedPortrait(objectKey, name, title, stylePrompt) {
    const MAX_ATTEMPTS = 3;

    // Download original photo once for verification comparisons
    const originalObj = await downloadFromStorage(objectKey);
    const originalB64 = originalObj.data.toString('base64');
    console.log(`[orchestrator] Downloaded original photo: ${originalObj.size} bytes`);

    let lastResultKey = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      console.log(`[orchestrator] Attempt ${attempt}/${MAX_ATTEMPTS} for ${name}`);

      let resultKey;
      try {
        resultKey = await generatePortrait(objectKey, name, title, stylePrompt);
      } catch (err) {
        console.error(`[orchestrator] generate-portrait failed on attempt ${attempt}: ${err.message || err}`);
        if (attempt === MAX_ATTEMPTS) {
          throw err;
        }
        continue;
      }

      lastResultKey = resultKey;

      // On the final attempt, skip verification — return whatever we got
      if (attempt === MAX_ATTEMPTS) {
        console.log(`[orchestrator] Final attempt, skipping verification`);
        return resultKey;
      }

      // Verify likeness inline (no subtask)
      try {
        const portraitObj = await downloadFromStorage(resultKey);
        const portraitB64 = portraitObj.data.toString('base64');

        const verification = await verifyLikeness(originalB64, portraitB64);

        if (verification.match) {
          console.log(`[orchestrator] Likeness verified on attempt ${attempt}`);
          return resultKey;
        }

        console.log(`[orchestrator] Likeness failed on attempt ${attempt}, retrying...`);
        deleteFromStorage(resultKey);
      } catch (err) {
        console.error(`[orchestrator] verification failed on attempt ${attempt}: ${err.message || err}`);
        // Verification error — keep the portrait rather than retrying blindly
        console.log(`[orchestrator] Returning portrait despite verification error`);
        return resultKey;
      }
    }

    return lastResultKey;
  }
);

startTaskServer();
