type ScreenKind='live_map'|'alerts'|'ai'|'emergency'|'overview'|'responder'|'unknown';

type ScreenExplanation={title:string;summary:string;steps:string[]};

const SCREENS:Record<Exclude<ScreenKind,'unknown'>,ScreenExplanation>={
  live_map:{title:'Live Safety Map',summary:'This screen finds a safer destination from the user’s current GPS position, calculates real-road evacuation options, screens them against modeled and user-reported hazards, and recommends the best viable route.',steps:['Tap Use my location.','Wait for the route analysis to finish.','Check analyzed, rejected, viable, and recommended route counts.','Review the destination, ETA, distance, and route explanation.','Start guidance or report that you cannot evacuate if moving is unsafe.']},
  alerts:{title:'Alerts',summary:'This screen separates critical safety alerts, route updates, responder updates, and system notices so the user can tell what changed and where the information came from.',steps:['Open the alert category you need.','Read the source label before acting.','Use route updates to see whether navigation changed.','Open Live Map when an alert affects your route.']},
  ai:{title:'NavCat AI Assistant',summary:'NavCat is JalRakshak’s safety assistant. Text, voice, and image help are meant to use the same safety context so the user can ask naturally instead of learning the app workflow.',steps:['Type, speak, or attach a screenshot.','Ask the question in normal words.','NavCat explains the feature or performs supported safety actions.','Use the action buttons when NavCat offers a route, SOS, or map action.']},
  emergency:{title:'Emergency Help',summary:'This screen creates and tracks an SOS request using the citizen’s current location and available safety context.',steps:['Choose Rescue, Medical, or Evacuation.','Confirm the number of people and add useful notes.','Use current GPS location.','Submit the SOS.','Keep the page open to follow responder assignment and status updates.']},
  overview:{title:'Citizen Overview',summary:'This is the citizen dashboard summary. It gives quick access to risk, alerts, map, emergency help, and the main safety tools.',steps:['Check the current safety summary.','Review any active alert.','Open Live Map for evacuation guidance.','Use Emergency Help when immediate assistance is needed.']},
  responder:{title:'Responder Emergency Queue',summary:'This is the responder workflow for reviewing active SOS requests, assigning responders, tracking progress, and resolving incidents.',steps:['Open the newest or highest-priority request.','Review citizen location, risk, notes, and people count.','Assign the appropriate responder.','Mark progress as en route and on scene.','Resolve the incident only after response is complete.']},
};

function escapeHtml(value:string){return value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]??c));}

function classify(text:string):ScreenKind{
  const t=text.toLowerCase();
  if(/safest route around you|recommended evacuation|route analysis|use my location|start guidance/.test(t))return'live_map';
  if(/critical alerts|route updates|responder updates|system notices|what needs your attention/.test(t))return'alerts';
  if(/navcat|ai assistant|ask navcat|new chat/.test(t))return'ai';
  if(/request immediate assistance|emergency help|waiting for a responder|i need help|response complete/.test(t))return'emergency';
  if(/approve requests|emergency queue|assigned responder|mark en route|resolve incident/.test(t))return'responder';
  if(/overview|citizen safety/.test(t))return'overview';
  return'unknown';
}

async function detectTextFromImage(src:string):Promise<string>{
  const Detector=(window as any).TextDetector;
  if(!Detector)return'';
  try{
    const response=await fetch(src);
    const blob=await response.blob();
    const bitmap=await createImageBitmap(blob);
    const detector=new Detector();
    const blocks=await detector.detect(bitmap);
    bitmap.close?.();
    return blocks.map((item:any)=>item.rawValue??item.text??'').filter(Boolean).join(' ');
  }catch{return'';}
}

function promptMode(prompt:string){const t=prompt.toLowerCase();if(/step|how do i|how to|use this|what do i do/.test(t))return'steps';if(/why/.test(t))return'why';return'overview';}

