const { task, startTaskServer } = require('@renderinc/sdk/workflows');
const { Render } = require('@renderinc/sdk');
const crypto = require('crypto');
const OpenAI = require('openai');
const { toFile } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const render = new Render({
  ownerId: process.env.RENDER_OWNER_ID,
  region: process.env.RENDER_REGION || 'oregon',
});
const storage = render.experimental.storage.objects;

// ── Helper: delete from object storage (fire-and-forget) ──
function deleteFromStorage(key) {
  storage.delete({ key }).catch(() => {});
}

// ── Verify likeness (plain function called inside subtask) ──
async function verifyLikeness(originalB64, portraitB64) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a quality-control judge for stylized AI portraits. The portrait is INTENTIONALLY stylized — expect altered proportions, lighting, and artistic effects. Your job is to check whether the portrait clearly depicts the SAME PERSON, not whether it\'s a photorealistic copy. Only reject if the portrait looks like a completely different person.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Image 1 is the original photo. Image 2 is a stylized trading card portrait generated from that photo. The portrait will have artistic stylization — that's expected. Focus on whether the PERSON is recognizable.

Score each criterion pass/fail:
1. HAIR: Is the hair color, length, and general style consistent?
2. SKIN TONE: Is the skin tone approximately correct (not a different ethnicity/complexion)?
3. DISTINGUISHING FEATURES: Are key identifiers preserved (glasses, facial hair, beard, scars, piercings, etc.)?
4. OVERALL IDENTITY: Would someone who knows this person say "that's them" when seeing the portrait?

Respond with JSON: {"match": true/false, "passed": <number of criteria passed out of 4>, "reason": "which criteria failed and why"}
Set "match": true if at least 3 of 4 criteria pass. Set "match": false only if the portrait looks like a different person.`,
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
  console.log(`[verify] match=${result.match}, passed=${result.passed}/4, reason=${result.reason}`);
  return result;
}

// ── Subtask: generate-portrait ──
// Downloads photo, generates portrait, verifies likeness, uploads result.
// Returns { resultKey, match, passed, reason } so the orchestrator can decide.
const generatePortrait = task(
  { name: 'generate-portrait' },
  async function generatePortrait(objectKey, name, title, stylePrompt) {
    console.log(`[generate] Starting portrait for ${name}, fetching photo: ${objectKey}`);

    // Download original photo via SDK (automatic retries in v0.4.0)
    const obj = await storage.get({ key: objectKey });
    const photoBuffer = obj.data;
    const originalB64 = photoBuffer.toString('base64');
    console.log(`[generate] Downloaded photo: ${photoBuffer.length} bytes`);

    // Generate portrait
    const prompt = `A stylized premium trading card portrait of ${name}, ${title}. ${stylePrompt}. Upper body portrait, facing the viewer.`;
    const imageFile = await toFile(photoBuffer, 'photo.png', { type: 'image/png' });
    console.log('[generate] Calling images.edit...');

    const result = await openai.images.edit({
      model: 'gpt-image-1',
      image: imageFile,
      prompt,
      size: '1024x1024',
      quality: 'low',
    });
    const portraitB64 = result.data[0].b64_json;
    console.log('[generate] Portrait generated');

    // Upload result to object storage via SDK
    const resultKey = `portraits/result-${crypto.randomUUID()}.png`;
    const resultBuffer = Buffer.from(portraitB64, 'base64');
    await storage.put({ key: resultKey, data: resultBuffer, contentType: 'image/png' });
    console.log(`[generate] Uploaded ${resultKey} (${resultBuffer.length} bytes)`);

    // Verify likeness (both images already in memory — no extra downloads)
    let match = true;
    let passed = 5;
    let reason = 'verification skipped';
    try {
      const verification = await verifyLikeness(originalB64, portraitB64);
      match = verification.match;
      passed = verification.passed;
      reason = verification.reason;
    } catch (err) {
      console.error(`[generate] Verification call failed: ${err.message}`);
      // If verification fails, default to accepting the portrait
    }

    return { resultKey, match, passed, reason };
  }
);

// ── Orchestrator: generate-verified-portrait ──
// Calls generate-portrait subtask, retries if likeness fails. Never touches object storage.
task(
  { name: 'generate-verified-portrait' },
  async function generateVerifiedPortrait(objectKey, name, title, stylePrompt) {
    const MAX_ATTEMPTS = 3;
    let lastResultKey = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      console.log(`[orchestrator] Attempt ${attempt}/${MAX_ATTEMPTS} for ${name}`);

      let result;
      try {
        result = await generatePortrait(objectKey, name, title, stylePrompt);
      } catch (err) {
        console.error(`[orchestrator] Subtask failed on attempt ${attempt}: ${err.message || err}`);
        // If we have a previous portrait, return it instead of failing
        if (lastResultKey) {
          console.log(`[orchestrator] Returning previous portrait: ${lastResultKey}`);
          return lastResultKey;
        }
        if (attempt === MAX_ATTEMPTS) throw err;
        continue;
      }

      // Clean up the previous failed portrait now that we have a new one
      if (lastResultKey) deleteFromStorage(lastResultKey);
      lastResultKey = result.resultKey;

      // On the final attempt, return regardless of verification
      if (attempt === MAX_ATTEMPTS) {
        console.log(`[orchestrator] Final attempt, returning portrait (match=${result.match})`);
        return result.resultKey;
      }

      if (result.match) {
        console.log(`[orchestrator] Likeness verified on attempt ${attempt} (${result.passed}/4)`);
        return result.resultKey;
      }

      console.log(`[orchestrator] Likeness failed on attempt ${attempt} (${result.passed}/4: ${result.reason}), retrying...`);
    }

    // All attempts failed verification — return the last portrait anyway
    return lastResultKey;
  }
);

startTaskServer();
