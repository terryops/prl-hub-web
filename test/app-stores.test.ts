import test from "node:test";
import assert from "node:assert/strict";
import { appStoreURL, playStoreURL, downloadLink, storeFor } from "../src/app-stores.ts";

test("the App page QR code sends each phone to its own store", () => {
  assert.equal(downloadLink, "https://pearlhub.net/#download");
  const ua = {
    iPhone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
    iPadOld: "Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1",
    wechatIPhone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50",
    pixel: "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
    samsung: "Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
    mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  };
  assert.equal(storeFor(ua.iPhone), appStoreURL);
  assert.equal(storeFor(ua.iPadOld), appStoreURL);
  assert.equal(storeFor(ua.wechatIPhone), appStoreURL);
  assert.equal(storeFor(ua.pixel), playStoreURL);
  assert.equal(storeFor(ua.samsung), playStoreURL);
  // iPadOS 13+ Safari sends the Mac user agent; the touch screen gives it away.
  assert.equal(storeFor(ua.mac, 5), appStoreURL);
  // A computer that opens the link gets the App page.
  assert.equal(storeFor(ua.mac, 0), null);
  assert.equal(storeFor(ua.windows, 0), null);
});
