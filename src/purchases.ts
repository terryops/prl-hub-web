import { api, ApiError } from "./api.ts";
import { localPurchase, savePurchase, forgetPurchase } from "./purchase-key.ts";
export type PurchaseProfile = { purchase_id:string; purchase_key?:string; pro:boolean; linked:boolean };
let pending: Promise<PurchaseProfile> | undefined;
export async function restorePurchase(): Promise<PurchaseProfile|null> {
  if(!localPurchase())return null;
  try {return await api<PurchaseProfile>("/v1/purchase/session");}
  catch(e) {if(e instanceof ApiError&&e.status===401){forgetPurchase();return null;}throw e;}
}
export function ensurePurchase(device: Record<string,string>) {
  return pending ||= (async()=>{
    const existing=await restorePurchase();if(existing)return existing;
    const profile=await api<PurchaseProfile>("/v1/purchase/session","POST",device);
    if(!profile.purchase_key)throw new Error("purchase_storage");
    // Keep the receipt before requesting a payable order.
    savePurchase(profile.purchase_key,profile.purchase_id);return profile;
  })().finally(()=>{pending=undefined;});
}
export function associatePurchase(accountId:string) {
  return api<{linked:boolean;conflict?:boolean}>("/v1/purchase/associate","POST",{},accountId);
}
