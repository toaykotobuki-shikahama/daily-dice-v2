function doGet(e){
  const q=e&&e.parameter||{};
  if(q.action)return json_(v2Public_(q));
  const nonce=String(q.nonce||'');if(!/^[a-f0-9]{32}$/.test(nonce))return HtmlService.createHtmlOutput('Invalid request');
  const t=HtmlService.createTemplateFromFile('Bridge');t.nonceJson=JSON.stringify(nonce);t.originJson=JSON.stringify(PropertiesService.getScriptProperties().getProperty('PUBLIC_ORIGIN')||'https://toaykotobuki-shikahama.github.io');
  return t.evaluate().setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function doPost(e){let body={};try{body=JSON.parse(e.postData.contents||'{}');}catch(_){return json_({ok:false,error:'INVALID_REQUEST'});}return json_(body&&body.signature?v2AdminRpc_(body):v2Public_(body));}
/** Client entry for Bridge.html. google.script.run cannot call private functions (trailing "_"). */
function v2PublicRpc(req){return v2Public_(req);}
function json_(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);}
