const V2_SHEETS = {
  Campaigns:['id','name','startDate','endDate','receptionEndDate','target','pointsJson','confirmationEnabled','paused','archived','version','createdAt','updatedAt'],
  Participants:['participantId','identityHash','secretHash','source','createdAt'],
  Cards:['campaignId','participantId','sourceSnapshot','total','actualTotal','state','todayKey','lastEventId','confirmationHash','confirmationCode','confirmationVersion','confirmationExpiresAt','achievedAt','completedAt','updatedAt'],
  DailyHistory:['eventId','campaignId','participantId','jstDate','face','earned','totalAfter','requestId','createdAt'],
  StaffConfirmLog:['operationId','campaignId','participantId','staffEmail','staffName','status','createdAt'],
  AuditLog:['operationId','actor','campaignId','action','beforeJson','afterJson','version','createdAt'],
  ProcessLog:['traceId','action','stage','result','reasonCode','eventId','storageState','createdAt'],
  Dashboard:['campaignId','metric','value','definition','updatedAt']
};
function v2Db_(){const id=PropertiesService.getScriptProperties().getProperty('DB_ID');if(!id)throw new Error('SETUP_REQUIRED');return SpreadsheetApp.openById(id);}
function v2EnsureSheets_(){const ss=v2Db_();Object.keys(V2_SHEETS).forEach(name=>{let sh=ss.getSheetByName(name);if(!sh)sh=ss.insertSheet(name);const hdr=V2_SHEETS[name];if(sh.getLastRow()===0)sh.getRange(1,1,1,hdr.length).setValues([hdr]);const actual=sh.getRange(1,1,1,hdr.length).getDisplayValues()[0];if(JSON.stringify(actual)!==JSON.stringify(hdr))throw new Error('SCHEMA_MISMATCH:'+name);});return ss;}
function v2Rows_(name){const sh=v2Db_().getSheetByName(name);if(!sh)throw new Error('MISSING_SHEET:'+name);if(sh.getLastRow()<2)return [];const values=sh.getRange(2,1,sh.getLastRow()-1,V2_SHEETS[name].length).getValues();return values.map(r=>Object.fromEntries(V2_SHEETS[name].map((h,i)=>[h,r[i]])));}
function v2Append_(name,obj){const sh=v2Db_().getSheetByName(name);sh.appendRow(V2_SHEETS[name].map(h=>obj[h]===undefined?'':obj[h]));}
function v2Replace_(name,keyFields,obj){const sh=v2Db_().getSheetByName(name), rows=v2Rows_(name);const index=rows.findIndex(r=>keyFields.every(k=>String(r[k])===String(obj[k])));if(index<0){v2Append_(name,obj);return;}sh.getRange(index+2,1,1,V2_SHEETS[name].length).setValues([V2_SHEETS[name].map(h=>obj[h]===undefined?'':obj[h])]);}
// Flush buffered SpreadsheetApp writes before another execution can take the lock.
function v2WithLock_(fn){const lock=LockService.getScriptLock();if(!lock.tryLock(25000))throw new Error('BUSY_RETRY');try{return fn();}finally{try{SpreadsheetApp.flush();}finally{lock.releaseLock();}}}
function v2Log_(trace,action,stage,result,reason,eventId,storageState){try{v2Append_('ProcessLog',{traceId:trace,action,stage,result,reasonCode:reason||'',eventId:eventId||'',storageState:storageState||'UNKNOWN',createdAt:new Date()});}catch(e){console.error('process log unavailable',String(e));}}
function v2Hash_(text){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(text),Utilities.Charset.UTF_8).map(b=>(b<0?b+256:b).toString(16).padStart(2,'0')).join('');}
function v2JstDate_(date){return Utilities.formatDate(date,'Asia/Tokyo','yyyy-MM-dd');}
function v2Iso_(date){return date.toISOString();}
function v2FindCampaign_(id){return v2Rows_('Campaigns').find(c=>String(c.id)===String(id))||null;}
function v2DateText_(v){if(v instanceof Date)return Utilities.formatDate(v,'Asia/Tokyo','yyyy-MM-dd');const m=String(v||'').match(/^(\d{4}-\d{2}-\d{2})/);return m?m[1]:String(v||'');}
function v2Campaign_(r){return {id:String(r.id),name:String(r.name),startDate:v2DateText_(r.startDate),endDate:v2DateText_(r.endDate),receptionEndDate:v2DateText_(r.receptionEndDate),target:Number(r.target),points:JSON.parse(r.pointsJson),confirmationEnabled:String(r.confirmationEnabled)==='TRUE'||r.confirmationEnabled===true,paused:String(r.paused)==='TRUE'||r.paused===true,archived:String(r.archived)==='TRUE'||r.archived===true,version:Number(r.version)||1};}
function v2Card_(campaignId,participantId){return v2Rows_('Cards').find(c=>String(c.campaignId)===String(campaignId)&&String(c.participantId)===String(participantId))||null;}
function v2SafeError_(e){const code=String(e&&e.code||e&&e.message||'INTERNAL_ERROR').split(':')[0];const allow=['AUTH','RATE_LIMIT','CONFIG','STORAGE','STORAGE_FORMAT','CAMPAIGN_CONFIGURATION','SETUP_REQUIRED','CAMPAIGN_AMBIGUOUS','CAMPAIGN_OVERLAP','UPCOMING','ENDED','PAUSED','ALREADY_PLAYED','NOT_ACHIEVED','CONFIRMATION_CLOSED','CODE_INVALID','ALREADY_COMPLETED','BUSY_RETRY','INVALID_REQUEST'];return allow.includes(code)?code:'INTERNAL_ERROR';}
/** Atomic write set within one spreadsheet. Requires the Advanced Sheets service (Sheets API v4). */
function v2ApiCell_(value){if(value instanceof Date)return {userEnteredValue:{stringValue:value.toISOString()}};if(typeof value==='number')return {userEnteredValue:{numberValue:value}};if(typeof value==='boolean')return {userEnteredValue:{boolValue:value}};return {userEnteredValue:{stringValue:value===null||value===undefined?'':String(value)}};}
// Appends use appendCells, which inserts grid rows as needed. updateCells past the sheet's grid
// (1000 rows by default) fails the whole batch, so it is used only for existing rows.
function v2AtomicWrite_(operations){SpreadsheetApp.flush();const ss=v2Db_(),requests=operations.map(op=>{const sh=ss.getSheetByName(op.name);if(!sh)throw new Error('MISSING_SHEET:'+op.name);const rows=[{values:V2_SHEETS[op.name].map(h=>v2ApiCell_(op.obj[h]))}];
  if(op.append)return {appendCells:{sheetId:sh.getSheetId(),rows,fields:'userEnteredValue'}};
  const i=v2Rows_(op.name).findIndex(r=>op.keyFields.every(k=>String(r[k])===String(op.obj[k])));if(i<0)throw new Error('ROW_NOT_FOUND:'+op.name);
  return {updateCells:{range:{sheetId:sh.getSheetId(),startRowIndex:i+1,startColumnIndex:0},rows,fields:'userEnteredValue'}};});
  Sheets.Spreadsheets.batchUpdate({requests},ss.getId());}
