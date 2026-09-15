let pending: Promise<any> | null = null;

/** One loader shared by citizen and responder maps; failed loads can be retried. */
export function loadLeaflet(): Promise<any> {
  const existing = (window as any).L;
  if (existing?.map) return Promise.resolve(existing);
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-jalrakshak-leaflet]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.dataset.jalrakshakLeaflet = 'true';
      document.head.appendChild(link);
    }
    const previous = document.querySelector<HTMLScriptElement>('script[data-jalrakshak-leaflet]');
    const script = previous ?? document.createElement('script');
    const cleanup = () => {
      window.clearTimeout(timer);
      script.removeEventListener('load', loaded);
      script.removeEventListener('error', failed);
    };
    const loaded = () => {
      if (!(window as any).L?.map) { failed(); return; }
      cleanup(); resolve((window as any).L);
    };
    const failed = () => {
      cleanup(); script.remove(); pending = null;
      reject(new Error('The interactive map could not load. Check your connection and retry.'));
    };
    const timer = window.setTimeout(failed, 15_000);
    script.addEventListener('load', loaded, { once: true });
    script.addEventListener('error', failed, { once: true });
    if (!previous) {
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.crossOrigin = 'anonymous';
      script.async = true;
      script.dataset.jalrakshakLeaflet = 'true';
      document.body.appendChild(script);
    }
  });
  return pending;
}
