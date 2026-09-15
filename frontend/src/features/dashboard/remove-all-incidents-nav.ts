function removeAllIncidentsNav() {
  if (!window.location.pathname.includes('/responder')) return;

  document.querySelectorAll<HTMLButtonElement>('.ops-nav button').forEach((button) => {
    const label = button.querySelector('span')?.textContent?.trim();
    if (label === 'All Incidents') button.remove();
  });

  // If an older static registry view is still mounted, remove it and restore the queue.
  document.querySelector<HTMLElement>('[data-incident-registry-v2]')?.remove();
  document.querySelectorAll<HTMLElement>('.command-center-static-view').forEach((view) => {
    const text = view.textContent || '';
    if (text.includes('Incident registry') || text.includes('All requests')) view.remove();
  });

  const queue = document.querySelector<HTMLElement>('.ops-queue-pane');
  const detail = document.querySelector<HTMLElement>('.ops-detail-pane');
  if (queue) queue.style.display = '';
  if (detail) detail.style.display = '';
}

function start() {
  removeAllIncidentsNav();
  new MutationObserver(removeAllIncidentsNav).observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
