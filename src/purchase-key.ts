// A device-only purchase capability. It cannot authenticate an email account or
// read cloud configuration, and never appears in URLs or exported settings.
const KEY = "prl.web.purchase";
type LocalPurchase = { key:string; id:string; token?:string };
export function localPurchase(): LocalPurchase | null {
  try {
    const data=JSON.parse(localStorage.getItem(KEY)||"null");
    return data && /^[A-Za-z0-9_-]{43}$/.test(data.key||"") && /^g_[a-f0-9]{64}$/.test(data.id||"") ? data : null;
  } catch {return null;}
}
export function purchaseHeaders(): Record<string,string> {
  const data=localPurchase();return data?{"X-Purchase-Key":data.key}:{};
}
export function savePurchase(key:string,id:string) {
  if(!/^[A-Za-z0-9_-]{43}$/.test(key)||!/^g_[a-f0-9]{64}$/.test(id))throw new Error("purchase_storage");
  localStorage.setItem(KEY,JSON.stringify({key,id}));
  if(localPurchase()?.key!==key)throw new Error("purchase_storage");
}
export function rememberPurchaseToken(token:string) {
  const data=localPurchase();if(data)localStorage.setItem(KEY,JSON.stringify({...data,token}));
}
export function forgetPurchase() {localStorage.removeItem(KEY);}
