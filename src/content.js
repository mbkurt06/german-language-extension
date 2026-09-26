(() => {
  const ADAPTERS = [
    {id:"youtube", host:/youtube\.com$/, selectors:[".ytp-caption-segment"]},
    {id:"zdf", host:/(^|\.)zdf\.de$/, selectors:["[class*='subtitle']","[class*='caption']","[aria-live='polite']"]},
    {id:"ard", host:/(^|\.)ardmediathek\.de$/, selectors:["[class*='subtitle']","[class*='caption']","[aria-live='polite']"]}
  ];
  const state={lastText:"", cache:new Map(), tooltip:null, youtubeOverlay:null, youtubeGermanLine:null, youtubeVideoId:"", youtubeCaptionsEnabled:null, youtubeTrackKey:"", youtubeFetchKey:"", youtubeLastAttemptKey:"", youtubeFetchFailures:0, youtubeRetryTimer:null, youtubeFetchId:0, youtubeTimedCues:null, youtubeCueIndex:-1, youtubeVideo:null, youtubeVideoListeners:null, youtubeVideoFrameId:null, youtubeFallbackHideTimer:null, youtubeLastInputAt:0, youtubeActiveContainer:null, youtubeSegmentTexts:new WeakMap(), youtubeLastDomText:"", settings:{showSentenceTranslation:true,translationFontSize:85}};
  const adapter=ADAPTERS.find(a=>a.host.test(location.hostname));
  if(!adapter) return;

  function tokenize(text){ return text.match(/[\p{L}\p{M}ßÄÖÜäöü]+(?:['’-][\p{L}\p{M}]+)?|[^\s]/gu)||[]; }
  function createTooltip(){
    const el=document.createElement("div"); el.id="gle-tooltip"; el.hidden=true; document.documentElement.appendChild(el); return el;
  }
  function esc(s){ const d=document.createElement("div"); d.textContent=s??""; return d.innerHTML; }
  function renderCard(data, tokenIndex, anchor){
    const h=data.hover?.[String(tokenIndex)]||data.hover?.[tokenIndex]||{};
    const expressions=h.primary_expressions||[];
    const expr=expressions[0];
    const lexical=h.lexical_form;
    const notes=h.usage_notes||[];
    const more=(h.dictionary_meanings_tr||[]).join(", ");
    const sentence=data.sentence_meaning_tr ? `<div class="gle-sentence">🇹🇷 ${esc(data.sentence_meaning_tr)}</div>` : "";
    const sourceToken=(data.tokens||[]).find(token=>token.i===tokenIndex);
    const source=sourceToken?.text && !lexical?.article ? `<div class="gle-source"><b>Almanca:</b> ${esc(sourceToken.lemma||sourceToken.text)}</div>` : "";
    const expression=expr ? `<div class="gle-expression"><b>${esc(expr.canonical)}</b><div>→ ${esc((expr.meaning_tr||[])[0]||"")}</div>${expr.grammar_hint?`<small>${esc(expr.grammar_hint)}</small>`:""}</div>` : "";
    const contextual=h.contextual_word_meaning_tr ? `<div class="gle-context"><b>Bu cümlede:</b> ${esc(h.contextual_word_meaning_tr)}</div>` : "";
    const usage=notes.map(n=>`<div class="gle-note"><b>${esc(n.label)}</b> · ${esc(n.explanation_tr)}</div>`).join("");
    const noun=lexical?.article ? `<div class="gle-lexical"><b>${esc(lexical.article)} ${esc(lexical.singular)}</b> · die ${esc(lexical.plural)}</div>` : "";
    const dictionary=more ? `<details><summary>Kelime anlamları</summary><div>${esc(more)}</div></details>` : "";
    state.tooltip.innerHTML=sentence+source+expression+noun+contextual+usage+dictionary || `<div>Henüz analiz yok.</div>`;
    const r=anchor.getBoundingClientRect(); state.tooltip.hidden=false;
    state.tooltip.style.left=Math.min(window.innerWidth-370,Math.max(8,r.left))+"px";
    state.tooltip.style.top=Math.max(8,r.top-state.tooltip.offsetHeight-10)+"px";
  }
  async function analyze(text){
    if(state.cache.has(text)) return state.cache.get(text);
    const {engineUrl="http://127.0.0.1:8765"}=await chrome.storage.sync.get("engineUrl");
    const response=await fetch(engineUrl.replace(/\/$/,"")+"/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text})});
    if(!response.ok) throw new Error("Engine "+response.status);
    const data=await response.json(); state.cache.set(text,data); return data;
  }
  async function renderSentenceTranslation(node,text){
    node.querySelector(".gle-subtitle-translation")?.remove();
    if(!state.settings.showSentenceTranslation) return;
    try{
      const data=await analyze(text);
      if(!data.sentence_meaning_tr || node.dataset.gleText!==text) return;
      const line=document.createElement("span");
      line.className="gle-subtitle-translation";
      line.textContent=data.sentence_meaning_tr;
      line.style.fontSize=state.settings.translationFontSize+"%";
      node.appendChild(line);
    }catch(_e){ /* Hover remains available even when translation fails. */ }
  }
  function renderAnalyzedTokens(node,text,data){
    if(node.dataset.gleText!==text) return;
    node.textContent="";
    const tokens=data.tokens||[];
    tokens.forEach((token,i)=>{
      const span=document.createElement("span");
      span.textContent=token.text;
      span.className=token.pos==="PUNCT"?"gle-punct":"gle-word";
      span.dataset.gleIndex=token.i;
      if(span.className==="gle-word") span.addEventListener("mouseenter",()=>renderCard(data,token.i,span));
      node.appendChild(span);
      if(i<tokens.length-1 && token.pos!=="PUNCT") node.append(" ");
    });
  }
  function renderFallbackTokens(node,text){
    node.textContent="";
    const parts=tokenize(text);
    parts.forEach((part,i)=>{
      const span=document.createElement("span");
      span.textContent=part;
      span.className=/^[\p{L}\p{M}]/u.test(part)?"gle-word":"gle-punct";
      node.appendChild(span);
      if(i<parts.length-1) node.append(" ");
    });
  }
  async function decorate(node,text){
    if(node.dataset.gleText===text) return;
    node.dataset.gleText=text;
    renderFallbackTokens(node,text);
    try{
      const data=await analyze(text);
      if(node.dataset.gleText!==text) return;
      renderAnalyzedTokens(node,text,data);
      await renderSentenceTranslation(node,text);
    }catch(_e){ /* Keep the timed subtitle visible if analysis is unavailable. */ }
  }
  function sourceText(node){
    return node.dataset.gleSource || node.dataset.gleText || (node.innerText||node.textContent||"").trim();
  }
  function resetYouTubeTrack(videoId){
    clearTimeout(state.youtubeFallbackHideTimer);
    state.youtubeFallbackHideTimer=null;
    state.youtubeVideoId=videoId;
    state.youtubeCaptionsEnabled=null;
    state.youtubeTrackKey="";
    state.youtubeFetchKey="";
    state.youtubeLastAttemptKey="";
    state.youtubeFetchFailures=0;
    clearTimeout(state.youtubeRetryTimer);
    state.youtubeRetryTimer=null;
    state.youtubeFetchId++;
    state.youtubeTimedCues=null;
    state.youtubeCueIndex=-1;
    state.youtubeActiveContainer=null;
    state.youtubeSegmentTexts=new WeakMap();
    if(state.youtubeOverlay) state.youtubeOverlay.hidden=true;
  }
  function renderTimedCue(mediaTime){
    if(!state.youtubeTimedCues) return false;
    const video=state.youtubeVideo || document.querySelector("video.html5-main-video") || document.querySelector("video");
    const player=document.querySelector(".html5-video-player");
    if(!video || !player) return true;
    const {overlay,germanLine}=ensureYouTubeOverlay(player);
    const seconds=Number.isFinite(mediaTime)?mediaTime:video.currentTime;
    const cue=cueAtTime(state.youtubeTimedCues,seconds*1000);
    if(!cue){ overlay.hidden=true; state.youtubeCueIndex=-1; return true; }
    overlay.hidden=false;
    if(state.youtubeCueIndex!==cue.index){
      state.youtubeCueIndex=cue.index;
      decorate(germanLine,cue.text);
    }
    return true;
  }
  function bindYouTubeVideo(){
    const video=document.querySelector("video.html5-main-video") || document.querySelector("video");
    if(!video || video===state.youtubeVideo) return video;
    if(state.youtubeVideo && state.youtubeVideoListeners){
      ["timeupdate","seeking","seeked","play","pause","ratechange"].forEach(type=>state.youtubeVideo.removeEventListener(type,state.youtubeVideoListeners));
      if(state.youtubeVideoFrameId!==null && state.youtubeVideo.cancelVideoFrameCallback) state.youtubeVideo.cancelVideoFrameCallback(state.youtubeVideoFrameId);
    }
    state.youtubeVideo=video;
    state.youtubeVideoListeners=()=>renderTimedCue();
    ["timeupdate","seeking","seeked","play","pause","ratechange"].forEach(type=>video.addEventListener(type,state.youtubeVideoListeners));
    if(video.requestVideoFrameCallback){
      const onFrame=(_now,metadata)=>{
        if(state.youtubeVideo!==video) return;
        renderTimedCue(metadata.mediaTime);
        state.youtubeVideoFrameId=video.requestVideoFrameCallback(onFrame);
      };
      state.youtubeVideoFrameId=video.requestVideoFrameCallback(onFrame);
    }
    return video;
  }
  async function loadYouTubeTrack(videoId,track){
    let url;
    try{ url=new URL(track.baseUrl); }catch(_error){ return; }
    if(url.hostname!=="youtube.com" && !url.hostname.endsWith(".youtube.com")) return;
    url.searchParams.set("fmt","json3");
    const key=`${videoId}|${track.vssId||track.languageCode||""}|${url.href}`;
    if(key===state.youtubeTrackKey || key===state.youtubeFetchKey) return;
    if(key!==state.youtubeLastAttemptKey){
      state.youtubeLastAttemptKey=key;
      state.youtubeFetchFailures=0;
    }
    const requestId=++state.youtubeFetchId;
    state.youtubeFetchKey=key;
    state.youtubeTimedCues=null;
    try{
      const response=await fetch(url.href,{credentials:"include",cache:"no-store"});
      if(!response.ok) throw new Error(`Caption track ${response.status}`);
      const raw=(await response.text()).replace(/^\)\]\}'\s*/,"");
      const cues=parseJson3Cues(JSON.parse(raw));
      if(!cues.length) throw new Error("Caption track contained no timed cues");
      if(requestId!==state.youtubeFetchId || videoId!==state.youtubeVideoId) return;
      state.youtubeFetchKey="";
      state.youtubeTrackKey=key;
      state.youtubeTimedCues=cues;
      state.youtubeCueIndex=-1;
      state.youtubeFetchFailures=0;
      clearTimeout(state.youtubeRetryTimer);
      state.youtubeRetryTimer=null;
      bindYouTubeVideo();
      renderTimedCue();
    }catch(_error){
      if(requestId!==state.youtubeFetchId) return;
      state.youtubeFetchKey="";
      state.youtubeTrackKey="";
      state.youtubeTimedCues=null;
      state.youtubeFetchFailures++;
      if(state.youtubeFetchFailures<=2){
        clearTimeout(state.youtubeRetryTimer);
        state.youtubeRetryTimer=setTimeout(()=>{
          state.youtubeRetryTimer=null;
          if(videoId===state.youtubeVideoId) window.postMessage({source:"gle-youtube-content",type:"refresh"},location.origin);
        },state.youtubeFetchFailures*2500);
      }
    }
  }
  function receiveYouTubeTrack(event){
    const message=event.data;
    if(event.source!==window || event.origin!==location.origin || message?.source!=="gle-youtube-caption-bridge") return;
    if(message.videoId && message.videoId!==state.youtubeVideoId) resetYouTubeTrack(message.videoId);
    state.youtubeCaptionsEnabled=message.enabled!==false;
    if(!state.youtubeCaptionsEnabled){
      state.youtubeFetchId++;
      state.youtubeFetchKey="";
      clearTimeout(state.youtubeRetryTimer);
      state.youtubeRetryTimer=null;
      state.youtubeTimedCues=null;
      state.youtubeTrackKey=`${state.youtubeVideoId}|disabled`;
      state.youtubeSegmentTexts=new WeakMap();
      if(state.youtubeOverlay) state.youtubeOverlay.hidden=true;
      return;
    }
    if(!message.track?.baseUrl){
      state.youtubeFetchId++;
      state.youtubeFetchKey="";
      clearTimeout(state.youtubeRetryTimer);
      state.youtubeRetryTimer=null;
      state.youtubeTimedCues=null;
      state.youtubeTrackKey=`${state.youtubeVideoId}|no-track`;
      state.youtubeSegmentTexts=new WeakMap();
      scanYouTube();
      return;
    }
    loadYouTubeTrack(message.videoId, message.track);
  }
  function installYouTubeBridge(){
    window.addEventListener("message",receiveYouTubeTrack);
    const script=document.createElement("script");
    script.src=chrome.runtime.getURL("src/youtube-bridge.js");
    script.onload=()=>script.remove();
    (document.head || document.documentElement).appendChild(script);
  }
  function ensureYouTubeOverlay(player){
    let overlay=player.querySelector(".gle-youtube-overlay");
    if(!overlay){
      overlay=document.createElement("div");
      overlay.className="gle-youtube-overlay";
      const germanLine=document.createElement("div");
      germanLine.className="gle-youtube-german";
      overlay.appendChild(germanLine);
      player.appendChild(overlay);
    }
    state.youtubeOverlay=overlay;
    state.youtubeGermanLine=overlay.querySelector(".gle-youtube-german");
    return {overlay,germanLine:state.youtubeGermanLine};
  }
  function scanYouTube(){
    const player=document.querySelector(".html5-video-player");
    if(!player) return;

    const containers=[...document.querySelectorAll(".ytp-caption-window-bottom")];
    const entries=containers.map(container=>{
      const parts=[...container.querySelectorAll(".ytp-caption-segment")]
        .map(node=>(node.innerText||node.textContent||"").trim())
        .filter(Boolean);
      const text=parts.join(" ")
        .replace(/\s+([,.!?;:])/g,"$1")
        .replace(/\s+/g," ")
        .trim();
      return {container,text};
    }).filter(entry=>entry.text);

    const {overlay,germanLine}=ensureYouTubeOverlay(player);
    const current=entries[entries.length-1];

    if(current?.text && current.text.length<500){
      clearTimeout(state.youtubeFallbackHideTimer);
      state.youtubeFallbackHideTimer=null;
      overlay.hidden=false;
      if(current.text!==state.youtubeLastDomText){
        state.youtubeLastDomText=current.text;
        decorate(germanLine,current.text);
      }
      return;
    }

    if(state.youtubeFallbackHideTimer===null){
      state.youtubeFallbackHideTimer=setTimeout(()=>{
        state.youtubeFallbackHideTimer=null;
        state.youtubeLastDomText="";
        overlay.hidden=true;
      },250);
    }
  }
  function scan(){
    if(adapter.id==="youtube"){ scanYouTube(); return; }
    for(const selector of adapter.selectors) document.querySelectorAll(selector).forEach(node=>{
      const text=sourceText(node); if(text && text.length<500 && !node.querySelector(".gle-word")) decorate(node,text);
    });
  }
  state.tooltip=createTooltip();
  chrome.storage.sync.get({showSentenceTranslation:true,translationFontSize:85},x=>{state.settings=x;scan();});
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=="sync") return;
    if(changes.showSentenceTranslation) state.settings.showSentenceTranslation=changes.showSentenceTranslation.newValue;
    if(changes.translationFontSize) state.settings.translationFontSize=changes.translationFontSize.newValue;
    document.querySelectorAll(".gle-subtitle-translation").forEach(el=>el.remove());
    document.querySelectorAll("[data-gle-text]").forEach(node=>{ if(state.settings.showSentenceTranslation) renderSentenceTranslation(node,node.dataset.gleText); });
  });
  document.addEventListener("mousemove",e=>{ if(state.tooltip&&!state.tooltip.contains(e.target)&&!e.target.closest?.(".gle-word")) state.tooltip.hidden=true; });
  let scanScheduled=false;
  new MutationObserver(()=>{
    if(scanScheduled) return;
    scanScheduled=true;
    requestAnimationFrame(()=>{scanScheduled=false;scan();});
  }).observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  scan();
})();