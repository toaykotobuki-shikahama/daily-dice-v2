/* Shared unchanged rules; helpers are private in both GAS projects. */
function diceRules_(read32,points,total,target){let n;do{n=read32();}while(n>=4294967292);const face=n%6+1,earned=Number(points[face-1]);return {face,earned,actualTotal:Number(total)+earned,cappedTotal:Math.min(Number(target),Number(total)+earned)};}
function diceStaffName_(value){const name=String(value||'').trim();if(!name||name.length>50||/[\r\n]/.test(name))throw Error('確認担当者名を1～50文字で入力してください');return name;}