function explanationHtml(kind:Exclude<ScreenKind,'unknown'>,prompt:string){
  const item=SCREENS[kind],mode=promptMode(prompt);
  const intro=mode==='steps'?`Here is how to use the ${item.title}:`:mode==='why'?`${item.title} exists to make this workflow easier during a safety situation.`:`This looks like the ${item.title}.`;
  return `<div class="navcat-hazard-source">PROJECT SCREEN</div><strong>${escapeHtml(intro)}</strong><p>${escapeHtml(item.summary)}</p><ol class="navcat-image-steps">${item.steps.map(step=>`<li>${escapeHtml(step)}</li>`).join('')}</ol><p class="navcat-image-note">You can keep asking follow-up questions about this screen in normal words.</p>`;
}

function appendCard(html:string){
  const box=document.querySelector<HTMLElement>('#jalrakshak-navcat-overlay .ai-messages');
  if(!box)return;
  const card=document.createElement('div');card.className='navcat-hazard-chat-card navcat-image-explanation';card.innerHTML=html;box.appendChild(card);box.scrollTop=box.scrollHeight;
}

function screenChooser(prompt:string){
  appendCard(`<div class="navcat-hazard-source">SCREENSHOT HELP</div><strong>I can explain this JalRakshak screen.</strong><p>This browser did not expose local screenshot text detection, so choose the screen shown in the image:</p><div class="navcat-screen-choices">${(['live_map','alerts','emergency','ai','overview','responder'] as const).map(kind=>`<button type="button" data-navcat-screen="${kind}">${escapeHtml(SCREENS[kind].title)}</button>`).join('')}</div>`);
  document.querySelectorAll<HTMLButtonElement>('[data-navcat-screen]').forEach(button=>button.addEventListener('click',()=>{
    const kind=button.dataset.navcatScreen as Exclude<ScreenKind,'unknown'>;appendCard(explanationHtml(kind,prompt));button.closest('.navcat-image-explanation')?.remove();
  },{once:true}));
}

async function explainPickerImage(panel:HTMLElement){
  const img=panel.querySelector<HTMLImageElement>('.navcat-hazard-preview img');if(!img)return;
  const composer=document.querySelector<HTMLInputElement>('#jalrakshak-navcat-overlay [data-ai-input]');
  const prompt=composer?.value.trim()||'Explain what this JalRakshak screenshot shows and how to use it.';
  if(composer)composer.value='';
  appendCard(`<div class="navcat-hazard-source">IMAGE</div><strong>${escapeHtml(prompt)}</strong><p>NavCat is checking the screenshot locally for JalRakshak screen text…</p>`);
  const text=await detectTextFromImage(img.src);const kind=classify(text);
  document.querySelectorAll('.navcat-image-explanation').forEach((el,index,list)=>{if(index===list.length-1)el.remove();});
  if(kind==='unknown'){screenChooser(prompt);return;}
  appendCard(explanationHtml(kind,prompt));
  const voice=document.querySelector<HTMLElement>('#jalrakshak-navcat-overlay [data-ai-mic].voice-enabled');
  if(voice&&'speechSynthesis'in window){const u=new SpeechSynthesisUtterance(`${SCREENS[kind].title}. ${SCREENS[kind].summary}`);window.speechSynthesis.cancel();window.speechSynthesis.speak(u);}
}

function enhancePicker(){
  const panel=document.querySelector<HTMLElement>('.navcat-hazard-picker');if(!panel||panel.dataset.imageExplainer==='true')return;panel.dataset.imageExplainer='true';
  const copy=panel.querySelector<HTMLElement>('.navcat-hazard-picker-copy');if(!copy)return;
  const section=document.createElement('div');section.className='navcat-image-mode';section.innerHTML=`<div class="navcat-hazard-source">WHAT DO YOU WANT TO DO?</div><div class="navcat-image-mode-actions"><button type="button" data-navcat-explain-image>Explain this screenshot</button><span>or report the image as a road/flood hazard below</span></div>`;copy.prepend(section);
  section.querySelector<HTMLButtonElement>('[data-navcat-explain-image]')?.addEventListener('click',()=>void explainPickerImage(panel));
}

const observer=new MutationObserver(enhancePicker);observer.observe(document.body,{childList:true,subtree:true});enhancePicker();
