type StoredMessage = { id?: string; role: 'assistant' | 'user'; text: string; createdAt?: number };
type ChatSession = { id: string; title: string; messages: StoredMessage[]; updatedAt: number };

const ACTIVE_HISTORY_KEY = 'jalrakshak:citizen-ai-history:v1';
const SESSION_KEY = 'jalrakshak:navcat-sessions:v1';
const ACTIVE_SESSION_KEY = 'jalrakshak:navcat-active-session:v1';
const DRAFT_KEY = 'jalrakshak:navcat-draft:v1';

let historyOpen = false;
let draft = sessionStorage.getItem(DRAFT_KEY) ?? '';
let inputWasFocused = false;
let applying = false;

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readMessages(): StoredMessage[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACTIVE_HISTORY_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((m) => m && (m.role === 'assistant' || m.role === 'user') && typeof m.text === 'string')
      : [];
  } catch {
    return [];
  }
}

function readSessions(): ChatSession[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: ChatSession[]) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(sessions.slice(0, 30)));
}

function titleFrom(messages: StoredMessage[]) {
  const firstUser = messages.find((m) => m.role === 'user')?.text?.trim();
  if (!firstUser) return 'New chat';
  return firstUser.length > 38 ? `${firstUser.slice(0, 38).trim()}…` : firstUser;
}

function hasUserMessage(messages: StoredMessage[]) {
  return messages.some((message) => message.role === 'user' && message.text.trim().length > 0);
}

function ensureActiveSession() {
  let sessions = readSessions();
  let activeId = localStorage.getItem(ACTIVE_SESSION_KEY);
  const currentMessages = readMessages();

  if (!activeId || !sessions.some((s) => s.id === activeId)) {
    activeId = uid();
    sessions.unshift({ id: activeId, title: titleFrom(currentMessages), messages: currentMessages, updatedAt: Date.now() });
    localStorage.setItem(ACTIVE_SESSION_KEY, activeId);
    saveSessions(sessions);
  }
  return activeId;
}

function syncActiveSession() {
  const activeId = ensureActiveSession();
  const currentMessages = readMessages();
  const sessions = readSessions();
  const index = sessions.findIndex((s) => s.id === activeId);
  const next: ChatSession = {
    id: activeId,
    title: titleFrom(currentMessages),
    messages: currentMessages,
    updatedAt: Date.now(),
  };
  if (index >= 0) sessions[index] = next;
  else sessions.unshift(next);
  sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  saveSessions(sessions);
}

function refreshHistoryControls() {
  const controls = document.querySelector<HTMLElement>('.ai-history-controls');
  if (controls) delete controls.dataset.navcatHistorySignature;
  window.setTimeout(applyHistoryUi, 0);
}

function newChat() {
  syncActiveSession();
  let sessions = readSessions();
  const currentId = localStorage.getItem(ACTIVE_SESSION_KEY);
  const current = sessions.find((session) => session.id === currentId);

  if (current && !hasUserMessage(current.messages ?? [])) {
    sessions = sessions.filter((session) => session.id !== current.id);
  }

  const id = uid();
  sessions.unshift({ id, title: 'New chat', messages: [], updatedAt: Date.now() });
  saveSessions(sessions);
  localStorage.setItem(ACTIVE_SESSION_KEY, id);
  localStorage.setItem(ACTIVE_HISTORY_KEY, '[]');
  sessionStorage.removeItem(DRAFT_KEY);
  draft = '';
  historyOpen = false;

  window.dispatchEvent(new CustomEvent('jalrakshak:navcat-new-chat'));
  refreshHistoryControls();
}

function openSession(id: string) {
  syncActiveSession();
  const session = readSessions().find((s) => s.id === id);
  if (!session) return;

  localStorage.setItem(ACTIVE_SESSION_KEY, id);
  localStorage.setItem(ACTIVE_HISTORY_KEY, JSON.stringify(session.messages ?? []));
  sessionStorage.removeItem(DRAFT_KEY);
  draft = '';
  historyOpen = false;

  window.dispatchEvent(new CustomEvent('jalrakshak:navcat-load-session', {
    detail: { messages: session.messages ?? [] },
  }));
  refreshHistoryControls();
}

function deleteSession(id: string) {
  const activeId = ensureActiveSession();
  let sessions = readSessions().filter((s) => s.id !== id);

  if (id === activeId) {
    const next = sessions[0] ?? { id: uid(), title: 'New chat', messages: [], updatedAt: Date.now() };
    if (!sessions.length) sessions = [next];
    localStorage.setItem(ACTIVE_SESSION_KEY, next.id);
    localStorage.setItem(ACTIVE_HISTORY_KEY, JSON.stringify(next.messages ?? []));
    saveSessions(sessions);
    historyOpen = false;
    window.dispatchEvent(new CustomEvent('jalrakshak:navcat-load-session', {
      detail: { messages: next.messages ?? [] },
    }));
    refreshHistoryControls();
    return;
  }

  saveSessions(sessions);
  refreshHistoryControls();
}

