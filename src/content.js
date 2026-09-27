(() => {
  const ADAPTERS = [
    {id:"youtube", host:/youtube\.com$/, selectors:[".ytp-caption-segment"]},
    {id:"zdf", host:/(^|\.)zdf\.de$/, selectors:["[class*='subtitle']","[class*='caption']","[aria-live='polite']"]},
    {id:"ard", host:/(^|\.)ardmediathek\.de$/, selectors:["[class*='subtitle']","[class*='caption']","[aria-live='polite']"]}
  ];

  const state = {
    cache:new Map(),
    analysisInflight:new Map(),
    tooltip:null,
    tooltipHideTimer:null,
    settings:{showSentenceTranslation:true,germanFontSize:100,translationFontSize:100,youtubeSubtitlePositionY:82},
    learningItems:[],
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

  function cancelTooltipHide(){
    clearTimeout(state.tooltipHideTimer);
    state.tooltipHideTimer=null;
  }

  function scheduleTooltipHide(delay=240){
    if(state.tooltipHideTimer) return;
    state.tooltipHideTimer=setTimeout(()=>{
      state.tooltipHideTimer=null;
      if(state.tooltip) state.tooltip.hidden=true;
    },delay);
  }

  function createTooltip(){
    const el=document.createElement("div");
    el.id="gle-tooltip";
    el.hidden=true;
    el.addEventListener("mouseenter",cancelTooltipHide);
    el.addEventListener("mouseleave",()=>scheduleTooltipHide(220));
    document.documentElement.appendChild(el);
    return el;
  }

  function esc(s){
    const d=document.createElement("div");
    d.textContent=s??"";
    return d.innerHTML;
  }

  function escAttr(s){
    return esc(s).replace(/"/g,"&quot;");
  }

  function expressionTypeLabel(type){
    return ({
      IDIOM:"Kalıp / deyim",
      REFLEXIVE_VERB:"Refleksif fiil",
      VERB_PREPOSITION:"Fiil + edat",
      REFLEXIVE_VERB_PREPOSITION:"Refleksif fiil + edat",
      NOMEN_VERB:"İsim + fiil kalıbı",
      FUNCTION_VERB:"Sabit fiil kalıbı",
      ADJECTIVE_PREPOSITION:"Sıfat + edat",
      NOUN_PREPOSITION:"İsim + edat",
      PARTICLE_VERB:"Ayrılabilen fiil",
      COPULAR_CONSTRUCTION:"Sabit yapı (sein/werden/bleiben)",
      GRAMMAR_CONSTRUCTION:"Dilbilgisi yapısı",
      COLLOCATION:"Birlikte kullanım",
      FIXED_CONSTRUCTION:"Sabit yapı"
    })[type] || "Birlikte kullanım";
  }

  function posLabel(pos){
    return ({
      NOUN:"İsim",
      PROPN:"Özel isim",
      VERB:"Fiil",
      AUX:"Yardımcı fiil",
      ADJ:"Sıfat",
      ADV:"Zarf",
      ADP:"Edat",
      PRON:"Zamir",
      DET:"Tanımlık / belirleyici",
      SCONJ:"Bağlaç",
      CCONJ:"Bağlaç",
      PART:"Parçacık",
      NUM:"Sayı",
      INTJ:"Ünlem",
    })[pos] || "Kelime";
  }

  function learningKey(kind,key){
    return kind+":"+String(key||"").toLocaleLowerCase("de-DE");
  }

  function isLearning(kind,key){
    const wanted=learningKey(kind,key);
    return state.learningItems.some(item=>learningKey(item.kind,item.key)===wanted);
  }

  function saveLearningItem(item){
    const normalized={...item,key:String(item.key||"").toLocaleLowerCase("de-DE")};
    const id=learningKey(normalized.kind,normalized.key);
    if(state.learningItems.some(existing=>learningKey(existing.kind,existing.key)===id)) return;
    state.learningItems=[...state.learningItems,normalized];
    chrome.storage.sync.set({learningItems:state.learningItems});
  }

  function renderCard(data, tokenIndex, anchor){
    cancelTooltipHide();
    const h=data.hover?.[String(tokenIndex)]||data.hover?.[tokenIndex]||{};
    const expressions=h.primary_expressions||[];
    const expr=expressions[0];
    const lexical=h.lexical_form;
    const notes=h.usage_notes||[];
    const dictionaryMeanings=h.dictionary_meanings_tr||[];
    const sourceToken=(data.tokens||[]).find(token=>token.i===tokenIndex);
    const lemma=sourceToken?.lemma||sourceToken?.text||"";

    const primaryLabel=expr ? expr.canonical : lemma;
    const primaryType=expr ? expressionTypeLabel(expr.type) : posLabel(sourceToken?.pos);
    const primaryMeaning=expr
      ? (expr.contextual_meaning_tr||(expr.meaning_tr||[])[0]||h.contextual_word_meaning_tr||"")
      : (h.contextual_word_meaning_tr||dictionaryMeanings[0]||"");

    const header=primaryLabel
      ? `<div class="gle-hover-head"><b>${esc(primaryLabel)}</b><span>${esc(primaryType)}</span></div>`
      : "";
    const contextual=primaryMeaning
      ? `<div class="gle-context gle-context-primary"><b>Bu cümlede:</b> ${esc(primaryMeaning)}</div>`
      : "";

    const usage=notes.filter(note=>note.kind!=="GRAMMAR_ROLE")
      .map(note=>`<div class="gle-note"><b>${esc(note.label)}</b> · ${esc(note.explanation_tr)}</div>`)
      .join("");

    const grammarHint=expr?.grammar_hint
      ? `<div class="gle-note"><b>Yapı:</b> ${esc(expr.grammar_hint)}</div>`
      : "";
    const noun=lexical?.article
      ? `<div class="gle-lexical"><b>${esc(lexical.article)} ${esc(lexical.singular)}</b> · die ${esc(lexical.plural)}</div>`
      : "";
    const standalone=expr && dictionaryMeanings.length
      ? `<div class="gle-standalone"><b>${esc(lemma)} tek başına:</b> ${esc(dictionaryMeanings.join(", "))}</div>`
      : "";
    const dictionary=!expr && dictionaryMeanings.length>1
      ? `<details><summary>Diğer sözlük anlamları</summary><div>${esc(dictionaryMeanings.join(", "))}</div></details>`
      : "";

    const learnTarget=expr ? {
      kind:"expression",
      key:expr.pattern_id||expr.canonical,
      label:expr.canonical,
      meaning:primaryMeaning,
    } : {
      kind:"word",
      key:lemma,
      label:lemma,
      meaning:primaryMeaning,
    };
    const learning=learnTarget.key && isLearning(learnTarget.kind,learnTarget.key);
    const learnAction=learnTarget.key
      ? `<div class="gle-learn-actions"><button type="button" class="gle-learn-button gle-learn-toggle" title="${learning?"Öğreniyorum listesinden kaldır":"Öğreniyorum listesine ekle"}" aria-label="${learning?"Öğreniyorum listesinden kaldır":"Öğreniyorum listesine ekle"}" data-kind="${escAttr(learnTarget.kind)}" data-key="${escAttr(learnTarget.key)}" data-label="${escAttr(learnTarget.label)}" data-meaning="${escAttr(learnTarget.meaning)}">${learning?"★":"☆"} <span>Öğren</span></button></div>`
      : "";

    state.tooltip.innerHTML=header+contextual+grammarHint+noun+standalone+usage+dictionary+learnAction || "<div>Henüz analiz yok.</div>";
    const learnButton=state.tooltip.querySelector(".gle-learn-toggle");
    if(learnButton){
      learnButton.addEventListener("click",()=>{
        const kind=learnButton.dataset.kind;
        const key=learnButton.dataset.key;
        const id=learningKey(kind,key);
        const existing=state.learningItems.some(item=>learningKey(item.kind,item.key)===id);
        if(existing){
          state.learningItems=state.learningItems.filter(item=>learningKey(item.kind,item.key)!==id);
          chrome.storage.sync.set({learningItems:state.learningItems});
          learnButton.innerHTML="☆ <span>Öğren</span>";
          learnButton.title="Öğreniyorum listesine ekle";
          learnButton.setAttribute("aria-label","Öğreniyorum listesine ekle");
        }else{
          saveLearningItem({
            kind,
            key,
            label:learnButton.dataset.label,
            meaning_tr:learnButton.dataset.meaning,
          });
          learnButton.innerHTML="★ <span>Öğren</span>";
          learnButton.title="Öğreniyorum listesinden kaldır";
          learnButton.setAttribute("aria-label","Öğreniyorum listesinden kaldır");
        }
      });
    }

    const r=anchor.getBoundingClientRect();
    state.tooltip.hidden=false;
    state.tooltip.style.left=Math.min(window.innerWidth-370,Math.max(8,r.left))+"px";
    state.tooltip.style.top=Math.max(8,r.top-state.tooltip.offsetHeight-10)+"px";
  }

  async function analyze(text){
    if(state.cache.has(text)) return state.cache.get(text);
    if(state.analysisInflight.has(text)) return state.analysisInflight.get(text);

    const request=(async()=>{
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
    })();

    state.analysisInflight.set(text,request);
    try{
      return await request;
    }finally{
      if(state.analysisInflight.get(text)===request) state.analysisInflight.delete(text);
    }
  }

  function cleanTranslationText(text){
    return String(text||"")
      .replace(/\b([\p{L}\p{N}]+)(?:\s+\1){2,}\b/giu,"$1")
      .replace(/\s+/g," ")
      .trim();
  }

  async function renderSentenceTranslation(node,text,translationText=text){
    node.querySelector(".gle-subtitle-translation")?.remove();
    if(!state.settings.showSentenceTranslation) return;
    try{
      const data=await analyze(translationText);
      if(!data.sentence_meaning_tr || node.dataset.gleText!==text) return;
      const translation=cleanTranslationText(data.sentence_meaning_tr);
      if(!translation) return;
      const line=document.createElement("span");
      line.className="gle-subtitle-translation";
      line.textContent=translation;
      node.appendChild(line);
    }catch(_error){}
  }

  function shouldInsertSpace(token,next){
    if(!next) return false;
    if(next.pos==="PUNCT" && /^[,.;:!?…\)\]\}»”’]$/u.test(next.text)) return false;
    if(token.pos==="PUNCT" && /^[\(\[\{«„“]$/u.test(token.text)) return false;
    return true;
  }

  function normalizedTokenText(token){
    return String(token?.text||"").toLocaleLowerCase("de-DE");
  }

  function findTokenSequenceOffset(contextTokens,currentTokens){
    if(!contextTokens?.length || !currentTokens?.length || currentTokens.length>contextTokens.length) return -1;
    outer:
    for(let start=0;start<=contextTokens.length-currentTokens.length;start++){
      for(let i=0;i<currentTokens.length;i++){
        if(normalizedTokenText(contextTokens[start+i])!==normalizedTokenText(currentTokens[i])) continue outer;
      }
      return start;
    }
    return -1;
  }

  function renderAnalyzedTokens(node,text,data,hoverData=data){
    if(node.dataset.gleText!==text) return;
    node.textContent="";
    const tokens=data.tokens||[];
    const hoverTokens=hoverData.tokens||[];
    const hoverOffset=hoverData===data ? 0 : findTokenSequenceOffset(hoverTokens,tokens);
    const mappedTokens=tokens.map((token,i)=>hoverOffset>=0 ? hoverTokens[hoverOffset+i] : token);

    const learningWordLabels=new Map();
    for(const item of state.learningItems){
      if(item.kind!=="word") continue;
      tokens.forEach((token,i)=>{
        if(String(token.lemma||"").toLocaleLowerCase("de-DE")===String(item.key||"").toLocaleLowerCase("de-DE")){
          const mapped=mappedTokens[i]||token;
          const currentHover=hoverData.hover?.[String(mapped.i)]||hoverData.hover?.[mapped.i]||{};
          learningWordLabels.set(i,{
            ...item,
            meaning_tr:currentHover.contextual_word_meaning_tr||item.meaning_tr,
          });
        }
      });
    }

    const expressionMembers=new Map();
    const expressionBadges=new Map();
    const expressions=hoverData.expressions||[];
    for(const item of state.learningItems){
      if(item.kind!=="expression") continue;
      const match=expressions.find(expr=>
        String(expr.pattern_id||expr.canonical||"").toLocaleLowerCase("de-DE")===
        String(item.key||"").toLocaleLowerCase("de-DE")
      );
      if(!match) continue;
      const visible=[];
      mappedTokens.forEach((mapped,i)=>{
        if(mapped && match.token_indices?.includes(mapped.i)){
          const currentItem={
            ...item,
            meaning_tr:match.contextual_meaning_tr||(match.meaning_tr||[])[0]||item.meaning_tr,
          };
          expressionMembers.set(i,currentItem);
          visible.push(i);
        }
      });
      if(visible.length) expressionBadges.set(visible[0],expressionMembers.get(visible[0])||item);
    }

    tokens.forEach((token,i)=>{
      const span=document.createElement("span");
      span.textContent=token.text;
      span.className=token.pos==="PUNCT"?"gle-punct":"gle-word";
      span.dataset.gleIndex=token.i;
      const learningItem=expressionMembers.get(i)||learningWordLabels.get(i);
      if(learningItem){
        span.classList.add("gle-learning-item");
      }
      const badgeItem=expressionBadges.get(i)||learningWordLabels.get(i);
      if(badgeItem){
        span.dataset.gleLearningLabel=`${badgeItem.label} → ${badgeItem.meaning_tr||""}`;
      }
      if(span.classList.contains("gle-word")){
        const mappedToken=mappedTokens[i]||token;
        span.addEventListener("mouseenter",()=>{
          cancelTooltipHide();
          renderCard(
            hoverOffset>=0 ? hoverData : data,
            mappedToken?.i ?? token.i,
            span
          );
        });
        span.addEventListener("mouseleave",()=>scheduleTooltipHide(260));
      }
      node.appendChild(span);
      if(shouldInsertSpace(token,tokens[i+1])) node.append(" ");
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

  async function decorate(node,text,translationText=text,hoverContextText=text){
    if(node.dataset.gleText===text) return;
    node.dataset.gleText=text;
    renderFallbackTokens(node,text);
    try{
      const [data,hoverData]=await Promise.all([
        analyze(text),
        hoverContextText===text ? Promise.resolve(null) : analyze(hoverContextText),
      ]);
      if(node.dataset.gleText!==text) return;
      renderAnalyzedTokens(node,text,data,hoverData||data);
      await renderSentenceTranslation(node,text,translationText);
    }catch(_error){}
  }

  function sourceText(node){
    return node.dataset.gleSource || node.dataset.gleText || (node.innerText||node.textContent||"").trim();
  }

  function clamp(value,min,max){
    return Math.min(max,Math.max(min,value));
  }

  function applyYouTubeAppearance(){
    const overlay=state.youtube.overlay;
    const germanLine=state.youtube.germanLine;
    if(!overlay || !germanLine) return;
    overlay.style.setProperty("--gle-german-font-scale",(state.settings.germanFontSize/100).toFixed(2));
    overlay.style.setProperty("--gle-translation-font-scale",(state.settings.translationFontSize/100).toFixed(2));
    overlay.style.top=clamp(Number(state.settings.youtubeSubtitlePositionY)||82,8,92)+"%";
  }

  function installYouTubeDragHandle(player,overlay,handle){
    handle.addEventListener("pointerdown",event=>{
      if(event.button!==0) return;
      event.preventDefault();
      event.stopPropagation();

      const rect=player.getBoundingClientRect();
      if(!rect.height) return;

      const startY=event.clientY;
      const startPosition=clamp(Number(state.settings.youtubeSubtitlePositionY)||82,8,92);
      handle.setPointerCapture?.(event.pointerId);
      overlay.classList.add("gle-dragging");

      const onMove=moveEvent=>{
        const next=clamp(startPosition+((moveEvent.clientY-startY)/rect.height)*100,8,92);
        state.settings.youtubeSubtitlePositionY=next;
        overlay.style.top=next+"%";
      };

      const finish=()=>{
        handle.removeEventListener("pointermove",onMove);
        handle.removeEventListener("pointerup",finish);
        handle.removeEventListener("pointercancel",finish);
        overlay.classList.remove("gle-dragging");
        chrome.storage.sync.set({youtubeSubtitlePositionY:state.settings.youtubeSubtitlePositionY});
      };

      handle.addEventListener("pointermove",onMove);
      handle.addEventListener("pointerup",finish);
      handle.addEventListener("pointercancel",finish);
    });
  }

  function ensureYouTubeOverlay(){
    const player=document.querySelector(".html5-video-player");
    if(!player) return null;

    let overlay=player.querySelector(".gle-youtube-overlay");
    if(!overlay){
      overlay=document.createElement("div");
      overlay.className="gle-youtube-overlay";
      overlay.hidden=true;

      const handle=document.createElement("button");
      handle.type="button";
      handle.className="gle-youtube-drag-handle";
      handle.textContent="↕";
      handle.title="Altyazıyı yukarı/aşağı taşı";
      handle.setAttribute("aria-label","Altyazıyı yukarı veya aşağı taşı");
      overlay.appendChild(handle);

      const germanLine=document.createElement("div");
      germanLine.className="gle-youtube-german";
      overlay.appendChild(germanLine);
      player.appendChild(overlay);
      installYouTubeDragHandle(player,overlay,handle);
    }

    state.youtube.overlay=overlay;
    state.youtube.germanLine=overlay.querySelector(".gle-youtube-german");
    applyYouTubeAppearance();
    return {player,overlay,germanLine:state.youtube.germanLine};
  }

  function setYouTubeCustomActive(active){
    const player=document.querySelector(".html5-video-player");
    if(player) player.classList.toggle("gle-custom-captions-active",Boolean(active));
  }

  function showYouTubeText(text,translationText=text,hoverContextText=text){
    const ui=ensureYouTubeOverlay();
    if(!ui || !text) return;
    clearTimeout(state.youtube.hideTimer);
    state.youtube.hideTimer=null;
    setYouTubeCustomActive(true);
    ui.overlay.hidden=false;
    decorate(ui.germanLine,text,translationText,hoverContextText);
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

  function prefetchYouTubeAnalyses(index,horizon=5){
    const cues=state.youtube.cues;
    if(!cues?.length || index<0) return;
    for(let i=index;i<=Math.min(cues.length-1,index+horizon);i++){
      const text=cues[i]?.text;
      if(text && !state.cache.has(text)) analyze(text).catch(()=>{});
      const translationText=globalThis.GLEYoutubeCues.translationTextForCue(cues,i);
      if(translationText && !state.cache.has(translationText)) analyze(translationText).catch(()=>{});
      const hoverContextText=globalThis.GLEYoutubeCues.hoverTextForCue(cues,i);
      if(hoverContextText && !state.cache.has(hoverContextText)) analyze(hoverContextText).catch(()=>{});
    }
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

    prefetchYouTubeAnalyses(cue.index);

    if(state.youtube.cueIndex!==cue.index){
      state.youtube.cueIndex=cue.index;
      const translationText=globalThis.GLEYoutubeCues.translationTextForCue(cues,cue.index);
      const hoverContextText=globalThis.GLEYoutubeCues.hoverTextForCue(cues,cue.index);
      showYouTubeText(cue.text,translationText,hoverContextText);
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
      const video=state.youtube.video || document.querySelector("video.html5-main-video") || document.querySelector("video");
      const currentCue=video ? globalThis.GLEYoutubeCues.cueAtTime(cues,video.currentTime*1000) : cues[0];
      prefetchYouTubeAnalyses(currentCue?.index ?? 0);
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

  chrome.storage.sync.get({
    showSentenceTranslation:true,
    germanFontSize:100,
    translationFontSize:100,
    youtubeSubtitlePositionY:82,
    learningItems:[]
  },settings=>{
    state.learningItems=Array.isArray(settings.learningItems)?settings.learningItems:[];
    delete settings.learningItems;
    state.settings=settings;
    scan();
  });

  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=="sync") return;
    if(changes.showSentenceTranslation) state.settings.showSentenceTranslation=changes.showSentenceTranslation.newValue;
    if(changes.germanFontSize) state.settings.germanFontSize=changes.germanFontSize.newValue;
    if(changes.translationFontSize) state.settings.translationFontSize=changes.translationFontSize.newValue;
    if(changes.youtubeSubtitlePositionY) state.settings.youtubeSubtitlePositionY=changes.youtubeSubtitlePositionY.newValue;
    if(changes.learningItems){
      state.learningItems=Array.isArray(changes.learningItems.newValue)?changes.learningItems.newValue:[];
      if(adapter.id==="youtube" && state.youtube.cues?.length){
        state.youtube.cueIndex=-1;
        renderTimedCue();
      }
    }
    applyYouTubeAppearance();

    document.querySelectorAll(".gle-subtitle-translation").forEach(el=>el.remove());
    document.querySelectorAll("[data-gle-text]").forEach(node=>{
      if(!state.settings.showSentenceTranslation) return;
      let translationText=node.dataset.gleText;
      if(adapter.id==="youtube" && node===state.youtube.germanLine && state.youtube.cues && state.youtube.cueIndex>=0){
        translationText=globalThis.GLEYoutubeCues.translationTextForCue(state.youtube.cues,state.youtube.cueIndex);
      }
      renderSentenceTranslation(node,node.dataset.gleText,translationText);
    });
  });

  document.addEventListener("mousemove",event=>{
    const overTooltip=state.tooltip?.contains(event.target);
    const overWord=event.target.closest?.(".gle-word");
    if(overTooltip || overWord){
      cancelTooltipHide();
      return;
    }
    scheduleTooltipHide(260);
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
