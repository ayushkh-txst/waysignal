const FILTER_SELECTOR='[data-command-center-filters] [data-incident-filter]';
const CARD_SELECTOR='.ops-queue-list > button';
let selecting=false;

function visibleCards(){
  return Array.from(document.querySelectorAll<HTMLButtonElement>(CARD_SELECTOR)).filter((card)=>{
    const style=window.getComputedStyle(card);
    return style.display!=='none'&&style.visibility!=='hidden'&&!card.disabled;
  });
}

function ensureInteractive(){
  document.querySelectorAll<HTMLButtonElement>(`${FILTER_SELECTOR}, ${CARD_SELECTOR}`).forEach((button)=>{
    button.style.pointerEvents='auto';
    button.style.position=button.style.position||'relative';
    button.style.zIndex='2';
  });
}

function selectFirstVisible(){
  if(selecting)return;
  const current=document.querySelector<HTMLButtonElement>(`${CARD_SELECTOR}.active`);
  if(current&&window.getComputedStyle(current).display!=='none')return;
  const first=visibleCards()[0];
  if(!first)return;
  selecting=true;
  window.setTimeout(()=>{
    try{first.click();}
    finally{selecting=false;}
  },40);
}

function onClick(event:Event){
  const target=event.target as HTMLElement;
  const filter=target.closest<HTMLButtonElement>(FILTER_SELECTOR);
  if(filter){
    window.setTimeout(()=>{
      ensureInteractive();
      selectFirstVisible();
    },80);
    return;
  }

  const card=target.closest<HTMLButtonElement>(CARD_SELECTOR);
  if(card){
    card.focus({preventScroll:true});
  }
}

let scheduled=false;
function schedule(){
  if(scheduled)return;
  scheduled=true;
  window.setTimeout(()=>{
    scheduled=false;
    ensureInteractive();
  },60);
}

function start(){
  document.addEventListener('click',onClick,true);
  const observer=new MutationObserver(schedule);
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class','disabled']});
  schedule();
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
else start();
