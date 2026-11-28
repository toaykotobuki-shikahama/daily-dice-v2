function staffTestBootstrap(){const email=trialAuth_(),master=trialRows_('テストマスタ').filter(r=>r['有効']==='有効');return {email,appVersion:TEST_VERSION_,versions:[...new Set(master.map(x=>x['テストVer']))],runs:trialRows_('テスト実施履歴').filter(x=>x['操作アカウント']===email).slice(-30).reverse().map(x=>({id:x['実施ID'],ver:x['テストVer'],name:x['実施者'],phase:x['実施状況'],app:x['アプリVer']})),enabled:props_().getProperty('TEST_TRIAL_ENABLED')!=='false'};}
function trialGoal_(t){const complete=t.plan.every(p=>trialCount_(t,p.id).total>=p.target);if(complete&&!t.state.active){const c=trialCount_(t);t.state.phase=c.failure||c.unknown||c.interrupted?'回数達成・要確認':'完了';}}
function trialClose_(t,row,result,error){if(row['終了日時'])return;const commands=trialArray_(row,'通信JSON');if(commands.length)row['GAS通信回数']=commands.reduce((n,x)=>n+(x.requestCount||1),0);row['GAS計測区間ms']=commands.reduce((n,c)=>n+c.serverMs,0);row['終了日時']=iso_();row['結果']=row['試行開始イベント']?result:'未開始';row['エラー内容']=error||'';row['操作処理時間ms']='';row['演出時間ms']='';t.state.active='';t.state.rev++;row['状態JSON']=JSON.stringify(t.state);trialWrite_('テスト操作ログ',row);trialGoal_(t);}
function staffTrialRpc(r){const serverStart=Date.now(),email=trialAuth_();if(!r||!/^REQ-[a-f0-9-]{36}$/i.test(r.requestId||'')||JSON.stringify(r).length>16000)throw Error('通信内容を確認してください');return withLock_(()=>{
 trialRate_(email);
 if(r.action==='start'){
  const id='TEST-'+r.requestId.slice(4);if(trialRows_('テスト実施履歴').some(x=>x['実施ID']===id))return trialReply_(trialSession_(id,email));
  if(trialRows_('テスト実施履歴').length>=TRIAL_LIMITS_.sessions)throw Error('実施数上限です。CSV保管後に管理者が初期化してください');const name=trialText_(r.name,50).trim();if(!name)throw Error('実施者名が必要です');const rows=trialRows_('テストマスタ').filter(x=>x['テストVer']===r.ver&&x['有効']==='有効').sort((a,b)=>Number(a['順序'])-Number(b['順序']));
  const plan=rows.map(x=>({id:String(x['テストID']),title:String(x['テスト名']),kind:String(x['操作種類']),condition:String(x['開始条件']),steps:String(x['操作手順']),expected:String(x['正常条件']),start:String(x['計測開始点']),end:String(x['計測終了点']),target:Number(x['目標試行回数']),rule:String(x['判定条件']),interruption:String(x['中断時の扱い']),definition:trialDefinition_(x)}));
  if(JSON.stringify(plan).length>30000)throw Error('マスタの文章量が多すぎます');if(!plan.length||plan.length>40||plan.some(x=>!Number.isInteger(x.target)||x.target<1||x.target>1000)||plan.reduce((n,x)=>n+x.target,0)>TRIAL_LIMITS_.trials||new Set(plan.map(x=>x.id)).size!==plan.length)throw Error('マスタの目標回数・IDを確認してください');
  const state={rev:0,phase:'実施中',active:'',total:0,cardState:'ACTIVE',code:'',last:null,calls:0,errors:0,lastErrorAt:0};
  trialWrite_('テスト実施履歴',{'実施ID':id,'実施者':name,'操作アカウント':email,'実施開始日時':iso_(),'最終実施日時':iso_(),'アプリVer':TEST_VERSION_,'テストVer':r.ver,'目標回数':plan.reduce((n,x)=>n+x.target,0),'実施回数':0,'成功回数':0,'失敗回数':0,'中断回数':0,'未確認回数':0,'実施状況':'実施中','計画JSON':JSON.stringify(plan),'状態JSON':JSON.stringify(state),'操作履歴JSON':'[]'});return trialReply_(trialSession_(id,email));
 }
 const t=trialSession_(r.sessionId,email),s=t.state;const find=id=>t.logs.find(x=>x['試行ID']===id);
 if(r.action==='status')return trialReply_(t);
 if(r.action==='feedback'){
  const row=find(r.trialId);if(!row||!row['終了日時'])throw Error('終了した試行を選んでください');if(!['正常','異常','判断できない'].includes(r.result)||!['快適','普通','遅い','使いにくい'].includes(r.feel)||!['反応しない','表示がおかしい','データが消えた','動作が遅い','二重に処理された','その他','問題なし'].includes(r.problem))throw Error('所感の選択肢を確認してください');
  const url=trialText_(r.evidence||'',1000);if(url&&!/^https:\/\/[^\s]+$/.test(url))throw Error('証拠URLはhttpsから入力してください');Object.assign(row,{'動作結果':r.result,'操作感':r.feel,'問題の種類':r.problem,'所感':trialText_(r.notes||'',2000),'証拠URL':url});if(r.result==='異常'&&row['試行開始イベント'])row['結果']='失敗';if(r.result==='判断できない'&&row['試行開始イベント'])row['結果']='未確認';trialWrite_('テスト操作ログ',row);trialGoal_(t);trialControl_(t,'所感');return trialReply_(t);
 }
 if(['pause','recover','stop'].includes(r.action)){
  const row=find(s.active);if(row&&!row['終了日時']){
   const proof=r.localStart;if(!row['試行開始イベント']&&proof&&proof.trialId===row['試行ID']&&proof.nonce===row['認可値']&&['dice-start','reload-start','operation-start'].includes(proof.event)){row['試行開始イベント']=true;row['開始根拠']='ブラウザ開始イベント（GAS処理到達は未確認）';row['開始日時']=trialText_(proof.at,40);}
   trialClose_(t,row,r.action==='pause'&&!r.pending?'中断':'未確認','中断・再アクセスにより操作完了を確認できません'+(r.clientError?'：'+trialText_(r.clientError,2000):''));
  }
  if(!['完了','回数達成・要確認'].includes(s.phase))s.phase=r.action==='stop'?'停止':'中断';trialControl_(t,r.action);return trialReply_(t);
 }
 if(r.action==='resume'){if(s.active)throw Error('未完了の試行を再取得・復旧してください');if(t.row['アプリVer']!==TEST_VERSION_)throw Error('アプリ版が変わりました。同じ条件で新しい実施を開始してください');if(!['完了','回数達成・要確認'].includes(s.phase))s.phase='実施中';s.errors=0;trialControl_(t,'再開');return trialReply_(t);}
 if(r.action!=='finish'&&props_().getProperty('TEST_TRIAL_ENABLED')==='false')throw Error('管理者が検証モードを停止しています');
 if(s.calls>=TRIAL_LIMITS_.requests)throw Error('通信回数上限です');
 if(r.action!=='finish'&&s.phase!=='実施中')throw Error('中断・停止中です。再開してください');
 if(t.row['アプリVer']!==TEST_VERSION_)throw Error('アプリ版が変わりました。新しい実施を開始してください');
 if(r.action==='arm'){
  const id='TRY-'+r.requestId.slice(4),replay=find(id);if(replay)return trialReply_(t,{trial:replay});if(s.active)throw Error('前の試行を復旧または終了してください');if(r.expectedRev!==s.rev)throw Error('別画面で更新されました。状態を再取得してください');const p=t.plan.find(x=>x.id===r.itemId);if(!p||trialCount_(t,p.id).total>=p.target)throw Error('項目がないか目標回数に達しています');
  if(['roll','tap','spam','save','duplicate','achieve','leave'].includes(p.kind)){s.total=0;s.cardState='ACTIVE';s.last=null;s.code='';}if(p.kind==='reload'){s.total=3;s.cardState='ACTIVE';s.last={eventId:'TEST-FIXTURE',face:3,earned:1};s.code='';}
  s.active=id;s.rev++;const row={'試行ID':id,'実施ID':t.row['実施ID'],'テストID':p.id,'試行番号':trialCount_(t,p.id).total+1,'アプリVer':t.row['アプリVer'],'テストVer':t.row['テストVer'],'テスト定義Ver':p.definition,'実施者':t.row['実施者'],'操作アカウント':email,'操作名':p.title,'試行開始イベント':false,'開始根拠':'準備のみ・未開始','結果':'未開始','通信結果':'未取得','端末情報':trialText_(r.device||'未取得',300),'通信環境':trialText_(r.network||'未取得',80),'対応状況':'未確認','要求ID':r.requestId,'条件JSON':JSON.stringify(p),'状態JSON':JSON.stringify(s),'通信JSON':'[]','計測JSON':'{}','認可値':Utilities.getUuid()};trialWrite_('テスト操作ログ',row);return trialReply_(trialSession_(t.row['実施ID'],email),{trial:row});
 }
 const row=find(r.trialId);if(!row||row['認可値']!==r.nonce)throw Error('試行の認可を確認できません');const p=JSON.parse(row['条件JSON']);
 if(r.action==='execute'){
  if(typeof r.operationId!=='string'||r.operationId.length<3||r.operationId.length>100)throw Error('操作IDを確認してください');
  const commands=trialArray_(row,'通信JSON'),duplicate=commands.find(c=>c.id===r.operationId);if(duplicate||row['終了日時']){if(duplicate&&!row['終了日時']){duplicate.serverMs+=Date.now()-serverStart;duplicate.requestCount=(duplicate.requestCount||1)+1;row['通信JSON']=JSON.stringify(commands);const m=JSON.parse(row['計測JSON']);m.duplicatePrevented=true;row['計測JSON']=JSON.stringify(m);trialWrite_('テスト操作ログ',row);}return trialReply_(t,{duplicatePrevented:!!duplicate,trial:row});}
  if(s.active!==row['試行ID'])throw Error('現在の試行ではありません');
  row['試行開始イベント']=true;row['開始根拠']='GAS操作開始イベント';if(!row['開始日時'])row['開始日時']=iso_();row['結果']='未確認';row['通信結果']='応答あり';let ok=true,error='';
  try{
   if(['roll','tap','spam','save','duplicate','achieve','leave'].includes(p.kind)&&r.operation==='roll'){
    if(p.kind!=='achieve'&&commands.some(c=>c.operation==='roll'))throw Error('この試行は抽選済みです');if(s.cardState!=='ACTIVE')throw Error('達成または完了済みです');const key=props_().getProperty('TEST_RANDOM_KEY');const draw=diceRules_(()=>{const bytes=Utilities.computeHmacSha256Signature(Utilities.getUuid()+':'+iso_(),key);return bytes.slice(0,4).reduce((n,b)=>(n*256)+(b&255),0);},[1,1,1,2,2,3],s.total,7);s.total=draw.actualTotal;s.last={eventId:'TEST-ROLL-'+Utilities.getUuid(),face:draw.face,earned:draw.earned,createdAt:iso_()};if(s.total>=7){s.cardState='ACHIEVED';s.code='TEST-'+Utilities.getUuid().slice(0,8).toUpperCase();}
   }else if(p.kind==='achieve'&&r.operation==='complete'){
    diceStaffName_(r.staffName);if(s.cardState!=='ACHIEVED'||r.code!==s.code)throw Error('テスト確認コード・達成状態・担当者名を確認してください');s.cardState='COMPLETED';
   }else if(['reload','achieve','save'].includes(p.kind)&&r.operation==='read'){
    // Read the saved card through the same authenticated adapter.
   }else if(['reload','probe','leave','invalid'].includes(p.kind)&&r.operation==='check'){
    if(p.kind==='invalid'){if(r.invalidValue!=='')throw Error('空欄の無効入力を試してください');try{diceStaffName_(r.invalidValue);throw Error('検証条件が一致しません');}catch(e){row['計測JSON']=JSON.stringify({expectedRejection:true,rejection:String(e.message)});}}
   }else throw Error('この項目の操作ではありません');
  }catch(e){ok=false;error=String(e.message);}
  commands.push({id:r.operationId,operation:r.operation,ok,error,serverMs:Date.now()-serverStart,rttMs:null,requestCount:1});if(commands.length>20)throw Error('1試行の操作回数上限です');row['通信JSON']=JSON.stringify(commands);row['エラー内容']=error;s.calls++;s.rev++;if(!ok){s.errors=Date.now()-s.lastErrorAt<60000?s.errors+1:1;s.lastErrorAt=Date.now();if(s.errors>=3)s.phase='自動停止';}else s.errors=0;row['状態JSON']=JSON.stringify(s);trialWrite_('テスト操作ログ',row);return trialReply_(trialSession_(t.row['実施ID'],email),{operationOk:ok,error,trial:row,serverMeasuredMs:commands[commands.length-1].serverMs});
 }
 if(r.action==='finish'){
  if(row['終了日時'])return trialReply_(t,{trial:row});if(!row['試行開始イベント'])throw Error('操作開始イベントがないため試行回数には加算できません');
  const commands=trialArray_(row,'通信JSON');if(Array.isArray(r.timings))for(const v of r.timings){const c=commands.find(x=>x.id===v.id);if(c)c.rttMs=trialFinite_(v.rtt);}
  let good=commands.length>0&&commands.every(x=>x.ok),reason='';const m=JSON.parse(row['計測JSON']);
  if(['roll','tap','spam','save','duplicate'].includes(p.kind))good=good&&r.display?.face===s.last?.face&&r.display?.total===Math.min(7,s.total);
  if(p.kind==='tap')good=good&&r.taps>=1;if(p.id==='B-04'){const first=Array.isArray(r.tapTimings)?r.tapTimings[0]:undefined,index=(Number(row['試行番号'])-1)%3;good=good&&Number.isFinite(first)&&(index===0?first<200:index===1?first>=200&&first<650:first>=650&&first<=850);}if(p.kind==='spam')good=good&&r.taps>=2;if(p.kind==='duplicate')good=good&&m.duplicatePrevented;
  if(p.kind==='save')good=good&&commands.some(x=>x.operation==='read');
  if(p.kind==='reload')good=good&&r.display?.total===3&&commands.some(x=>x.operation==='read');
  if(p.kind==='achieve')good=good&&s.cardState==='COMPLETED'&&r.display?.state==='COMPLETED';
  if(p.kind==='invalid')good=good&&m.expectedRejection===true;
  let result=r.interrupted?'中断':r.unknown?'未確認':good?'成功':'失敗';if(!good)reason='期待結果または操作条件との一致を確認できません';
  row['終了日時']=iso_();row['結果']=result;if(!row['エラー内容'])row['エラー内容']=reason;row['通信JSON']=JSON.stringify(commands);row['操作処理時間ms']=r.interrupted||r.unknown?'':trialFinite_(r.operationMs);row['演出時間ms']=r.interrupted||r.unknown?'':trialFinite_(r.animationMs);
  const rtts=commands.filter(x=>Number.isFinite(x.rttMs));row['GAS往復時間ms']=rtts.length===commands.length?rtts.reduce((n,x)=>n+Number(x.rttMs),0):'';row['GAS通信回数']=commands.reduce((n,x)=>n+(x.requestCount||1),0);row['GAS計測区間ms']=commands.reduce((n,x)=>n+x.serverMs,0);row['計測JSON']=JSON.stringify({...m,taps:r.taps||0,tapTimings:r.tapTimings||[],achievementMs:trialFinite_(r.achievementMs),queueWaitMs:trialFinite_(r.queueWaitMs),clockOrigin:r.clockOrigin||'',display:r.display||{},timingDefinition:'操作全体：開始イベントから表示。GAS往復：実操作要求のみ。演出：回転開始から停止。'});
  s.active='';s.rev++;row['状態JSON']=JSON.stringify(s);trialWrite_('テスト操作ログ',row);trialGoal_(t);trialControl_(t,'試行終了');return trialReply_(trialSession_(t.row['実施ID'],email),{trial:row});
 }
 throw Error('この操作は許可されていません');
 });}
