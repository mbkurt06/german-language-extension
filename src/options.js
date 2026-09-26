const url=document.querySelector("#url");
const showTranslation=document.querySelector("#showTranslation");
const translationSize=document.querySelector("#translationSize");
const sizeValue=document.querySelector("#sizeValue");
const status=document.querySelector("#status");

const defaults={engineUrl:"http://127.0.0.1:8765",showSentenceTranslation:true,translationFontSize:85};
chrome.storage.sync.get(defaults,x=>{
  url.value=x.engineUrl;
  showTranslation.checked=x.showSentenceTranslation;
  translationSize.value=x.translationFontSize;
  sizeValue.value=x.translationFontSize+"%";
});
translationSize.addEventListener("input",()=>sizeValue.value=translationSize.value+"%");
document.querySelector("#save").onclick=()=>chrome.storage.sync.set({
  engineUrl:url.value.trim(),
  showSentenceTranslation:showTranslation.checked,
  translationFontSize:Number(translationSize.value)
},()=>{status.textContent="Kaydedildi.";setTimeout(()=>status.textContent="",1500);});
