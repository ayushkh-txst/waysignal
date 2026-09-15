import { citizenSafetyApi, type EvacuationRoute } from './api/citizen-safety.api';
import { loadRecentUserHazards, screenEvacuationRoute } from './api/route-screening';
import './responder-live-map-enhancer.css';
import { hazardsApi } from './api/hazards.api';
import type { ResponderMapElement } from './pages/ResponderOperationsMap';
let unsubscribeHazards: (()=>void)|null=null;
let hazardRevision='';

type LatLng={latitude:number;longitude:number};
type RouteCandidate={distanceM:number;durationS:number;geometry:[number,number][];safetyScore:number;status:'recommended'|'viable'|'rejected';reason:string;rejectionReasons?:string[]};
type Handoff={incidentId:string;responderPosition:LatLng;candidates:RouteCandidate[];updatedAt:string};
const HANDOFF_KEY='jalrakshak:responder-route-handoff';
let showRoutes=true;let scheduled=false;let watchId:number|null=null;let rerouting=false;let lastRerouteAt=0;let lastHazardCount=-1;let lastPosition:LatLng|null=null;let lastBackendSyncAt=0;

const toRad=(v:number)=>v*Math.PI/180;
function distanceMeters(a:LatLng,b:LatLng){const R=6371000,dLat=toRad(b.latitude-a.latitude),dLon=toRad(b.longitude-a.longitude),lat1=toRad(a.latitude),lat2=toRad(b.latitude);const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(h));}
function fmtDistance(m:number){return m>=1609.344?`${(m/1609.344).toFixed(1)} mi`:`${Math.max(1,Math.round(m*3.28084))} ft`;}
function fmtDuration(s:number){const min=Math.max(1,Math.round(s/60));return min>=60?`${Math.floor(min/60)}h ${min%60}m`:`${min} min`;}
function readHandoff():Handoff|null{try{const raw=sessionStorage.getItem(HANDOFF_KEY);if(!raw)return null;const parsed=JSON.parse(raw) as Handoff;return parsed?.incidentId&&parsed?.responderPosition&&Array.isArray(parsed?.candidates)?parsed:null;}catch{return null;}}
function saveHandoff(handoff:Handoff){sessionStorage.setItem(HANDOFF_KEY,JSON.stringify(handoff));}
async function syncNavigation(handoff:Handoff,status:'en_route'|'approaching'|'on_scene'='en_route',reason:string|null=null){const recommended=handoff.candidates.find(r=>r.status==='recommended');if(!recommended)return;await citizenSafetyApi.updateEmergencyNavigation(handoff.incidentId,{responder_latitude:handoff.responderPosition.latitude,responder_longitude:handoff.responderPosition.longitude,recommended_route:{geometry:recommended.geometry,safety_score:recommended.safetyScore,status:recommended.status,reason:recommended.reason,rejection_reasons:recommended.rejectionReasons??[]},responder_eta_seconds:Math.max(0,Math.round(recommended.durationS)),responder_distance_m:Math.max(0,recommended.distanceM),navigation_status:status,reroute_reason:reason});lastBackendSyncAt=Date.now();}
function mapView() { return document.querySelector<ResponderMapElement>('[data-responder-map]')?.responderMap; }
function clearRouteLayer() {
  const view=mapView(); if(!view)return;
  if(view.routeLayer) view.map.removeLayer(view.routeLayer);
  view.routeLayer=undefined; view.routeKey=undefined;
}
function drawRoutes(handoff:Handoff) {
  const view=mapView(); if(!view)return;
  const key=JSON.stringify([handoff,showRoutes]);
  if(view.routeKey===key)return;
  clearRouteLayer(); view.routeKey=key;
  if(!showRoutes)return;
  const {map,L}=view;
  const group=L.layerGroup().addTo(map); view.routeLayer=group;
  handoff.candidates.forEach(route=>{
    const points=route.geometry.filter(([lon,lat])=>Number.isFinite(lon)&&Math.abs(lon)<=180&&Number.isFinite(lat)&&Math.abs(lat)<=90).map(([lon,lat])=>[lat,lon]);
    if(points.length<2)return;
    L.polyline(points,{color:route.status==='recommended'?'#7d6727':route.status==='rejected'?'#c83831':'#66747c',weight:route.status==='recommended'?5:3,dashArray:route.status==='rejected'?'8 6':undefined,opacity:.85})
      .addTo(group).bindPopup(Object.assign(document.createElement('span'), { textContent: route.reason }));
  });
  const p=handoff.responderPosition;
  if(Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180) {
    L.marker([p.latitude,p.longitude],{icon:L.divIcon({className:'ops-geographic-incident',html:'<span class="en_route">R</span>',iconSize:[38,38],iconAnchor:[19,19]})})
      .addTo(group).bindPopup('Responder position');
  }
}
function screenedCandidates(screened:EvacuationRoute):RouteCandidate[]{return(screened.screened_routes??[]).map(r=>({distanceM:Number(r.distance_m??screened.distance_m),durationS:Number(r.duration_s??screened.duration_s),geometry:(r.geometry??screened.geometry??[]).map(([lat,lon])=>[lon,lat] as [number,number]),safetyScore:Number(r.prototype_safety_score??screened.prototype_safety_score??50),status:r.status,rejectionReasons:r.rejection_reasons??[],reason:r.status==='recommended'?'Safest viable route after live hazard re-screening.':r.status==='rejected'?(r.rejection_reasons?.join(' · ')||'Rejected by live hazard screening.'):'Viable live alternative.'})).sort((a,b)=>({recommended:0,viable:1,rejected:2}[a.status]-{recommended:0,viable:1,rejected:2}[b.status])||b.safetyScore-a.safetyScore);}
function setNote(message:string){const note=document.querySelector<HTMLElement>('[data-live-route-note]');if(note&&note.textContent!==message)note.textContent=message;}
async function reroute(position:LatLng,reason:string){if(rerouting)return;const handoff=readHandoff();if(!handoff)return;rerouting=true;setNote(`Re-screening route: ${reason}…`);try{const incident=await citizenSafetyApi.getEmergency(handoff.incidentId);const current=handoff.candidates.find(r=>r.status==='recommended')??handoff.candidates[0];if(!current)return;const synthetic:EvacuationRoute={destination_name:`${incident.citizen_name} SOS`,destination_type:'citizen_sos',destination_latitude:incident.latitude,destination_longitude:incident.longitude,distance_m:current.distanceM,duration_s:current.durationS,geometry:current.geometry,steps:[],alternatives_considered:handoff.candidates.length,prototype_safety_score:current.safetyScore,reasons:['Live responder route re-screen requested.'],source:'Responder live monitoring',warning:'Prototype rescue routing; verify field conditions.'};const screened=await screenEvacuationRoute(position.latitude,position.longitude,synthetic);const next=screenedCandidates(screened);if(screened.screening_status!=='complete')throw new Error('Hazard screening unavailable');if(next.length){const updatedHandoff={incidentId:handoff.incidentId,responderPosition:position,candidates:next,updatedAt:new Date().toISOString()};saveHandoff(updatedHandoff);await syncNavigation(updatedHandoff,'en_route',reason);lastRerouteAt=Date.now();lastPosition=position;setNote(`Route updated · ${next.filter(r=>r.status==='rejected').length} rejected · ${next.filter(r=>r.status!=='rejected').length} viable.`);render();}else setNote('Live re-screen completed; no replacement route was returned.');}catch{const stale=readHandoff();if(stale){saveHandoff({...stale,candidates:stale.candidates.map(r=>({...r,status:'rejected',reason:'Not currently verified: shared hazard or road screening unavailable.'}))});render();}setNote('Shared hazard or road screening unavailable. No route is currently recommended.');}finally{rerouting=false;}}
async function startGuidance(handoff:Handoff){const recommended=handoff.candidates.find(r=>r.status==='recommended');if(!recommended)return;if(hazardsApi.snapshot().error||!hazardsApi.snapshot().checkedAt){setNote('Shared hazards must be available before guidance starts.');return;}try{const incident=await citizenSafetyApi.getEmergency(handoff.incidentId);if(incident.status==='assigned')await citizenSafetyApi.updateEmergency(incident.id,{status:'en_route',responder_id:incident.responder_id??undefined,responder_name:incident.responder_name??undefined});await syncNavigation(handoff,'en_route','Responder guidance started');const url=`https://www.google.com/maps/dir/?api=1&origin=${handoff.responderPosition.latitude},${handoff.responderPosition.longitude}&destination=${incident.latitude},${incident.longitude}&travelmode=driving`;window.open(url,'_blank','noopener,noreferrer');setNote('Guidance started · live GPS monitoring is active and the route will be re-screened as conditions change.');ensureGpsWatch();}catch{setNote('Could not start guidance. Recheck the incident and route.');}}
function ensureToolbar(){
 const toolbar=document.querySelector<HTMLElement>('.ops-map-toolbar');
 if(!toolbar||toolbar.querySelector('[data-route-layer-toggle]'))return;
 const routes=document.createElement('button'); routes.type='button';routes.dataset.routeLayerToggle='true';
 routes.classList.toggle('active',showRoutes);routes.setAttribute('aria-pressed',String(showRoutes));routes.textContent='Routes';
 routes.onclick=()=>{showRoutes=!showRoutes;routes.classList.toggle('active',showRoutes);routes.setAttribute('aria-pressed',String(showRoutes));render();};
 toolbar.prepend(routes);
}
function ensureGpsWatch(){if(!unsubscribeHazards&&document.querySelector('.ops-map-page')&&readHandoff()){unsubscribeHazards=hazardsApi.subscribe(state=>{const next=JSON.stringify(state.reports.map(r=>[r.id,r.updated_at]));if(state.error){setNote('Shared hazards unavailable. Re-screen before starting guidance.');return;}if(state.checkedAt&&next!==hazardRevision){hazardRevision=next;const h=readHandoff();if(h)void reroute(h.responderPosition,'shared hazard reports updated');}});}if(watchId!=null||!navigator.geolocation||!document.querySelector('.ops-map-page'))return;const handoff=readHandoff();if(!handoff)return;lastPosition=handoff.responderPosition;lastHazardCount=loadRecentUserHazards().length;watchId=navigator.geolocation.watchPosition((p)=>{const position={latitude:p.coords.latitude,longitude:p.coords.longitude};const current=readHandoff();if(!current)return;const updated={...current,responderPosition:position,updatedAt:new Date().toISOString()};saveHandoff(updated);const distanceToCitizen=updated.candidates.find(r=>r.status==='recommended')?.distanceM??Infinity;const navigationStatus=distanceToCitizen<=75?'on_scene':distanceToCitizen<=300?'approaching':'en_route';if(Date.now()-lastBackendSyncAt>=3000)void syncNavigation(updated,navigationStatus).catch(()=>setNote('Route remains visible, but backend navigation sync is temporarily unavailable.'));const moved=lastPosition?distanceMeters(lastPosition,position):0;const hazardCount=loadRecentUserHazards().length;const hazardsChanged=hazardCount!==lastHazardCount;const stale=Date.now()-lastRerouteAt>15000;if((moved>=30&&stale)||hazardsChanged){lastHazardCount=hazardCount;void reroute(position,hazardsChanged?'new hazard report detected':`responder moved ${Math.round(moved)} m`);}else{lastPosition=position;render();}},()=>setNote('Live GPS monitoring paused because responder location is unavailable.'),{enableHighAccuracy:true,maximumAge:3000,timeout:10000});}
function stopGpsWatch(){unsubscribeHazards?.();unsubscribeHazards=null;hazardRevision='';if(watchId!=null&&navigator.geolocation){navigator.geolocation.clearWatch(watchId);watchId=null;}}
function render(){
 const page=document.querySelector<HTMLElement>('.ops-map-page');
 if(!page){stopGpsWatch();return;}
 ensureToolbar();
 const handoff=readHandoff();
 const side=document.querySelector<HTMLElement>('.ops-map-side');
 const selectedId=side?.querySelector('.ops-map-selected-head>div>span')?.textContent?.trim();
 if(!handoff||!side||handoff.incidentId!==selectedId){
  document.querySelector('[data-live-route-card]')?.remove(); clearRouteLayer();stopGpsWatch();return;
 }
 if(!mapView())return;
 ensureGpsWatch();drawRoutes(handoff);
const recommended=handoff.candidates.find(r=>r.status==='recommended');const rejected=handoff.candidates.filter(r=>r.status==='rejected').length;const viable=handoff.candidates.filter(r=>r.status==='recommended'||r.status==='viable').length;let card=side.querySelector<HTMLElement>('[data-live-route-card]');if(!card){card=document.createElement('section');card.dataset.liveRouteCard='true';card.className='live-route-card';side.prepend(card);}const cardHtml=`<div class="live-route-card-head"><div><span>LIVE RESPONSE ROUTE</span><h3>${recommended?'Recommended route active':'No recommended route'}</h3></div><b>${handoff.candidates.length} ANALYZED</b></div><div class="live-route-counts"><div><strong>${rejected}</strong><span>REJECTED</span></div><div><strong>${viable}</strong><span>VIABLE</span></div><div><strong>${recommended?1:0}</strong><span>RECOMMENDED</span></div></div>${recommended?`<div class="live-route-primary"><div><span>ETA</span><strong>${fmtDuration(recommended.durationS)}</strong></div><div><span>DISTANCE</span><strong>${fmtDistance(recommended.distanceM)}</strong></div><div><span>SAFETY</span><strong>${recommended.safetyScore}/100</strong></div></div><p class="live-route-why">${recommended.reason}</p><button type="button" data-live-start-guidance>START GUIDANCE</button>`:`<p class="live-route-warning">No route currently clears the safety screen, or screening is unavailable. Recheck conditions before dispatch.</p>`}<p data-live-route-note class="live-route-note">Live GPS monitoring active · route lines: gold = recommended, gray = viable, red dashed = rejected.</p>`;if(card.dataset.renderKey===cardHtml)return;card.dataset.renderKey=cardHtml;card.innerHTML=cardHtml;card.querySelector<HTMLButtonElement>('[data-live-start-guidance]')?.addEventListener('click',()=>void startGuidance(handoff));}
function schedule(){if(scheduled)return;scheduled=true;window.setTimeout(()=>{scheduled=false;render();},100);}const observer=new MutationObserver(schedule);const start=()=>{observer.observe(document.body,{childList:true,subtree:true});window.addEventListener('jalrakshak:live-route-opened',schedule);window.addEventListener('jalrakshak:responder-map-ready',schedule);schedule();};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
