/** Dashboard writer lives in the same project lock as campaign and participation writes. */
function v2AdminRefreshDashboard_(actor,operationId){
  const prior=v2AdminReplay_(operationId,['DASHBOARD_REFRESH']);if(prior)return {ok:true,rows:prior.rows,replayed:true};
  const campaigns=v2Rows_('Campaigns').map(v2Campaign_).filter(c=>!c.archived),participants=v2Rows_('Participants'),cards=v2Rows_('Cards'),events=v2Rows_('DailyHistory'),logs=v2Rows_('StaffConfirmLog'),now=new Date(),out=[];
  campaigns.forEach(c=>{
    const e=events.filter(x=>String(x.campaignId)===c.id),played=new Set(e.map(x=>String(x.participantId))),counts={};e.forEach(x=>counts[x.participantId]=(counts[x.participantId]||0)+1);
    const achieved=new Map();e.forEach(x=>{if(Number(x.totalAfter)>=c.target&&!achieved.has(String(x.participantId)))achieved.set(String(x.participantId),x);});
    const complete=new Set(logs.filter(x=>String(x.campaignId)===c.id&&String(x.status)==='SUCCESS').map(x=>String(x.participantId))),pairs=new Set(e.map(x=>String(x.participantId)+'|'+String(x.jstDate))),today=v2JstDate_(now);let eligible=0,next=0;
    e.forEach(x=>{const d=v2JstDate_(new Date(Date.parse(String(x.jstDate)+'T00:00:00+09:00')+86400000));if(Number(x.totalAfter)<c.target&&d<today&&d<=c.endDate){eligible++;if(pairs.has(String(x.participantId)+'|'+d))next++;}});
    const earlier=new Set(events.filter(x=>String(x.campaignId)!==c.id&&String(x.jstDate)<c.startDate).map(x=>String(x.participantId))),returned=[...played].filter(p=>earlier.has(p)).length;
    const days=[...achieved.entries()].map(([pid,x])=>{const first=e.filter(r=>String(r.participantId)===pid).map(r=>String(r.jstDate)).sort()[0];return Math.round((Date.parse(String(x.jstDate)+'T00:00:00+09:00')-Date.parse(first+'T00:00:00+09:00'))/86400000)+1;});
    const rate=(n,d)=>d?n/d:'',add=(metric,value,definition)=>out.push({campaignId:c.id,metric,value,definition,updatedAt:now});
    add('初回参加カード数（全期間）',participants.length,'端末・ブラウザ単位の登録カード。開催比較の合算対象外');add('キャンペーン参加カード数',played.size,'1回以上抽選したカード');add('キャンペーンアクセス登録カード数',cards.filter(x=>String(x.campaignId)===c.id).length,'開催カード。未抽選を含む');add('2回以上参加したカード数',Object.values(counts).filter(n=>n>=2).length,'日別参加履歴が2行以上あるカード');add('達成カード数',achieved.size,'抽選時点の開催目標以上');add('スタッフ確認完了数',complete.size,'SUCCESSログのユニークカード');add('スタンプ達成率',rate(achieved.size,played.size),'達成カード数 / 抽選カード数');add('スタッフ確認完了率',rate(complete.size,achieved.size),'完了カード数 / 達成カード数');add('翌日再参加率',rate(next,eligible),'翌日参加カード日 / 成熟済み参加可能カード日。停止日の扱いはR08未決');add('翌日再参加率の分子',next,'翌日参加カード日');add('翌日再参加率の分母',eligible,'翌日が経過した参加可能カード日');add('平均達成日数',days.length?days.reduce((a,b)=>a+b,0)/days.length:'','初回抽選日から達成日まで。初日=1');add('過去参加カードの再参加率',rate(returned,earlier.size),'開催前に他キャンペーン参加し現開催で抽選した割合');add('過去参加カードの再参加率の分母',earlier.size,'開催開始前の他開催参加カード');
    const daily={};e.forEach(x=>{(daily[x.jstDate]||(daily[x.jstDate]=new Set())).add(String(x.participantId));});Object.keys(daily).sort().forEach(d=>add('日別参加 '+d,daily[d].size,'同日カード単位'));
    ['line','pop','other'].forEach(source=>{const ids=new Set(cards.filter(x=>String(x.campaignId)===c.id&&String(x.sourceSnapshot||'other')===source&&played.has(String(x.participantId))).map(x=>String(x.participantId)));add('導線 '+source+' 参加カード数',ids.size,'開催カード作成時の流入元固定');add('導線 '+source+' 達成率',rate([...ids].filter(p=>achieved.has(p)).length,ids.size),'流入元別の達成 / 抽選カード');add('導線 '+source+' 確認完了数',[...ids].filter(p=>complete.has(p)).length,'流入元別の完了');});
  });
  const ss=v2Db_(),sh=ss.getSheetByName('Dashboard'),audit=ss.getSheetByName('AuditLog');if(!sh||!audit)throw new Error('DASHBOARD_SCHEMA_MISSING');
  SpreadsheetApp.flush();const maxRows=sh.getMaxRows(),grow=Math.max(0,out.length+1-maxRows),requests=[];
  if(maxRows>1)requests.push({updateCells:{range:{sheetId:sh.getSheetId(),startRowIndex:1,endRowIndex:maxRows,startColumnIndex:0,endColumnIndex:V2_SHEETS.Dashboard.length},fields:'userEnteredValue'}});
  if(grow)requests.push({appendDimension:{sheetId:sh.getSheetId(),dimension:'ROWS',length:grow}});
  if(out.length)requests.push({updateCells:{range:{sheetId:sh.getSheetId(),startRowIndex:1,startColumnIndex:0},rows:out.map(o=>({values:V2_SHEETS.Dashboard.map(k=>v2ApiCell_(o[k]))})),fields:'userEnteredValue'}});
  const auditObj={operationId,actor,campaignId:'',action:'DASHBOARD_REFRESH',beforeJson:'',afterJson:JSON.stringify({rows:out.length}),version:0,createdAt:now};requests.push({appendCells:{sheetId:audit.getSheetId(),rows:[{values:V2_SHEETS.AuditLog.map(k=>v2ApiCell_(auditObj[k]))}],fields:'userEnteredValue'}});
  Sheets.Spreadsheets.batchUpdate({requests},ss.getId());return {ok:true,rows:out.length};
}
