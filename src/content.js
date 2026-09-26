(() => {
  const ADAPTERS = [
    {id:"youtube", host:/youtube\.com$/, selectors:[".ytp-caption-segment"]},
    {id:"zdf", host:/(^|\.)zdf\.de$/, selectors:["[class*='subtitle']","[class*='caption']","[aria-live='polite']"]},
    {id:"ard", host:/(^|\.)ardmediathek\.de$/, selectors:["[class*='subtitle']","[class*='caption']","[aria-live='polite']"]}
  ];
  const state={lastText:"", cache:new Map(), tooltip:null, settings:{showSentenceTranslation:true,translationFontSize:85}};
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
  async function decorate(node,text){
    if(node.dataset.gleText===text) return;
    node.dataset.gleText=text;
    try{
      const data=await analyze(text);
      if(node.dataset.gleText!==text) return;
      renderAnalyzedTokens(node,text,data);
      await renderSentenceTranslation(node,text);
    }catch(_e){
      if(node.dataset.gleText!==text) return;
      node.textContent="";
      tokenize(text).forEach((part,i)=>{
        const span=document.createElement("span"); span.textContent=part; span.className=/^[\p{L}\p{M}]/u.test(part)?"gle-word":"gle-punct";
        node.appendChild(span); if(i<tokenize(text).length-1) node.append(" ");
      });
    }
  }
  function sourceText(node){
    return node.dataset.gleSource || node.dataset.gleText || (node.innerText||node.textContent||"").trim();
  }
  function scanYouTube(){
    const groups=new Map();
    document.querySelectorAll(".ytp-caption-segment").forEach(node=>{
      const container=node.closest(".ytp-caption-window-bottom") || node.parentElement;
      if(!container) return;
      if(!groups.has(container)) groups.set(container,[]);
      groups.get(container).push(node);
    });
    groups.forEach(nodes=>{
      const parts=nodes.map(sourceText).filter(Boolean);
      const text=parts.join(" ").replace(/\s+([,.!?;:])/g,"$1").replace(/\s+/g," ").trim();
      if(!text || text.length>=500) return;
      const primary=nodes[0];
      nodes.forEach(node=>{
        const liveText=(node.innerText||node.textContent||"").trim();
        if(!node.dataset.gleSource || (liveText && !node.querySelector(".gle-word") && liveText!==node.dataset.gleSource)){
          node.dataset.gleSource=liveText || sourceText(node);
        }
        node.style.removeProperty("display");
      });
      if(primary.dataset.gleText!==text || !primary.querySelector(".gle-word")) decorate(primary,text);
    });
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
  new MutationObserver(scan).observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  scan();
})();