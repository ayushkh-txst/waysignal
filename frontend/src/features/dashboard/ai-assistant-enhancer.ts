import { citizenSafetyApi, type EmergencyRecord, type EvacuationRoute, type SafetyContext } from './api/citizen-safety.api';
import { runNavCatAction, type NavCatAction } from './navcat-action-engine';

type Message = { id: string; role: 'assistant' | 'user'; text: string; createdAt: number; actions?: NavCatAction[]; inputMode?: 'text' | 'voice' };
type SpeechRecognitionCtor = new () => any;

const CHAT_HISTORY_KEY = 'jalrakshak:citizen-ai-history:v1';
const WELCOME_TEXT = 'Hi, I’m NavCat. I’m here to help you stay safe and use JalRakshak. Ask me to find a safe place, explain any feature, guide you step by step, or get emergency help.';
const NAVCAT_OVERLAY_ID = 'jalrakshak-navcat-overlay';

let latestRoute: EvacuationRoute | null = null;
let latestSafety: SafetyContext | null = null;
let latestEmergency: EmergencyRecord | null = null;
let messages: Message[] = loadHistory();
let voiceEnabled = false;
let listening = false;
let crisisMode = false;
let lastLocationKey = '';
let refreshTimer: number | null = null;
let responsePending = false;
let composerDraft = '';
let assistantMounted = false;
let activeRecognition: any = null;

function createMessage(role: Message['role'], text: string, actions?: NavCatAction[], inputMode: Message['inputMode'] = 'text'): Message {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role, text, actions, createdAt: Date.now(), inputMode };
}
function loadHistory(): Message[] { try { const parsed = JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) ?? '[]'); return Array.isArray(parsed) ? parsed.filter((item:any) => item && (item.role === 'assistant' || item.role === 'user') && typeof item.text === 'string').slice(-80) : []; } catch { return []; } }
function saveHistory() { try { localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(messages.slice(-80))); } catch {} }
function citizenName() { return document.querySelector<HTMLElement>('.sidebar-user strong')?.textContent?.trim() || 'there'; }
function locationLabel() { const raw = document.querySelector<HTMLElement>('.location-line')?.textContent?.replace(/\s+/g, ' ').trim() ?? ''; return raw.replace(/^⌖\s*/, '').replace(/\s*·\s*LIVE\s*$/, '').trim() || 'your current area'; }
function getCurrentPosition(): Promise<GeolocationPosition | null> { if (!navigator.geolocation) return Promise.resolve(null); return new Promise((resolve) => navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 4500, maximumAge: 15000 })); }
async function refreshContext() { const position = await getCurrentPosition(); if (position) { const key = `${position.coords.latitude.toFixed(3)},${position.coords.longitude.toFixed(3)}`; if (key !== lastLocationKey || !latestSafety) { lastLocationKey = key; try { latestSafety = await citizenSafetyApi.getContext(position.coords.latitude, position.coords.longitude); } catch {} } } try { const records = await citizenSafetyApi.listEmergencies(); latestEmergency = records.filter((item) => !item.is_demo && item.status !== 'cancelled').sort((a,b) => Date.parse(b.updated_at ?? b.created_at) - Date.parse(a.updated_at ?? a.created_at))[0] ?? null; } catch {} }
function speak(text:string) {
  if (!voiceEnabled || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = crisisMode ? 0.92 : 1;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}
function escapeHtml(value:string) { return value.replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char] ?? char)); }
function renderAction(action:NavCatAction, messageId:string, index:number) { if (action.kind === 'call') return `<button type="button" class="navcat-result-action emergency" data-navcat-action="call" data-navcat-phone="${escapeHtml(action.phone)}" data-message="${escapeHtml(messageId)}-${index}">${escapeHtml(action.label)}</button>`; return `<button type="button" class="navcat-result-action" data-navcat-action="${action.kind}" data-message="${escapeHtml(messageId)}-${index}">${escapeHtml(action.label)}</button>`; }
function renderMessages() {
  const visible = messages.length ? messages : [createMessage('assistant', WELCOME_TEXT)];
  return visible.map((message) => `<div class="ai-message ${message.role}" data-message-id="${escapeHtml(message.id)}"><div class="ai-message-wrap"><div class="ai-bubble"><div>${message.role === 'user' && message.inputMode === 'voice' ? '<span class="navcat-voice-note" title="Voice message">🎙 </span>' : ''}${escapeHtml(message.text)}</div>${message.actions?.length ? `<div class="navcat-result-actions">${message.actions.map((action,index) => renderAction(action,message.id,index)).join('')}</div>` : ''}</div>${messages.length ? `<button type="button" class="ai-delete-message" data-ai-delete="${escapeHtml(message.id)}" aria-label="Delete this message">×</button>` : ''}</div></div>`).join('');
}
function quickActions() { const items = [['risk','My risk'],['route','Safest route'],['explain','Explain feature'],['weather','Weather update'],['responder','Responder status'],['scared',"I'm scared"],['stuck',"I'm stuck"],['medical','Medical help'],['guide','Guide me']]; return items.map(([key,label]) => `<button type="button" data-ai-quick="${key}">${label}</button>`).join(''); }

