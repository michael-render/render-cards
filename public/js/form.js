document.addEventListener('DOMContentLoaded', async () => {
  let aiEnabled = false;
  let photoDataUrl = null;

  // Check AI availability
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    aiEnabled = data.aiEnabled;
  } catch (e) {
    // AI not available
  }

  // Update AI badges
  const badge = document.getElementById('ai-photo-badge');
  if (aiEnabled) {
    badge.textContent = 'AI On';
    badge.className = 'ai-badge ai-badge--on';
  }

  // Photo tab switching
  const tabs = document.querySelectorAll('.photo-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.photo-panel').forEach(p => p.classList.remove('active'));
      document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
    });
  });

  // Restore form state if returning from card preview
  const saved = sessionStorage.getItem('formData');
  if (saved) {
    try {
      const f = JSON.parse(saved);
      document.getElementById('name').value = f.name || '';
      document.getElementById('title').value = f.title || '';
      if (f.skills) {
        f.skills.forEach((s, i) => {
          const el = document.getElementById(`skill-${i}`);
          if (el) el.value = s;
        });
      }
      if (f.photoDescription) {
        document.getElementById('photo-description').value = f.photoDescription;
      }
      if (f.photoDataUrl) {
        photoDataUrl = f.photoDataUrl;
        document.getElementById('photo-preview').innerHTML =
          `<img src="${photoDataUrl}" alt="Preview">`;
      }
      if (f.activeTab && f.activeTab !== 'upload') {
        const tab = document.querySelector(`.photo-tab[data-tab="${f.activeTab}"]`);
        if (tab) tab.click();
      }
    } catch (e) {
      // Ignore corrupt data
    }
    sessionStorage.removeItem('formData');
  }

  // Resize image to fit card photo frame (max 480x600)
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

  // Convert an external image URL to a data URL (avoids CORS issues in html-to-image)
  function urlToDataUrl(url, maxW, maxH) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
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
      img.onerror = () => resolve(url); // fallback to original URL
      img.src = url;
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
    const title = document.getElementById('title').value.trim();
    const skills = [
      document.getElementById('skill-0').value.trim(),
      document.getElementById('skill-1').value.trim(),
      document.getElementById('skill-2').value.trim()
    ].filter(Boolean);

    if (!name || !title || skills.length < 3) {
      const status = document.getElementById('status');
      status.textContent = 'Please fill in all fields including all 3 skills.';
      status.className = 'status error';
      return;
    }

    const btn = document.getElementById('submit-btn');
    const status = document.getElementById('status');
    btn.disabled = true;
    btn.textContent = 'Generating...';
    status.textContent = '';
    status.className = 'status';

    try {
      // Get photo
      let photo = photoDataUrl;
      const activeTab = document.querySelector('.photo-tab.active').dataset.tab;

      if (activeTab === 'ai' && aiEnabled) {
        const desc = document.getElementById('photo-description').value.trim();
        if (desc) {
          status.textContent = 'Generating AI photo...';
          const res = await fetch('/api/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: desc })
          });
          const data = await res.json();
          if (data.image) {
            photo = await urlToDataUrl(data.image, 480, 600);
          } else if (data.message) {
            status.textContent = data.message;
          }
        }
      }

      if (!photo) {
        status.textContent = 'Please upload a photo or generate one with AI.';
        status.className = 'status error';
        btn.disabled = false;
        btn.textContent = 'Generate Card';
        return;
      }

      // Enhance uploaded photo with AI vision + DALL-E
      if (aiEnabled && photoDataUrl && photo === photoDataUrl) {
        try {
          status.textContent = 'Enhancing photo with AI...';
          const enhanceRes = await fetch('/api/enhance-photo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ photo: photoDataUrl, name, title })
          });
          if (enhanceRes.ok) {
            const enhanceData = await enhanceRes.json();
            if (enhanceData.image) {
              photo = await urlToDataUrl(enhanceData.image, 480, 600);
            }
          }
        } catch (e) {
          // Enhancement failed — use original photo silently
        }
      }

      // Generate stats
      status.textContent = 'Generating stats...';
      const statsRes = await fetch('/api/generate-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, title, skills })
      });
      const statsData = await statsRes.json();

      // Store data and navigate
      const cardData = {
        name,
        title,
        photo,
        skills: skills.length ? skills : ['Leadership', 'Innovation', 'Excellence'],
        stats: statsData.stats
      };

      sessionStorage.setItem('cardData', JSON.stringify(cardData));

      // Save form state so "Back" from preview restores entries
      sessionStorage.setItem('formData', JSON.stringify({
        name,
        title,
        skills,
        photoDataUrl,
        activeTab,
        photoDescription: document.getElementById('photo-description').value
      }));

      window.location.href = '/card.html';

    } catch (err) {
      console.error(err);
      const msg = err.name === 'QuotaExceededError'
        ? 'Photo is too large. Please use a smaller image.'
        : 'Something went wrong. Please try again.';
      status.textContent = msg;
      status.className = 'status error';
      btn.disabled = false;
      btn.textContent = 'Generate Card';
    }
  });
});
