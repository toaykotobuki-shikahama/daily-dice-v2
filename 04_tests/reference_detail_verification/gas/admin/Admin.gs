/* Bound spreadsheet project. NEVER deploy this project as a web app. */
function onOpen(){SpreadsheetApp.getUi().createMenu('サイコロ管理').addItem('スタッフ確認','showStaffDialog').addItem('参加状況更新','refreshParticipation').addItem('集計更新','refreshDashboard').addItem('キャンペーン設定確認','showCampaignSettings').addItem('動作テスト','runDiagnostics').addItem('次回キャンペーンを作成','createNextCampaign').addItem('シートを日本語表示に変更','localizeDiceSheets').addSubMenu(buildDiceTestMenu_()).addToUi();}
function authorize_(){const email=Session.getActiveUser().getEmail().toLowerCase();const allowed=(props_().getProperty('ADMIN_EMAILS')||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);if(!email||!allowed.includes(email))throw new Error('管理権限を確認できません。管理アカウントで開いてください。');return email;}
function setupDice(){const s=SpreadsheetApp.getActiveSpreadsheet();const email=Session.getActiveUser().getEmail();if(!email)throw new Error('管理アカウントを確認できません');if(props_().getProperty('ADMIN_EMAILS'))authorize_();props_().setProperty('SPREADSHEET_ID',s.getId());if(!props_().getProperty('ADMIN_EMAILS'))props_().setProperty('ADMIN_EMAILS',email.toLowerCase());Object.entries(SCHEMA_).forEach(([name,headers])=>{let sh=s.getSheetByName(name);if(!sh)sh=s.insertSheet(name);if(sh.getLastRow()===0){sh.getRange(1,1,1,headers.length).setValues([headers.map(label_)]);sh.setFrozenRows(1);sh.getRange(1,1,1,headers.length).setBackground('#142a46').setFontColor('#ffffff').setFontWeight('bold');sh.getRange(1,1,Math.max(100,sh.getMaxRows()),headers.length).setNumberFormat('@');sh.autoResizeColumns(1,headers.length);}});
 if(rows_('設定マスタ').length===0)append_('設定マスタ',{campaignId:'DICE-001',name:'デイリーサイコロチャレンジ',status:'準備中',target:7,p1:1,p2:1,p3:1,p4:2,p5:2,p6:3,staffEnabled:true,selected:true});
 const sh=s.getSheetByName('設定マスタ');sh.getRange('E2:E1000').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['準備中','実施中','終了'],true).setAllowInvalid(false).build());setJapaneseValidation_(sh);s.setSpreadsheetTimeZone('Asia/Tokyo');SpreadsheetApp.getUi().alert('初期構築完了。初期状態は準備中です。公開用プロジェクトの設定は導入手順を参照してください。');}
function showStaffDialog(){authorize_();SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutputFromFile('StaffDialog').setWidth(440).setHeight(530),'スタッフ確認');}
function normalizeCode_(v){return String(v||'').replace(/[\s-]/g,'').toUpperCase();}
function attemptLimit_(email,recordFailure){const k='attempt:'+hash_(email),store=props_();let a=JSON.parse(store.getProperty(k)||'[]').filter(t=>Date.now()-t<15*60000);if(a.length>=20)throw new Error('試行回数が上限に達しました。15分後に再確認してください。');if(recordFailure)a.push(Date.now());store.setProperty(k,JSON.stringify(a));}
function staffLookup(code){const email=authorize_();return withLock_(()=>{attemptLimit_(email,false);let match;try{match=lookup_(normalizeCode_(code));}catch(e){attemptLimit_(email,true);throw e;}return {campaignId:match.c.campaignId,campaignName:String(match.c.name),participantSuffix:match.card.participantId.slice(-8),total:match.m.cappedTotal,expiresAt:match.card.confirmationExpiresAt};});}
function lookup_(code){if(!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{20}$/.test(code))throw new Error('確認コードが無効または期限切れです');const h=hash_(code);const a=rows_('キャンペーン参加DB').filter(r=>same_(r.confirmationHash,h));if(a.length!==1)throw new Error('確認コードが無効または期限切れです');const card=a[0],c=config_(card.campaignId),m=model_(card,c);if(m.state!=='ACHIEVED'||!reception_(c,new Date())||new Date(card.confirmationExpiresAt)<=new Date())throw new Error('未達成・確認済み・受付終了・期限切れのいずれかです');return {card,c,m,h};}
function staffComplete(code,name){const email=authorize_();name=diceStaffName_(name);return withLock_(()=>{attemptLimit_(email,false);let match;try{match=lookup_(normalizeCode_(code));}catch(e){attemptLimit_(email,true);append_('スタッフ確認ログ',{eventId:'S-'+Utilities.getUuid(),confirmedAt:iso_(),staffName:name,operatorEmail:email,result:'REJECTED',reason:'INVALID_OR_USED'});throw e;}append_('スタッフ確認ログ',{eventId:'S-'+Utilities.getUuid(),campaignId:match.c.campaignId,participantId:match.card.participantId,confirmedAt:iso_(),staffName:name,operatorEmail:email,result:'SUCCESS',confirmationHash:match.h,reason:''});return {ok:true,message:'確認完了を記録しました'};});}
function refreshParticipation(){authorize_();const cards=rows_('キャンペーン参加DB');const summary={ACTIVE:0,ACHIEVED:0,COMPLETED:0};cards.forEach(card=>{summary[model_(card,config_(card.campaignId)).state]++;});SpreadsheetApp.getUi().alert('履歴から確認した状態\n参加中 '+summary.ACTIVE+'\n達成 '+summary.ACHIEVED+'\n確認完了 '+summary.COMPLETED+'\n顧客画面照会時に参加DBの状態も更新されます。');}
function showCampaignSettings(){authorize_();const c=config_();SpreadsheetApp.getUi().alert(SCHEMA_['設定マスタ'].map(key=>label_(key)+'：'+String(encodeDisplay_(key,c[key]===undefined?'':c[key]))).join('\n'));}
function runDiagnostics(){authorize_();const c=config_();const issues=[];Object.keys(SCHEMA_).forEach(n=>rows_(n));if(c.status==='準備中')issues.push('準備中：抽選停止');if(!c.confirmationDeadline)issues.push('確認受付期限未設定：スタッフ確認停止');SpreadsheetApp.getUi().alert('スキーマ・設定の読み取り確認完了\n'+issues.join('\n')+'\n実抽選・Google環境の総合テストは別途必要です。');}

