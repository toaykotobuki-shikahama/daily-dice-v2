'use strict';
window.diceHex = bytes => [...crypto.getRandomValues(new Uint8Array(bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
class DiceTransport {
 constructor(config){this.config=config;this.pending=new Map();this.listener=e=>this.receive(e);window.addEventListener('message',this.listener);}
 async connect(){if(this.peer)return;if(this.connecting)return this.connecting;
 this.connecting=new Promise((resolve,reject)=>{this.nonce=diceHex(16);this.resolveReady=resolve;this.rejectReady=reject;
 const url=new URL(this.config.gasUrl);if(url.origin!=='https://script.google.com'||!/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname)){reject(new Error('CONFIG'));return;}
 url.searchParams.set('nonce',this.nonce);this.frame=document.createElement('iframe');this.frame.className='bridge-frame';this.frame.title='参加状況通信';this.frame.referrerPolicy='no-referrer';this.frame.src=url.href;document.body.append(this.frame);
 this.readyTimer=setTimeout(()=>reject(new Error('BRIDGE_TIMEOUT')),this.config.timeoutMs);
 }).catch(e=>{this.reset();throw e;});return this.connecting;}
 receive(e){const m=e.data;if(!m||m.nonce!==this.nonce)return;
 // GAS HtmlService runs inside a nested frame. Pin its WindowProxy on the nonce handshake.
 if(!/^https:\/\/(?:[a-z0-9-]+-)?script\.googleusercontent\.com$/.test(e.origin))return;
 if(m.kind==='dice-ready'&&!this.peer){this.peer=e.source;this.origin=e.origin;clearTimeout(this.readyTimer);this.resolveReady();return;}
 if(e.source!==this.peer||e.origin!==this.origin||m.kind!=='dice-response')return;
 const p=this.pending.get(m.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(m.id);p.resolve(m.result);}
 async request(request){await this.connect();const id=diceHex(16);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('REQUEST_TIMEOUT'));},this.config.timeoutMs);this.pending.set(id,{resolve,reject,timer});this.peer.postMessage({kind:'dice-request',nonce:this.nonce,id,request},this.origin);});}
 reset(){clearTimeout(this.readyTimer);this.frame?.remove();this.peer=null;this.origin=null;this.connecting=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('BRIDGE_RESET'));}this.pending.clear();}
}
window.DiceTransport=DiceTransport;
