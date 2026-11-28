function v2Public_(req){
  const trace=String(req&&req.requestId||Utilities.getUuid());
  try{
    if(!req||JSON.stringify(req).length>16000||!['register','status','roll'].includes(req.action))throw new Error('INVALID_REQUEST');
    const p=req.action==='register'?null:v2Authenticate_(req);
    if(req.action==='status'){
      // Read-only status runs without the lock. Only card creation or code renewal takes the locked path below.
      const now=new Date(),active=DiceV2.resolveCampaign(v2Rows_('Campaigns').map(v2Campaign_).filter(c=>!c.archived),now.getTime());
      if(!(active&&!req.campaignId&&!v2Card_(active.id,p.participantId))){const r=v2Status_(p,req.campaignId,active,now,trace,true);if(r)return r;}
    }
    return v2WithLock_(()=>{
      // Read campaign state only after acquiring this project's write lock.
      const now=new Date(),day=v2JstDate_(now),campaigns=v2Rows_('Campaigns').map(v2Campaign_).filter(c=>!c.archived);
      const active=DiceV2.resolveCampaign(campaigns,now.getTime());
      if(req.action==='register')return active?v2Register_(req,active,now,trace):v2NoActiveStatus(campaigns,now);
      if(req.action==='status'){
        if(active&&!req.campaignId&&!v2Card_(active.id,p.participantId)){
          v2Append_('Cards',v2NewCard_(active,p,now));
          v2Log_(trace,'status','CARD_CREATED','OK','', '', 'COMMITTED');
        }
        return v2Status_(p,req.campaignId,active,now,trace);
      }
      return v2Roll_(req,p,active,now,day,trace);
    });
  }catch(e){
    const reason=v2SafeError_(e);
    // Never wait for the lock a second time on the error path. appendRow is safe without it.
    if(reason==='BUSY_RETRY')console.warn('BUSY_RETRY',trace,req&&req.action);
    else if(!['AUTH','INVALID_REQUEST'].includes(reason))v2Log_(trace,req&&req.action||'unknown','DISPATCH','REJECTED',reason,'','UNKNOWN');
    return {ok:false,error:reason,traceId:trace};
  }
}
function v2NewCard_(campaign,p,now){return {campaignId:campaign.id,participantId:p.participantId,sourceSnapshot:p.source,total:0,actualTotal:0,state:'ACTIVE',todayKey:'',lastEventId:'',confirmationHash:'',confirmationCode:'',confirmationVersion:0,confirmationExpiresAt:'',achievedAt:'',completedAt:'',updatedAt:now};}
function v2Register_(req,active,now,trace){
  if(!req.registrationKey||! /^[a-f0-9]{64}$/i.test(req.registrationKey))throw new Error('INVALID_REQUEST');
  const identityHash=v2Hash_(req.registrationKey),old=v2Rows_('Participants').find(x=>String(x.identityHash)===identityHash);let p=old;
  if(!p)p={participantId:Utilities.getUuid(),identityHash,secretHash:'',source:['line','pop'].includes(req.source)?req.source:'other',createdAt:now};
  const issuedSecret=v2Hash_(String(req.registrationKey)+':'+String(p.participantId));p.secretHash=v2Hash_(issuedSecret);
  if(!old)v2Append_('Participants',p);else v2Replace_('Participants',['participantId'],p);
  if(!v2Card_(active.id,p.participantId))v2Append_('Cards',v2NewCard_(active,p,now));
  const response=v2Status_(p,active.id,active,now,trace);response.identity={participantId:p.participantId,secret:issuedSecret};
  v2Log_(trace,'register','IDENTITY_AND_CARD_READY','OK','', '', 'COMMITTED');return response;
}
function v2Authenticate_(req){
  if(!req.participantId||!req.secret)throw new Error('AUTH');
  const hash=v2Hash_(req.secret),p=v2Rows_('Participants').find(x=>String(x.participantId)===String(req.participantId)&&String(x.secretHash)===hash);
  if(!p)throw new Error('AUTH');return p;
}
// fresh: a card row this execution just wrote through the Sheets API. SpreadsheetApp does not see those
// writes within the same execution, so the written row replaces the (stale) row read back here.
function v2Status_(p,campaignId,active,now,trace,readOnly,fresh){
  const same=x=>fresh&&String(x.campaignId)===String(fresh.campaignId)&&String(x.participantId)===String(fresh.participantId);
  const all=v2Rows_('Cards').filter(x=>String(x.participantId)===String(p.participantId)).map(x=>same(x)?fresh:x);
  if(fresh&&!all.includes(fresh))all.push(fresh);
  let target=campaignId?v2FindCampaign_(campaignId):active&&v2FindCampaign_(active.id);
  if(!target&&all.length)target=v2FindCampaign_(all[all.length-1].campaignId);
  const c=target?v2Campaign_(target):active;
  if(!c)return v2NoActiveStatus(v2Rows_('Campaigns').map(v2Campaign_),now);
  let row=all.find(x=>String(x.campaignId)===String(c.id));
  const state=DiceV2.campaignState(c,now),day=v2JstDate_(now),receptionOpen=c.confirmationEnabled&&day<=c.receptionEndDate;
  if(row&&DiceV2.confirmationNeedsRenewal(c,row,now.getTime())){
    const expires=v2CodeExpiry_(c,now);
    if(expires>now.getTime()){
      if(readOnly)return null; // caller retries under the lock
      const code=String(Math.floor(100000+Math.random()*900000));
      row.confirmationHash=v2Hash_(code);row.confirmationCode=code;row.confirmationVersion=Number(row.confirmationVersion||0)+1;
      row.confirmationExpiresAt=new Date(expires);row.updatedAt=now;
      v2AtomicWrite_([
        {name:'Cards',obj:row,keyFields:['campaignId','participantId']},
        {name:'ProcessLog',obj:{traceId:trace,action:'status',stage:'CONFIRMATION_CODE_REISSUE',result:'OK',reasonCode:'EXPIRED_OR_MISSING',eventId:String(row.lastEventId||''),storageState:'COMMITTED',createdAt:now},append:true}
      ]);
    }
  }
  const nextAvailableAt=row&&String(row.todayKey)===day?v2NextJstMidnight_(now):'';
  const card=row?{state:String(row.state),total:Number(row.total),actualTotal:Number(row.actualTotal),canRoll:!!active&&active.id===c.id&&state.active&&String(row.todayKey)!==day&&String(row.state)==='ACTIVE',todayPlayed:String(row.todayKey)===day,nextAvailableAt,lastResult:v2LastResult_(row),confirmationCode:row.confirmationCode||'',confirmationExpiresAt:row.confirmationExpiresAt?v2Iso_(new Date(row.confirmationExpiresAt)):'',reference:String(p.participantId).slice(-8)}:null;
  const cards=all.map(x=>{const rr=v2FindCampaign_(x.campaignId);return rr?{id:String(x.campaignId),name:String(rr.name),state:String(x.state),total:Number(x.total),target:Number(rr.target)}:null;}).filter(Boolean);
  const next=!active?v2UpcomingCampaign_(now):null;return {ok:true,serverTime:v2Iso_(now),campaign:{id:c.id,name:c.name,target:c.target,active:state.active,status:!active&&next?'UPCOMING':state.status,receptionOpen,dateSchedule:true,nextBoundaryAt:v2NextBoundary_(c,now)},nextCampaign:next?{id:next.id,name:next.name,startDate:next.startDate}:null,card,campaignCards:cards,previous:all.length>1};
}
function v2CodeExpiry_(campaign,now){return DiceV2.confirmationCodeExpiry(campaign.receptionEndDate,now.getTime());}
function v2NextJstMidnight_(now){return DiceV2.nextJstMidnight(now);}
function v2UpcomingCampaign_(now){const today=v2JstDate_(now);return v2Rows_('Campaigns').map(v2Campaign_).filter(c=>!c.archived&&c.startDate>today).sort((a,b)=>a.startDate.localeCompare(b.startDate))[0]||null;}
function v2NoActiveStatus(campaigns,now){
  const today=v2JstDate_(now),next=campaigns.filter(c=>!c.archived&&c.startDate&&c.startDate>today).sort((a,b)=>a.startDate.localeCompare(b.startDate))[0];
  return {ok:true,serverTime:v2Iso_(now),campaign:{id:'',name:next?next.name:'',target:7,active:false,status:next?'UPCOMING':'NONE',receptionOpen:false,nextBoundaryAt:next?new Date(next.startDate+'T00:00:00+09:00').toISOString():''},nextCampaign:next?{id:next.id,name:next.name,startDate:next.startDate}:null,card:null,campaignCards:[]};
}
function v2LastResult_(card){const h=v2Rows_('DailyHistory').filter(r=>String(r.campaignId)===String(card.campaignId)&&String(r.participantId)===String(card.participantId)).pop();return h?{eventId:String(h.eventId),face:Number(h.face),earned:Number(h.earned),total:Number(h.totalAfter)}:null;}
function v2NextBoundary_(c,now){const d=v2JstDate_(now);if(d<c.startDate)return new Date(c.startDate+'T00:00:00+09:00').toISOString();if(d<=c.endDate)return new Date(Date.parse(c.endDate+'T00:00:00+09:00')+86400000).toISOString();const next=v2Rows_('Campaigns').map(v2Campaign_).filter(x=>!x.archived&&x.startDate>d).sort((a,b)=>a.startDate.localeCompare(b.startDate))[0];return next?new Date(next.startDate+'T00:00:00+09:00').toISOString():'';}
function v2Roll_(req,p,active,now,day,trace){
  const id=String(req.campaignId||''),requestId=String(req.requestId||'');
  // Recover a committed event before checking whether its campaign is still active.
  if(requestId){const prior=v2Rows_('DailyHistory').find(x=>String(x.requestId)===requestId&&String(x.participantId)===String(p.participantId)&&String(x.campaignId)===id);if(prior)return v2Status_(p,id,active,now,trace);}
  if(!id||!active||id!==active.id)throw new Error(active?'CAMPAIGN_CONFIGURATION':'ENDED');
  const c=active,state=DiceV2.campaignState(c,now);if(!state.active)throw new Error(c.paused?'PAUSED':'ENDED');
  const card=v2Card_(id,p.participantId);if(!card)throw new Error('AUTH');
  if(String(card.state)!=='ACTIVE')throw new Error('NOT_ACHIEVED');if(String(card.todayKey)===day)throw new Error('ALREADY_PLAYED');
  const face=Math.floor(Math.random()*6)+1,earned=DiceV2.addPoints(c,face),total=Number(card.actualTotal)+earned,reached=total>=c.target,eventId=Utilities.getUuid();
  const history={eventId,campaignId:id,participantId:p.participantId,jstDate:day,face,earned,totalAfter:total,requestId:requestId||trace,createdAt:now};
  card.total=Math.min(c.target,total);card.actualTotal=total;card.state=reached?'ACHIEVED':'ACTIVE';card.todayKey=day;card.lastEventId=eventId;card.achievedAt=reached?now:'';card.updatedAt=now;
  if(reached&&c.confirmationEnabled){const code=String(Math.floor(100000+Math.random()*900000));card.confirmationHash=v2Hash_(code);card.confirmationCode=code;card.confirmationVersion=Number(card.confirmationVersion||0)+1;card.confirmationExpiresAt=new Date(v2CodeExpiry_(c,now));}
  v2AtomicWrite_([
    {name:'DailyHistory',obj:history,append:true},
    {name:'Cards',obj:card,keyFields:['campaignId','participantId']},
    {name:'ProcessLog',obj:{traceId:trace,action:'roll',stage:'DRAW_AND_CARD_COMMIT',result:'OK',reasonCode:'',eventId,storageState:'COMMITTED',createdAt:now},append:true}
  ]);
  const result=v2Status_(p,id,active,now,trace,false,card);result.card.lastResult={eventId,face,earned,total:card.total};return result;
}
