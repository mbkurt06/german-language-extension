(() => {
  const ADAPTERS = [
    {id:"youtube", host:/youtube\.com$/, selectors:[".ytp-caption-segment"]},
    {id:"zdf", host:/(^|\.)zdf\.de$/, selectors:["[class*='subtitle']","[class*='caption']","[aria-live='polite']"]},
    {id:"ard", host:/(^|\.)ardmediathek\.de$/, selectors:["[class*='subtitle']","[class*='caption']","[aria-live='polite']"]}
  ];

  const state = {
    cache:new Map(),
    tooltip:null,
    settings:{showSentenceTranslation:true,translationFontSize:85},
    youtube:{
      overlay:null,
      germanLine:null,
      video:null,
      frameId:null,
      videoListeners:null,
      videoId:"",
      cues:null,
      cueIndex:-1,
      timedAvailable:false,
      domPending:"",
      domStable:"",
      domLastChange:0,
      domFirstSeen:0,
      domTimer:null,
      hideTimer:null,
    }
  };

  const adapter=ADAPTERS.find(a=>a.host.test(location.hostname));
  if(!adapter) return;

  function tokenize(text){
    return text.match(/[\p{L}\p{M}ßÄÖÜäöü]+(?:['’-][\p{L}\p{M}]+)?|[^\s]/gu)||[];
  }

  function createTooltip(){
    const el=document.createElement("div");
    el.id="gle-tooltip";
    el.hidden=true;
    document.documentElement.appendChild(el);
    return el;
  }

  function esc(s){
    const d=document.createElement("div");
    d.textContent=s??"";
    return d.innerHTML;
  }

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
    state.tooltip.innerHTML=sentence+source+expression+noun+contextual+usage+dictionary || "<div>Henüz analiz yok.</div>";

    const r=anchor.getBoundingClientRect();
    state.tooltip.hidden=false;
    state.tooltip.style.left=Math.min(window.innerWidth-370,Math.max(8,r.left))+"px";
    state.tooltip.style.top=Math.max(8,r.top-state.tooltip.offsetHeight-10)+"px";
  }

  async function analyze(text){
    if(state.cache.has(text)) return state.cache.get(text);
    const {engineUrl="http://127.0.0.1:8765"}=await chrome.storage.sync.get("engineUrl");
    const response=await fetch(engineUrl.replace(/\/$/,"")+"/analyze",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({text})
    });
    if(!response.ok) throw new Error("Engine "+response.status);
    const data=await response.json();
    state.cache.set(text,data);
    return data;
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
    }catch(_error){}
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
      if(span.className==="gle-word"){
        span.addEventListener("mouseenter",()=>renderCard(data,token.i,span));
      }
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
    }catch(_error){}
  }

  function sourceText(node){
    return node.dataset.gleSource || node.dataset.gleText || (node.innerText||node.textContent||"").trim();
  }

  function ensureYouTubeOverlay(){
    const player=document.querySelector(".html5-video-player");
    if(!player) return null;

    let overlay=player.querySelector(".gle-youtube-overlay");
    if(!overlay){
      overlay=document.createElement("div");
      overlay.className="gle-youtube-overlay";
      overlay.hidden=true;
      const germanLine=document.createElement("div");
      germanLine.className="gle-youtube-german";
      overlay.appendChild(germanLine);
      player.appendChild(overlay);
    }

    state.youtube.overlay=overlay;
    state.youtube.germanLine=overlay.querySelector(".gle-youtube-german");
    return {player,overlay,germanLine:state.youtube.germanLine};
  }

  function setYouTubeCustomActive(active){
    const player=document.querySelector(".html5-video-player");
    if(player) player.classList.toggle("gle-custom-captions-active",Boolean(active));
  }

  function showYouTubeText(text){
    const ui=ensureYouTubeOverlay();
    if(!ui || !text) return;
    clearTimeout(state.youtube.hideTimer);
    state.youtube.hideTimer=null;
    setYouTubeCustomActive(true);
    ui.overlay.hidden=false;
    decorate(ui.germanLine,text);
  }

  function hideYouTubeOverlay(){
    if(state.youtube.overlay) state.youtube.overlay.hidden=true;
    setYouTubeCustomActive(false);
  }

  function resetYouTube(videoId=""){
    clearTimeout(state.youtube.domTimer);
    clearTimeout(state.youtube.hideTimer);
    state.youtube.domTimer=null;
    state.youtube.hideTimer=null;
    state.youtube.videoId=videoId;
    state.youtube.cues=null;
    state.youtube.cueIndex=-1;
    state.youtube.timedAvailable=false;
    state.youtube.domPending="";
    state.youtube.domStable="";
    state.youtube.domLastChange=0;
    state.youtube.domFirstSeen=0;
    hideYouTubeOverlay();
  }

  function renderTimedCue(mediaTime){
    const cues=state.youtube.cues;
    if(!cues?.length) return false;

    const video=state.youtube.video || document.querySelector("video.html5-main-video") || document.querySelector("video");
    if(!video) return false;

    const seconds=Number.isFinite(mediaTime)?mediaTime:video.currentTime;
    const cue=globalThis.GLEYoutubeCues.cueAtTime(cues,seconds*1000);

    setYouTubeCustomActive(true);
    if(!cue){
      if(state.youtube.overlay) state.youtube.overlay.hidden=true;
      state.youtube.cueIndex=-1;
      return true;
    }

    if(state.youtube.cueIndex!==cue.index){
      state.youtube.cueIndex=cue.index;
      showYouTubeText(cue.text);
    }else if(state.youtube.overlay){
      state.youtube.overlay.hidden=false;
    }
    return true;
  }

  function bindYouTubeVideo(){
    const video=document.querySelector("video.html5-main-video") || document.querySelector("video");
    if(!video || video===state.youtube.video) return video;

    if(state.youtube.video && state.youtube.videoListeners){
      ["timeupdate","seeking","seeked","play","pause","ratechange"].forEach(type=>
        state.youtube.video.removeEventListener(type,state.youtube.videoListeners)
      );
      if(state.youtube.frameId!==null && state.youtube.video.cancelVideoFrameCallback){
        state.youtube.video.cancelVideoFrameCallback(state.youtube.frameId);
      }
    }

    state.youtube.video=video;
    state.youtube.videoListeners=()=>renderTimedCue();
    ["timeupdate","seeking","seeked","play","pause","ratechange"].forEach(type=>
      video.addEventListener(type,state.youtube.videoListeners)
    );

    if(video.requestVideoFrameCallback){
      const onFrame=(_now,metadata)=>{
        if(state.youtube.video!==video) return;
        renderTimedCue(metadata.mediaTime);
        state.youtube.frameId=video.requestVideoFrameCallback(onFrame);
      };
      state.youtube.frameId=video.requestVideoFrameCallback(onFrame);
    }

    return video;
  }

  function receiveYouTubeBridge(event){
    const message=event.data;
    if(event.source!==window || event.origin!==location.origin || message?.source!=="gle-youtube-caption-bridge") return;

    if(message.videoId && message.videoId!==state.youtube.videoId){
      resetYouTube(message.videoId);
    }

    if(message.type==="track-status" && message.enabled===false){
      resetYouTube(message.videoId || state.youtube.videoId);
      return;
    }

    if(message.type!=="track-data" || !message.payload) return;

    try{
      const cues=globalThis.GLEYoutubeCues.parseJson3Cues(message.payload);
      if(!cues.length) return;
      clearTimeout(state.youtube.domTimer);
      state.youtube.domTimer=null;
      state.youtube.cues=cues;
      state.youtube.cueIndex=-1;
      state.youtube.timedAvailable=true;
      bindYouTubeVideo();
      renderTimedCue();
    }catch(_error){
      state.youtube.timedAvailable=false;
      state.youtube.cues=null;
    }
  }

  function connectYouTubeBridge(){
    window.addEventListener("message",receiveYouTubeBridge);
    window.postMessage({source:"gle-youtube-content",type:"refresh"},location.origin);
  }

  function collectYouTubeDomText(){
    const containers=[...document.querySelectorAll(".ytp-caption-window-bottom")];
    const entries=containers.map(container=>{
      const parts=[...container.querySelectorAll(".ytp-caption-segment")]
        .map(node=>(node.textContent||"").trim())
        .filter(Boolean);
      const text=globalThis.GLEYoutubeCues.normalizeCueText(parts.join(" "));
      return text;
    }).filter(Boolean);
    return entries[entries.length-1] || "";
  }

  function commitDomPending(){
    const yt=state.youtube;
    yt.domTimer=null;
    if(yt.timedAvailable || !yt.domPending) return;

    const now=Date.now();
    const quietFor=now-yt.domLastChange;
    const totalFor=now-yt.domFirstSeen;
    const complete=globalThis.GLEYoutubeCues.sentenceIsComplete(yt.domPending);
    const wordCount=yt.domPending.split(/\s+/).filter(Boolean).length;

    if(!complete && quietFor<900 && totalFor<2600){
      yt.domTimer=setTimeout(commitDomPending,Math.max(120,900-quietFor));
      return;
    }

    const extendsStable=yt.domStable && yt.domPending.startsWith(yt.domStable) && yt.domPending!==yt.domStable;
    if(extendsStable && !complete && totalFor<2600 && wordCount<14){
      yt.domTimer=setTimeout(commitDomPending,350);
      return;
    }

    yt.domStable=yt.domPending;
    yt.domFirstSeen=0;
    showYouTubeText(yt.domStable);
  }

  function queueDomText(text){
    const yt=state.youtube;
    if(yt.timedAvailable) return;

    const normalized=globalThis.GLEYoutubeCues.normalizeCueText(text);
    if(!normalized || normalized===yt.domPending) return;

    const now=Date.now();
    if(!yt.domFirstSeen) yt.domFirstSeen=now;
    yt.domPending=normalized;
    yt.domLastChange=now;

    clearTimeout(yt.domTimer);
    const complete=globalThis.GLEYoutubeCues.sentenceIsComplete(normalized);
    yt.domTimer=setTimeout(commitDomPending,complete?120:900);
  }

  function scanYouTube(){
    ensureYouTubeOverlay();

    if(state.youtube.timedAvailable){
      bindYouTubeVideo();
      renderTimedCue();
      return;
    }

    const text=collectYouTubeDomText();
    if(text){
      clearTimeout(state.youtube.hideTimer);
      state.youtube.hideTimer=null;
      queueDomText(text);
      return;
    }

    if(state.youtube.domStable && state.youtube.hideTimer===null){
      state.youtube.hideTimer=setTimeout(()=>{
        state.youtube.hideTimer=null;
        state.youtube.domStable="";
        state.youtube.domPending="";
        state.youtube.domFirstSeen=0;
        hideYouTubeOverlay();
      },650);
    }
  }

  function scan(){
    if(adapter.id==="youtube"){
      scanYouTube();
      return;
    }

    for(const selector of adapter.selectors){
      document.querySelectorAll(selector).forEach(node=>{
        const text=sourceText(node);
        if(text && text.length<500 && !node.querySelector(".gle-word")) decorate(node,text);
      });
    }
  }

  state.tooltip=createTooltip();

  chrome.storage.sync.get({showSentenceTranslation:true,translationFontSize:85},settings=>{
    state.settings=settings;
    scan();
  });

  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=="sync") return;
    if(changes.showSentenceTranslation) state.settings.showSentenceTranslation=changes.showSentenceTranslation.newValue;
    if(changes.translationFontSize) state.settings.translationFontSize=changes.translationFontSize.newValue;

    document.querySelectorAll(".gle-subtitle-translation").forEach(el=>el.remove());
    document.querySelectorAll("[data-gle-text]").forEach(node=>{
      if(state.settings.showSentenceTranslation) renderSentenceTranslation(node,node.dataset.gleText);
    });
  });

  document.addEventListener("mousemove",event=>{
    if(state.tooltip && !state.tooltip.contains(event.target) && !event.target.closest?.(".gle-word")){
      state.tooltip.hidden=true;
    }
  });

  if(adapter.id==="youtube") connectYouTubeBridge();

  let scanScheduled=false;
  new MutationObserver(()=>{
    if(scanScheduled) return;
    scanScheduled=true;
    requestAnimationFrame(()=>{
      scanScheduled=false;
      scan();
    });
  }).observe(document.documentElement,{subtree:true,childList:true,characterData:true});

  scan();
})();
