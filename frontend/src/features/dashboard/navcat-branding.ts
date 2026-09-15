const NAVCAT_NAME = 'NavCat';

function catIcon() {
  return `
    <span class="navcat-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M6.4 8.2 7.6 3.8l3.1 2.4c.4-.1.9-.2 1.3-.2s.9.1 1.3.2l3.1-2.4 1.2 4.4c1.5 1.3 2.4 3.2 2.4 5.3 0 4.1-3.5 7.4-8 7.4s-8-3.3-8-7.4c0-2.1.9-4 2.4-5.3Zm2.5 4.1a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm6.2 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM12 17.2c1.4 0 2.5-.6 3.2-1.5l-1.3-.7c-.4.5-1.1.8-1.9.8s-1.5-.3-1.9-.8l-1.3.7c.7.9 1.8 1.5 3.2 1.5Z"/>
      </svg>
    </span>`;
}

function replaceAssistantCopy(text: string) {
  return text
    .replace('I’m JalRakshak Safety Assistant.', `Hi, I’m ${NAVCAT_NAME}.`)
    .replace("I'm JalRakshak Safety Assistant.", `Hi, I'm ${NAVCAT_NAME}.`)
    .replace('I’m JalRakshak AI.', `I’m ${NAVCAT_NAME}, JalRakshak’s safety assistant.`)
    .replace("I'm JalRakshak AI.", `I'm ${NAVCAT_NAME}, JalRakshak's safety assistant.`);
}

function applyNavCatBranding() {
  const screen = document.querySelector<HTMLElement>('.citizen-ai-screen');
  if (!screen) return;

  const brand = screen.querySelector<HTMLElement>('.ai-brand-label');
  if (brand && brand.dataset.navcatBranded !== 'true') {
    brand.innerHTML = `${catIcon()}<span class="navcat-name">${NAVCAT_NAME}</span>`;
    brand.dataset.navcatBranded = 'true';
    brand.setAttribute('aria-label', 'NavCat safety assistant');
  }

  const input = screen.querySelector<HTMLInputElement>('[data-ai-input]');
  if (input) input.placeholder = `Ask ${NAVCAT_NAME}…`;

  screen.querySelectorAll<HTMLElement>('.ai-message.assistant .ai-bubble').forEach((bubble) => {
    const current = bubble.textContent ?? '';
    const next = replaceAssistantCopy(current);
    if (next !== current) bubble.textContent = next;
  });
}

window.addEventListener('load', applyNavCatBranding);
window.addEventListener('jalrakshak:route-analysis', () => window.setTimeout(applyNavCatBranding, 0));
const navCatObserver = new MutationObserver(() => applyNavCatBranding());
navCatObserver.observe(document.documentElement, { childList: true, subtree: true });
applyNavCatBranding();
