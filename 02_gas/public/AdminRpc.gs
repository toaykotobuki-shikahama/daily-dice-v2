/** All writes to the V2 operational DB are serialized in this one public GAS project. */
function v2AdminRpc_(request){
  let verified=false;
  try{
    v2VerifyAdminRpc_(request);verified=true;
    return v2WithLock_(()=>{
      const cache=CacheService.getScriptCache(),cacheKey='admin-rpc:'+request.nonce;
      if(cache.get(cacheKey))throw new Error('RPC_REPLAY');cache.put(cacheKey,'1',600);
      const p=request.payload||{},actor=String(request.actor||'');
      if(!actor||actor.length>254)throw new Error('RPC_ACTOR_INVALID');
      switch(request.action){
        case 'saveCampaign': return v2AdminSaveCampaign_(p,actor,request.operationId);
        case 'duplicateCampaign': return v2AdminDuplicateCampaign_(p.id,actor,request.operationId);
        case 'setPaused': return v2AdminSetPaused_(p.id,p.paused,actor,request.operationId);
        case 'staffComplete': return v2AdminStaffComplete_(p,actor,request.operationId);
        case 'refreshDashboard': return v2AdminRefreshDashboard_(actor,request.operationId);
        default: throw new Error('RPC_ACTION_INVALID');
      }
    });
  }catch(e){const reason=String(e.message||'RPC_ERROR').split(':')[0];if(verified&&reason!=='BUSY_RETRY')v2Log_(request&&request.operationId||Utilities.getUuid(),'adminRpc',request&&request.action||'unknown','REJECTED',reason,'','UNKNOWN');return {ok:false,error:reason};}
}
function v2VerifyAdminRpc_(r){
  const secret=PropertiesService.getScriptProperties().getProperty('ADMIN_RPC_SECRET');if(!secret||secret.length<64)throw new Error('RPC_NOT_CONFIGURED');
  if(!r||!r.signature||!r.nonce||!/^[-a-f0-9]{36}$/i.test(r.nonce)||Math.abs(Date.now()-Number(r.issuedAt))>300000)throw new Error('RPC_AUTH');
  const canonical=JSON.stringify({action:r.action,actor:r.actor,operationId:r.operationId,issuedAt:r.issuedAt,nonce:r.nonce,payload:r.payload});
  const expected=Utilities.computeHmacSha256Signature(canonical,secret).map(b=>(b<0?b+256:b).toString(16).padStart(2,'0')).join('');
  const actual=String(r.signature);if(canonical.length>20000)throw new Error('RPC_SIZE');if(expected.length!==actual.length)throw new Error('RPC_AUTH');let mismatch=0;for(let i=0;i<expected.length;i++)mismatch|=expected.charCodeAt(i)^actual.charCodeAt(i);if(mismatch)throw new Error('RPC_AUTH');
}
function v2AdminReplay_(operationId,actions){const row=v2Rows_('AuditLog').find(x=>String(x.operationId)===String(operationId)&&actions.includes(String(x.action)));return row?JSON.parse(row.afterJson||'{}'):null;}
function v2AdminSaveCampaign_(input,actor,operationId){
  const replay=v2AdminReplay_(operationId,['CREATE','UPDATE']);if(replay)return {ok:true,campaign:replay,replayed:true};
  const now=new Date(),existing=input.id?v2FindCampaign_(input.id):null;if(existing&&Number(input.version)!==Number(existing.version))throw new Error('VERSION_CONFLICT');
  const id=existing?String(existing.id):(input.id&&String(input.id).startsWith('DICE-')?String(input.id):'DICE-'+Utilities.getUuid().slice(0,8).toUpperCase());
  if(!existing&&v2FindCampaign_(id))throw new Error('ID_CONFLICT');
  const c=DiceV2.validateCampaign({id,name:input.name,startDate:input.startDate,endDate:input.endDate,receptionEndDate:input.receptionEndDate,target:Number(input.target),points:input.points.map(Number),confirmationEnabled:!!input.confirmationEnabled,paused:existing?existing.paused:false,archived:false});
  const rows=v2Rows_('Campaigns').map(v2Campaign_);DiceV2.validateNoOverlap(rows,c,existing&&existing.id);
  let before='';if(existing){const prev=v2Campaign_(existing),started=v2JstDate_(now)>=prev.startDate,hasActivity=v2Rows_('DailyHistory').some(x=>String(x.campaignId)===prev.id)||v2Rows_('Cards').some(x=>String(x.campaignId)===prev.id);if(started||hasActivity){if(c.id!==prev.id||c.startDate!==prev.startDate||c.target!==prev.target||JSON.stringify(c.points)!==JSON.stringify(prev.points))throw new Error('LOCKED_SETTING');if(c.name!==prev.name||c.confirmationEnabled!==prev.confirmationEnabled)throw new Error('R06_APPROVAL_REQUIRED');if(c.endDate<prev.endDate||c.receptionEndDate<prev.receptionEndDate)throw new Error('R06_APPROVAL_REQUIRED');const history=v2Rows_('DailyHistory').filter(x=>String(x.campaignId)===prev.id),confirms=v2Rows_('StaffConfirmLog').filter(x=>String(x.campaignId)===prev.id&&String(x.status)==='SUCCESS');if(history.some(x=>String(x.jstDate)>c.endDate)||confirms.some(x=>v2JstDate_(new Date(x.createdAt))>c.receptionEndDate))throw new Error('DATE_CONFLICT');}c.version=prev.version+1;before=JSON.stringify(prev);
  }else c.version=1;
  const row={id:c.id,name:c.name,startDate:c.startDate,endDate:c.endDate,receptionEndDate:c.receptionEndDate,target:c.target,pointsJson:JSON.stringify(c.points),confirmationEnabled:c.confirmationEnabled,paused:c.paused,archived:false,version:c.version,createdAt:existing?existing.createdAt:now,updatedAt:now};
  v2AtomicWrite_([{name:'Campaigns',obj:row,keyFields:['id'],append:!existing},{name:'AuditLog',obj:{operationId,actor,campaignId:c.id,action:existing?'UPDATE':'CREATE',beforeJson:before,afterJson:JSON.stringify(c),version:c.version,createdAt:now},append:true}]);
  return {ok:true,campaign:c};
}
function v2AdminDuplicateCampaign_(id,actor,operationId){
  const replay=v2AdminReplay_(operationId,['DUPLICATE_DRAFT']);if(replay)return {ok:true,campaign:replay,replayed:true};
  const old=v2FindCampaign_(id);if(!old)throw new Error('NOT_FOUND');const c=v2Campaign_(old),draft={id:'DICE-'+Utilities.getUuid().slice(0,8).toUpperCase(),name:c.name,startDate:'',endDate:'',receptionEndDate:'',target:c.target,points:c.points,confirmationEnabled:c.confirmationEnabled,paused:false,version:0};
  v2AtomicWrite_([{name:'AuditLog',obj:{operationId,actor,campaignId:draft.id,action:'DUPLICATE_DRAFT',beforeJson:JSON.stringify({sourceId:id}),afterJson:JSON.stringify(draft),version:0,createdAt:new Date()},append:true}]);return {ok:true,campaign:draft};
}
function v2AdminSetPaused_(id,paused,actor,operationId){
  const replay=v2AdminReplay_(operationId,['PAUSE','RESUME']);if(replay)return {ok:true,campaign:replay,replayed:true};
  const row=v2FindCampaign_(id);if(!row)throw new Error('NOT_FOUND');const c=v2Campaign_(row),now=new Date(),day=v2JstDate_(now);if(day<c.startDate||day>c.endDate)throw new Error('OUTSIDE_PERIOD');const next=Object.assign({},c,{paused:!!paused,version:c.version+1});
  const store=Object.assign({},row,{paused:!!paused,version:next.version,updatedAt:now});v2AtomicWrite_([{name:'Campaigns',obj:store,keyFields:['id']},{name:'AuditLog',obj:{operationId,actor,campaignId:id,action:paused?'PAUSE':'RESUME',beforeJson:JSON.stringify(c),afterJson:JSON.stringify(next),version:next.version,createdAt:now},append:true}]);return {ok:true,campaign:next};
}
function v2AdminStaffComplete_(p,actor,operationId){
  const prior=v2Rows_('StaffConfirmLog').find(x=>String(x.operationId)===String(operationId)&&String(x.status)==='SUCCESS');if(prior)return {ok:true,completed:true,replayed:true};
  const card=v2Card_(p.campaignId,p.participantId),campaignRow=v2FindCampaign_(p.campaignId);if(!card||!campaignRow)throw new Error('NOT_FOUND');const c=v2Campaign_(campaignRow),now=new Date(),name=String(p.staffName||'').trim();if(!name||name.length>40||/[\r\n]/.test(name))throw new Error('INVALID_STAFF_NAME');
  // State first, so a completed card reports ALREADY_COMPLETED instead of CONFIRMATION_CLOSED.
  if(String(card.state)==='COMPLETED')throw new Error('ALREADY_COMPLETED');if(String(card.state)!=='ACHIEVED')throw new Error('NOT_ACHIEVED');
  if(!DiceV2.canReception(c,card,true,now.getTime())||new Date(card.confirmationExpiresAt).getTime()<now.getTime())throw new Error('CONFIRMATION_CLOSED');if(v2Hash_(String(p.code||'').replace(/\D/g,''))!==String(card.confirmationHash))throw new Error('CODE_INVALID');
  card.state='COMPLETED';card.completedAt=now;card.updatedAt=now;v2AtomicWrite_([{name:'Cards',obj:card,keyFields:['campaignId','participantId']},{name:'StaffConfirmLog',obj:{operationId,campaignId:p.campaignId,participantId:p.participantId,staffEmail:actor,staffName:name,status:'SUCCESS',createdAt:now},append:true},{name:'ProcessLog',obj:{traceId:operationId,action:'staffComplete',stage:'CARD_AND_LOG_COMMIT',result:'OK',reasonCode:'',eventId:String(card.lastEventId||''),storageState:'COMMITTED',createdAt:now},append:true}]);return {ok:true,completed:true};
}