function renderAssistant(section:HTMLElement) {
  const previousInput = section.querySelector<HTMLInputElement>('[data-ai-input]');
  if (previousInput) composerDraft = previousInput.value;
  const focused = document.activeElement === previousInput;
  section.className = `citizen-ai-screen navcat-overlay-screen ${crisisMode ? 'crisis-mode' : ''}`;
  section.innerHTML = `<div class="navcat-shell">
    <aside class="navcat-left-rail">
      <div class="navcat-left-title">NavCat</div>
      <div class="ai-history-controls"></div>
      <div class="navcat-left-help">Your saved chats stay here unless you delete them.</div>
    </aside>
    <main class="navcat-chat-main">
      <div class="ai-header"><span class="ai-brand-label">NavCat</span></div>
      <div class="ai-layout"><section class="ai-chat-card">
        <div class="ai-messages" aria-live="polite">${renderMessages()}${responsePending ? '<div class="navcat-thinking">NavCat is checking live safety data…</div>' : ''}</div>
        <div class="ai-quick-actions">${quickActions()}</div>
        <form class="ai-input-row">
          <span class="ai-chat-composer-label">💬 Chat</span>
          <button type="button" class="ai-mic ${listening ? 'listening' : ''} ${voiceEnabled ? 'voice-enabled' : ''}" data-ai-mic aria-pressed="${voiceEnabled}">${listening ? '■ Listening' : voiceEnabled ? '🔊 Voice on' : '🎙 Voice'}</button>
          <input type="text" data-ai-input placeholder="Ask NavCat…" autocomplete="off" value="${escapeHtml(composerDraft)}" ${responsePending ? 'disabled' : ''}/>
          <button type="submit" class="ai-send" ${responsePending ? 'disabled' : ''}>Send</button>
        </form>
        <div class="ai-disclaimer">Chat and voice use the same NavCat safety engine, live context, history, routing, emergency actions, and follow-up memory.</div>
      </section></div>
    </main>
  </div>`;
  wireAssistant(section);
  window.setTimeout(() => {
    const box = section.querySelector<HTMLElement>('.ai-messages'); if (box) box.scrollTop = box.scrollHeight;
    const input = section.querySelector<HTMLInputElement>('[data-ai-input]');
    if (focused && input && !input.disabled) { input.focus({ preventScroll:true }); try { input.setSelectionRange(input.value.length,input.value.length); } catch {} }
  }, 0);
}