function escapeHtml(value: string) {
  return value.replace(/[&<>\"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;' }[char] ?? char));
}

function visibleHistorySessions() {
  return readSessions()
    .filter((session) => hasUserMessage(session.messages ?? []))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function historyListHtml() {
  const activeId = ensureActiveSession();
  const sessions = visibleHistorySessions();
  if (!sessions.length) return '<div class="navcat-history-empty">No previous chats yet</div>';

  return sessions.map((session) => `
    <div class="navcat-history-row ${session.id === activeId ? 'active' : ''}">
      <button type="button" class="navcat-history-item" data-navcat-session="${escapeHtml(session.id)}">
        <span>${escapeHtml(session.title || 'New chat')}</span>
        <small>${session.messages?.length ?? 0} messages</small>
      </button>
      <button type="button" class="navcat-history-delete" data-navcat-delete-session="${escapeHtml(session.id)}" aria-label="Delete chat">×</button>
    </div>`).join('');
}

function historySignature() {
  const activeId = ensureActiveSession();
  const compact = readSessions().map((s) => `${s.id}:${s.title}:${s.messages?.length ?? 0}:${s.updatedAt}`).join('|');
  return `${historyOpen ? 'open' : 'closed'}:${activeId}:${compact}`;
}

function applyHistoryUi() {
  if (applying) return;
  const screen = document.querySelector<HTMLElement>('.citizen-ai-screen');
  const controls = screen?.querySelector<HTMLElement>('.ai-history-controls');
  if (!screen || !controls) return;

  syncActiveSession();
  const signature = historySignature();
  if (controls.dataset.navcatHistorySignature === signature && controls.querySelector('.navcat-history-shell')) return;

  applying = true;
  controls.innerHTML = `
    <div class="navcat-history-shell">
      <button type="button" class="navcat-history-toggle ${historyOpen ? 'active' : ''}" data-navcat-history>History</button>
      <button type="button" class="navcat-new-chat" data-navcat-new>+ New chat</button>
      ${historyOpen ? `
        <aside class="navcat-history-menu" aria-label="NavCat chat history">
          <div class="navcat-history-panel-head">
            <strong>NavCat</strong>
            <button type="button" class="navcat-history-close" data-navcat-history-close aria-label="Close history">×</button>
          </div>
          <button type="button" class="navcat-history-new-wide" data-navcat-new-panel>✎ New chat</button>
          <div class="navcat-history-title">Recents</div>
          <div class="navcat-history-list">${historyListHtml()}</div>
        </aside>` : ''}
    </div>`;
  controls.dataset.navcatHistorySignature = signature;

  controls.querySelector<HTMLButtonElement>('[data-navcat-history]')?.addEventListener('click', () => {
    historyOpen = !historyOpen;
    delete controls.dataset.navcatHistorySignature;
    applyHistoryUi();
  });
  controls.querySelector<HTMLButtonElement>('[data-navcat-history-close]')?.addEventListener('click', () => {
    historyOpen = false;
    delete controls.dataset.navcatHistorySignature;
    applyHistoryUi();
  });
  controls.querySelector<HTMLButtonElement>('[data-navcat-new]')?.addEventListener('click', newChat);
  controls.querySelector<HTMLButtonElement>('[data-navcat-new-panel]')?.addEventListener('click', newChat);
  controls.querySelectorAll<HTMLButtonElement>('[data-navcat-session]').forEach((button) => {
    button.addEventListener('click', () => openSession(button.dataset.navcatSession ?? ''));
  });
  controls.querySelectorAll<HTMLButtonElement>('[data-navcat-delete-session]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      deleteSession(button.dataset.navcatDeleteSession ?? '');
    });
  });
  applying = false;
}

function restoreDraft() {
  const input = document.querySelector<HTMLInputElement>('[data-ai-input]');
  if (!input) return;
  if (draft && input.value !== draft) {
    input.value = draft;
    if (inputWasFocused) {
      input.focus({ preventScroll: true });
      const end = input.value.length;
      try { input.setSelectionRange(end, end); } catch { /* not supported */ }
    }
  }
}

function applyEnhancements() {
  if (!document.querySelector('.citizen-ai-screen')) return;
  applyHistoryUi();
  restoreDraft();
}

ensureActiveSession();
syncActiveSession();

document.addEventListener('input', (event) => {
  const target = event.target as HTMLInputElement | null;
  if (!target?.matches?.('[data-ai-input]')) return;
  draft = target.value;
  sessionStorage.setItem(DRAFT_KEY, draft);
});

document.addEventListener('focusin', (event) => {
  if ((event.target as HTMLElement | null)?.matches?.('[data-ai-input]')) inputWasFocused = true;
});

document.addEventListener('focusout', (event) => {
  if ((event.target as HTMLElement | null)?.matches?.('[data-ai-input]')) inputWasFocused = false;
});

document.addEventListener('submit', (event) => {
  const form = event.target as HTMLFormElement | null;
  if (!form?.matches?.('.ai-input-row')) return;
  draft = '';
  sessionStorage.removeItem(DRAFT_KEY);
  window.setTimeout(() => {
    syncActiveSession();
    refreshHistoryControls();
  }, 120);
}, true);

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement | null;
  if (!target?.closest('.navcat-history-shell') && historyOpen) {
    historyOpen = false;
    refreshHistoryControls();
  }
});

window.addEventListener('beforeunload', syncActiveSession);
window.addEventListener('load', applyEnhancements);
const historyObserver = new MutationObserver(() => window.setTimeout(applyEnhancements, 0));
historyObserver.observe(document.documentElement, { childList: true, subtree: true });
applyEnhancements();
