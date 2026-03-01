document.addEventListener('DOMContentLoaded', () => {
  let photoDataUrl = null;

  // Restore form state if returning from card preview
  const saved = sessionStorage.getItem('formData');
  if (saved) {
    try {
      const f = JSON.parse(saved);
      document.getElementById('name').value = f.name || '';
      document.getElementById('role').value = f.role || '';
      document.getElementById('hobby').value = f.hobby || '';
      document.getElementById('unpopular-opinion').value = f.unpopularOpinion || '';
      document.getElementById('work-hack').value = f.workHack || '';
      document.getElementById('emoji').value = f.emoji || '';
      document.getElementById('desert-island').value = f.desertIsland || '';
      document.getElementById('superpower').value = f.superpower || '';
      document.getElementById('motivation').value = f.motivation || '';
      if (f.photoDataUrl) {
        photoDataUrl = f.photoDataUrl;
        document.getElementById('photo-preview').innerHTML =
          `<img src="${photoDataUrl}" alt="Preview">`;
      }
    } catch (e) {
      // Ignore corrupt data
    }
    sessionStorage.removeItem('formData');
  }

  // Resize image to fit card photo frame
  function resizeImage(dataUrl, maxW, maxH) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxW || h > maxH) {
          const ratio = Math.min(maxW / w, maxH / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = dataUrl;
    });
  }

  // File upload → base64
  document.getElementById('photo-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      photoDataUrl = await resizeImage(ev.target.result, 480, 600);
      const preview = document.getElementById('photo-preview');
      preview.innerHTML = `<img src="${photoDataUrl}" alt="Preview">`;
    };
    reader.readAsDataURL(file);
  });

  // Form submit
  document.getElementById('card-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('name').value.trim();
    const role = document.getElementById('role').value.trim();

    if (!name || !role) {
      const status = document.getElementById('status');
      status.textContent = 'Please fill in your name and role.';
      status.className = 'status error';
      return;
    }

    if (!photoDataUrl) {
      const status = document.getElementById('status');
      status.textContent = 'Please upload a photo.';
      status.className = 'status error';
      return;
    }

    const btn = document.getElementById('submit-btn');
    const status = document.getElementById('status');
    btn.disabled = true;
    btn.textContent = 'Generating...';
    status.textContent = '';
    status.className = 'status';

    const responses = {
      hobby: document.getElementById('hobby').value.trim(),
      unpopularOpinion: document.getElementById('unpopular-opinion').value.trim(),
      workHack: document.getElementById('work-hack').value.trim(),
      emoji: document.getElementById('emoji').value.trim(),
      desertIsland: document.getElementById('desert-island').value.trim(),
      superpower: document.getElementById('superpower').value.trim(),
      motivation: document.getElementById('motivation').value.trim(),
    };

    // Save form state so "Back" restores entries
    const formState = { name, role, ...responses, photoDataUrl };

    try {
      // Try multi-variant generation first (3 variants → pick page)
      status.textContent = 'Generating your card variants...';
      const multiRes = await fetch('/api/generate-card-multi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, role, ...responses }),
      });

      if (!multiRes.ok) throw new Error('multi-failed');
      const multiData = await multiRes.json();

      // Build pick session with shared person info
      const pickSession = {
        name,
        role,
        photo: photoDataUrl,
        responses,
      };

      if (multiData.sessionId) {
        // Workflow path — poll on pick page
        pickSession.sessionId = multiData.sessionId;
      } else if (multiData.variants) {
        // Synchronous fallback — embed variants directly
        pickSession.variants = multiData.variants;
      }

      sessionStorage.setItem('pickSession', JSON.stringify(pickSession));
      sessionStorage.setItem('formData', JSON.stringify(formState));
      window.location.href = '/pick.html';

    } catch (multiErr) {
      // Fallback: single variant → card.html directly
      console.warn('Multi-variant failed, falling back to single:', multiErr.message);
      try {
        status.textContent = 'Generating your card...';
        const res = await fetch('/api/generate-card', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, role, ...responses }),
        });

        if (!res.ok) throw new Error('Failed to generate card');
        const cardContent = await res.json();

        const cardData = {
          name,
          role,
          photo: photoDataUrl,
          responses,
          funTitle: cardContent.funTitle,
          tagline: cardContent.tagline,
          resolvedEmoji: cardContent.resolvedEmoji,
          stats: cardContent.stats,
        };

        sessionStorage.setItem('cardData', JSON.stringify(cardData));
        sessionStorage.setItem('formData', JSON.stringify(formState));
        window.location.href = '/card.html';

      } catch (singleErr) {
        console.error(singleErr);
        const msg = singleErr.name === 'QuotaExceededError'
          ? 'Photo is too large. Please use a smaller image.'
          : 'Something went wrong. Please try again.';
        status.textContent = msg;
        status.className = 'status error';
        btn.disabled = false;
        btn.textContent = 'Generate Card';
      }
    }
  });
});
