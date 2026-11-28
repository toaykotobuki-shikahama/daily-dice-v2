/** Bound only to the new V2 management spreadsheet. Configure DB_ID, ADMIN_EMAILS, PUBLIC_EXEC_URL, ADMIN_RPC_SECRET. */
function onOpen(){SpreadsheetApp.getUi().createMenu('サイコロ管理').addItem('開催設定','openCampaignSettings').addItem('スタッフ確認','openStaffDialog').addItem('簡易動作確認','openSimpleTest').addSeparator().addSubMenu(buildDiceTestMenu_()).addSeparator().addItem('集計を更新','refreshDashboard').addToUi();}
function adminAllowed_(){const email=Session.getActiveUser().getEmail();const allowed=(PropertiesService.getScriptProperties().getProperty('ADMIN_EMAILS')||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);if(!email||!allowed.includes(email.toLowerCase()))throw new Error('権限を確認できません');return email;}
function openCampaignSettings(){adminAllowed_();SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutputFromFile('CampaignSettings').setWidth(760).setHeight(700),'開催設定');}
function openStaffDialog(){adminAllowed_();SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutputFromFile('StaffDialog').setWidth(520).setHeight(500),'スタッフ確認');}
function openSimpleTest(){adminAllowed_();SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutputFromFile('SimpleTest').setWidth(500).setHeight(620),'簡易動作確認');}
function adminListCampaigns(){adminAllowed_();return v2Rows_('Campaigns').map(v2Campaign_).sort((a,b)=>a.startDate.localeCompare(b.startDate));}
function v2AdminRpcCall_(action,payload,actor){
  const props=PropertiesService.getScriptProperties(),url=props.getProperty('PUBLIC_EXEC_URL'),secret=props.getProperty('ADMIN_RPC_SECRET');
  if(!url||!secret)throw new Error('管理RPCの接続設定がありません');
  const request={action,actor,operationId:String(payload.operationId||Utilities.getUuid()),issuedAt:String(Date.now()),nonce:Utilities.getUuid(),payload};
  const canonical=JSON.stringify(request),signature=Utilities.computeHmacSha256Signature(canonical,secret).map(b=>(b<0?b+256:b).toString(16).padStart(2,'0')).join('');
  const response=UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',payload:JSON.stringify({...request,signature}),muteHttpExceptions:true});
  if(response.getResponseCode()!==200)throw new Error('管理RPCの応答を確認できません。確認ID '+request.operationId);
  let result;try{result=JSON.parse(response.getContentText());}catch(_){throw new Error('管理RPCの応答形式を確認できません。確認ID '+request.operationId);}
  if(!result.ok)throw new Error(result.error||'管理処理に失敗しました。確認ID '+request.operationId);return result;
}
function adminSaveCampaign(input){const actor=adminAllowed_();return v2AdminRpcCall_('saveCampaign',input,actor);}
function adminDuplicateCampaign(id,operationId){const actor=adminAllowed_();return v2AdminRpcCall_('duplicateCampaign',{id,operationId},actor);}
function adminSetPaused(id,paused,operationId){const actor=adminAllowed_();return v2AdminRpcCall_('setPaused',{id,paused,operationId},actor);}
function refreshDashboard(){const actor=adminAllowed_();return v2AdminRpcCall_('refreshDashboard',{operationId:Utilities.getUuid()},actor);}
function v2AdminLock_(fn){const lock=LockService.getScriptLock();if(!lock.tryLock(25000))throw new Error('BUSY_RETRY');try{return fn();}finally{try{SpreadsheetApp.flush();}finally{lock.releaseLock();}}}
// Old hashes stay on completed/expired cards, so prefer a live ACHIEVED card when 6-digit codes collide.
function v2FindCardByCode_(code){const hash=v2Hash_(String(code||'').replace(/\D/g,''));const hits=v2Rows_('Cards').filter(c=>String(c.confirmationHash)===hash),now=Date.now();return hits.find(c=>String(c.state)==='ACHIEVED'&&new Date(c.confirmationExpiresAt).getTime()>=now)||hits.find(c=>String(c.state)==='ACHIEVED')||hits[0]||null;}
function staffLookup(code){adminAllowed_();const card=v2FindCardByCode_(code);if(!card)throw new Error('CODE_INVALID');if(card.state==='COMPLETED')return {ok:true,completed:true};const campaign=v2FindCampaign_(card.campaignId);const c=v2Campaign_(campaign),now=new Date();if(!DiceV2.canReception(c,card,true,now.getTime()))throw new Error('CONFIRMATION_CLOSED');if(new Date(card.confirmationExpiresAt).getTime()<now.getTime())throw new Error('CODE_INVALID');return {ok:true,operationId:Utilities.getUuid(),campaignName:c.name,reference:String(card.participantId).slice(-8),participantId:String(card.participantId),campaignId:String(card.campaignId)};}
function staffComplete(operationId,campaignId,participantId,code,staffName){const actor=adminAllowed_();return v2AdminRpcCall_('staffComplete',{operationId,campaignId,participantId,code,staffName},actor);}
