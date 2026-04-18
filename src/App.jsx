import { useState, useEffect, useCallback, useRef } from "react";

/*
  OPEN MIC TONIGHT — Multi-Venue Platform
  Aesthetic: Dive bar bulletin board / zine / photocopied flyer
  Routes: # directory | #create | #<slug> venue | #<slug>/host dashboard
*/

// ─── Storage ──────────────────────────────────────────────────────
import { db, doc, getDoc, setDoc, deleteDoc, collection, getDocs } from "./firebase";

async function ldV(s) {
  const snap = await getDoc(doc(db, "venues", s));
  return snap.exists() ? snap.data() : null;
}
async function svV(s, d) {
  await setDoc(doc(db, "venues", s), d);
}
async function dlV(s) {
  await deleteDoc(doc(db, "venues", s));
}
async function ldIdx() {
  const snap = await getDocs(collection(db, "venues"));
  return snap.docs.map(d => ({ slug: d.id, name: d.data().eventName, created: d.data().createdAt || 0 }));
}
async function svIdx() { /* no-op — list comes from venues collection */ }

// ─── Cleanup thresholds ───────────────────────────────────────────
const SIX_MONTHS_MS = 1000 * 60 * 60 * 24 * 180;
const WARN_WINDOW_MS = 1000 * 60 * 60 * 24 * 14; // show warning in last 2 weeks

// ─── My Venues (local device tracking) ────────────────────────────
const MY_KEY = "omic-my-v1";
function myVenues() { try { return JSON.parse(localStorage.getItem(MY_KEY) || "[]") } catch { return [] } }
function addMyVenue(slug) { try { const v = myVenues(); if (!v.includes(slug)) { v.push(slug); localStorage.setItem(MY_KEY, JSON.stringify(v)) } } catch {} }
function removeMyVenue(slug) { try { localStorage.setItem(MY_KEY, JSON.stringify(myVenues().filter(s => s !== slug))) } catch {} }

// ─── Utils ────────────────────────────────────────────────────────
const DAYS=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MO=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DS={signupOpen:false,totalSlots:12,limitMode:"time",timePerSlot:5,songsPerSlot:2,slots:{},currentSlot:0,eventName:"Open Mic Night",waitlist:[],venueAddress:"",venueLat:null,venueLng:null,venueRadius:150,geofenceEnabled:false,venueName:"",scheduleEnabled:false,scheduleDays:[4],scheduleOpenHour:18,scheduleOpenMin:30,scheduleShowHour:19,scheduleShowMin:0,scheduleDuration:30,showDate:null,manualOverride:false,performedDevices:[],allowLinks:false,hostPin:"",archived:false,createdAt:0,lastHostSeen:0,scheduleCloseEnabled:false,scheduleCloseAfter:3};