function clickSidebarNav(label:string) { const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.figma-nav button')); const target = buttons.find((button) => button.textContent?.replace(/\s+/g,' ').trim().includes(label)); if (!target) return false; target.click(); return true; }
function executeResultAction(action:string, phone?:string) { if (action === 'emergency_help') { clickSidebarNav('Emergency Help'); return; } if (action === 'open_map') { clickSidebarNav('Live Map'); return; } if (action === 'call' && phone) window.location.href = `tel:${phone}`; }

async function addUserMessage(section:HTMLElement, text:string, inputMode:Message['inputMode']='text') {
  const clean = text.trim(); if (!clean || responsePending) return;
  composerDraft = '';
  messages.push(createMessage('user',clean,undefined,inputMode)); saveHistory(); responsePending = true; renderAssistant(section);
  await refreshContext();
  const result = await runNavCatAction(clean, {
    userName: citizenName(), placeLabel: locationLabel(), latestRoute, latestSafety,
    latestEmergencyStatus: latestEmergency?.status ?? null,
    latestResponderName: latestEmergency?.responder_name ?? null,
    conversation: messages.slice(-20).map((message) => ({ role: message.role, text: message.text })),
  });
  if (result.route) latestRoute = result.route;
  crisisMode = Boolean(result.crisis);
  messages.push(createMessage('assistant', result.text, result.actions)); saveHistory(); responsePending = false; renderAssistant(section); speak(result.text);
}
function deleteMessage(section:HTMLElement,id:string) { messages = messages.filter((message) => message.id !== id); saveHistory(); renderAssistant(section); }
function stopListening(section:HTMLElement) {
  try { activeRecognition?.stop?.(); } catch {}
  activeRecognition = null;
  listening = false;
  renderAssistant(section);
}
function startVoice(section:HTMLElement) {
  const browser = window as any;
  const Recognition = (browser.SpeechRecognition || browser.webkitSpeechRecognition) as SpeechRecognitionCtor | undefined;
  if (!Recognition) {
    messages.push(createMessage('assistant','Voice input is not supported in this browser. You can still type a short request.'));
    saveHistory(); renderAssistant(section); return;
  }
  if (listening) { stopListening(section); return; }
  voiceEnabled = true;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  const recognition = new Recognition();
  activeRecognition = recognition;
  recognition.lang = 'en-US';
  recognition.interimResults = true;
  recognition.continuous = false;
  listening = true;
  renderAssistant(section);
  recognition.onresult = (event:any) => {
    let interim = '';
    let finalText = '';
    for (let index = event.resultIndex ?? 0; index < event.results.length; index += 1) {
      const transcript = event.results[index]?.[0]?.transcript ?? '';
      if (event.results[index]?.isFinal) finalText += transcript;
      else interim += transcript;
    }
    composerDraft = (finalText || interim).trim();
    const input = section.querySelector<HTMLInputElement>('[data-ai-input]');
    if (input) input.value = composerDraft;
    if (finalText.trim()) {
      listening = false;
      activeRecognition = null;
      void addUserMessage(section, finalText.trim(), 'voice');
    }
  };
  recognition.onerror = (event:any) => {
    listening = false;
    activeRecognition = null;
    const code = event?.error ?? '';
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      messages.push(createMessage('assistant','Microphone access is blocked. Allow microphone permission for this site, then press Voice again.'));
      saveHistory();
    }
    renderAssistant(section);
  };
  recognition.onend = () => {
    activeRecognition = null;
    if (listening) {
      listening = false;
      const captured = composerDraft.trim();
      if (captured) void addUserMessage(section,captured,'voice');
      else renderAssistant(section);
    }
  };
  recognition.start();
}
function wireAssistant(section:HTMLElement) {
  const input = section.querySelector<HTMLInputElement>('[data-ai-input]');
  input?.addEventListener('input', () => { composerDraft = input.value; });
  section.querySelector<HTMLFormElement>('.ai-input-row')?.addEventListener('submit', (event) => { event.preventDefault(); if (input) void addUserMessage(section,input.value,'text'); });
  section.querySelector<HTMLButtonElement>('[data-ai-mic]')?.addEventListener('click', () => startVoice(section));
  section.querySelectorAll<HTMLButtonElement>('[data-ai-delete]').forEach((button) => button.addEventListener('click', () => { if (button.dataset.aiDelete) deleteMessage(section,button.dataset.aiDelete); }));
  section.querySelectorAll<HTMLButtonElement>('[data-navcat-action]').forEach((button) => button.addEventListener('click', () => executeResultAction(button.dataset.navcatAction ?? '',button.dataset.navcatPhone)));
  section.querySelectorAll<HTMLButtonElement>('[data-ai-quick]').forEach((button) => button.addEventListener('click', () => { const prompts:Record<string,string> = { risk:'Am I safe right now?', route:'Find me the safest route from my current location.', explain:'Explain how to use the safest-route feature step by step.', weather:'Is the rain dangerous right now?', responder:'What is my responder status?', scared:"I'm scared.", stuck:"I'm stuck and can't evacuate.", medical:'I need medical help.', guide:'Guide me to safety.' }; void addUserMessage(section,prompts[button.dataset.aiQuick ?? ''] ?? '','text'); }));
}