function createNextCampaign(){authorize_();return withLock_(()=>{const all=rows_('設定マスタ');const n=Math.max(0,...all.map(c=>/^DICE-\d+$/.test(c.campaignId)?Number(c.campaignId.slice(5)):0))+1;const id='DICE-'+String(n).padStart(3,'0');append_('設定マスタ',{campaignId:id,name:'デイリーサイコロチャレンジ',status:'準備中',target:7,p1:1,p2:1,p3:1,p4:2,p5:2,p6:3,staffEnabled:true,selected:false});SpreadsheetApp.getUi().alert(id+' を準備中で作成しました。開催期間・確認受付期限を設定後、「現在の開催」を切り替えてください。');});}

function setJapaneseValidation_(sheet){
 const max=sheet.getMaxRows();if(max<2)return;
 [['M','有効','無効'],['O','対象','対象外']].forEach(([col,a,b])=>sheet.getRange(col+'2:'+col+max).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList([a,b],true).setAllowInvalid(false).build()));
}
// Admin-only migration. Backups are hidden sheets; IDs, hashes, totals and dates are preserved.
function localizeDiceSheets(){
 authorize_();
 const count=withLock_(()=>{
   const ss=db_();const plans=[];
   Object.keys(SCHEMA_).forEach(name=>{
     rows_(name); // Preflight all schemas before changing any sheet.
     const sheet=ss.getSheetByName(name),before=sheet.getDataRange().getValues(),keys=SCHEMA_[name];
     const after=before.map((row,i)=>i===0?keys.map(label_):row.map((value,j)=>j<keys.length?encodeDisplay_(keys[j],decodeDisplay_(keys[j],value)):value));
     const changed=before.some((row,i)=>row.slice(0,keys.length).some((v,j)=>v!==after[i][j]));
     if(changed)plans.push({sheet,before,after,name});
   });
   const stamp=Utilities.formatDate(new Date(),'Asia/Tokyo','yyyyMMdd-HHmmss');
   // Finish all backups first; no data changes if a backup fails.
   plans.forEach(({sheet,name})=>{const base='日本語化前_'+stamp+'_'+name;let title=base,n=1;while(ss.getSheetByName(title))title=base+'_'+n++;sheet.copyTo(ss).setName(title).hideSheet();});
   plans.forEach(({sheet,after,name})=>{
     if(name==='設定マスタ')setJapaneseValidation_(sheet);
     sheet.getRange(1,1,after.length,SCHEMA_[name].length).setValues(after.map(row=>row.slice(0,SCHEMA_[name].length)));
     sheet.setFrozenRows(1);sheet.getRange(1,1,1,SCHEMA_[name].length).setBackground('#142a46').setFontColor('#ffffff').setFontWeight('bold');sheet.autoResizeColumns(1,SCHEMA_[name].length);
   });
   // Refresh validation even when all labels were already Japanese.
   setJapaneseValidation_(ss.getSheetByName('設定マスタ'));
   SpreadsheetApp.flush();return plans.length;
 });
 SpreadsheetApp.getUi().alert(count?count+'シートを日本語表示に変更しました。変更前のコピーは非表示シートに保存しています。':'すでに日本語表示です。設定の選択肢も確認しました。');
}
