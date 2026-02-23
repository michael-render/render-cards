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

// ── Helper: delete from object storage (fire-and-forget) ──
function deleteFromStorage(key) {
  render.experimental.storage.objects.delete({
    ownerId: OWNER_ID, region: REGION, key,
  }).catch(() => {});
}

// ── Verify likeness (plain function) ──
// Compares original photo and generated portrait via GPT-4o-mini vision.
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

// ── Single task: generate + verify + retry, all in one process ──
// Downloads photo once, then loops: generate portrait → verify likeness → retry if needed.
// No subtasks — avoids worker spawn cascade and object storage 404s.
task(
  { name: 'generate-verified-portrait' },
  async function generateVerifiedPortrait(objectKey, name, title, stylePrompt) {
    const MAX_ATTEMPTS = 3;

    // Download photo once, keep in memory for all attempts
    console.log(`[task] Downloading photo: ${objectKey}`);
    const obj = await render.experimental.storage.objects.get({
      ownerId: OWNER_ID, region: REGION, key: objectKey,
    });
    const photoBuffer = obj.data;
    const originalB64 = photoBuffer.toString('base64');
    console.log(`[task] Downloaded photo: ${obj.size} bytes`);

    const prompt = `A stylized premium trading card portrait of ${name}, ${title}. ${stylePrompt}. Upper body portrait, facing the viewer.`;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      console.log(`[task] Attempt ${attempt}/${MAX_ATTEMPTS} for ${name}`);

      // Generate portrait
      let portraitB64;
      try {
        const imageFile = await toFile(Buffer.from(photoBuffer), 'photo.png', { type: 'image/png' });
        const result = await openai.images.edit({
          model: 'gpt-image-1',
          image: imageFile,
          prompt,
          size: '1024x1024',
          quality: 'low',
        });
        portraitB64 = result.data[0].b64_json;
        console.log(`[task] Portrait generated on attempt ${attempt}`);
      } catch (err) {
        console.error(`[task] Generation failed on attempt ${attempt}: ${err.message}`);
        if (attempt === MAX_ATTEMPTS) throw err;
        continue;
      }

      // Upload result
      const resultKey = `portraits/result-${crypto.randomUUID()}.png`;
      const resultBuffer = Buffer.from(portraitB64, 'base64');
      await uploadToStorage(resultKey, resultBuffer);
      console.log(`[task] Uploaded ${resultKey} (${resultBuffer.length} bytes)`);

      // On the final attempt, skip verification
      if (attempt === MAX_ATTEMPTS) {
        console.log(`[task] Final attempt, skipping verification`);
        return resultKey;
      }

      // Verify likeness inline
      try {
        const verification = await verifyLikeness(originalB64, portraitB64);
        if (verification.match) {
          console.log(`[task] Likeness verified on attempt ${attempt}`);
          return resultKey;
        }
        console.log(`[task] Likeness failed on attempt ${attempt}, retrying...`);
        deleteFromStorage(resultKey);
      } catch (err) {
        console.error(`[task] Verification error on attempt ${attempt}: ${err.message}`);
        // Can't verify — return what we have
        return resultKey;
      }
    }
  }
);

startTaskServer();