function removeNavCatOverlay() { document.getElementById(NAVCAT_OVERLAY_ID)?.remove(); assistantMounted = false; }
function positionOverlay(placeholder:HTMLElement, overlay:HTMLElement) { const rect = placeholder.getBoundingClientRect(); Object.assign(overlay.style,{ position:'fixed', left:`${Math.max(0,rect.left)}px`, top:`${Math.max(0,rect.top)}px`, width:`${Math.max(320,rect.width)}px`, height:`${Math.max(320,window.innerHeight-Math.max(0,rect.top))}px`, zIndex:'30', overflow:'hidden', background:'#fbf7ef' }); }
function getOrCreateNavCatOverlay(placeholder:HTMLElement) { let overlay = document.getElementById(NAVCAT_OVERLAY_ID) as HTMLElement | null; if (!overlay) { overlay = document.createElement('section'); overlay.id = NAVCAT_OVERLAY_ID; document.body.appendChild(overlay); } positionOverlay(placeholder,overlay); return overlay; }
function maybeEnhanceAssistant() {
  const placeholder = document.querySelector<HTMLElement>('.figma-placeholder-panel');
  const onAssistant = placeholder?.querySelector('h2')?.textContent?.trim() === 'AI Assistant';
  if (onAssistant && placeholder) {
    const overlay = getOrCreateNavCatOverlay(placeholder);
    if (!assistantMounted) { assistantMounted = true; renderAssistant(overlay); void refreshContext(); }
    if (refreshTimer == null) refreshTimer = window.setInterval(() => void refreshContext(), 12_000);
    return;
  }
  removeNavCatOverlay();
  if (refreshTimer != null) { window.clearInterval(refreshTimer); refreshTimer = null; }
}
window.addEventListener('resize', maybeEnhanceAssistant);
window.addEventListener('jalrakshak:navcat-new-chat', () => { const section = document.getElementById(NAVCAT_OVERLAY_ID) as HTMLElement | null; if (!section) return; try { activeRecognition?.stop?.(); } catch {} activeRecognition=null; listening=false; messages=[]; composerDraft=''; crisisMode=false; responsePending=false; saveHistory(); if ('speechSynthesis' in window) window.speechSynthesis.cancel(); renderAssistant(section); });
window.addEventListener('jalrakshak:navcat-load-session', (event) => { const section = document.getElementById(NAVCAT_OVERLAY_ID) as HTMLElement | null; if (!section) return; const detail = (event as CustomEvent<{messages?:Message[]}>).detail; const incoming = Array.isArray(detail?.messages) ? detail.messages : []; messages = incoming.filter((message) => message && (message.role==='assistant'||message.role==='user') && typeof message.text==='string').map((message) => ({ id:message.id||`${Date.now()}-${Math.random().toString(36).slice(2,8)}`, role:message.role, text:message.text, actions:message.actions, inputMode:message.inputMode ?? 'text', createdAt:message.createdAt||Date.now() })); composerDraft=''; crisisMode=false; responsePending=false; saveHistory(); renderAssistant(section); });
window.addEventListener('jalrakshak:route-analysis', (event) => { const next = (event as CustomEvent<EvacuationRoute>).detail; if (next) latestRoute = next; });
const observer = new MutationObserver((mutations) => { const overlay = document.getElementById(NAVCAT_OVERLAY_ID); if (overlay && mutations.every((mutation) => Array.from(mutation.addedNodes).every((node) => node === overlay || (node instanceof Node && overlay.contains(node))))) return; maybeEnhanceAssistant(); });
observer.observe(document.body,{childList:true,subtree:true});
maybeEnhanceAssistant();