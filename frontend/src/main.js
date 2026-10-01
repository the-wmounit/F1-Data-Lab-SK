import './styles.css';
import { ReplayScene } from './replay.js';
import { formatTime, completedLap, sampleAt } from './math.js';
const $=s=>document.querySelector(s);
const number=n=>new Intl.NumberFormat('fr-FR').format(n);
const state={races:[],race:null,replay:null,results:null,laps:[],pits:[],playing:false,time:0,speed:30,selected:null,view:'replay',champ:null,champPlaying:false,champRound:24,champAccumulator:0,strategy:new Set(),generation:0};
let scene=null,last=0,lastTiming=-1;
async function get(url){const r=await fetch(url);if(!r.ok){let details='';try{const p=await r.json();details=p.detail||p.error||'';}catch{}throw new Error(`${r.status} : ${details||'données indisponibles'}`);}return r.json();}
function message(text){$('#message').textContent=text;$('#message').hidden=!text;}
function cell(tag,text,className){const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;}
function setPlaying(on){state.playing=on;$('#play').replaceChildren(cell('span',on?'Ⅱ':'▶'),document.createTextNode(on?'Pause':'Lire la course'));$('#play').setAttribute('aria-label',on?'Mettre la course en pause':'Lire la course');}
async function loadRace(race){
  const generation=++state.generation;state.race=race;state.replay=null;setPlaying(false);state.time=0;lastTiming=-1;message('');
  $('#race-name').textContent=race.name;$('#circuit-name').textContent=race.circuit;$('#track-title').textContent=`${race.country} · manche ${race.round}`;
  $('#race-date').textContent=new Date(`${race.date}T12:00:00Z`).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'});
  $('#track-loading').hidden=false;$('#play').disabled=true;$('#timeline').disabled=true;$('#elapsed').textContent='00:00';
  if(scene){scene.clear();scene.replay=null;}
  try{
    const path=`${race.year}/${race.round}`;
    const [results,laps,pits,replay]=await Promise.all([get(`/api/results/${path}`),get(`/api/laps/${path}`),get(`/api/pits/${path}`),get(`/api/replay/${path}`)]);
    if(generation!==state.generation)return;
    state.results=results.drivers;state.laps=laps.laps;state.pits=pits.stops;state.replay=replay;
    state.selected=results.drivers.find(d=>d.position===1)?.driverId||replay.drivers[0].driverId;
    state.strategy=new Set(results.drivers.slice(0,8).map(d=>d.driverId));
    $('#timeline').max=replay.durationSeconds;$('#timeline').value=0;$('#timeline').disabled=false;$('#duration').textContent=`/ ${formatTime(replay.durationSeconds)}`;$('#play').disabled=false;
    $('#raw-count').textContent=number(replay.quality.rawPoints);$('#sample-count').textContent=number(replay.quality.sampledPoints);$('#gap-count').textContent=number(replay.quality.gapCount);
    $('#timing-count').textContent=`${replay.drivers.length} pilotes`;
    if(!scene){try{scene=new ReplayScene($('#track'));}catch(error){$('#track-loading').textContent='La vue 3D nécessite WebGL. Les classements et la stratégie restent accessibles.';message('Le navigateur ne permet pas de créer la vue 3D. Activez l’accélération graphique et rechargez la page.');console.error(error);}}
    if(scene){scene.load(replay);scene.select(state.selected);$('#track-loading').hidden=true;}
    $('#telemetry-note').textContent='Positions approximatives ; z non calibré. Trous > 5 s sans interpolation. La dernière mesure est conservée au plus 1 s en fin de flux.';
    renderTiming();renderStrategyControls();renderBump();
    setPlaying(state.view==='replay'&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }catch(e){if(generation!==state.generation)return;message(`Impossible de charger cette course. ${e.message}`);$('#track-loading').textContent='Course indisponible';}
}
function renderTiming(){
  if(!state.replay)return;
  const leaderId=state.results.find(d=>d.position===1)?.driverId;
  const lap=completedLap(state.laps,leaderId,state.time);
  const standings=state.laps.find(l=>l.lap===lap)?.timings||[];
  const ordering=[...state.results].sort((a,b)=>{const pa=standings.find(x=>x.driverId===a.driverId)?.position??(lap?100+a.position:a.grid||30);const pb=standings.find(x=>x.driverId===b.driverId)?.position??(lap?100+b.position:b.grid||30);return pa-pb;});
  const fragment=document.createDocumentFragment();
  for(const d of ordering){
    const driver=state.replay.drivers.find(x=>x.driverId===d.driverId);const isVisible=driver&&sampleAt(driver.points,state.time)!==null;
    const row=cell('button','',`driver${isVisible?'':' nosample'}`);row.style.setProperty('--team',d.color);row.setAttribute('aria-pressed',String(state.selected===d.driverId));row.setAttribute('aria-label',`Suivre ${d.name}`);
    const position=standings.find(x=>x.driverId===d.driverId)?.position??(lap?'—':d.grid||'—');
    row.append(cell('span',String(position),'rank'),cell('span','','team-line'));
    const name=cell('span',d.code,'name');name.append(cell('span',d.team,'driver-detail'));
    if(!/^(Finished|Lapped|\+\d+ Laps?)$/.test(d.status))name.append(cell('span',`Résultat : abandon · ${d.laps} tour${d.laps>1?'s':''}`,'driver-detail'));
    row.append(name,cell('span',isVisible?`#${d.number}`:'hors flux','position-status'));
    row.onclick=()=>{state.selected=d.driverId;scene?.select(d.driverId);renderTiming();};fragment.append(row);
  }
  // Avoid replacing a focused driver's button during playback.
  const active=document.activeElement?.getAttribute('aria-label');
  $('#driver-list').replaceChildren(fragment);
  if(active?.startsWith('Suivre ')){[...$('#driver-list').children].find(b=>b.getAttribute('aria-label')===active)?.focus({preventScroll:true});}
  $('#current-lap').replaceChildren(document.createTextNode(`${lap} `),cell('small',`/ ${state.race.laps}`));
}
function changeView(view){state.view=view;for(const name of ['replay','championship','strategy']){$(`#view-${name}`).hidden=name!==view;const b=$(`[data-view="${name}"]`);if(name===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}if(view!=='replay')setPlaying(false);if(view!=='championship')setChampPlaying(false);$('.race-choice').hidden=view==='championship';$('#race-name').textContent=view==='championship'?'Championnat 2024':state.race?.name||'Archive de course';$('.context').textContent=view==='championship'?'Saison complète / simulation des points':'Saison 2024 / archive de course';if(view==='championship'&&!state.champ)loadChampionship();}
let champGeneration=0;
async function loadChampionship(){
  const generation=++champGeneration;setChampPlaying(false);$('#champ-error').hidden=true;
  const scoring=$('#scoring').value, points=$('#custom-points').value;
  try{const result=await get(`/api/championship/2024?scoring=${scoring}${scoring==='custom'?`&points=${encodeURIComponent(points)}`:''}`);if(generation!==champGeneration)return;state.champ=result;state.champRound=Math.min(state.champRound,result.frames.length);$('#champ-timeline').max=result.frames.length;$('#champ-timeline').value=state.champRound;renderBars();}
  catch(e){if(generation!==champGeneration)return;$('#champ-error').hidden=false;$('#champ-error').textContent=`Barème non appliqué. ${e.message}`;}
}
function setChampPlaying(on){state.champPlaying=on;$('#champ-play').textContent=on?'Ⅱ Pause':'▶ Animer la saison';}
function renderBars(){
  if(!state.champ)return;
  const frame=state.champ.frames[Math.max(0,state.champRound-1)];if(!frame)return;
  const rows=frame.standings;const max=Math.max(1,...rows.map(d=>d.points));
  $('#champ-race').textContent=state.champRound===0?'Avant la première course':frame.name;
  $('#champ-round').textContent=`${state.champRound} / ${state.champ.frames.length}`;$('#champ-timeline').value=state.champRound;
  const present=new Set();
  rows.forEach((driver,i)=>{
    present.add(driver.driverId);let el=$(`#bars [data-driver="${driver.driverId}"]`);
    if(!el){el=cell('div','','bar-row');el.dataset.driver=driver.driverId;el.style.setProperty('--team',driver.color);el.append(cell('span','','bar-rank'),cell('span',driver.name,'bar-name'));const track=cell('div','','bar-track');track.append(cell('div','','bar-fill'));el.append(track,cell('span','','bar-points'));$('#bars').append(el);}
    el.style.transform=`translateY(${i*28}px)`;el.querySelector('.bar-rank').textContent=String(i+1).padStart(2,'0');el.querySelector('.bar-fill').style.width=`${state.champRound===0?0:driver.points/max*100}%`;el.querySelector('.bar-points').textContent=state.champRound===0?'0':number(driver.points);el.style.setProperty('--team',driver.color);
  });
  for(const el of $('#bars').children)if(!present.has(el.dataset.driver))el.remove();
  $('#bars').style.height=`${rows.length*28+10}px`;
  $('#bars').setAttribute('aria-label',`${$('#champ-race').textContent}, ${rows.map(d=>`${d.name} : ${state.champRound===0?0:d.points} points`).join(', ')}`);
}
function renderStrategyControls(){const fragment=document.createDocumentFragment();for(const d of state.results){const b=cell('button',d.code);b.style.setProperty('--team',d.color);b.prepend(cell('i',''));b.setAttribute('aria-pressed',String(state.strategy.has(d.driverId)));b.setAttribute('aria-label',`Afficher ${d.name}`);b.onclick=()=>{if(state.strategy.has(d.driverId))state.strategy.delete(d.driverId);else state.strategy.add(d.driverId);b.setAttribute('aria-pressed',String(state.strategy.has(d.driverId)));renderBump();};fragment.append(b);}$('#strategy-drivers').replaceChildren(fragment);}
function svg(tag,attrs={},text){const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,v);if(text!==undefined)el.textContent=text;return el;}
function renderBump(){
  if(!state.results)return;const root=$('#bump');root.replaceChildren(svg('title',{},`${state.race.name} : positions tour par tour et arrêts aux stands`));
  const left=55,right=990,top=30,bottom=480;const x=lap=>left+(lap-1)/Math.max(1,state.race.laps-1)*(right-left);const y=pos=>top+(pos-1)/19*(bottom-top);
  for(let pos=1;pos<=20;pos++){root.append(svg('text',{x:32,y:y(pos)+4,'text-anchor':'end'},String(pos)));if([1,5,10,15,20].includes(pos))root.append(svg('line',{x1:left,x2:right,y1:y(pos),y2:y(pos),class:'axis-line'}));}
  for(let lap=1;lap<=state.race.laps;lap++){if(lap!==1&&lap%5!==0&&lap!==state.race.laps)continue;root.append(svg('line',{x1:x(lap),x2:x(lap),y1:top,y2:bottom,class:'lap-guide'}),svg('text',{x:x(lap),y:bottom+25,'text-anchor':'middle'},String(lap)));}
  root.append(svg('text',{x:left,y:15},'Position'),svg('text',{x:right,y:bottom+48,'text-anchor':'end'},'Tour'));
  for(const d of state.results){if(!state.strategy.has(d.driverId))continue;const samples=state.laps.map(l=>({lap:l.lap,timing:l.timings.find(t=>t.driverId===d.driverId)})).filter(s=>s.timing);if(!samples.length)continue;
    let path='',previous=0;for(const s of samples){path+=`${s.lap===previous+1&&previous?'L':'M'}${x(s.lap)},${y(s.timing.position)} `;previous=s.lap;}
    root.append(svg('path',{d:path,stroke:d.color,class:'driver-line'}));const end=samples.at(-1);root.append(svg('text',{x:x(end.lap)+8,y:y(end.timing.position)+4,style:`fill:${d.color};font-weight:600`},d.code));
    for(const pit of state.pits.filter(p=>p.driverId===d.driverId)){const s=samples.find(s=>s.lap===pit.lap);if(!s)continue;const circle=svg('circle',{cx:x(s.lap),cy:y(s.timing.position),r:5,fill:d.color,tabindex:0});circle.append(svg('title',{},`${d.name}, arrêt ${pit.stop}, tour ${pit.lap}, ${pit.durationSeconds} secondes dans la voie des stands`));root.append(circle);}
  }
  if(!state.strategy.size)root.append(svg('text',{x:550,y:260,'text-anchor':'middle'},'Sélectionnez au moins un pilote pour afficher ses positions.'));
}
for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>changeView(button.dataset.view);
$('#race-select').onchange=()=>loadRace(state.races[Number($('#race-select').value)]);
$('#play').onclick=()=>{if(state.replay&&state.time>=state.replay.durationSeconds)state.time=0;setPlaying(!state.playing);};
$('#timeline').oninput=()=>{state.time=Number($('#timeline').value);$('#elapsed').textContent=formatTime(state.time);renderTiming();};
$('#speed').onchange=()=>state.speed=Number($('#speed').value);
$('#camera-orbit').onclick=()=>cameraMode('orbit');$('#camera-follow').onclick=()=>cameraMode('follow');$('#camera-onboard').onclick=()=>cameraMode('onboard');$('#camera-reset').onclick=()=>{cameraMode('orbit');scene?.reset();};
function cameraMode(mode){scene?.setMode(mode);for(const name of ['orbit','follow','onboard'])$(`#camera-${name}`).setAttribute('aria-pressed',String(mode===name));}
$('#scoring').onchange=()=>{const custom=$('#scoring').value==='custom';$('#custom-label').hidden=!custom;$('#apply-scoring').hidden=!custom;loadChampionship();};$('#apply-scoring').onclick=loadChampionship;
$('#champ-timeline').oninput=()=>{setChampPlaying(false);state.champRound=Number($('#champ-timeline').value);renderBars();};
$('#champ-play').onclick=()=>{if(!state.champ)return;if(state.champRound>=state.champ.frames.length)state.champRound=0;state.champAccumulator=0;setChampPlaying(!state.champPlaying);renderBars();};
function tick(now){const dt=last?Math.min((now-last)/1000,.1):0;last=now;if(!document.hidden){
  if(state.playing&&state.replay){state.time=Math.min(state.replay.durationSeconds,state.time+dt*state.speed);$('#timeline').value=state.time;$('#elapsed').textContent=formatTime(state.time);if(state.time>=state.replay.durationSeconds)setPlaying(false);}
  if(state.view==='replay'&&state.replay){scene?.render(state.time);const timing=Math.floor(state.time/2);if(timing!==lastTiming){lastTiming=timing;renderTiming();}}
  if(state.champPlaying&&state.champ){state.champAccumulator+=dt;if(state.champAccumulator>=1.1){state.champAccumulator=0;state.champRound++;renderBars();if(state.champRound>=state.champ.frames.length)setChampPlaying(false);}}
}requestAnimationFrame(tick);}
requestAnimationFrame(tick);
document.addEventListener('visibilitychange',()=>{last=0;});
window.addEventListener('pagehide',event=>{if(!event.persisted)scene?.dispose();});
async function init(){try{const catalog=await get('/api/races');state.races=Array.isArray(catalog)?catalog:catalog.races;if(!state.races.length)throw new Error('aucune course dans le catalogue local');$('#race-select').replaceChildren(...state.races.map((r,i)=>{const o=cell('option',`${String(r.round).padStart(2,'0')} · ${r.name}`);o.value=i;return o;}));$('#race-select').disabled=false;await loadRace(state.races[0]);}catch(e){$('#race-name').textContent='Archive indisponible';message(`Le catalogue local n’est pas disponible. ${e.message}`);}}
init();
