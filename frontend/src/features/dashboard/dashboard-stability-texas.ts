const TEXAS_REPLACEMENTS: Array<[RegExp, string]> = [
  [/Bagmati Valley,?\s*Sindhupalchowk/gi, 'Houston, Harris County'],
  [/Bagmati Valley\s*·\s*Sindhupalchowk/gi, 'Houston · Harris County'],
  [/Sindhupalchowk/gi, 'Harris County'],
  [/Sindhupalchok/gi, 'Harris County'],
  [/Nepal Flood Intelligence Network/gi, 'Texas Gulf Flood Intelligence'],
  [/Nepal Flood Intelligence/gi, 'Texas Gulf Flood Intelligence'],
];

function normalizeVisibleLocationText(root: Node = document.body) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const original = node.nodeValue ?? '';
    let next = original;
    for (const [pattern, replacement] of TEXAS_REPLACEMENTS) next = next.replace(pattern, replacement);
    if (next !== original) node.nodeValue = next;
  }
}

// WorkerDashboard owns navigation and the dashboard host. Do not intercept its clicks.

let scheduled = false;
function scheduleNormalize() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    normalizeVisibleLocationText();
  });
}

const observer = new MutationObserver(scheduleNormalize);
const start = () => {
  normalizeVisibleLocationText();
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
