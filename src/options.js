const url=document.querySelector("#url");
const showTranslation=document.querySelector("#showTranslation");
const germanSize=document.querySelector("#germanSize");
const germanSizeValue=document.querySelector("#germanSizeValue");
const translationSize=document.querySelector("#translationSize");
const sizeValue=document.querySelector("#sizeValue");
const status=document.querySelector("#status");

const defaults={engineUrl:"http://127.0.0.1:8765",showSentenceTranslation:true,germanFontSize:100,translationFontSize:85};
chrome.storage.sync.get(defaults,x=>{
  url.value=x.engineUrl;
  showTranslation.checked=x.showSentenceTranslation;
  germanSize.value=x.germanFontSize;
  germanSizeValue.value=x.germanFontSize+"%";
  translationSize.value=x.translationFontSize;
  sizeValue.value=x.translationFontSize+"%";
});
germanSize.addEventListener("input",()=>germanSizeValue.value=germanSize.value+"%");
translationSize.addEventListener("input",()=>sizeValue.value=translationSize.value+"%");
document.querySelector("#save").onclick=()=>chrome.storage.sync.set({
  engineUrl:url.value.trim(),
  showSentenceTranslation:showTranslation.checked,
  germanFontSize:Number(germanSize.value),
  translationFontSize:Number(translationSize.value)
},()=>{status.textContent="Kaydedildi.";setTimeout(()=>status.textContent="",1500);});
