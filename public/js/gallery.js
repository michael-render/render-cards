document.addEventListener('DOMContentLoaded', async () => {
  const grid = document.getElementById('gallery-grid');
  const empty = document.getElementById('gallery-empty');
  const modal = document.getElementById('modal');
  const modalImage = document.getElementById('modal-image');
  const modalDownload = document.getElementById('modal-download');

  // Load cards
  try {
    const resp = await fetch('/api/cards');
    if (!resp.ok) throw new Error('Failed to load');
    const cards = await resp.json();

    if (cards.length === 0) {
      empty.style.display = 'block';
      return;
    }

    cards.forEach(card => {
      const el = document.createElement('div');
      el.className = 'gallery-card';
      el.innerHTML = `
        <img src="/api/cards/${card.id}/image" alt="${card.name}" loading="lazy">
        <div class="gallery-card-info">
          <div class="gallery-card-name">${card.name}</div>
          <div class="gallery-card-title">${card.title}</div>
        </div>
      `;
      el.addEventListener('click', () => openModal(card.id, card.name));
      grid.appendChild(el);
    });
  } catch (err) {
    console.error('Gallery load error:', err);
    empty.textContent = 'Could not load gallery';
    empty.style.display = 'block';
  }

  function openModal(id, name) {
    const imageUrl = `/api/cards/${id}/image`;
    modalImage.src = imageUrl;
    modalDownload.href = imageUrl;
    modalDownload.download = `${name.replace(/\s+/g, '_')}_render_card.png`;
    modal.classList.add('active');
  }

  function closeModal() {
    modal.classList.remove('active');
    modalImage.src = '';
  }

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
});
