const url=document.querySelector("#url");
const showTranslation=document.querySelector("#showTranslation");
const germanSize=document.querySelector("#germanSize");
const germanSizeValue=document.querySelector("#germanSizeValue");
const translationSize=document.querySelector("#translationSize");
const sizeValue=document.querySelector("#sizeValue");
const status=document.querySelector("#status");
const learningList=document.querySelector("#learningList");
let learningItems=[];

const defaults={engineUrl:"http://127.0.0.1:8765",showSentenceTranslation:true,germanFontSize:100,translationFontSize:100,learningItems:[]};
chrome.storage.sync.get(defaults,x=>{
  url.value=x.engineUrl;
  showTranslation.checked=x.showSentenceTranslation;
  germanSize.value=x.germanFontSize;
  germanSizeValue.value=x.germanFontSize+"%";
  translationSize.value=x.translationFontSize;
  sizeValue.value=x.translationFontSize+"%";
  learningItems=Array.isArray(x.learningItems)?x.learningItems:[];
  renderLearningItems();
});
germanSize.addEventListener("input",()=>germanSizeValue.value=germanSize.value+"%");
translationSize.addEventListener("input",()=>sizeValue.value=translationSize.value+"%");
document.querySelector("#save").onclick=()=>chrome.storage.sync.set({
  engineUrl:url.value.trim(),
  showSentenceTranslation:showTranslation.checked,
  germanFontSize:Number(germanSize.value),
  translationFontSize:Number(translationSize.value)
},()=>{status.textContent="Kaydedildi.";setTimeout(()=>status.textContent="",1500);});


function renderLearningItems(){
  learningList.textContent="";
  if(!learningItems.length){
    const empty=document.createElement("li");
    empty.textContent="Henüz işaretlenmiş öğe yok.";
    learningList.appendChild(empty);
    return;
  }

  learningItems.forEach((item,index)=>{
    const li=document.createElement("li");
    const text=document.createElement("div");
    const strong=document.createElement("strong");
    strong.textContent=item.label||item.key;
    const meta=document.createElement("span");
    meta.className="learning-meta";
    meta.textContent=(item.kind==="expression"?"Kalıp":"Kelime")+(item.meaning_tr?" · "+item.meaning_tr:"");
    text.append(strong,meta);

    const remove=document.createElement("button");
    remove.type="button";
    remove.textContent="Kaldır";
    remove.onclick=()=>{
      learningItems=learningItems.filter((_,i)=>i!==index);
      chrome.storage.sync.set({learningItems},renderLearningItems);
    };

    li.append(text,remove);
    learningList.appendChild(li);
  });
}
