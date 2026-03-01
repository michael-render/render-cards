document.addEventListener('DOMContentLoaded', () => {
  const session = JSON.parse(sessionStorage.getItem('pickSession'));
  if (!session) {
    window.location.href = '/';
    return;
  }

  const statusEl = document.getElementById('pick-status');
  const variantsEl = document.getElementById('variants');

  // If variants were embedded (fallback mode), render immediately
  if (session.variants) {
    renderVariants(session.variants);
    return;
  }

  // Otherwise poll for workflow results
  if (session.sessionId) {
    pollVariants(session.sessionId);
  } else {
    showError('No session data found.');
  }

  function pollVariants(sessionId) {
    let polls = 0;
    const maxPolls = 30;
    const interval = 2000;

    const timer = setInterval(async () => {
      polls++;
      try {
        const res = await fetch(`/api/variants/${sessionId}`);
        if (!res.ok) throw new Error('Fetch failed');
        const data = await res.json();

        if (data.status === 'ready') {
          clearInterval(timer);
          renderVariants(data.variants);
        } else if (data.status === 'error') {
          clearInterval(timer);
          showError(data.error || 'Generation failed.');
        } else if (polls >= maxPolls) {
          clearInterval(timer);
          showError('Timed out waiting for variants.');
        }
      } catch (err) {
        clearInterval(timer);
        showError('Failed to load variants.');
      }
    }, interval);
  }

  function showError(msg) {
    statusEl.innerHTML = `<span>${msg}</span>`;
    statusEl.classList.add('error');
    statusEl.classList.remove('hidden');
  }

  function renderVariants(variants) {
    statusEl.classList.add('hidden');
    variantsEl.innerHTML = '';

    variants.forEach((v, i) => {
      const card = document.createElement('div');
      card.className = 'variant-card';
      card.innerHTML = `
        <span class="variant-number">${i + 1} / 3</span>
        <div class="variant-emoji">${v.resolvedEmoji || '🤙'}</div>
        <div class="variant-title">${escapeHtml(v.funTitle)}</div>
        <div class="variant-tagline">"${escapeHtml(v.tagline)}"</div>
        <div class="variant-stats">
          ${(v.stats || []).map((s, si) => `
            <div class="variant-stat-row">
              <span class="variant-stat-label">${escapeHtml(s.label)}</span>
              <div class="variant-stat-track">
                <div class="variant-stat-fill" style="width: 0%"></div>
              </div>
              <span class="variant-stat-value">${s.value}</span>
            </div>
          `).join('')}
        </div>
      `;

      card.addEventListener('click', () => selectVariant(v));
      variantsEl.appendChild(card);
    });

    // Animate stat bars in after a brief delay
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        variantsEl.querySelectorAll('.variant-stat-fill').forEach(bar => {
          const value = bar.closest('.variant-stat-row').querySelector('.variant-stat-value').textContent;
          bar.style.width = `${value}%`;
        });
      });
    });
  }

  function selectVariant(variant) {
    const cardData = {
      name: session.name,
      role: session.role,
      photo: session.photo,
      responses: session.responses,
      funTitle: variant.funTitle,
      tagline: variant.tagline,
      resolvedEmoji: variant.resolvedEmoji,
      stats: variant.stats,
    };

    sessionStorage.setItem('cardData', JSON.stringify(cardData));
    sessionStorage.removeItem('pickSession');
    window.location.href = '/card.html';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
});