function gid(){return Math.random().toString(36).slice(2,10)+Date.now().toString(36)}
function slug(s){return s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,48)}
function devId(){let id;try{id=localStorage.getItem("omic-d9")}catch{}if(!id){id=gid();try{localStorage.setItem("omic-d9",id)}catch{}}return id}
function hav(a,b,c,d){const R=6371000,r=x=>x*Math.PI/180,dL=r(c-a),dN=r(d-b),x=Math.sin(dL/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(dN/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))}
function fD(ts){if(!ts)return"";const d=new Date(ts);return`${DAYS[d.getDay()]}, ${MO[d.getMonth()]} ${d.getDate()}`}
function fFull(d,h,m){return`${DAYS[d.getDay()]}, ${MO[d.getMonth()]} ${d.getDate()} at ${fT(h,m)}`}
function nextOcc(days,h,m){if(!days||!days.length)return null;const now=new Date();const nowMin=now.getHours()*60+now.getMinutes();const showMin=h*60+m;for(let i=0;i<8;i++){const d=new Date(now);d.setDate(now.getDate()+i);if(days.includes(d.getDay())){if(i===0&&nowMin>=showMin)continue;return d}}return null}
function fT(h,m){return`${h%12||12}:${String(m).padStart(2,"0")} ${h>=12?"PM":"AM"}`}
function addM(h,m,a){const t=h*60+m+a;return[Math.floor(t/60)%24,t%60]}
function showTime(s){if(s.scheduleShowHour!=null&&s.scheduleShowMin!=null)return[s.scheduleShowHour,s.scheduleShowMin];return addM(s.scheduleOpenHour,s.scheduleOpenMin,s.scheduleDuration||30)}
function inSch(s){if(!s.scheduleEnabled)return null;const n=new Date(),dy=s.scheduleDays||[4];if(!dy.includes(n.getDay()))return false;const m=n.getHours()*60+n.getMinutes(),o=s.scheduleOpenHour*60+s.scheduleOpenMin;return m>=o}
function filled(sl){return Object.keys(sl).filter(k=>sl[k]).map(Number).sort((a,b)=>a-b)}
function findDev(sl,d){for(const[k,v]of Object.entries(sl))if(v&&v.deviceId===d)return{...v,slotNum:Number(k)};return null}
function nextF(sl,tot,cur){for(let i=cur+1;i<=tot;i++)if(sl[String(i)])return i;return null}
function lowOpen(sl,tot){for(let i=1;i<=tot;i++)if(!sl[String(i)])return i;return null}
function eUrl(s){if(!s)return"";const t=s.trim();return/^https?:\/\//i.test(t)?t:"https://"+t}
function fHrs(h){if(h<=0)return"0h";const wh=Math.floor(h),m=Math.round((h-wh)*60);return m>0?`${wh}h ${m}m`:`${wh}h`}
// For cleanup: returns effective "last host activity" timestamp. Grandfather
// existing venues by pretending they were just seen if they have no stamp.
function lastSeen(v,graceFrom){if(v.lastHostSeen)return v.lastHostSeen;if(v.createdAt)return v.createdAt;return graceFrom}
function isUpcoming(v){return v.scheduleEnabled&&v.scheduleDays?.length>0&&!!nextOcc(v.scheduleDays,...showTime(v))}
function addr(s){return(s.venueAddress||s.venueName||"").trim()}
function shortAddr(a,n){if(!a)return"";return a.length>n?a.slice(0,n-1)+"…":a}
function mvSlot(si,tot,f,t){if(f===t)return si;const s={...si},p=s[String(f)];if(!p)return si;delete s[String(f)];if(!s[String(t)]){s[String(t)]=p;return s}let ed=null,eu=null;for(let i=t+1;i<=tot;i++){if(!s[String(i)]){ed=i;break}}for(let i=t-1;i>=1;i--){if(!s[String(i)]){eu=i;break}}const dd=t>f,ud=dd?(ed!==null):(eu===null);if(ud&&ed!==null){for(let i=ed;i>t;i--)s[String(i)]=s[String(i-1)]||null}else if(!ud&&eu!==null){for(let i=eu;i<t;i++)s[String(i)]=s[String(i+1)]||null}else if(ed!==null){for(let i=ed;i>t;i--)s[String(i)]=s[String(i-1)]||null}else if(eu!==null){for(let i=eu;i<t;i++)s[String(i)]=s[String(i+1)]||null}s[String(t)]=p;for(let i=1;i<=tot;i++)if(!s[String(i)])delete s[String(i)];return s}

// ─── CSS ──────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,700;9..144,900&family=Overpass+Mono:wght@400;600;700&family=Lexend:wght@400;500;600;700&display=swap');
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --paper: #f0ead6; --paper-warm: #e8e0ca; --paper-dark: #d6ccb4;
  --ink: #2a2622; --ink-mid: #5a554e; --ink-light: #8a857e; --ink-faded: #b8b2a8;
  --coral: #d94830; --coral-light: #f06848;
  --teal: #2a7a6c; --teal-light: #3aa898;
  --cream: #faf6ee; --shadow: #2a262220;
  --grain: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
}
body { background: var(--paper); color: var(--ink); font-family: 'Lexend', sans-serif; -webkit-font-smoothing: antialiased; }
input::placeholder { color: var(--ink-light); }
::-webkit-scrollbar { width: 5px; }
::-webkit-scrollbar-thumb { background: var(--ink-faded); border-radius: 3px; }
@keyframes drift { from { opacity: 0; transform: translateY(8px) rotate(-0.5deg); } to { opacity: 1; transform: translateY(0) rotate(0deg); } }
@keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
.drift { animation: drift 0.35s ease-out both; }
.drift-1 { animation: drift 0.35s ease-out 0.06s both; }
.drift-2 { animation: drift 0.35s ease-out 0.12s both; }
`;

// ─── Style objects ────────────────────────────────────────────────
const PAGE={minHeight:"100vh",background:"var(--paper)",backgroundImage:"var(--grain)",backgroundSize:"200px",padding:"16px 16px 60px",display:"flex",flexDirection:"column",alignItems:"center",position:"relative"};
const CARD={background:"var(--cream)",border:"2px solid var(--ink)",borderRadius:3,padding:"24px 20px",maxWidth:460,width:"100%",boxShadow:"4px 4px 0 var(--shadow)",position:"relative"};
const CARD_ALT={...CARD,background:"var(--paper-warm)",border:"2px dashed var(--ink-mid)",boxShadow:"3px 3px 0 var(--shadow)"};
const SECT={background:"var(--paper)",border:"1px solid var(--ink-faded)",borderRadius:2,padding:14,marginTop:10};
const INP={width:"100%",padding:"10px 12px",border:"2px solid var(--ink)",borderRadius:2,background:"var(--cream)",color:"var(--ink)",fontSize:15,fontFamily:"'Lexend',sans-serif",outline:"none",boxSizing:"border-box"};
const BTN={padding:"11px 20px",border:"2px solid var(--ink)",borderRadius:2,cursor:"pointer",background:"var(--ink)",color:"var(--cream)",fontSize:14,fontWeight:700,fontFamily:"'Lexend',sans-serif",letterSpacing:0.3,textAlign:"center",boxShadow:"3px 3px 0 var(--shadow)",transition:"transform 0.1s, box-shadow 0.1s"};
const BTN2={...BTN,background:"var(--cream)",color:"var(--ink)"};
const BTN_SM={padding:"6px 12px",border:"2px solid var(--ink)",borderRadius:2,cursor:"pointer",background:"var(--cream)",color:"var(--ink)",fontSize:12,fontWeight:700,fontFamily:"'Overpass Mono',monospace",boxShadow:"2px 2px 0 var(--shadow)"};
const BTN_GHOST={background:"none",border:"none",cursor:"pointer",color:"var(--ink-mid)",fontSize:13,fontFamily:"'Lexend',sans-serif",padding:"6px 0"};
const LINK={background:"none",border:"none",cursor:"pointer",color:"var(--ink-mid)",fontSize:12,fontFamily:"'Lexend',sans-serif",textDecoration:"underline",textUnderlineOffset:3,marginTop:14,display:"block",textAlign:"center",width:"100%"};
const TITLE={fontFamily:"'Fraunces',serif",fontSize:28,fontWeight:900,color:"var(--ink)",lineHeight:1.1,letterSpacing:-0.5};
const SUB={fontFamily:"'Overpass Mono',monospace",fontSize:11,fontWeight:600,letterSpacing:2,textTransform:"uppercase",color:"var(--ink-mid)"};
const BODY={color:"var(--ink-mid)",fontSize:13,lineHeight:1.5,fontFamily:"'Lexend',sans-serif"};
const FLASH_S={position:"fixed",bottom:20,left:"50%",transform:"translateX(-50%)",background:"var(--ink)",color:"var(--cream)",padding:"10px 24px",borderRadius:2,fontWeight:700,fontSize:13,fontFamily:"'Lexend',sans-serif",zIndex:999,border:"2px solid var(--ink)",boxShadow:"3px 3px 0 var(--coral)"};
const TAG=(bg,fg)=>({display:"inline-block",padding:"3px 8px",borderRadius:2,fontSize:10,fontWeight:700,fontFamily:"'Overpass Mono',monospace",letterSpacing:1,background:bg,color:fg,border:`1px solid ${fg}`,transform:"rotate(-1deg)"});

// ─── Shared Components ────────────────────────────────────────────
function NumInput({value,onChange,min,max,style:s,...p}){
  const[t,setT]=useState(String(value??""));const pv=useRef(value);
  useEffect(()=>{if(value!==pv.current){setT(String(value??""));pv.current=value}},[value]);
  return <input {...p} inputMode="numeric" style={{...INP,width:70,textAlign:"center",fontFamily:"'Overpass Mono',monospace",...s}} value={t}
    onChange={e=>{const v=e.target.value;if(v===""||/^\d*$/.test(v))setT(v)}}
    onBlur={()=>{let n=parseInt(t,10);if(isNaN(n))n=min??0;if(min!=null)n=Math.max(min,n);if(max!=null)n=Math.min(max,n);setT(String(n));onChange(n)}}/>;
}
function Timer({seconds,onDone}){
  const[left,setLeft]=useState(seconds);const[run,setRun]=useState(false);
  useEffect(()=>{setLeft(seconds);setRun(false)},[seconds]);
  useEffect(()=>{if(run&&left>0){const i=setInterval(()=>setLeft(l=>l-1),1000);return()=>clearInterval(i)}if(left<=0&&run){setRun(false);onDone?.()}},[run,left]);
  const pct=seconds>0?left/seconds:0,w=pct<0.2;
  return(<div style={{textAlign:"center",margin:"16px 0"}}>
    <div style={{fontSize:48,fontFamily:"'Overpass Mono',monospace",fontWeight:700,color:w?"var(--coral)":"var(--ink)",letterSpacing:2}}>{String(Math.floor(left/60)).padStart(2,"0")}:{String(left%60).padStart(2,"0")}</div>
    <div style={{height:8,borderRadius:0,background:"var(--paper-dark)",margin:"10px auto",maxWidth:240,overflow:"hidden",border:"1px solid var(--ink-faded)"}}><div style={{height:"100%",width:`${pct*100}%`,background:w?"var(--coral)":"var(--ink)",transition:"width 1s linear"}}/></div>
    <div style={{display:"flex",gap:8,justifyContent:"center",marginTop:10}}>
      {!run?<button onClick={()=>setRun(true)} style={BTN_SM}>▶ START</button>:<button onClick={()=>setRun(false)} style={BTN_SM}>⏸ PAUSE</button>}
      <button onClick={()=>{setLeft(seconds);setRun(false)}} style={{...BTN_SM,background:"var(--paper)"}}>↺ RESET</button>
    </div>
  </div>);
}
function SongCounter({max,onDone}){
  const[c,setC]=useState(0);const dn=c>=max;
  return(<div style={{textAlign:"center",margin:"16px 0"}}>
    <div style={{fontSize:44,fontFamily:"'Overpass Mono',monospace",fontWeight:700,color:dn?"var(--coral)":"var(--ink)"}}>{c}/{max}</div>
    <p style={{...BODY,fontSize:12,marginTop:4}}>{dn?"Done!!":`${max-c} to go`}</p>
    <div style={{display:"flex",gap:8,justifyContent:"center",marginTop:10}}>
      <button onClick={()=>{const n=Math.min(c+1,max);setC(n);if(n>=max)onDone?.()}} style={BTN_SM} disabled={dn}>🎵 DONE</button>
      <button onClick={()=>setC(0)} style={{...BTN_SM,background:"var(--paper)"}}>↺ RESET</button>
    </div>
  </div>);
}
function Toggle({on,onToggle,label}){
  return <div onClick={onToggle} style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",userSelect:"none"}}>
    <div style={{width:40,height:22,borderRadius:2,border:"2px solid var(--ink)",position:"relative",background:on?"var(--teal)":"var(--paper-dark)",transition:"background .2s"}}>
      <div style={{width:14,height:14,borderRadius:1,background:on?"var(--cream)":"var(--ink)",position:"absolute",top:2,left:on?20:2,transition:"left .2s"}}/>
    </div>
    {label&&<span style={{fontSize:13,color:on?"var(--ink)":"var(--ink-mid)"}}>{label}</span>}
  </div>;
}
function Flash({msg}){if(!msg)return null;return<div style={FLASH_S}>{msg}</div>}
function Tape({children,color}){return<span style={{...TAG(color||"var(--paper-warm)","var(--ink)"),transform:`rotate(${(Math.random()*2-1).toFixed(1)}deg)`}}>{children}</span>}

// ─── SlotGrid ─────────────────────────────────────────────────────
function SlotGrid({slots,totalSlots,currentSlot,onDeckSlot,onMove,onRemove,onClearLink}){
  const[sel,setSel]=useState(null);
  const tap=n=>{const p=slots[String(n)];if(sel===null){if(p)setSel(n)}else if(sel===n)setSel(null);else{onMove(sel,n);setSel(null)}};
  return(<div>
    {sel!==null&&<div style={{background:"#fff8e0",border:"2px dashed var(--coral)",borderRadius:2,padding:"6px 10px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <p style={{...SUB,margin:0,color:"var(--coral)",fontSize:11}}>MOVING: {slots[String(sel)]?.name} — tap destination</p>
      <button onClick={()=>setSel(null)} style={BTN_GHOST}>cancel</button>
    </div>}
    {Array.from({length:totalSlots},(_,i)=>{
      const n=i+1,p=slots[String(n)],cur=n===currentSlot,done=currentSlot>0&&n<currentSlot&&p,od=n===onDeckSlot,isSel=n===sel,isTgt=sel!==null&&n!==sel;
      if(p)return(<div key={n} onClick={()=>tap(n)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 10px",marginBottom:2,cursor:"pointer",userSelect:"none",borderRadius:2,transition:"all .1s",background:isSel?"#fff3c4":cur?"#fff8e8":od?"#e8f6f0":done?"var(--paper-dark)":"var(--cream)",opacity:done&&!isSel?0.35:1,borderLeft:`4px solid ${isSel?"var(--coral)":od?"var(--teal)":cur?"var(--coral)":"transparent"}`,outline:isSel?"2px solid var(--coral)":"none"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
          <span style={{fontFamily:"'Overpass Mono',monospace",fontSize:14,fontWeight:700,width:24,textAlign:"center",color:cur?"var(--coral)":"var(--ink-mid)",flexShrink:0}}>{n}</span>
          <span style={{fontSize:14,fontWeight:600,color:isSel?"var(--coral)":p.pending?"var(--ink-light)":"var(--ink)",fontStyle:p.pending?"italic":"normal"}}>{p.pending?"(reserving…)":p.name}</span>
          {p.link&&!sel&&<button onClick={e=>{e.stopPropagation();onClearLink(n)}} style={{background:"none",border:"none",color:"var(--teal)",fontSize:10,cursor:"pointer"}}>🔗✕</button>}
          {od&&!isSel&&<Tape color="#d4f0e8">ON DECK</Tape>}
          {isSel&&<Tape color="#fff3c4">SELECTED</Tape>}
        </div>
        {!sel&&<button onClick={e=>{e.stopPropagation();onRemove(n)}} style={{...BTN_GHOST,color:"var(--coral)",fontSize:16,padding:0}}>×</button>}
        {isTgt&&<span style={{...SUB,fontSize:10,color:"var(--ink-light)"}}>↵ here</span>}
      </div>);
      return(<div key={n} onClick={()=>{if(sel)tap(n)}} style={{display:"flex",alignItems:"center",padding:"4px 10px",marginBottom:2,borderRadius:2,cursor:isTgt?"pointer":"default",borderLeft:isTgt?"4px dashed var(--ink-faded)":"4px solid transparent",background:isTgt?"var(--paper-warm)":"transparent"}}>
        <span style={{fontFamily:"'Overpass Mono',monospace",fontSize:13,width:24,textAlign:"center",color:isTgt?"var(--ink-mid)":"var(--ink-faded)"}}>{n}</span>
        <span style={{fontSize:12,fontStyle:"italic",color:isTgt?"var(--ink-light)":"var(--ink-faded)",marginLeft:8}}>{isTgt?"tap here":"—"}</span>
      </div>);
    })}
  </div>);
}

// ─── Hooks ────────────────────────────────────────────────────────
function useGeo(st){const[status,setS]=useState("idle");const[dist,setD]=useState(null);const check=useCallback(()=>{if(!st.geofenceEnabled||!st.venueLat){setS("ok");return}if(!navigator.geolocation){setS("unavailable");return}setS("checking");navigator.geolocation.getCurrentPosition(p=>{const d=hav(p.coords.latitude,p.coords.longitude,st.venueLat,st.venueLng);setD(Math.round(d));setS(d<=st.venueRadius?"ok":"too_far")},()=>setS("error"),{enableHighAccuracy:true,timeout:10000})},[st.geofenceEnabled,st.venueLat,st.venueLng,st.venueRadius]);return{status,dist,check}}
function sameDay(a,b){const d1=new Date(a),d2=new Date(b);return d1.getFullYear()===d2.getFullYear()&&d1.getMonth()===d2.getMonth()&&d1.getDate()===d2.getDate()}
function useSch(st,persist){const ref=useRef(st);ref.current=st;useEffect(()=>{if(!st.scheduleEnabled)return;const tick=()=>{const s=ref.current;
const so=inSch(s);const isNewWindow=so===true&&(!s.showDate||!sameDay(s.showDate,Date.now()));
// New show window: un-archive, open signups, reset lineup (even if currently archived)
if(isNewWindow){persist({...s,signupOpen:true,slots:{},waitlist:[],currentSlot:0,showDate:Date.now(),performedDevices:[],manualOverride:false,archived:false});return}
if(s.archived)return;
// Auto-close: if showDate is set and enough hours have elapsed, close signups & archive
if(s.scheduleCloseEnabled&&s.showDate){const elapsed=(Date.now()-s.showDate)/(1000*60*60);if(elapsed>=s.scheduleCloseAfter){persist({...s,signupOpen:false,archived:true,manualOverride:true});return}}
if(s.manualOverride)return};tick();const id=setInterval(tick,15000);return()=>clearInterval(id)},[st.scheduleEnabled,JSON.stringify(st.scheduleDays),st.scheduleOpenHour,st.scheduleOpenMin,st.scheduleShowHour,st.scheduleShowMin,st.scheduleDuration,st.scheduleCloseEnabled,st.scheduleCloseAfter])}

// ═══════════════════════════════════════════════════════════════════
//  DIRECTORY
// ═══════════════════════════════════════════════════════════════════
function DirPage({go}){
  const[venues,setV]=useState([]);const[ld,setLd]=useState(true);
  const[q,setQ]=useState("");const[mine,setMine]=useState([]);
  useEffect(()=>{(async()=>{
    const idx=await ldIdx();const all=[];const now=Date.now();const graceFrom=now;const stale=[];
    for(const e of idx){const v=await ldV(e.slug);if(!v)continue;const ls=lastSeen(v,graceFrom);if(now-ls>SIX_MONTHS_MS)stale.push(e.slug);else all.push({slug:e.slug,...v})}
    setV(all);setLd(false);setMine(myVenues());
    // fire-and-forget cleanup of stale venues
    for(const s of stale){try{await dlV(s);removeMyVenue(s)}catch{}}
  })()},[]);
  const ql=q.trim().toLowerCase();
  const searching=ql.length>0;
  const matches=searching?venues.filter(v=>v.eventName?.toLowerCase().includes(ql)||v.slug.toLowerCase().includes(ql)):[];
  const myList=mine.map(s=>venues.find(v=>v.slug===s)).filter(Boolean);
  const live=venues.filter(v=>v.signupOpen&&!v.archived),rest=venues.filter(v=>!v.signupOpen&&!v.archived),upcoming=venues.filter(v=>v.archived&&isUpcoming(v));
  return(<div style={PAGE}><style>{CSS}</style>
    <div style={{...CARD,marginTop:40,textAlign:"center"}} className="drift">
      <div style={{position:"absolute",top:-14,left:20,transform:"rotate(-3deg)",...TAG("var(--coral)","var(--cream)"),fontSize:10,padding:"4px 10px"}}>EST. TONIGHT</div>
      <h1 style={{...TITLE,fontSize:"clamp(32px,7vw,48px)",marginTop:8}}>Open Mic<br/>Tonight</h1>
      <p style={{...BODY,marginTop:8,maxWidth:300,marginInline:"auto"}}>Every venue gets a link. Performers sign up on their phone. Host runs the show.</p>
      <button onClick={()=>go("contact")} style={{...BTN,marginTop:20,width:"100%",fontSize:15}}
        onMouseDown={e=>{e.currentTarget.style.transform="translate(2px,2px)";e.currentTarget.style.boxShadow="1px 1px 0 var(--shadow)"}}
        onMouseUp={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="3px 3px 0 var(--shadow)"}}>+ NEW OPEN MIC</button>
    </div>

    <div style={{maxWidth:460,width:"100%",marginTop:20}}>
      <input style={{...INP,fontSize:14}} placeholder="🔍 search all venues" value={q} onChange={e=>setQ(e.target.value)}/>
    </div>

    {myList.length>0&&!searching&&<div style={{maxWidth:460,width:"100%",marginTop:20}} className="drift-1">
      <span style={SUB}>YOUR VENUES</span>
      {myList.map(v=>{const up=v.archived&&isUpcoming(v);return<div key={v.slug} onClick={()=>go(`${v.slug}/host`)} style={{...SECT,cursor:"pointer",marginTop:8,display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
        <div style={{minWidth:0,flex:1}}>
          <p style={{fontWeight:700,fontSize:15,margin:0}}>{v.eventName}</p>
          <p style={{...BODY,fontSize:12,marginTop:2}}>{v.slug}{v.archived?(up?" · upcoming":" · ended"):v.signupOpen?" · live":""}</p>
        </div>
        {v.archived&&up&&<span style={TAG("#fff8e8","var(--coral)")}>UPCOMING</span>}
        {v.archived&&!up&&<span style={TAG("var(--paper-dark)","var(--ink-mid)")}>ENDED</span>}
        {v.signupOpen&&!v.archived&&<span style={TAG("#d4f0e8","var(--teal)")}>OPEN</span>}
      </div>})}
    </div>}

    {searching?<div style={{maxWidth:460,width:"100%",marginTop:20}} className="drift-2">
      <span style={SUB}>{matches.length} result{matches.length!==1?"s":""}</span>
      {matches.length===0&&<p style={{...BODY,marginTop:12,textAlign:"center"}}>No venues match "{q}". Try fewer words.</p>}
      {matches.map(v=>{const up=v.archived&&isUpcoming(v);const[shH,shM]=showTime(v);const nxt=up?nextOcc(v.scheduleDays,shH,shM):null;return<div key={v.slug} onClick={()=>go(v.archived&&!up?`${v.slug}/host`:v.slug)} style={{...SECT,cursor:"pointer",marginTop:8,display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,opacity:v.archived&&!up?0.75:1}}>
        <div style={{minWidth:0,flex:1}}>
          <p style={{fontWeight:700,fontSize:15,margin:0}}>{v.eventName}</p>
          <p style={{...BODY,fontSize:12,marginTop:2}}>{v.slug}{up&&nxt?` · next ${fD(nxt)}`:v.showDate?` · last ${fD(v.showDate)}`:""}</p>
        </div>
        {v.archived&&up?<span style={TAG("#fff8e8","var(--coral)")}>UPCOMING</span>:v.archived?<span style={TAG("var(--paper-dark)","var(--ink-mid)")}>ENDED</span>:v.signupOpen?<span style={TAG("#d4f0e8","var(--teal)")}>OPEN</span>:null}
      </div>})}
      {matches.some(v=>v.archived&&!isUpcoming(v))&&<p style={{...BODY,fontSize:11,marginTop:10,color:"var(--ink-light)",textAlign:"center"}}>Ended venues link straight to the host panel (PIN required).</p>}
    </div>:<>
      {live.length>0&&<div style={{maxWidth:460,width:"100%",marginTop:20}} className="drift-1">
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}><div style={{width:8,height:8,borderRadius:"50%",background:"var(--teal)",animation:"blink 1.5s infinite"}}/><span style={{...SUB,color:"var(--teal)",margin:0}}>HAPPENING NOW</span></div>
        {live.map(v=><div key={v.slug} onClick={()=>go(v.slug)} style={{...CARD_ALT,cursor:"pointer",marginBottom:10,padding:"16px 18px",borderColor:"var(--teal)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}><div><p style={{...TITLE,fontSize:18,margin:0}}>{v.eventName}</p><p style={{...BODY,fontSize:12,marginTop:3}}>{filled(v.slots||{}).length}/{v.totalSlots} slots{addr(v)?` · ${shortAddr(addr(v),50)}`:""}</p></div><span style={TAG("#d4f0e8","var(--teal)")}>OPEN</span></div>
        </div>)}
      </div>}
      {upcoming.length>0&&<div style={{maxWidth:460,width:"100%",marginTop:20}} className="drift-1">
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}><span style={{...SUB,color:"var(--coral)",margin:0}}>📅 COMING UP</span></div>
        {upcoming.map(v=>{const[shH,shM]=showTime(v);const nxt=nextOcc(v.scheduleDays,shH,shM);return<div key={v.slug} onClick={()=>go(v.slug)} style={{...CARD_ALT,cursor:"pointer",marginBottom:10,padding:"16px 18px",borderColor:"var(--coral)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}><div><p style={{...TITLE,fontSize:18,margin:0}}>{v.eventName}</p>{nxt&&<p style={{...BODY,fontSize:12,marginTop:3}}>{fFull(nxt,shH,shM)}{addr(v)?` · ${shortAddr(addr(v),40)}`:""}</p>}</div><span style={TAG("#fff8e8","var(--coral)")}>UPCOMING</span></div>
        </div>})}
      </div>}
      {rest.length>0&&<div style={{maxWidth:460,width:"100%",marginTop:20}} className="drift-2">
        <span style={SUB}>ALL VENUES</span>
        {rest.map(v=><div key={v.slug} onClick={()=>go(v.slug)} style={{...SECT,cursor:"pointer",marginTop:8}}><p style={{fontWeight:700,fontSize:15,margin:0}}>{v.eventName}</p><p style={{...BODY,fontSize:12,marginTop:2}}>{v.slug}{v.showDate?` · last ${fD(v.showDate)}`:""}</p></div>)}
      </div>}
    </>}
    {ld&&<p style={{...BODY,marginTop:30}}>loading…</p>}
    {!ld&&venues.length===0&&<p style={{...BODY,marginTop:30}}>No open mics yet. Start one!</p>}
  </div>);
}

// ═══════════════════════════════════════════════════════════════════
//  CREATE
// ═══════════════════════════════════════════════════════════════════
function CreatePage({go}){
  const[auth,setAuth]=useState(false);const[pinIn,setPinIn]=useState("");
  const[name,setName]=useState("");const[sl,setSl]=useState("");const[pin,setPin]=useState("");
  const[tl,setTl]=useState(5);const[ts,setTs]=useState(12);const[msg,setMsg]=useState("");
  const[busy,setBusy]=useState(false);const[cust,setCust]=useState(false);
  const[limMode,setLimMode]=useState("time");const[spp,setSpp]=useState(2);
  const flash=m=>{setMsg(m);setTimeout(()=>setMsg(""),3000)};
  useEffect(()=>{if(!cust)setSl(slug(name))},[name,cust]);
  const create=async()=>{if(!name.trim()){flash("Name it");return}if(!sl.trim()){flash("Need a URL");return}if(pin.length<4){flash("PIN: 4+ chars");return}setBusy(true);const ex=await ldV(sl);if(ex){flash("URL taken");setBusy(false);return}const now=Date.now();const v={...DS,eventName:name.trim(),hostPin:pin,limitMode:limMode,timePerSlot:tl,songsPerSlot:spp,totalSlots:ts,createdAt:now,lastHostSeen:now};await svV(sl,v);const idx=await ldIdx();addMyVenue(sl);go(`${sl}/host`)};
  if(!auth){const tryP=()=>{if(pinIn==="4202"){setAuth(true);setPinIn("")}else flash("Wrong PIN")};
    return(<div style={PAGE}><style>{CSS}</style><Flash msg={msg}/>
      <div style={{maxWidth:460,width:"100%",marginTop:30}}>
        <button onClick={()=>go("")} style={{...BTN_GHOST,marginBottom:16}}>← back</button>
        <div style={{...CARD,textAlign:"center"}} className="drift">
          <div style={{fontSize:36,marginBottom:8}}>🔒</div><h2 style={{...TITLE,fontSize:24}}>Create Open Mic</h2><p style={{...BODY,marginTop:4}}>Enter admin PIN to continue.</p>
          <input type="password" value={pinIn} onChange={e=>setPinIn(e.target.value)} placeholder="admin pin" style={{...INP,textAlign:"center",fontFamily:"'Overpass Mono',monospace",fontSize:18,letterSpacing:4,marginTop:16}} onKeyDown={e=>e.key==="Enter"&&tryP()}/>
          <button style={{...BTN,width:"100%",marginTop:12}} onClick={tryP}>UNLOCK →</button>
        </div>
      </div>
    </div>)}
  return(<div style={PAGE}><style>{CSS}</style><Flash msg={msg}/>
    <div style={{maxWidth:460,width:"100%",marginTop:30}}>
      <button onClick={()=>go("")} style={{...BTN_GHOST,marginBottom:16}}>← back</button>
      <div style={CARD} className="drift">
        <div style={{position:"absolute",top:-12,right:16,transform:"rotate(2deg)",...TAG("var(--ink)","var(--cream)"),fontSize:10}}>NEW</div>
        <h2 style={{...TITLE,fontSize:26}}>Create Open Mic</h2>
        <p style={{...BODY,marginTop:4,marginBottom:20}}>Set it up. Get a link. Run the show.</p>
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div><label style={SUB}>NAME</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="Thursday Night at Joe's" style={{...INP,marginTop:6}}/></div>
          <div><label style={SUB}>URL</label><input value={sl} onChange={e=>{setSl(slug(e.target.value));setCust(true)}} placeholder="thursday-joes" style={{...INP,marginTop:6,fontFamily:"'Overpass Mono',monospace",fontSize:14}}/><p style={{...BODY,fontSize:11,marginTop:4}}>link → <span style={{fontFamily:"'Overpass Mono',monospace",color:"var(--coral)"}}>#{sl||"…"}</span></p></div>
          <div><label style={SUB}>HOST PIN</label><input value={pin} onChange={e=>setPin(e.target.value)} placeholder="secret (4+ chars)" type="password" style={{...INP,marginTop:6}}/></div>
          <div>
            <label style={SUB}>PERFORMER LIMIT</label>
            <div style={{display:"flex",borderRadius:2,overflow:"hidden",border:"2px solid var(--ink)",marginTop:8,marginBottom:12}}>
              <button onClick={()=>setLimMode("time")} style={{flex:1,padding:"9px 0",border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Overpass Mono',monospace",background:limMode==="time"?"var(--ink)":"var(--cream)",color:limMode==="time"?"var(--cream)":"var(--ink-mid)",transition:"all .1s"}}>⏱ MINUTES</button>
              <button onClick={()=>setLimMode("songs")} style={{flex:1,padding:"9px 0",border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Overpass Mono',monospace",background:limMode==="songs"?"var(--ink)":"var(--cream)",color:limMode==="songs"?"var(--cream)":"var(--ink-mid)",transition:"all .1s"}}>🎵 SONGS</button>
            </div>
            {limMode==="time"?<>
              <label style={SUB}>MINUTES PER ACT</label>
              <div style={{display:"flex",gap:6,marginTop:8}}>{[3,5,7,10,15].map(t=><button key={t} onClick={()=>setTl(t)} style={{flex:1,padding:"10px 0",border:"2px solid var(--ink)",borderRadius:2,cursor:"pointer",fontFamily:"'Overpass Mono',monospace",fontSize:14,fontWeight:700,background:tl===t?"var(--ink)":"var(--cream)",color:tl===t?"var(--cream)":"var(--ink)",transition:"all .1s"}}>{t}</button>)}</div>
            </>:<>
              <label style={SUB}>SONGS PER ACT</label>
              <div style={{display:"flex",gap:6,marginTop:8}}>{[1,2,3,4,5].map(s=><button key={s} onClick={()=>setSpp(s)} style={{flex:1,padding:"10px 0",border:"2px solid var(--ink)",borderRadius:2,cursor:"pointer",fontFamily:"'Overpass Mono',monospace",fontSize:14,fontWeight:700,background:spp===s?"var(--ink)":"var(--cream)",color:spp===s?"var(--cream)":"var(--ink)",transition:"all .1s"}}>{s}</button>)}</div>
            </>}
          </div>
          <div><label style={SUB}>TOTAL SLOTS</label><NumInput value={ts} onChange={setTs} min={4} max={50} style={{marginTop:6}}/></div>
          <button onClick={create} disabled={busy} style={{...BTN,width:"100%",opacity:busy?0.5:1,marginTop:4}}>{busy?"CREATING…":"CREATE →"}</button>
        </div>
      </div>
    </div>
  </div>);
}

// ═══════════════════════════════════════════════════════════════════
//  VENUE (performer + audience)
// ═══════════════════════════════════════════════════════════════════
function VenuePage({slug:SL,go}){
  const[vw,setVw]=useState("landing");const[st,setSt]=useState(DS);const[ld,setLd]=useState(false);
  const[sN,setSN]=useState("");const[sL,setSL2]=useState("");const[step,setStep]=useState("form");
  const[eN,setEN]=useState("");const[eL,setEL]=useState("");const[msg,setMsg]=useState("");
  const did=useRef(devId());const geo=useGeo(st);
  const refresh=useCallback(async()=>{const v=await ldV(SL);if(v)setSt(p=>({...p,...v}));setLd(true)},[SL]);
  useEffect(()=>{refresh();const id=setInterval(refresh,3000);return()=>clearInterval(id)},[refresh]);
  const persist=useCallback(n=>{setSt(n);svV(SL,n)},[SL]);
  useSch(st,persist);
  const flash=m=>{setMsg(m);setTimeout(()=>setMsg(""),3000)};
  const cnt=filled(st.slots).length;const os=[];for(let i=1;i<=st.totalSlots;i++)if(!st.slots[String(i)])os.push(i);
  const ps=os.filter(n=>st.currentSlot===0||n>st.currentSlot);
  const curP=st.currentSlot>0?st.slots[String(st.currentSlot)]:null;
  const odS=nextF(st.slots,st.totalSlots,st.currentSlot),odP=odS?st.slots[String(odS)]:null;
  const schD=st.scheduleDays||[4];
  const me=findDev(st.slots,did.current),mw=st.waitlist.find(w=>w.deviceId===did.current),al=me||mw;
  useEffect(()=>{if(vw==="signup"&&me&&me.pending&&step==="form")setStep("name")},[vw,me,step]);
  const pickSlot=n=>{const e={id:gid(),name:"",deviceId:did.current,time:Date.now(),pending:true};persist({...st,slots:{...st.slots,[String(n)]:e},showDate:st.showDate||Date.now()});setStep("name")};
  const joinWaitlist=()=>{setStep("waitlistName")};
  const submitName=()=>{
    if(!sN.trim()){flash("Enter your name");return}
    if(me){persist({...st,slots:{...st.slots,[String(me.slotNum)]:{...st.slots[String(me.slotNum)],name:sN.trim(),pending:false}}});flash("You're in! 🎤");setSN("");if(st.allowLinks){setSL2("");setStep("linkPrompt")}else setStep("form")}
  };
  const submitWaitlistName=()=>{
    if(!sN.trim()){flash("Enter your name");return}
    persist({...st,waitlist:[...st.waitlist,{id:gid(),name:sN.trim(),deviceId:did.current,time:Date.now()}]});
    flash("Waitlisted!");setSN("");setStep("form");
  };
  const releaseSlot=()=>{if(me){const s={...st.slots};delete s[String(me.slotNum)];persist({...st,slots:s})}setStep("form")};
  const dropOut=()=>{
    if(!confirm("Drop out of the lineup?\n\nYou'll lose your spot. You can sign up again later if slots are still open."))return;
    if(me){const s={...st.slots};delete s[String(me.slotNum)];persist({...st,slots:s})}
    else if(mw){persist({...st,waitlist:st.waitlist.filter(w=>w.deviceId!==did.current)})}
    flash("You're out. Thanks for letting us know!");
    setStep("form");
    setVw("landing");
  };
  const saveEdit=()=>{if(!eN.trim()){flash("Name can't be empty");return}if(me){persist({...st,slots:{...st.slots,[String(me.slotNum)]:{...st.slots[String(me.slotNum)],name:eN.trim(),link:eL.trim()||null}}})}else if(mw){persist({...st,waitlist:st.waitlist.map(w=>w.deviceId===did.current?{...w,name:eN.trim(),link:eL.trim()||null}:w)})}flash("Updated!");setStep("form")};
  const repick=n=>{if(!me)return;const s={...st.slots};const p={...s[String(me.slotNum)]};delete s[String(me.slotNum)];s[String(n)]=p;persist({...st,slots:s});flash(`Moved to #${n}`);setStep("form")};
  const startEdit=()=>{setEN(al?.name||"");setEL(al?.link||"");setStep("edit")};
  if(!ld)return<div style={PAGE}><style>{CSS}</style><p style={BODY}>loading…</p></div>;

  if(vw==="landing"){
    const[shH,shM]=showTime(st);
    const nextShow=st.scheduleEnabled?nextOcc(schD,shH,shM):null;
    return(<div style={PAGE}><style>{CSS}</style><Flash msg={msg}/>
    <div style={{...CARD,marginTop:40,textAlign:"left"}} className="drift">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
        <div><p style={SUB}>OPEN MIC</p><h1 style={{...TITLE,fontSize:32,marginTop:4}}>{st.eventName}</h1></div>
        {st.archived?<span style={TAG("var(--paper-dark)","var(--ink-mid)")}>ENDED</span>:st.signupOpen?<span style={TAG("#d4f0e8","var(--teal)")}>OPEN</span>:<span style={TAG("var(--paper-dark)","var(--ink-mid)")}>CLOSED</span>}
      </div>

      {st.archived&&nextShow?<>
        <div style={{marginTop:18,padding:"14px 16px",background:"#fff8e8",border:"2px dashed var(--coral)",borderRadius:2}}>
          <p style={{...SUB,color:"var(--coral)",margin:"0 0 4px"}}>COMING UP</p>
          <p style={{fontFamily:"'Fraunces',serif",fontSize:18,fontWeight:700,color:"var(--ink)",lineHeight:1.3}}>{fFull(nextShow,shH,shM)}</p>
          <p style={{...BODY,fontSize:12,marginTop:6}}>Signups {fT(st.scheduleOpenHour,st.scheduleOpenMin)} · Show {fT(shH,shM)} · {st.limitMode==="time"?`${st.timePerSlot} min`:`${st.songsPerSlot} song${st.songsPerSlot!==1?"s":""}`}/act</p>
          <p style={{...BODY,fontSize:11,marginTop:4,color:"var(--ink-light)"}}>Every {schD.map(d=>DAYS[d]).join(", ")}</p>
        </div>
        {addr(st)&&<p style={{...BODY,fontSize:12,marginTop:10,lineHeight:1.4}}>📌 {addr(st)}</p>}
        <p style={{...BODY,fontSize:12,marginTop:12,textAlign:"center"}}>Check back later!</p>
      </>:st.archived?<>
        <div style={{marginTop:18,padding:"14px 16px",background:"var(--paper-warm)",border:"2px dashed var(--ink-faded)",borderRadius:2}}>
          <p style={{...BODY,margin:0}}>This open mic has ended. Check back later or find another venue.</p>
        </div>
      </>:<>
        {addr(st)&&<p style={{...BODY,fontSize:12,marginTop:8,lineHeight:1.4}}>📌 {addr(st)}</p>}
        {st.geofenceEnabled&&<p style={{...BODY,fontSize:12,marginTop:4,color:"var(--coral)"}}>📍 Must be at venue to sign up</p>}
        {st.scheduleEnabled&&<p style={{...BODY,fontSize:12,marginTop:4}}>🕐 {schD.map(d=>DAYS[d]).join(", ")} · signups {fT(st.scheduleOpenHour,st.scheduleOpenMin)} · show {fT(shH,shM)}{st.scheduleCloseEnabled?` · closes after ${fHrs(st.scheduleCloseAfter)}`:""}</p>}
        <div style={{display:"flex",flexDirection:"column",gap:10,marginTop:24}}>
          <button style={{...BTN,width:"100%"}} onClick={()=>{setVw("signup");setStep("form");geo.check()}}>SIGN UP TO PERFORM →</button>
          <button style={{...BTN2,width:"100%"}} onClick={()=>setVw("audience")}>VIEW LINEUP</button>
        </div>
      </>}

      <div style={{display:"flex",justifyContent:"space-between",marginTop:16}}>
        <button style={BTN_GHOST} onClick={()=>go("")}>← all venues</button>
        <button style={{...BTN_GHOST,color:"var(--ink-faded)",fontSize:11}} onClick={()=>go(`${SL}/host`)}>host panel →</button>
      </div>
    </div>
  </div>)}

  if(vw==="signup"){const gB=st.geofenceEnabled&&st.venueLat&&geo.status!=="ok",gC=geo.status==="checking";const rps=me?os.filter(n=>n>st.currentSlot):[];const dP=(st.performedDevices||[]).includes(did.current);
  return(<div style={PAGE}><style>{CSS}</style><Flash msg={msg}/>
    <div style={{...CARD,marginTop:30}} className="drift">
      <p style={SUB}>{st.eventName}</p><h2 style={{...TITLE,fontSize:24,marginTop:4}}>Sign Up</h2>
      {al&&!(me&&me.pending)&&(step==="form"||step==="edit"||step==="editlink"||step==="repick"||step==="linkPrompt")?(
        step==="linkPrompt"?<div style={{borderTop:"2px solid var(--teal)",marginTop:16,paddingTop:16}}>
          <p style={{fontWeight:700,fontSize:16,color:"var(--teal)"}}>🎤 You're in!</p><p style={BODY}>Add a link?</p>
          <input style={{...INP,marginTop:10}} placeholder="instagram, website…" value={sL} onChange={e=>setSL2(e.target.value)}/>
          <button style={{...BTN,width:"100%",marginTop:10}} onClick={()=>{const m2=findDev(st.slots,did.current);if(m2&&sL.trim())persist({...st,slots:{...st.slots,[String(m2.slotNum)]:{...st.slots[String(m2.slotNum)],link:sL.trim()}}});setSL2("");setStep("form")}}>{sL.trim()?"SAVE LINK":"SKIP"}</button>
        </div>:step==="edit"?<div style={{marginTop:16}}>
          <label style={SUB}>YOUR NAME</label><input style={{...INP,marginTop:6}} value={eN} onChange={e=>setEN(e.target.value)}/>
          {st.allowLinks&&<><label style={{...SUB,marginTop:12,display:"block"}}>LINK</label><input style={{...INP,marginTop:6}} placeholder="optional" value={eL} onChange={e=>setEL(e.target.value)}/></>}
          <div style={{display:"flex",gap:8,marginTop:12}}><button style={{...BTN,flex:1}} onClick={saveEdit}>SAVE</button><button style={{...BTN2,flex:1}} onClick={()=>setStep("form")}>CANCEL</button></div>
        </div>:step==="editlink"?<div style={{marginTop:16}}>
          <label style={SUB}>YOUR LINK</label><input style={{...INP,marginTop:6}} value={eL} onChange={e=>setEL(e.target.value)}/>
          <div style={{display:"flex",gap:8,marginTop:12}}><button style={{...BTN,flex:1}} onClick={()=>{if(me)persist({...st,slots:{...st.slots,[String(me.slotNum)]:{...st.slots[String(me.slotNum)],link:eL.trim()||null}}});flash("Updated!");setStep("form")}}>SAVE</button><button style={{...BTN2,flex:1}} onClick={()=>setStep("form")}>CANCEL</button></div>
        </div>:step==="repick"?<div style={{marginTop:16}}>
          <p style={BODY}>Tap an open slot to move there.</p>
          <div style={{display:"flex",flexDirection:"column",gap:3,marginTop:10}}>
            {Array.from({length:st.totalSlots},(_,i)=>{const n=i+1,p=st.slots[String(n)],isMe=me&&n===me.slotNum,past=st.currentSlot>0&&n<=st.currentSlot;
              if(isMe)return<div key={n} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:"#fff3c4",borderRadius:2,border:"2px solid var(--coral)"}}><span style={{fontFamily:"'Overpass Mono',monospace",fontWeight:700,width:24,textAlign:"center"}}>{n}</span><span style={{fontWeight:600}}>You ({p.name})</span></div>;
              if(p||past)return<div key={n} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 12px",opacity:past?0.25:0.5,borderRadius:2}}><span style={{fontFamily:"'Overpass Mono',monospace",width:24,textAlign:"center",color:"var(--ink-light)"}}>{n}</span><span style={{color:"var(--ink-light)",fontSize:13,fontStyle:p?.pending?"italic":"normal"}}>{p?(p.pending?"reserving…":p.name):"passed"}</span></div>;
              return<button key={n} onClick={()=>repick(n)} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",background:"var(--cream)",border:"2px dashed var(--ink-faded)",borderRadius:2,cursor:"pointer",width:"100%",textAlign:"left"}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--ink)";e.currentTarget.style.borderStyle="solid"}}onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--ink-faded)";e.currentTarget.style.borderStyle="dashed"}}>
                <span style={{fontFamily:"'Overpass Mono',monospace",fontWeight:700,width:24,textAlign:"center"}}>{n}</span><span style={{color:"var(--ink-mid)",fontSize:13}}>open — tap to move</span></button>})}
          </div><button style={{...LINK,marginTop:8}} onClick={()=>setStep("form")}>← cancel</button>
        </div>:(()=>{const hp=me&&st.currentSlot>0&&me.slotNum<st.currentSlot;
          return hp?<div style={{borderTop:"2px dashed var(--ink-faded)",marginTop:16,paddingTop:16}}>
            <p style={{fontWeight:700,fontSize:15}}>🎤 You performed!</p><p style={BODY}>{al.name} — slot {me.slotNum}. Thanks!</p>
            {st.allowLinks&&<button style={{...BTN_SM,marginTop:10}} onClick={()=>{setEL(al.link||"");setStep("editlink")}}>edit link</button>}
          </div>:<div style={{borderTop:"2px solid var(--teal)",marginTop:16,paddingTop:16}}>
            <p style={{fontWeight:700,fontSize:15,color:"var(--teal)"}}>✓ You're signed up</p>
            <p style={{...BODY,marginTop:4}}><strong>{al.name}</strong>{me?` — slot #${me.slotNum}`:""}{mw?" — waitlisted":""}</p>
            {st.allowLinks&&al.link&&<p style={{...BODY,fontSize:12,color:"var(--teal)"}}>🔗 {al.link}</p>}
            {!st.signupOpen&&<p style={{...BODY,fontSize:11,marginTop:4}}>Signups closed but you can manage your spot.</p>}
            <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
              <button style={BTN_SM} onClick={startEdit}>edit info</button>
              {me&&rps.length>0&&<button style={{...BTN_SM,background:"var(--paper)"}} onClick={()=>setStep("repick")}>change slot</button>}
              {!(me&&st.currentSlot>0&&me.slotNum===st.currentSlot)&&<button style={{...BTN_SM,background:"var(--cream)",color:"var(--coral)",borderColor:"var(--coral)"}} onClick={dropOut}>drop out</button>}
            </div>
          </div>})()
      ):!st.signupOpen?<div style={{marginTop:16}}><p style={{...BODY,color:"var(--coral)"}}>Sign-ups are closed.</p>{st.scheduleEnabled&&<p style={{...BODY,marginTop:4}}>Next: {schD.map(d=>DAYS[d]).join(", ")} · signups {fT(st.scheduleOpenHour,st.scheduleOpenMin)} · show {fT(...showTime(st))}</p>}</div>
      :gC?<div style={{textAlign:"center",margin:"30px 0"}}><p style={BODY}>📡 Checking location…</p></div>
      :gB?<div style={{textAlign:"center",margin:"20px 0"}}>{geo.status==="too_far"&&<><p style={{fontWeight:700,color:"var(--coral)"}}>📍 Not at venue</p><p style={BODY}>~{geo.dist}m away (need ≤{st.venueRadius}m)</p></>}{geo.status==="error"&&<p style={{color:"var(--coral)",fontWeight:600}}>Location failed</p>}<button style={{...BTN_SM,marginTop:12}} onClick={geo.check}>retry</button></div>
      :dP?<div style={{marginTop:16}}><p style={{fontWeight:700,fontSize:15}}>🎤 Already performed!</p><p style={BODY}>Enjoy the rest of the show.</p></div>
      :step==="form"?<div style={{marginTop:16}}>
        <p style={BODY}>{cnt}/{st.totalSlots} slots · {ps.length} open{st.waitlist.length>0?` · ${st.waitlist.length} waitlisted`:""}</p>
        <p style={{...BODY,fontSize:12,color:"var(--coral)",marginTop:2}}>{st.limitMode==="time"?`${st.timePerSlot} min`:`${st.songsPerSlot} song${st.songsPerSlot!==1?"s":""}`} per act</p>
        {ps.length===0?<>
          <p style={{...BODY,marginTop:14,textAlign:"center"}}>Slots are full, but you can join the waitlist.</p>
          <button style={{...BTN,width:"100%",marginTop:10}} onClick={joinWaitlist}>JOIN WAITLIST →</button>
        </>:<>
          <p style={{...BODY,fontSize:12,marginTop:12}}>Pick an open slot to reserve it. You'll enter your name next.</p>
          <div style={{display:"flex",flexDirection:"column",gap:3,marginTop:10}}>
            {Array.from({length:st.totalSlots},(_,i)=>{const n=i+1,p=st.slots[String(n)],past=st.currentSlot>0&&n<=st.currentSlot;
              if(p)return<div key={n} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 12px",background:"var(--paper)",borderRadius:2,border:"1px solid var(--ink-faded)",opacity:past?0.25:0.5}}><span style={{fontFamily:"'Overpass Mono',monospace",fontWeight:700,width:24,textAlign:"center",color:"var(--ink-light)"}}>{n}</span><span style={{color:"var(--ink-light)",fontSize:13,fontStyle:p.pending?"italic":"normal"}}>{p.pending?"reserving…":p.name}</span><span style={{...BODY,fontSize:11,marginLeft:"auto"}}>{past?"done":"taken"}</span></div>;
              if(past)return<div key={n} style={{padding:"4px 12px",opacity:0.2}}><span style={{fontFamily:"'Overpass Mono',monospace",fontSize:13,color:"var(--ink-faded)"}}>{n}</span></div>;
              return<button key={n} onClick={()=>pickSlot(n)} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"var(--cream)",border:"2px dashed var(--ink-faded)",borderRadius:2,cursor:"pointer",width:"100%",textAlign:"left",transition:"all .1s"}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--ink)";e.currentTarget.style.borderStyle="solid";e.currentTarget.style.background="#fff8e8"}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--ink-faded)";e.currentTarget.style.borderStyle="dashed";e.currentTarget.style.background="var(--cream)"}}>
                <span style={{fontFamily:"'Overpass Mono',monospace",fontWeight:700,width:24,textAlign:"center"}}>{n}</span><span style={{color:"var(--ink-mid)",fontSize:13}}>open — tap to claim</span></button>})}
          </div>
        </>}
        <p style={{...BODY,fontSize:11,textAlign:"center",marginTop:10}}>One per device. Be at the venue.</p>
      </div>
      :step==="name"?<div style={{marginTop:16}}>
        <div style={{background:"#fff8e8",border:"2px solid var(--coral)",borderRadius:2,padding:"10px 14px",marginBottom:14}}>
          <p style={{...SUB,color:"var(--coral)",margin:"0 0 2px",fontSize:10}}>SLOT #{me?.slotNum} RESERVED</p>
          <p style={{...BODY,fontSize:12,margin:0}}>Hold tight — finish signing up to keep it.</p>
        </div>
        <label style={SUB}>YOUR NAME</label>
        <input style={{...INP,marginTop:6}} placeholder="what should we call you?" value={sN} onChange={e=>setSN(e.target.value)} autoFocus onKeyDown={e=>{if(e.key==="Enter")submitName()}}/>
        <button style={{...BTN,width:"100%",marginTop:12}} onClick={submitName}>{st.allowLinks?"NEXT →":"LOCK IT IN →"}</button>
        <button style={{...LINK,color:"var(--coral)",marginTop:8}} onClick={releaseSlot}>← release slot &amp; go back</button>
      </div>
      :step==="waitlistName"?<div style={{marginTop:16}}>
        <p style={BODY}>All slots are taken. Join the waitlist and we'll grab you a spot if anyone drops.</p>
        <label style={{...SUB,marginTop:14,display:"block"}}>YOUR NAME</label>
        <input style={{...INP,marginTop:6}} placeholder="what should we call you?" value={sN} onChange={e=>setSN(e.target.value)} autoFocus onKeyDown={e=>{if(e.key==="Enter")submitWaitlistName()}}/>
        <button style={{...BTN,width:"100%",marginTop:12}} onClick={submitWaitlistName}>JOIN WAITLIST</button>
        <button style={{...LINK,marginTop:8}} onClick={()=>{setSN("");setStep("form")}}>← back</button>
      </div>:null}
      <button style={LINK} onClick={()=>{if(me&&me.pending){const s={...st.slots};delete s[String(me.slotNum)];persist({...st,slots:s})}setVw("landing");setStep("form")}}>← back</button>
    </div>
  </div>)}

  if(vw==="audience"){const curP2=st.currentSlot>0?st.slots[String(st.currentSlot)]:null;const odP2=odS?st.slots[String(odS)]:null;
  return(<div style={PAGE}><style>{CSS}</style>
    <div style={{...CARD,marginTop:30}} className="drift">
      <p style={SUB}>{st.eventName}</p><h2 style={{...TITLE,fontSize:24,marginTop:4}}>Lineup</h2>
      <p style={{...BODY,fontSize:12,marginTop:4}}>📅 {fD(st.showDate||Date.now())} · {cnt} acts · {st.limitMode==="time"?`${st.timePerSlot}min`:`${st.songsPerSlot} songs`}/act</p>
      {addr(st)&&<p style={{...BODY,fontSize:12,marginTop:4,lineHeight:1.4}}>📌 {addr(st)}</p>}
      {curP2&&<div style={{marginTop:16,padding:16,background:"#fff8e8",border:"2px solid var(--coral)",borderRadius:2}}>
        <p style={{...SUB,color:"var(--coral)",margin:"0 0 4px"}}>NOW ON STAGE — #{st.currentSlot}</p>
        <p style={{fontFamily:"'Fraunces',serif",fontSize:24,fontWeight:900}}>{curP2.name}</p>
        {st.allowLinks&&curP2.link&&<a href={eUrl(curP2.link)} target="_blank" rel="noopener" style={{color:"var(--teal)",fontSize:12,wordBreak:"break-all"}}>{curP2.link}</a>}
      </div>}
      {odP2&&<div style={{marginTop:8,padding:"8px 12px",background:"#e8f6f0",border:"1px solid var(--teal)",borderRadius:2}}><p style={{...BODY,margin:0}}>🎸 On deck: <strong>{odP2.name}</strong></p></div>}
      <div style={{marginTop:16}}>{Array.from({length:st.totalSlots},(_,i)=>{const n=i+1,p=st.slots[String(n)],cur=n===st.currentSlot,done=st.currentSlot>0&&n<st.currentSlot&&p,od=n===odS;
        return<div key={n} style={{padding:"6px 10px",marginBottom:2,display:"flex",alignItems:"center",gap:8,borderRadius:2,background:cur?"#fff8e8":od?"#e8f6f0":"transparent",opacity:done?0.3:p?1:0.15,borderLeft:`3px solid ${cur?"var(--coral)":od?"var(--teal)":"transparent"}`}}>
          <span style={{fontFamily:"'Overpass Mono',monospace",fontSize:13,fontWeight:700,width:24,textAlign:"center",color:cur?"var(--coral)":p?"var(--ink-mid)":"var(--ink-faded)"}}>{n}</span>
          {p?<div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",minWidth:0}}><span style={{fontSize:14,fontWeight:cur?700:400,fontStyle:p.pending?"italic":"normal",color:p.pending?"var(--ink-light)":"inherit"}}>{p.pending?"reserving…":p.name}</span>{st.allowLinks&&p.link&&<a href={eUrl(p.link)} target="_blank" rel="noopener" style={{color:"var(--teal)",fontSize:11,textDecoration:"none"}}>🔗</a>}</div>:<span style={{fontSize:12,fontStyle:"italic",color:"var(--ink-faded)"}}>—</span>}
        </div>})}</div>
      {st.signupOpen&&<button style={{...BTN,width:"100%",marginTop:14}} onClick={()=>{setVw("signup");setStep("form");geo.check()}}>SIGN UP</button>}
      <button style={LINK} onClick={()=>setVw("landing")}>← back</button>
    </div>
  </div>)}
  return null;
}

