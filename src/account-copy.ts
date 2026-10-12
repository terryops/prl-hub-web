import localized from "./account-locales.json";
import type { Lang } from "./types.ts";
const en = {
  guestCheckout: "No sign-in needed. Pro works in this browser; link an email to restore your purchase.",
  purchaseLinkedElsewhere: "This browser’s purchase is saved to another email. You can still use Pro here; sign in with that email to use it on other devices.",
  guestPurchaseNote: "Buy without signing in. Pro works in this browser. Optionally link an email to use it on other devices and restore it after clearing site data.", guestPro: "Pro enabled in this browser", savePurchase: "Optional: save purchase to email",
  account: "Account", security: "Account security", email: "Email", code: "6-digit email code", send: "Send code", resend: "Resend code", verify: "Continue", login: "Sign in", logout: "Sign out",
  intro: "Sign in with your email to manage devices and purchases. Data sync requires Pro; free accounts keep data on this device. No password needed.", syncRequiresPro: "Data sync requires Pro. A free account keeps your data on this device only.",
  privacy: "Public addresses, contacts, alerts and preferences can sync. Wallet seed phrases, private keys and passwords stay on your device.",
  human: "Complete the verification to send your email code.", sent: "Code sent. Check your inbox and spam folder. Valid for 5 minutes.",
  humanError: "Verification could not finish. Check your connection and try again.", unavailable: "Email sign-in is temporarily unavailable. You can continue using local features.",
  invalid: "The code is invalid or expired. Check it or request another code.", limited: "Too many requests. Please wait before trying again.", failed: "Could not complete this action. Please try again.",
  devices: "Signed-in devices", current: "This device", notifications: "Notifications connected", rename: "Rename", revoke: "Sign out device", revokeConfirm: "Sign out this device and stop its notifications?",
  rights: "Purchases", noRights: "No linked purchase", proRights: "Pro", apple: "App Store", prl: "PRL payment", admin: "Granted", revoked: "Revoked",
  rightsNote: "App Store and PRL payments unlock the same Pro features. Sign in with the same email on Web and in apps to share your verified purchase.",
  change: "Change email", oldEmail: "Verify current email", newEmail: "Verify new email", saveEmail: "Save new email", changed: "Email updated. Other devices have been signed out.",
  export: "Export settings", remove: "Delete account", deleteConfirm: "Delete the account and cloud settings, and sign out every device? Payment records will be retained without your email. Local wallets will remain on this device.",
  deleted: "Account deleted", cancel: "Cancel", close: "Close", loading: "Loading…", syncNote: "Settings sync through your account. Cloud data is encrypted at rest; the server can read it to process alerts.",
  import: "Add this browser’s local settings to the account? Choose Cancel to use the account’s settings only.",
  authorize: "Connect device", authorizeNote: "Connect this device to your Pearl Hub account?", connected: "Connected", expired: "Your session has expired. Sign in again to resume sync.",
};
export type AccountCopy = typeof en;
const zh: AccountCopy = {
  guestCheckout: "无需登录，本浏览器可用；可选关联邮箱恢复购买。",
  purchaseLinkedElsewhere: "本浏览器的购买已关联到另一个邮箱。这里仍可使用高级版；跨设备使用请登录原邮箱。",
  guestPurchaseNote: "无需登录即可购买，本浏览器可用。可选关联邮箱，跨设备使用，并在清理网站数据后恢复购买。", guestPro: "当前浏览器已开通高级版", savePurchase: "可选：关联邮箱，保存购买权益",
  account: "账号", security: "账号安全", email: "邮箱", code: "6 位邮件验证码", send: "发送验证码", resend: "重新发送", verify: "继续", login: "邮箱登录", logout: "退出登录",
  intro: "用邮箱登录，可管理设备和关联购买权益，无需设置密码。数据同步需开通 Pro；免费账号的数据仅保存在本机。", syncRequiresPro: "数据同步是 Pro 专属权益。免费账号的数据仅保存在本机，不会同步到云端或其他设备。",
  privacy: "可同步公开地址、通讯录、提醒和偏好设置。钱包助记词、私钥和密码仅保存在设备上。",
  human: "请完成人机验证，随后会自动发送邮件验证码。", sent: "验证码已发送，请检查收件箱和垃圾箱，5 分钟内有效。",
  humanError: "人机验证未完成，请检查网络后重试。", unavailable: "邮箱登录暂时不可用，你仍可使用本地功能。",
  invalid: "验证码错误或已过期，请检查或重新获取。", limited: "请求较多，请稍后再试。", failed: "操作未完成，请重试。",
  devices: "已登录设备", current: "当前设备", notifications: "已连接通知", rename: "重命名", revoke: "退出此设备", revokeConfirm: "退出此设备，并停止它的通知？",
  rights: "购买权益", noRights: "暂无关联购买", proRights: "高级版", apple: "App Store", prl: "PRL 支付", admin: "已授予", revoked: "已撤销",
  rightsNote: "App Store 或 PRL 付款均可开通高级版。在网页与 App 中登录同一邮箱，即可共享已验证的购买权益。",
  change: "更换邮箱", oldEmail: "验证原邮箱", newEmail: "验证新邮箱", saveEmail: "保存新邮箱", changed: "邮箱已更新，其他设备已退出登录。",
  export: "导出配置", remove: "注销账号", deleteConfirm: "注销账号、删除云端配置并退出全部设备？支付记录会去除邮箱后保留，本地钱包仍保存在设备上。",
  deleted: "账号已注销", cancel: "取消", close: "关闭", loading: "加载中…", syncNote: "通过账号同步配置。云端数据加密存储，服务器会读取配置来处理提醒。",
  import: "要将当前浏览器的本地配置加入此账号吗？取消后只使用账号中的配置。",
  authorize: "连接设备", authorizeNote: "将此设备连接到你的 Pearl Hub 账号？", connected: "已连接", expired: "登录已过期，请重新登录后继续同步。",
};
const hant: AccountCopy = { ...zh, guestCheckout: "無需登入，本瀏覽器可用；可選關聯電子郵件恢復購買。", purchaseLinkedElsewhere: "本瀏覽器的購買已關聯到另一個電子郵件。這裡仍可使用進階版；跨裝置使用請登入原電子郵件。", guestPurchaseNote: "無需登入即可購買，本瀏覽器可用。可選關聯電子郵件，跨裝置使用，並在清除網站資料後恢復購買。", guestPro: "目前瀏覽器已開通進階版", savePurchase: "可選：關聯電子郵件，儲存購買權益", security: "帳號安全", account: "帳號", email: "電子郵件", code: "6 位郵件驗證碼", send: "傳送驗證碼", resend: "重新傳送", login: "電子郵件登入", logout: "登出", intro: "使用電子郵件登入，可管理裝置及關聯購買權益，無需設定密碼。資料同步需開通 Pro；免費帳號的資料僅保存在本機。", syncRequiresPro: "資料同步是 Pro 專屬權益。免費帳號的資料僅保存在本機，不會同步到雲端或其他裝置。", privacy: "可同步公開地址、通訊錄、提醒及偏好設定。錢包助記詞、私鑰及密碼僅保存在裝置上。", human: "請完成人機驗證，隨後會自動傳送郵件驗證碼。", sent: "驗證碼已傳送，請檢查收件匣及垃圾郵件，5 分鐘內有效。", humanError: "人機驗證未完成，請檢查網路後重試。", unavailable: "電子郵件登入暫時無法使用，你仍可使用本機功能。", invalid: "驗證碼錯誤或已過期，請檢查或重新取得。", devices: "已登入裝置", current: "目前裝置", notifications: "已連接通知", rename: "重新命名", revoke: "登出此裝置", revokeConfirm: "登出此裝置並停止通知？", rights: "購買權益", noRights: "尚無關聯購買", proRights: "進階版", prl: "PRL 付款", admin: "已授予", revoked: "已撤銷", rightsNote: "App Store 或 PRL 付款均可開通進階版。在網頁與 App 中登入同一電子郵件，即可共享已驗證的購買權益。", change: "更換電子郵件", oldEmail: "驗證原電子郵件", newEmail: "驗證新電子郵件", saveEmail: "儲存新電子郵件", changed: "電子郵件已更新，其他裝置已登出。", export: "匯出設定", remove: "刪除帳號", deleteConfirm: "刪除帳號、雲端設定並登出全部裝置？付款記錄會移除電子郵件後保留，本機錢包仍保存在裝置上。", deleted: "帳號已刪除", loading: "載入中…", syncNote: "透過帳號同步設定。雲端資料加密儲存，伺服器會讀取設定來處理提醒。", import: "要將目前瀏覽器的本機設定加入此帳號嗎？取消後只使用帳號中的設定。", authorize: "連接裝置", authorizeNote: "將此裝置連接到你的 Pearl Hub 帳號？", expired: "登入已過期，請重新登入以繼續同步。" };
export const accountCopy = (lang: Lang): AccountCopy => lang === "zh-Hans" ? zh : lang === "zh-Hant" ? hant : { ...en, ...(localized as Record<string, Partial<AccountCopy>>)[lang] };
