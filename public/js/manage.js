document.addEventListener('DOMContentLoaded', async () => {
  const grid = document.getElementById('gallery-grid');
  const empty = document.getElementById('gallery-empty');

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
        <img src="/api/cards/${card.id}/thumbnail" alt="${card.name}" loading="lazy">
        <div class="gallery-card-info">
          <div class="gallery-card-name">${card.name}</div>
          <div class="gallery-card-title">${card.title}</div>
        </div>
        <button class="delete-btn" data-id="${card.id}">Delete</button>
      `;
      grid.appendChild(el);
    });

    grid.addEventListener('click', async (e) => {
      const btn = e.target.closest('.delete-btn');
      if (!btn) return;

      const id = btn.dataset.id;
      if (!confirm('Delete this card? This cannot be undone.')) return;

      btn.disabled = true;
      btn.textContent = 'Deleting…';

      try {
        const resp = await fetch(`/api/cards/${id}`, { method: 'DELETE' });
        if (!resp.ok) throw new Error('Delete failed');
        btn.closest('.gallery-card').remove();

        if (grid.children.length === 0) {
          empty.style.display = 'block';
        }
      } catch (err) {
        console.error('Delete error:', err);
        btn.disabled = false;
        btn.textContent = 'Delete';
        alert('Failed to delete card.');
      }
    });
  } catch (err) {
    console.error('Manage load error:', err);
    empty.textContent = 'Could not load cards';
    empty.style.display = 'block';
  }
});