// ═══════════════════════════════════════════════════════════════════
//  HOST DASHBOARD
// ═══════════════════════════════════════════════════════════════════
function HostPage({slug:SL,go}){
  const[st,setSt]=useState(DS);const[ld,setLd]=useState(false);const[auth,setAuth]=useState(false);
  const[pinIn,setPinIn]=useState("");const[msg,setMsg]=useState("");const[tab,setTab]=useState("show");const[aN,setAN]=useState("");
  const[aQ,setAQ]=useState("");const[aR,setAR]=useState([]);const[aL,setAL2]=useState(false);
  const refresh=useCallback(async()=>{const v=await ldV(SL);if(v)setSt(p=>({...p,...v}));setLd(true)},[SL]);
  useEffect(()=>{refresh();const id=setInterval(refresh,4000);return()=>clearInterval(id)},[refresh]);
  const persist=useCallback(async n=>{setSt(n);await svV(SL,n)},[SL]);
  useSch(st,persist);
  const flash=m=>{setMsg(m);setTimeout(()=>setMsg(""),3000)};
  if(!ld)return<div style={PAGE}><style>{CSS}</style><p style={BODY}>loading…</p></div>;
  if(!auth){const tryP=()=>{if(pinIn===st.hostPin){setAuth(true);setPinIn("");addMyVenue(SL);persist({...st,lastHostSeen:Date.now()})}else flash("Wrong PIN")};
    return(<div style={PAGE}><style>{CSS}</style><Flash msg={msg}/>
      <div style={{...CARD,marginTop:60,textAlign:"center"}} className="drift">
        <div style={{fontSize:36,marginBottom:8}}>🔒</div><h2 style={{...TITLE,fontSize:24}}>Host Panel</h2><p style={{...BODY,marginTop:4}}>{st.eventName}</p>
        <input type="password" value={pinIn} onChange={e=>setPinIn(e.target.value)} placeholder="host pin" style={{...INP,textAlign:"center",fontFamily:"'Overpass Mono',monospace",fontSize:18,letterSpacing:4,marginTop:16}} onKeyDown={e=>e.key==="Enter"&&tryP()}/>
        <button style={{...BTN,width:"100%",marginTop:12}} onClick={tryP}>UNLOCK →</button>
        <button style={LINK} onClick={()=>go(SL)}>← back to venue</button>
      </div>
    </div>)}
  const cnt=filled(st.slots).length;const os=[];for(let i=1;i<=st.totalSlots;i++)if(!st.slots[String(i)])os.push(i);
  const curP=st.currentSlot>0?st.slots[String(st.currentSlot)]:null;const odS=nextF(st.slots,st.totalSlots,st.currentSlot),odP=odS?st.slots[String(odS)]:null;const schD=st.scheduleDays||[4];
  const togSignup=()=>persist({...st,signupOpen:!st.signupOpen,manualOverride:true,showDate:st.showDate||(!st.signupOpen?Date.now():st.showDate)});
  const advance=()=>{const nxt=nextF(st.slots,st.totalSlots,st.currentSlot);if(!nxt){flash("No more performers!");return}const pd=[...(st.performedDevices||[])];if(st.currentSlot>0&&st.slots[String(st.currentSlot)]){const di=st.slots[String(st.currentSlot)].deviceId;if(di&&!pd.includes(di))pd.push(di)}let nx={...st,currentSlot:nxt,performedDevices:pd};if(st.waitlist.length>0&&os.length>0){const[wl,...rest]=st.waitlist;nx={...nx,slots:{...nx.slots,[String(os[0])]:wl},waitlist:rest}}persist(nx)};
  const rmSlot=n=>{const s={...st.slots};delete s[String(n)];persist({...st,slots:s})};
  const hostAdd=()=>{if(!aN.trim()){flash("Enter name");return}const sl=lowOpen(st.slots,st.totalSlots);if(!sl){flash("Full!");return}persist({...st,slots:{...st.slots,[String(sl)]:{id:gid(),name:aN.trim(),deviceId:"host",time:Date.now()}},showDate:st.showDate||Date.now()});flash(`Added #${sl}`);setAN("")};
  const resetShow=()=>persist({...st,slots:{},waitlist:[],currentSlot:0,signupOpen:false,showDate:null,manualOverride:false,performedDevices:[]});
  const deleteForever=async()=>{await dlV(SL);removeMyVenue(SL);go("")};
  const togDay=d=>{const dy=[...schD];const i=dy.indexOf(d);if(i>=0)dy.splice(i,1);else dy.push(d);dy.sort((a,b)=>a-b);persist({...st,scheduleDays:dy})};
  const setVGPS=()=>{if(!navigator.geolocation){flash("No geolocation");return}flash("Getting location…");navigator.geolocation.getCurrentPosition(p=>{persist({...st,venueLat:p.coords.latitude,venueLng:p.coords.longitude,venueAddress:st.venueAddress||"Current location"});flash("Pinned to current location!")},()=>flash("Failed"),{enableHighAccuracy:true,timeout:10000})};
  const searchAddr=async()=>{if(!aQ.trim())return;setAL2(true);setAR([]);try{const r=await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(aQ.trim())}`);const d=await r.json();setAR(d.map(r=>({name:r.display_name,lat:parseFloat(r.lat),lng:parseFloat(r.lon)})));if(d.length===0)flash("No results")}catch{flash("Search failed")}setAL2(false)};
  const setVFrom=r=>{persist({...st,venueLat:r.lat,venueLng:r.lng,venueAddress:r.name});setAR([]);setAQ("");flash("Address saved!")};
  const clearAddr=()=>{persist({...st,venueAddress:"",venueLat:null,venueLng:null,geofenceEnabled:false});flash("Cleared")};
  const copyLink=()=>{const b=window.location.href.replace(/#.*$/,"");navigator.clipboard?.writeText(`${b}#${SL}`);flash("Link copied!")};
  const copyHostLink=()=>{const b=window.location.href.replace(/#.*$/,"");navigator.clipboard?.writeText(`${b}#${SL}/host`);flash("Host link copied!")};
  return(<div style={{...PAGE,alignItems:"center",paddingTop:16}}><style>{CSS}</style><Flash msg={msg}/>
    <div style={{...CARD,maxWidth:540,width:"100%"}} className="drift">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div><p style={{...SUB,margin:0}}>HOST PANEL</p><h2 style={{...TITLE,fontSize:20,marginTop:2}}>{st.eventName}</h2></div>
        <button style={BTN_GHOST} onClick={()=>go(SL)}>exit →</button>
      </div>
      <div style={{display:"flex",borderRadius:2,overflow:"hidden",border:"2px solid var(--ink)",marginBottom:16}}>
        {[["show","SHOW"],["settings","SETTINGS"]].map(([k,l])=><button key={k} onClick={()=>setTab(k)} style={{flex:1,padding:"10px 0",border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Overpass Mono',monospace",letterSpacing:1,background:tab===k?"var(--ink)":"var(--cream)",color:tab===k?"var(--cream)":"var(--ink-mid)"}}>{l}</button>)}
      </div>
      {st.archived&&<div style={{background:"#fbeae6",border:"2px dashed var(--coral)",borderRadius:2,padding:"14px 16px",marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,marginBottom:10}}>
          <p style={{...SUB,color:"var(--coral)",margin:0}}>ENDED · BOOKMARK THIS PAGE</p>
          <button style={{...BTN_SM,background:"var(--teal)",color:"var(--cream)",borderColor:"var(--teal)"}} onClick={()=>{persist({...st,archived:false});flash("Restored!")}}>↻ RESTORE</button>
        </div>
        <p style={{...BODY,fontSize:12,marginBottom:10}}>Hidden from the directory. To re-host this same open mic later, bookmark this page now — it's the only way back in.</p>
        <div style={{background:"var(--cream)",border:"1px solid var(--ink-faded)",borderRadius:2,padding:"8px 10px",marginBottom:8,fontFamily:"'Overpass Mono',monospace",fontSize:11,color:"var(--ink)",wordBreak:"break-all",lineHeight:1.5}}>{typeof window!=="undefined"?`${window.location.origin}/#${SL}/host`:`/#${SL}/host`}</div>
        <button style={{...BTN_SM,width:"100%"}} onClick={copyHostLink}>📋 COPY HOST URL</button>
      </div>}
      {tab==="show"&&<>
        {st.scheduleEnabled&&<div style={{background:"#e8f6f0",borderRadius:2,padding:"8px 12px",marginBottom:10,border:"1px solid var(--teal)"}}><p style={{...BODY,fontSize:12,margin:0,color:"var(--teal)",fontWeight:600}}>⏰ {schD.map(d=>DAYS[d]).join(", ")} · signups {fT(st.scheduleOpenHour,st.scheduleOpenMin)} → show {fT(...showTime(st))}{st.scheduleCloseEnabled?` · auto-close after ${fHrs(st.scheduleCloseAfter)}`:""}{inSch(st)===true?" · OPEN":" · Closed"}{st.manualOverride?" · MANUAL":""}</p></div>}
        {st.geofenceEnabled&&st.venueLat&&<div style={{background:"#fff8e8",borderRadius:2,padding:"8px 12px",marginBottom:10,border:"1px solid var(--ink-faded)"}}><p style={{...BODY,fontSize:12,margin:0}}>📍 Geofence {st.venueRadius}m{addr(st)?` · ${shortAddr(addr(st),60)}`:""}</p></div>}
        <div style={{display:"flex",gap:8,marginBottom:10}}>
          <button style={{...BTN,flex:1,background:st.signupOpen?"var(--coral)":"var(--teal)",borderColor:st.signupOpen?"var(--coral)":"var(--teal)",color:"var(--cream)"}} onClick={togSignup}>{st.signupOpen?"🔒 CLOSE":"🔓 OPEN"} SIGNUP</button>
          <button style={{...BTN2,flexShrink:0,padding:"10px 14px"}} onClick={copyLink} title="Copy link">📋</button>
        </div>
        {curP&&st.currentSlot>0&&<div style={{marginTop:14,padding:16,background:"#fff8e8",border:"2px solid var(--coral)",borderRadius:2}}>
          <p style={{...SUB,color:"var(--coral)",margin:"0 0 4px"}}>NOW — #{st.currentSlot}</p>
          <p style={{fontFamily:"'Fraunces',serif",fontSize:22,fontWeight:900,margin:"4px 0"}}>{curP.name}</p>
          {st.limitMode==="time"?<Timer key={curP.id} seconds={st.timePerSlot*60} onDone={()=>flash("⏰ Time!")}/>:<SongCounter key={curP.id} max={st.songsPerSlot} onDone={()=>flash("🎵 Done!")}/>}
        </div>}
        {odP&&st.currentSlot>0&&<div style={{background:"#e8f6f0",borderRadius:2,padding:"8px 12px",marginTop:8,border:"1px solid var(--teal)"}}><p style={{...BODY,margin:0}}>🎸 On deck #{odS}: <strong>{odP.name}</strong></p></div>}
        <button style={{...BTN,width:"100%",marginTop:12}} onClick={advance}>{st.currentSlot===0?"▶ START SHOW":"⏭ NEXT PERFORMER"}</button>
        <div style={{...SECT,marginTop:14}}><p style={{...SUB,margin:"0 0 8px"}}>+ QUICK ADD</p><div style={{display:"flex",gap:8}}><input style={{...INP,flex:1}} placeholder="name" value={aN} onChange={e=>setAN(e.target.value)} onKeyDown={e=>e.key==="Enter"&&hostAdd()}/><button style={BTN_SM} onClick={hostAdd}>ADD</button></div></div>
        <div style={{...SECT,marginTop:10}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><p style={{...SUB,margin:0}}>SLOTS ({cnt}/{st.totalSlots})</p><span style={{...BODY,fontSize:10}}>tap to move</span></div>
          <SlotGrid slots={st.slots} totalSlots={st.totalSlots} currentSlot={st.currentSlot} onDeckSlot={odS} onMove={(f,t)=>persist({...st,slots:mvSlot(st.slots,st.totalSlots,f,t)})} onRemove={rmSlot} onClearLink={n=>{const p=st.slots[String(n)];if(p){const{link,...r}=p;persist({...st,slots:{...st.slots,[String(n)]:r}})}}}/>
        </div>
        {st.waitlist.length>0&&<div style={{...SECT,marginTop:8}}><p style={{...SUB,margin:"0 0 6px"}}>WAITLIST ({st.waitlist.length})</p>{st.waitlist.map((p,i)=><div key={p.id} style={{display:"flex",justifyContent:"space-between",padding:"4px 8px"}}><span style={{...BODY,fontSize:13}}>{i+1}. {p.name}</span><button onClick={()=>persist({...st,waitlist:st.waitlist.filter(w=>w.id!==p.id)})} style={{...BTN_GHOST,color:"var(--coral)",fontSize:14}}>×</button></div>)}</div>}
        <div style={{marginTop:22,paddingTop:16,borderTop:"1px dashed var(--ink-faded)"}}>
          <p style={{...SUB,color:"var(--coral)",margin:"0 0 10px"}}>DANGER ZONE</p>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button style={{...BTN_SM,background:"var(--cream)",color:"var(--coral)",borderColor:"var(--coral)"}} onClick={()=>{if(confirm("Clear tonight's lineup? The venue stays active."))resetShow()}}>↺ RESET SHOW</button>
            <button style={{...BTN_SM,background:"var(--coral)",color:"var(--cream)",borderColor:"var(--coral)",boxShadow:"2px 2px 0 var(--ink)"}} onClick={()=>{if(confirm("End this open mic?\n\nIt'll be removed from the directory. IMPORTANT: bookmark this page before leaving — it's how you'll get back to restore it later."))persist({...st,archived:true,signupOpen:false})}}>✕ END OPEN MIC</button>
          </div>
          <p style={{...BODY,fontSize:11,marginTop:8}}>Reset clears tonight's performers. End hides the venue from the public directory (link still works).</p>
          <div style={{marginTop:14,paddingTop:14,borderTop:"1px dashed var(--ink-faded)"}}>
            <button style={{...BTN_SM,background:"#2a0a0a",color:"#ff9a88",borderColor:"#2a0a0a",fontSize:11,padding:"7px 12px"}} onClick={()=>{const typed=prompt(`PERMANENT DELETE\n\nThis will erase "${st.eventName}" and everything in it — no way to recover.\n\nType the venue name to confirm:\n  ${st.eventName}`);if(typed===null)return;if(typed.trim()!==st.eventName.trim()){alert("Name didn't match. Nothing was deleted.");return}deleteForever()}}>☠ DELETE FOREVER</button>
            <p style={{...BODY,fontSize:11,marginTop:6}}>Permanently wipes the venue. No recovery. Use End Open Mic instead if you might bring it back.</p>
          </div>
        </div>
      </>}
      {tab==="settings"&&<>
        <div style={SECT}>
          <label style={SUB}>EVENT NAME</label><input style={{...INP,marginTop:6}} value={st.eventName} onChange={e=>persist({...st,eventName:e.target.value})}/>
          <label style={{...SUB,marginTop:14,display:"block"}}>TOTAL SLOTS</label><NumInput style={{marginTop:6}} value={st.totalSlots} min={1} max={50} onChange={v=>persist({...st,totalSlots:v})}/>
          <label style={{...SUB,marginTop:14,display:"block"}}>LIMIT MODE</label>
          <div style={{display:"flex",borderRadius:2,overflow:"hidden",border:"2px solid var(--ink)",marginTop:8,marginBottom:10}}>
            {[["time","⏱ MINUTES"],["songs","🎵 SONGS"]].map(([k,l])=><button key={k} onClick={()=>persist({...st,limitMode:k})} style={{flex:1,padding:"9px 0",border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Overpass Mono',monospace",background:st.limitMode===k?"var(--ink)":"var(--cream)",color:st.limitMode===k?"var(--cream)":"var(--ink-mid)"}}>{l}</button>)}
          </div>
          {st.limitMode==="time"?<><label style={SUB}>MINUTES PER ACT</label><NumInput style={{marginTop:6}} value={st.timePerSlot} min={1} max={30} onChange={v=>persist({...st,timePerSlot:v})}/></>:<><label style={SUB}>SONGS PER ACT</label><NumInput style={{marginTop:6}} value={st.songsPerSlot} min={1} max={10} onChange={v=>persist({...st,songsPerSlot:v})}/></>}
        </div>
        <div style={{...SECT,marginTop:12}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><p style={{...SUB,margin:0}}>🔗 PERFORMER LINKS</p><Toggle on={st.allowLinks} onToggle={()=>persist({...st,allowLinks:!st.allowLinks})}/></div></div>

        <div style={{...SECT,marginTop:12}}>
          <p style={{...SUB,margin:"0 0 4px"}}>📌 VENUE ADDRESS</p>
          <p style={{...BODY,fontSize:11,marginBottom:10}}>Shown to performers and on the venue listing. Optional.</p>
          {addr(st)?<div style={{background:"var(--paper-warm)",border:"1px solid var(--ink-faded)",borderRadius:2,padding:"10px 12px",marginBottom:10}}>
            <p style={{...BODY,fontSize:13,margin:0,color:"var(--ink)",lineHeight:1.4}}>{addr(st)}</p>
            {st.venueLat&&<p style={{...BODY,fontSize:10,margin:"4px 0 0",color:"var(--ink-light)",fontFamily:"'Overpass Mono',monospace"}}>📍 pinned · {st.venueLat.toFixed(4)}, {st.venueLng.toFixed(4)}</p>}
            <button style={{...BTN_GHOST,color:"var(--coral)",fontSize:11,marginTop:4,padding:0}} onClick={clearAddr}>clear address</button>
          </div>:null}
          <label style={SUB}>SEARCH &amp; PIN</label>
          <div style={{display:"flex",gap:6,marginTop:6,marginBottom:8}}>
            <input style={{...INP,flex:1}} placeholder="address or venue name" value={aQ} onChange={e=>setAQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&searchAddr()}/>
            <button style={BTN_SM} onClick={searchAddr} disabled={aL}>{aL?"…":"🔍"}</button>
          </div>
          {aR.length>0&&<div style={{marginBottom:10}}>{aR.map((r,i)=><button key={i} onClick={()=>setVFrom(r)} style={{display:"block",width:"100%",padding:"8px 10px",marginBottom:3,background:"var(--cream)",border:"1px solid var(--ink-faded)",borderRadius:2,color:"var(--ink)",fontSize:12,textAlign:"left",cursor:"pointer",lineHeight:1.4}}>📍 {r.name}</button>)}</div>}
          <label style={{...SUB,marginTop:10,display:"block"}}>OR TYPE FREELY</label>
          <input style={{...INP,marginTop:6}} placeholder="e.g. 'Joe's Bar, upstairs'" value={st.venueAddress||""} onChange={e=>persist({...st,venueAddress:e.target.value})}/>
          <p style={{...BODY,fontSize:11,marginTop:6}}>Free text is displayed only — for location lock, use search above to pin coordinates.</p>
        </div>

        <div style={{...SECT,marginTop:12,border:st.geofenceEnabled?"2px solid var(--ink-faded)":"1px solid var(--ink-faded)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><p style={{...SUB,margin:0}}>📍 LOCATION LOCK</p><Toggle on={st.geofenceEnabled} onToggle={()=>{if(!st.geofenceEnabled&&!st.venueLat){flash("Pin an address first");return}persist({...st,geofenceEnabled:!st.geofenceEnabled})}}/></div>
          <p style={{...BODY,fontSize:11,marginTop:6}}>Performers must be within the radius to sign up.</p>
          {st.geofenceEnabled&&<div style={{marginTop:12}}>
            {!st.venueLat&&<div style={{background:"#fbeae6",border:"1px solid var(--coral)",borderRadius:2,padding:"8px 10px",marginBottom:10}}><p style={{...BODY,fontSize:12,margin:0,color:"var(--coral)"}}>⚠ No coordinates pinned. Use the search above to pin an address, or:</p></div>}
            <button style={{...BTN_SM,width:"100%",marginBottom:10}} onClick={setVGPS}>📡 PIN CURRENT LOCATION</button>
            <label style={SUB}>RADIUS (m)</label><NumInput style={{marginTop:6}} value={st.venueRadius} min={20} max={2000} onChange={v=>persist({...st,venueRadius:v})}/>
          </div>}
        </div>
        <div style={{...SECT,marginTop:12,border:st.scheduleEnabled?"2px solid var(--teal)":"1px solid var(--ink-faded)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><p style={{...SUB,margin:0}}>🕐 AUTO SCHEDULE</p><Toggle on={st.scheduleEnabled} onToggle={()=>persist({...st,scheduleEnabled:!st.scheduleEnabled})}/></div>
          {st.scheduleEnabled&&<div style={{marginTop:12}}>
            <label style={SUB}>DAYS</label><div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:6,marginBottom:12}}>{DAYS.map((d,i)=><button key={i} onClick={()=>togDay(i)} style={{padding:"6px 10px",borderRadius:2,border:"2px solid var(--ink)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Overpass Mono',monospace",background:schD.includes(i)?"var(--ink)":"var(--cream)",color:schD.includes(i)?"var(--cream)":"var(--ink-mid)"}}>{d}</button>)}</div>
            <label style={SUB}>SIGNUPS OPEN AT</label><div style={{display:"flex",gap:8,alignItems:"center",marginTop:6,marginBottom:12}}><NumInput value={st.scheduleOpenHour} min={0} max={23} onChange={v=>persist({...st,scheduleOpenHour:v})}/><span style={{fontWeight:700,fontSize:18}}>:</span><NumInput value={st.scheduleOpenMin} min={0} max={59} onChange={v=>persist({...st,scheduleOpenMin:v})}/></div>
            <label style={SUB}>SHOW STARTS AT</label><div style={{display:"flex",gap:8,alignItems:"center",marginTop:6,marginBottom:4}}><NumInput value={st.scheduleShowHour!=null?st.scheduleShowHour:showTime(st)[0]} min={0} max={23} onChange={v=>persist({...st,scheduleShowHour:v})}/><span style={{fontWeight:700,fontSize:18}}>:</span><NumInput value={st.scheduleShowMin!=null?st.scheduleShowMin:showTime(st)[1]} min={0} max={59} onChange={v=>persist({...st,scheduleShowMin:v})}/></div>
            <p style={{...BODY,fontSize:11,marginBottom:12,color:"var(--ink-light)"}}>{st.scheduleCloseEnabled?`Signups auto-close ${fHrs(st.scheduleCloseAfter)} after opening.`:"Signups stay open until you close them manually."} Show time is shown to performers.</p>
            <div style={{marginTop:4,paddingTop:12,borderTop:"1px dashed var(--ink-faded)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><p style={{...SUB,margin:0}}>🔒 AUTO-CLOSE &amp; ARCHIVE</p><Toggle on={st.scheduleCloseEnabled} onToggle={()=>persist({...st,scheduleCloseEnabled:!st.scheduleCloseEnabled})}/></div>
              <p style={{...BODY,fontSize:11,marginTop:6}}>Signups close and the venue archives after a set number of hours. Resets fresh next show day.</p>
              {st.scheduleCloseEnabled&&<div style={{marginTop:10}}>
                <label style={SUB}>CLOSE AFTER (HOURS)</label>
                <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>{[2,3,4,5,6].map(h=><button key={h} onClick={()=>persist({...st,scheduleCloseAfter:h})} style={{padding:"10px 0",flex:"1 1 50px",border:"2px solid var(--ink)",borderRadius:2,cursor:"pointer",fontFamily:"'Overpass Mono',monospace",fontSize:14,fontWeight:700,background:st.scheduleCloseAfter===h?"var(--ink)":"var(--cream)",color:st.scheduleCloseAfter===h?"var(--cream)":"var(--ink)",transition:"all .1s"}}>{h}h</button>)}</div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginTop:10}}>
                  <span style={{...SUB,margin:0}}>CUSTOM</span>
                  <NumInput value={st.scheduleCloseAfter} min={1} max={24} onChange={v=>persist({...st,scheduleCloseAfter:v})} style={{width:60}}/>
                  <span style={{...BODY,fontSize:12}}>hours</span>
                </div>
              </div>}
            </div>
            <div style={{background:"#e8f6f0",borderRadius:2,padding:"10px 12px",marginTop:12,border:"1px solid var(--teal)"}}><p style={{...BODY,fontSize:13,margin:0,color:"var(--teal)"}}>Every <strong>{schD.map(d=>DAYS[d]).join(", ")||"—"}</strong>: signups open <strong>{fT(st.scheduleOpenHour,st.scheduleOpenMin)}</strong>, show starts <strong>{fT(...showTime(st))}</strong>{st.scheduleCloseEnabled?<>{", auto-closes after "}<strong>{fHrs(st.scheduleCloseAfter)}</strong></>:null}</p></div>
          </div>}
        </div>
      </>}
    </div>
  </div>);
}

// ═══════════════════════════════════════════════════════════════════
//  CONTACT
// ═══════════════════════════════════════════════════════════════════
function ContactPage({go}){
  return(<div style={PAGE}><style>{CSS}</style>
    <div style={{maxWidth:460,width:"100%",marginTop:30}}>
      <button onClick={()=>go("")} style={{...BTN_GHOST,marginBottom:16}}>← back</button>
      <div style={{...CARD,textAlign:"center"}} className="drift">
        <div style={{position:"absolute",top:-12,right:16,transform:"rotate(2deg)",...TAG("var(--ink)","var(--cream)"),fontSize:10}}>INQUIRIES</div>
        <div style={{fontSize:36,marginBottom:8}}>✉</div>
        <h2 style={{...TITLE,fontSize:26}}>Want to host?</h2>
        <p style={{...BODY,marginTop:10,marginBottom:20,maxWidth:340,marginInline:"auto"}}>We'd love to get your open mic set up on the platform. Reach out and we'll get you started.</p>
        <div style={{background:"var(--paper-warm)",border:"2px dashed var(--ink-mid)",borderRadius:2,padding:"16px 20px"}}>
          <p style={{...SUB,margin:"0 0 6px"}}>GET IN TOUCH</p>
          <a href="mailto:jamesrh36@gmail.com" style={{fontFamily:"'Overpass Mono',monospace",fontSize:16,fontWeight:700,color:"var(--coral)",textDecoration:"none",wordBreak:"break-all"}}>jamesrh36@gmail.com</a>
        </div>
        <p style={{...BODY,fontSize:12,marginTop:16,color:"var(--ink-light)"}}>Include your venue name, location, and how often you host — we'll take it from there.</p>
      </div>
    </div>
  </div>);
}

// ═══════════════════════════════════════════════════════════════════
//  ROUTER
// ═══════════════════════════════════════════════════════════════════
export default function App(){
  const[route,setRoute]=useState(window.location.hash.slice(1)||"");
  useEffect(()=>{const h=()=>setRoute(window.location.hash.slice(1)||"");window.addEventListener("hashchange",h);return()=>window.removeEventListener("hashchange",h)},[]);
  const go=p=>{window.location.hash=p};
  if(!route)return<DirPage go={go}/>;
  if(route==="contact")return<ContactPage go={go}/>;
  if(route==="create")return<CreatePage go={go}/>;
  if(route.endsWith("/host"))return<HostPage slug={route.replace(/\/host$/,"")} go={go}/>;
  return<VenuePage slug={route} go={go}/>;
}