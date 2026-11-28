/* Only this dispatcher is public. No staff writes or admin functions here. */
function publicApi(request){try{return withLock_(()=>dispatch_(request));}catch(e){const code=String(e.message);return {ok:false,error:['AUTH','BUSY','SETUP_REQUIRED','CAMPAIGN_CONFIGURATION','SCHEMA_MISMATCH','RATE_LIMIT','CARD_UNAVAILABLE','INVALID_REQUEST'].includes(code)?code:'SERVER_ERROR'};}}
function dispatch_(r){if(!r||!['register','status','roll'].includes(r.action))throw new Error('INVALID_REQUEST');const c=config_(r.action==='register'?null:r.campaignId||null);const now=new Date();
 if(r.action==='register')return register_(r,c,now);
 const p=authenticate_(r);throttle_(p.participantId,0,80);const card=card_(c,p.participantId,source_(r.source),active_(c,now)); if(!card)return {ok:true,campaign:publicConfig_(c,now),card:null,campaignCards:campaignCards_(p.participantId),previous:previous_(p.participantId,c.campaignId)};
 if(r.action==='roll')roll_(r,p,card,c,now);
 return state_(p,card,c,now);
}
function random_(purpose){const key=props_().getProperty('SERVER_KEY');if(!key)throw new Error('SETUP_REQUIRED');return Utilities.computeHmacSha256Signature(purpose+':'+Utilities.getUuid()+':'+iso_(),key).map(b=>(b&255).toString(16).padStart(2,'0')).join('');}
function throttle_(key,minSeconds,maxMinute){const ca=CacheService.getScriptCache();const now=Date.now();const v=JSON.parse(ca.get('rate:'+key)||'{"at":0,"minute":0,"count":0}');const minute=Math.floor(now/60000); if(now-v.at<minSeconds*1000||v.minute===minute&&v.count>=maxMinute)throw new Error('RATE_LIMIT');ca.put('rate:'+key,JSON.stringify({at:now,minute,count:v.minute===minute?v.count+1:1}),120);}
function register_(r,c,now){if(!/^[a-f0-9]{64}$/.test(r.registrationKey||''))throw new Error('INVALID_REQUEST');const kh=hash_(r.registrationKey);let p=rows_('参加者マスタ').find(x=>x.registrationKeyHash===kh);
 if(!p){if(!active_(c,now))return {ok:true,campaign:publicConfig_(c,now),card:null};throttle_('registration-global',0,120);const id='P-'+random_('id').slice(0,32); const secret=Utilities.computeHmacSha256Signature('credential:'+id+':'+kh,props_().getProperty('SERVER_KEY')).map(b=>(b&255).toString(16).padStart(2,'0')).join('');append_('参加者マスタ',{participantId:id,secretHash:hash_(secret),registrationKeyHash:kh,registeredAt:iso_(now),lastAccessAt:iso_(now),firstSource:source_(r.source)});p=rows_('参加者マスタ').find(x=>x.participantId===id);}
 // Deterministic replay recovers registration if the first response was lost.
 const secret=Utilities.computeHmacSha256Signature('credential:'+p.participantId+':'+kh,props_().getProperty('SERVER_KEY')).map(b=>(b&255).toString(16).padStart(2,'0')).join('');const card=card_(c,p.participantId,source_(r.source),active_(c,now));const result=card?state_(p,card,c,now):{ok:true,campaign:publicConfig_(c,now),card:null,campaignCards:campaignCards_(p.participantId),previous:previous_(p.participantId,c.campaignId)};result.identity={participantId:p.participantId,secret};return result;
}
function authenticate_(r){if(!/^P-[a-f0-9]{32}$/.test(r.participantId||'')||!/^[a-f0-9]{64}$/.test(r.secret||''))throw new Error('AUTH');const p=rows_('参加者マスタ').find(x=>x.participantId===r.participantId);if(!p||!same_(p.secretHash,hash_(r.secret)))throw new Error('AUTH');return p;}
function campaignCards_(p){return rows_('キャンペーン参加DB').filter(a=>a.participantId===p).map(a=>{const c=config_(a.campaignId);return {id:c.campaignId,name:String(c.name),state:model_(a,c).state};});}
function previous_(p,c){return rows_('日別参加履歴').some(r=>r.participantId===p&&r.campaignId!==c);}
function publicConfig_(c,now){return {id:c.campaignId,name:String(c.name),target:c.target,status:c.status,startDate:c.startDate,endDate:c.endDate,active:active_(c,now),staffEnabled:enabled_(c.staffEnabled),receptionOpen:reception_(c,now),confirmationDeadline:c.confirmationDeadline};}
function roll_(r,p,card,c,now){const m=model_(card,c);if(!active_(c,now)||m.state!=='ACTIVE'||m.events.some(e=>e.day===day_(now)))return;
 if(!/^[a-f0-9]{32}$/.test(r.requestId||''))throw new Error('INVALID_REQUEST');
 // Rejection sampling avoids modulo bias. HMAC server randomness is never provided by the client.
 const draw=diceRules_(()=>parseInt(random_('dice').slice(0,8),16),c.points,m.actualTotal,c.target);const {face,earned}=draw;
 append_('日別参加履歴',{eventId:'E-'+Utilities.getUuid(),campaignId:c.campaignId,participantId:p.participantId,day:day_(now),face,earned,actualTotal:draw.actualTotal,cappedTotal:draw.cappedTotal,createdAt:iso_(now),source:source_(r.source),requestId:r.requestId,targetAtRoll:c.target});
 // Event append is the commit point; snapshot failure cannot cause a second roll.
}
function state_(p,card,c,now){const m=model_(card,c);Object.assign(card,{actualTotal:m.actualTotal,cappedTotal:m.cappedTotal,state:m.state,achievedAt:m.achievedAt,completedAt:m.completedAt,firstRollAt:m.firstRollAt});
 let code='',expiry='';if(m.state==='ACHIEVED'&&reception_(c,now)){
 if(!card.confirmationHash||new Date(card.confirmationExpiresAt)<=now){card.confirmationVersion=Number(card.confirmationVersion||0)+1;card.confirmationExpiresAt=iso_(new Date(now.getTime()+15*60000));code=code_(card);card.confirmationHash=hash_(code);}
 else code=code_(card); expiry=card.confirmationExpiresAt;
 }
 save_('キャンペーン参加DB',card);if(!p.lastAccessAt||now-new Date(p.lastAccessAt)>60000){p.lastAccessAt=iso_(now);save_('参加者マスタ',p);}const last=m.events[m.events.length-1];return {ok:true,campaign:publicConfig_(c,now),campaignCards:campaignCards_(p.participantId),previous:previous_(p.participantId,c.campaignId),serverTime:iso_(now),card:{reference:p.participantId.slice(-8),state:m.state,total:m.cappedTotal,actualTotal:m.actualTotal,canRoll:active_(c,now)&&m.state==='ACTIVE'&&!m.events.some(e=>e.day===day_(now)),todayPlayed:m.events.some(e=>e.day===day_(now)),nextAvailableAt:nextDay_(now),confirmationCode:code,confirmationExpiresAt:expiry,lastResult:last?{eventId:last.eventId,day:last.day,face:Number(last.face),earned:Number(last.earned),createdAt:last.createdAt}:null}};}
function code_(card){const bytes=Utilities.computeHmacSha256Signature([card.campaignId,card.participantId,card.confirmationVersion,card.confirmationExpiresAt].join(':'),props_().getProperty('SERVER_KEY'));const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return bytes.slice(0,20).map(b=>alphabet[(b&255)%32]).join('');}
