import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {ensurePurchase,restorePurchase} from '../src/purchases.ts';
import {savePurchase,localPurchase} from '../src/purchase-key.ts';
import {api} from '../src/api.ts';
import {defaults,configOf,writeStore} from '../src/store.ts';
const fetchBefore=globalThis.fetch,storageBefore=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
const memory=new Map<string,string>(),key='x'.repeat(43),id='g_'+'a'.repeat(64);
beforeEach(()=>{memory.clear();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>memory.get(k)||null,setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k)}});});
afterEach(()=>{globalThis.fetch=fetchBefore;if(storageBefore)Object.defineProperty(globalThis,'localStorage',storageBefore);else Reflect.deleteProperty(globalThis,'localStorage');});
test('purchase capability stays separate from exported, synced and account settings',async()=>{
 savePurchase(key,id);const state=defaults();state.accountId='u_email';writeStore(state);
 const exported=JSON.stringify(configOf(state));assert.ok(!exported.includes(key)&&!exported.includes(id));
 assert.equal(JSON.parse(memory.get('prl.web.v1.account.u_email')!).key,undefined);
 let request:RequestInit|undefined;
 globalThis.fetch=async(_url,init)=>{request=init;return Response.json({ok:true});};
 await api('/v1/me','GET',undefined,state.accountId);
 assert.equal((request!.headers as Record<string,string>)['X-Purchase-Key'],key);
 assert.equal((request!.headers as Record<string,string>)['X-Account-ID'],state.accountId);
 assert.equal(request!.credentials,'same-origin');
});
test('checkout preparation fails when the browser cannot save its purchase credential',async()=>{
 localStorage.setItem=()=>{throw new Error('storage blocked');};
 globalThis.fetch=async()=>Response.json({purchase_id:id,purchase_key:key,pro:false});
 await assert.rejects(ensurePurchase({device_id:'browser-device-0001'}),/storage blocked/);
 assert.equal(localPurchase(),null,'no payable order can be requested by a successful preparation');
});
test('a temporarily unavailable purchase is kept for recovery; a revoked credential is discarded',async()=>{
 savePurchase(key,id);globalThis.fetch=async()=>Response.json({error:'upstream'},{status:503});
 await assert.rejects(restorePurchase(),/upstream/);assert.equal(localPurchase()?.key,key);
 globalThis.fetch=async()=>Response.json({error:'unauthorized'},{status:401});
 assert.equal(await restorePurchase(),null);assert.equal(localPurchase(),null);
});
