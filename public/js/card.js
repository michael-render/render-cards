document.addEventListener('DOMContentLoaded', () => {
  const data = JSON.parse(sessionStorage.getItem('cardData'));

  if (!data) {
    window.location.href = '/';
    return;
  }

  // Populate photo
  const photo = document.getElementById('card-photo');
  if (data.photo) {
    photo.src = data.photo;
  }

  // Populate name and title
  document.getElementById('card-name').textContent = data.name || 'NAME';
  document.getElementById('card-title').textContent = data.title || 'TITLE';

  // Populate stats
  if (data.stats && data.stats.length >= 3) {
    data.stats.forEach((stat, i) => {
      document.getElementById(`stat-label-${i}`).textContent = stat.label;
      document.getElementById(`stat-value-${i}`).textContent = stat.value;
    });
  }

  // Populate skills
  if (data.skills) {
    data.skills.forEach((skill, i) => {
      const el = document.getElementById(`skill-${i}`);
      if (el) el.textContent = skill;
    });
  }

  // Download PNG
  document.getElementById('download-btn').addEventListener('click', async () => {
    const btn = document.getElementById('download-btn');
    btn.textContent = 'Generating...';
    btn.disabled = true;

    try {
      const card = document.getElementById('card');
      const dataUrl = await htmlToImage.toPng(card, {
        pixelRatio: 3,
        cacheBust: true
      });

      const link = document.createElement('a');
      link.download = `${(data.name || 'card').replace(/\s+/g, '_')}_render_card.png`;
      link.href = dataUrl;
      link.click();

      // Save to gallery before user navigates away
      await saveCard(dataUrl);
    } catch (err) {
      console.error('PNG generation failed:', err);
      alert('Failed to generate PNG. Try again.');
    } finally {
      btn.textContent = 'Download PNG';
      btn.disabled = false;
    }
  });

  async function saveCard(imageDataUrl) {
    const status = document.getElementById('save-status');
    try {
      const resp = await fetch('/api/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          title: data.title,
          skills: data.skills || [],
          stats: data.stats || [],
          photo_url: data.photo || null,
          image: imageDataUrl
        })
      });
      if (resp.ok) {
        status.textContent = 'Saved to gallery';
        status.classList.add('visible');
      }
    } catch (err) {
      console.warn('Gallery save failed (non-blocking):', err.message);
    }
  }
});
