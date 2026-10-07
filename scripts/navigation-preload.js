(() => {
  const warmed = new Set();
  const warm = link => {
    const href = link?.getAttribute('href');
    if (!href || !/^\/(?:src(?:\/[a-z0-9-]+)?|)$/.test(href)) return;
    const url = new URL(href, location.href).href;
    if (url === location.href || warmed.has(url)) return;
    warmed.add(url);
    fetch(url, { credentials: 'same-origin', priority: 'low' })
      .then(response => {
        if (!response.ok) throw new Error('preload failed');
        return response.arrayBuffer();
      })
      .catch(() => warmed.delete(url));
  };
  const connection = navigator.connection;
  if (!connection?.saveData && !['slow-2g', '2g'].includes(connection?.effectiveType)) {
    document.querySelectorAll('a[href^="/src"]').forEach(warm);
  }
  for (const type of ['pointerover', 'focusin', 'touchstart']) {
    document.addEventListener(type, event => warm(event.target.closest?.('a')), { passive: true });
  }
})();
