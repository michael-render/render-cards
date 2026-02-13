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

  // File upload → base64
  document.getElementById('photo-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      photoDataUrl = ev.target.result;
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

    if (!name || !title) return;

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
            photo = data.image;
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
      window.location.href = '/card.html';

    } catch (err) {
      console.error(err);
      status.textContent = 'Something went wrong. Please try again.';
      status.className = 'status error';
      btn.disabled = false;
      btn.textContent = 'Generate Card';
    }
  });
});
