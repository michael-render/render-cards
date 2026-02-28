document.addEventListener('DOMContentLoaded', () => {
  const data = JSON.parse(sessionStorage.getItem('cardData'));

  if (!data) {
    window.location.href = '/';
    return;
  }

  populateCard(data);

  // ── Regenerate: re-roll AI content, keep photo + responses ──
  document.getElementById('regen-btn').addEventListener('click', async () => {
    const btn = document.getElementById('regen-btn');
    const status = document.getElementById('save-status');
    btn.disabled = true;
    btn.textContent = 'Regenerating...';
    status.textContent = '';
    status.classList.remove('visible');

    try {
      const res = await fetch('/api/generate-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          role: data.role,
          ...data.responses,
        })
      });

      if (!res.ok) throw new Error('Failed to regenerate');
      const content = await res.json();

      data.funTitle = content.funTitle;
      data.tagline = content.tagline;
      data.stats = content.stats;

      sessionStorage.setItem('cardData', JSON.stringify(data));
      populateCard(data);
    } catch (err) {
      console.error('Regenerate failed:', err);
      status.textContent = 'Regeneration failed. Try again.';
      status.classList.add('visible');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Regenerate';
    }
  });

  // ── Save & Download: capture PNG, save to gallery, download ──
  document.getElementById('save-btn').addEventListener('click', async () => {
    const btn = document.getElementById('save-btn');
    const status = document.getElementById('save-status');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      const card = document.getElementById('card');
      const pngDataUrl = await htmlToImage.toPng(card, {
        pixelRatio: 3,
        cacheBust: true,
      });

      // Save to gallery
      const resp = await fetch('/api/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          role: data.role,
          funTitle: data.funTitle,
          tagline: data.tagline,
          responses: data.responses || {},
          stats: data.stats || [],
          image: pngDataUrl,
        })
      });

      if (!resp.ok) throw new Error('Save failed');

      // Trigger download
      const link = document.createElement('a');
      link.download = `${(data.name || 'card').replace(/\s+/g, '_')}_rendervous.png`;
      link.href = pngDataUrl;
      link.click();

      status.textContent = 'Saved to gallery & downloaded!';
      status.classList.add('visible');

      sessionStorage.removeItem('formData');
      sessionStorage.removeItem('cardData');
    } catch (err) {
      console.error('Save/download failed:', err);
      status.textContent = 'Save failed. Try again.';
      status.classList.add('visible');
    } finally {
      btn.textContent = 'Save & Download';
      btn.disabled = false;
    }
  });

  function populateCard(d) {
    // Photo
    const photo = document.getElementById('card-photo');
    if (d.photo) photo.src = d.photo;

    // Name + emoji
    document.getElementById('card-name').textContent = d.name || 'NAME';
    document.getElementById('card-emoji').textContent = d.responses?.emoji || '';

    // Fun title + role
    document.getElementById('card-fun-title').textContent = d.funTitle || 'Mystery Human';
    document.getElementById('card-role').textContent = d.role || 'Render';

    // Fun fields
    document.getElementById('field-superpower').textContent = d.responses?.superpower || '—';
    document.getElementById('field-island').textContent = d.responses?.desertIsland || '—';
    document.getElementById('field-hot-take').textContent = d.responses?.unpopularOpinion || '—';

    // Stats with bars
    if (d.stats && d.stats.length >= 3) {
      d.stats.forEach((stat, i) => {
        document.getElementById(`stat-label-${i}`).textContent = stat.label;
        document.getElementById(`stat-value-${i}`).textContent = stat.value;
        const bar = document.getElementById(`stat-bar-${i}`);
        if (bar) bar.style.width = `${stat.value}%`;
      });
    }

    // Tagline
    document.getElementById('card-tagline').textContent =
      d.tagline ? `"${d.tagline}"` : '';
  }
});
