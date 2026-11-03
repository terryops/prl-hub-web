// The native apps' store pages, and the one link the App page's QR code holds: a phone that scans it
// goes on to its own store, anything else lands on the App page.
export const appStoreURL = "https://apps.apple.com/app/id6777132941";
export const macStoreURL = `${appStoreURL}?platform=mac`;
export const playStoreURL = "https://play.google.com/store/apps/details?id=com.prl.wizard";
export const downloadHash = "#download";
export const downloadLink = `https://pearlhub.net/${downloadHash}`;

export function storeFor(userAgent: string, touchPoints = 0): string | null {
  if (/Android/i.test(userAgent)) return playStoreURL;
  if (/iPhone|iPad|iPod/.test(userAgent)) return appStoreURL;
  // iPadOS Safari presents itself as a Mac; only its touch screen tells them apart.
  if (/Macintosh/.test(userAgent) && touchPoints > 1) return appStoreURL;
  return null;
}
