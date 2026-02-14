document.addEventListener('DOMContentLoaded', async () => {
  const status = document.getElementById('status');
  const portraits = document.getElementById('portraits');

  // Read session info from sessionStorage
  const raw = sessionStorage.getItem('pickSession');
  if (!raw) {
    status.textContent = 'No session found. Redirecting...';
    status.className = 'pick-status error';
    setTimeout(() => { window.location.href = '/'; }, 1500);
    return;
  }

  let pickSession;
  try {
    pickSession = JSON.parse(raw);
  } catch (e) {
    status.textContent = 'Invalid session. Redirecting...';
    status.className = 'pick-status error';
    setTimeout(() => { window.location.href = '/'; }, 1500);
    return;
  }

  const { sessionId, name, title, skills } = pickSession;

  // Back button: restore formData and go to form
  document.getElementById('back-btn').addEventListener('click', () => {
    window.location.href = '/';
  });

  // Fetch portraits
  status.textContent = 'Loading portraits...';
  try {
    const res = await fetch(`/api/portraits/${sessionId}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Session expired');
    }
    const data = await res.json();

    if (!data.images || data.images.length === 0) {
      throw new Error('No portraits available');
    }

    // Display images
    data.images.forEach((dataUrl, i) => {
      const img = document.getElementById(`img-${i}`);
      const loading = document.getElementById(`loading-${i}`);
      if (img && loading) {
        img.src = dataUrl;
        img.classList.add('loaded');
        loading.classList.add('hidden');
      }
    });

    status.textContent = '';

    // Click handler: select portrait → generate stats → navigate to card
    document.querySelectorAll('.portrait-card').forEach((card) => {
      card.addEventListener('click', async () => {
        const idx = parseInt(card.dataset.index, 10);
        if (idx >= data.images.length) return;

        // Visual feedback
        document.querySelectorAll('.portrait-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        status.textContent = 'Generating stats...';

        try {
          const statsRes = await fetch('/api/generate-stats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, title, skills })
          });
          const statsData = await statsRes.json();

          const cardData = {
            name,
            title,
            photo: data.images[idx],
            skills: skills.length ? skills : ['Leadership', 'Innovation', 'Excellence'],
            stats: statsData.stats
          };

          sessionStorage.setItem('cardData', JSON.stringify(cardData));
          sessionStorage.removeItem('pickSession');
          window.location.href = '/card.html';
        } catch (err) {
          console.error(err);
          status.textContent = 'Failed to generate stats. Please try again.';
          status.className = 'pick-status error';
        }
      });
    });
  } catch (err) {
    console.error(err);
    status.textContent = err.message === 'Session expired'
      ? 'Session expired. Redirecting...'
      : 'Failed to load portraits. Redirecting...';
    status.className = 'pick-status error';
    setTimeout(() => { window.location.href = '/'; }, 2000);
  }
});
