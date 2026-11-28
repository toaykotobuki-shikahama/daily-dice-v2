/* Portable domain rules. Loaded before GAS adapters and directly tested in Node. */
var DiceV2 = (function(){
  const DAY=86400000, TZ='Asia/Tokyo';
  function fail(code){const e=new Error(code);e.code=code;throw e;}
  function dateKey(value){
    if(value instanceof Date) return Utilities.formatDate(value,TZ,'yyyy-MM-dd');
    const s=String(value||''); if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail('INVALID_DATE');
    const d=new Date(s+'T00:00:00+09:00'); if(!Number.isFinite(d.getTime())||Utilities.formatDate(d,TZ,'yyyy-MM-dd')!==s) fail('INVALID_DATE'); return s;
  }
  function dayStart(s){return Date.parse(dateKey(s)+'T00:00:00+09:00');}
  function campaignState(c,now){const t=now instanceof Date?now.getTime():Number(now), today=Utilities.formatDate(new Date(t),TZ,'yyyy-MM-dd');
    if(!c||!c.startDate)return {status:'NONE',active:false};
    if(today<c.startDate)return {status:'UPCOMING',active:false};
    if(today>c.endDate)return {status:'ENDED',active:false};
    if(c.paused)return {status:'PAUSED',active:false};
    return {status:'ACTIVE',active:true};
  }
  function validateCampaign(c){
    if(!c||!c.id||!String(c.name||'').trim())fail('INVALID_CAMPAIGN');
    const s=dateKey(c.startDate),e=dateKey(c.endDate),r=dateKey(c.receptionEndDate);
    if(s>e||e>r)fail('INVALID_DATE_ORDER');
    if(!Number.isInteger(Number(c.target))||c.target<1||c.target>30)fail('INVALID_TARGET');
    if(!Array.isArray(c.points)||c.points.length!==6||c.points.some(x=>!Number.isInteger(Number(x))||x<1||x>30))fail('INVALID_POINTS');
    return Object.assign({},c,{name:String(c.name).trim(),startDate:s,endDate:e,receptionEndDate:r,target:Number(c.target),points:c.points.map(Number),paused:!!c.paused});
  }
  function resolveCampaign(campaigns,now){const matches=campaigns.filter(c=>!c.archived&&dateKey(c.startDate)<=Utilities.formatDate(new Date(now),TZ,'yyyy-MM-dd')&&dateKey(c.endDate)>=Utilities.formatDate(new Date(now),TZ,'yyyy-MM-dd'));
    if(matches.length>1)fail('CAMPAIGN_AMBIGUOUS'); return matches[0]||null;}
  function validateNoOverlap(campaigns,next,excludeId){const a=dateKey(next.startDate),b=dateKey(next.endDate);for(const c of campaigns){if(c.id===excludeId||c.archived)continue;if(a<=dateKey(c.endDate)&&dateKey(c.startDate)<=b)fail('CAMPAIGN_OVERLAP');} }
  function addPoints(campaign,face){if(!Number.isInteger(face)||face<1||face>6)fail('INVALID_FACE');return Number(campaign.points[face-1]);}
  function newCard(campaignId,participantId){return {campaignId,participantId,total:0,actualTotal:0,state:'ACTIVE',todayKey:'',lastEventId:'',achievedAt:'',completedAt:''};}
  function canReception(campaign,card,codeValid,now){const d=Utilities.formatDate(new Date(now),TZ,'yyyy-MM-dd');return !!campaign.confirmationEnabled&&card.state==='ACHIEVED'&&d<=dateKey(campaign.receptionEndDate)&&!!codeValid;}
  function nextJstMidnight(now){const d=now instanceof Date?now.getTime():Number(now),today=Utilities.formatDate(new Date(d),TZ,'yyyy-MM-dd');return new Date(dayStart(today)+DAY).toISOString();}
  function confirmationCodeExpiry(receptionEndDate,now){const t=now instanceof Date?now.getTime():Number(now),cutoff=dayStart(receptionEndDate)+DAY;return Math.min(t+15*60*1000,cutoff);}
  function confirmationNeedsRenewal(campaign,card,now){const t=now instanceof Date?now.getTime():Number(now);return !!campaign.confirmationEnabled&&card.state==='ACHIEVED'&&t<dayStart(campaign.receptionEndDate)+DAY&&(!card.confirmationCode||!card.confirmationExpiresAt||new Date(card.confirmationExpiresAt).getTime()<=t);}
  return {DAY,TZ,dateKey,dayStart,campaignState,validateCampaign,resolveCampaign,validateNoOverlap,addPoints,newCard,canReception,nextJstMidnight,confirmationCodeExpiry,confirmationNeedsRenewal};
})();
