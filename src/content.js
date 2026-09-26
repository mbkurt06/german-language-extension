(() => {
  const ADAPTERS = [
    {id:"youtube", host:/youtube\.com$/, selectors:[".ytp-caption-segment"]},
    {id:"zdf", host:/(^|\.)zdf\.de$/, selectors:["[class*='subtitle']","[class*='caption']","[aria-live='polite']"]},
    {id:"ard", host:/(^|\.)ardmediathek\.de$/, selectors:["[class*='subtitle']","[class*='caption']","[aria-live='polite']"]}
  ];
  const state={lastText:"", cache:new Map(), tooltip:null};
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
    const expression=expr ? `<div class="gle-expression"><b>${esc(expr.canonical)}</b><div>→ ${esc((expr.meaning_tr||[])[0]||"")}</div>${expr.grammar_hint?`<small>${esc(expr.grammar_hint)}</small>`:""}</div>` : "";
    const contextual=h.contextual_word_meaning_tr ? `<div class="gle-context"><b>Bu cümlede:</b> ${esc(h.contextual_word_meaning_tr)}</div>` : "";
    const usage=notes.map(n=>`<div class="gle-note"><b>${esc(n.label)}</b> · ${esc(n.explanation_tr)}</div>`).join("");
    const noun=lexical?.article ? `<div class="gle-lexical"><b>${esc(lexical.article)} ${esc(lexical.singular)}</b> · die ${esc(lexical.plural)}</div>` : "";
    const dictionary=more ? `<details><summary>Kelime anlamları</summary><div>${esc(more)}</div></details>` : "";
    state.tooltip.innerHTML=sentence+expression+contextual+usage+noun+dictionary || `<div>Henüz analiz yok.</div>`;
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
  function decorate(node,text){
    if(node.dataset.gleText===text) return;
    node.dataset.gleText=text; node.textContent="";
    tokenize(text).forEach((part,i)=>{
      const span=document.createElement("span"); span.textContent=part; span.className=/^[\p{L}\p{M}]/u.test(part)?"gle-word":"gle-punct"; span.dataset.gleIndex=i;
      if(span.className==="gle-word") span.addEventListener("mouseenter",async()=>{
        try{ renderCard(await analyze(text),i,span); }catch(e){ state.tooltip.innerHTML=`<div><b>Engine bağlantısı yok</b><br><small>${esc(e.message)}</small></div>`; state.tooltip.hidden=false; }
      });
      node.appendChild(span); if(i<tokenize(text).length-1) node.append(" ");
    });
  }
  function scan(){
    for(const selector of adapter.selectors) document.querySelectorAll(selector).forEach(node=>{
      const text=(node.innerText||node.textContent||"").trim(); if(text && text.length<500 && !node.querySelector(".gle-word")) decorate(node,text);
    });
  }
  state.tooltip=createTooltip();
  document.addEventListener("mousemove",e=>{ if(state.tooltip&&!state.tooltip.contains(e.target)&&!e.target.closest?.(".gle-word")) state.tooltip.hidden=true; });
  new MutationObserver(scan).observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  scan();
})();