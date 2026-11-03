// 设置 → 交易（SafeTrade）: the API key pair (iOS SafeTradeSettingsSection.swift), and 如何获取 API 密钥
// (SafeTradeKeyGuide.swift). The pair is checked against SafeTrade before it's saved, then kept by the shell
// in the Android Keystore; the page only ever sees the masked key again.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./trade-icons.tsx";
import { clearKeys, keyStatus, publicIP, saveKeys, verifyCredentials } from "./safetrade-client.ts";
import { cleanCredential, isCredential, type Tr } from "./safetrade.ts";
import { CopyButton, InfoTip, Spinner } from "./TradeUI.tsx";

type Message = { text: string; warning: boolean; id: number };

/** Whether a key is saved; null when the shell doesn't answer after a few tries. */
async function readStatus() {
  for (let i = 0; i < 3; i++) {
    try { return await keyStatus(); } catch { await new Promise((r) => setTimeout(r, 800)); }
  }
  return null;
}

export function KeySettings({ tr, onGuide, onChanged }: { tr: Tr; onGuide: () => void; onChanged?: () => void }) {
  const [masked, setMasked] = useState<string | null | undefined>(undefined);
  const [key, setKey] = useState(""), [secret, setSecret] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => { void readStatus().then((k) => setMasked(k?.set ? k.masked : null)); return () => clearTimeout(timer.current); }, []);
  // Warnings are actionable, so they stay longer; a success goes quickly.
  const flash = (text: string, warning = false, sticky = false) => {
    const m = { text, warning, id: Date.now() };
    setMessage(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage((x) => x?.id === m.id ? null : x), sticky ? 10000 : 3000);
  };
  const clear = async () => {
    try { await clearKeys(); } catch { /* Read back below. */ }
    const k = await readStatus();
    if (k) setMasked(k.set ? k.masked : null);
    if (k && !k.set) flash(tr("已清除"));
    onChanged?.();
  };
  // Saved even when the check fails (the IP may simply not be whitelisted yet, which is fixed on SafeTrade's
  // side), with a warning that says why.
  const save = async () => {
    const k = cleanCredential(key), sc = cleanCredential(secret);
    if (!isCredential(k) || !isCredential(sc)) { flash(tr("API Key 或 Secret 里有不该有的字符，请从 SafeTrade 重新复制"), true, true); return; }
    setVerifying(true); setMessage(null);
    const check = await verifyCredentials(k, sc);
    let saved: string | null = null;
    try { saved = await saveKeys(k, sc); } catch { saved = null; }
    setKey(""); setSecret(""); setVerifying(false);
    const status = await readStatus();
    setMasked(status ? (status.set ? status.masked : null) : saved);
    onChanged?.();
    if (!saved) { flash(tr("无法保存到本机的 Android 密钥库"), true); return; }
    if (check.kind === "ok") flash(tr("已保存并通过验证"));
    else if (check.kind === "rejected" && check.problem.kind === "untrustedIP") flash(tr("已保存，但当前网络的 IP 不在这把密钥的 Trusted IPs 里。到交易页查看 SafeTrade 看到的 IP（可能是 IPv6 地址），把它加进白名单。"), true, true);
    else if (check.kind === "rejected" && check.problem.kind === "clock") flash(tr("已保存，但验证未通过：本机时间和 SafeTrade 相差太多，请打开「自动设置时间」。"), true, true);
    else if (check.kind === "rejected" && check.problem.kind === "firewall") flash(tr("已保存，但请求被 SafeTrade 的防火墙拦截（网络或代理），换个网络后在交易页确认。"), true, true);
    else if (check.kind === "rejected") flash(tr("已保存，但验证未通过：API Key/Secret 可能不正确，或当前 IP 未加入白名单。请在 SafeTrade 后台核对密钥，并为此网络的 IP 开通访问权限。"), true, true);
    else if (check.kind === "serverError") flash(tr("已保存，但交易所返回错误（HTTP {0}）。请稍后在交易页重试。", String(check.status)), true, true);
    else flash(tr("已保存，但暂时无法连接 SafeTrade（网络问题）。请检查网络后在交易页确认。"), true, true);
  };
  return <section className="android-group">
    <h2 className="trade-group-title">{tr("SafeTrade API 密钥")}<InfoTip label={tr("SafeTrade API 密钥")} text={tr("API 密钥用 Android 密钥库加密，只存在这台设备上：不进备份，也不同步到其他设备；助记词同样只在本机。")} /></h2>
    <div className="card android-card trade-keys">
      {masked === undefined ? <div className="trade-keys-body"><Spinner /></div> : masked ? <>
        <div className="android-row"><span className="android-row-label">{tr("当前 Key")}</span><span className="android-row-value">{masked}</span></div>
        <div className="android-row"><span className="android-row-label">{tr("当前 Secret")}</span><span className="android-row-value">{tr("已设置 ✓")}</span></div>
        <button type="button" className="android-row danger" onClick={() => void clear()}><span className="android-row-label">{tr("清除密钥")}</span></button>
      </> : <form className="trade-keys-body" onSubmit={(e) => { e.preventDefault(); if (key && secret && !verifying) void save(); }}>
        <input type="password" placeholder="API Key" aria-label="SafeTrade API Key" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} />
        <input type="password" placeholder="API Secret" aria-label="SafeTrade API Secret" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={secret} onChange={(e) => setSecret(e.target.value)} />
        <button className="primary wide" disabled={!key || !secret || verifying}>{verifying ? <><Spinner />{tr("验证中…")}</> : tr("保存密钥")}</button>
      </form>}
      {message && <p className={message.warning ? "trade-line trade-warn trade-keys-message" : "trade-line trade-ok trade-keys-message"} role="status"><Icon name={message.warning ? "warning" : "check"} /><span>{message.text}</span></p>}
      <button type="button" className="android-row" onClick={onGuide}><span className="android-row-icon"><Icon name="help" /></span><span className="android-row-label">{tr("如何获取 API 密钥")}</span><Icon name="chevron" className="android-row-chevron" /></button>
    </div>
  </section>;
}

/** Creating a SafeTrade API key for the app, step by step, with the IP SafeTrade sees ready to paste. */
export function KeyGuide({ tr }: { tr: Tr }) {
  const [ip, setIP] = useState<string | null>(null), [failed, setFailed] = useState(false);
  const lookUp = () => { setFailed(false); void publicIP().then(setIP, () => setFailed(true)); };
  useEffect(lookUp, []);
  const step = (n: number, title: string, text: string, extra?: ReactNode, info?: string) => <div className="trade-step">
    <span className="trade-step-n">{n}</span>
    <div><span className="trade-step-title"><strong>{title}</strong>{info && <InfoTip label={title} text={info} />}</span><p>{text}</p>{extra}</div>
  </div>;
  // What the app does with the key, as the code behaves on Android.
  const handling = [tr("API Key 和 Secret 只存在这台设备上（用 Android 密钥库加密），不会上传到我们的服务器。"),
    tr("App 直接连接 safetrade.com，中间不经过我们或任何第三方。Secret 只在你的设备上用来给请求签名，本身从不发送出去。"),
    tr("每次提现前都要通过设备验证（指纹、人脸或锁屏密码）。")].join("\n\n");
  return <div className="trade-guide">
    <section className="card trade-card trade-steps">
      {step(1, tr("开启谷歌验证"), tr("登录 safetrade.com。创建 API 密钥需要谷歌验证（2FA），还没开的话先在账户安全设置里开启。"))}
      {step(2, tr("打开 API Keys 页面"), tr("在 SafeTrade 顶部菜单点「API」，或直接打开 safetrade.com/my/api，然后点「Create」。"),
        <a className="trade-link" href="https://safetrade.com/my/api" target="_blank" rel="noreferrer"><Icon name="external" />{tr("打开 SafeTrade API 页面")}</a>)}
      {step(3, tr("设置权限"), tr("Label 随便填（例如 Pearl Hub）。Restrictions 里勾选 Enable Reading 和 Enable Trading；只有要在 App 里提现时才勾 Enable Withdraw。"))}
      {step(4, tr("填写 Trusted IPs"), tr("SafeTrade 只接受这里列出的 IP。填入 SafeTrade 现在看到的你的 IP："),
        <div className="trade-ip trade-ip-box">{ip ? <><code>{ip}</code><CopyButton value={ip} tr={tr} /></>
          : failed ? <><span className="trade-warn-text">{tr("暂时查不到当前 IP，请稍后再试。")}</span><button type="button" className="text-button" onClick={lookUp}>{tr("重试")}</button></>
          : <Spinner label={tr("正在查询…")} />}</div>,
        tr("多个 IP 用空格隔开，IPv4 和 IPv6 都可以，最多 20 个。手机可能时而用 IPv4、时而用 IPv6，换网络后 IP 也会变——以后交易页提示 IP 不在白名单时，把它显示的新 IP 补进来即可。"))}
      {step(5, tr("保存 API Key 和 Secret"), tr("输入谷歌验证码确认后，页面会显示 API Key 和 API Secret。Secret 只显示这一次，请立刻复制。"))}
      {step(6, tr("填进 App"), tr("回到「设置 → 交易（SafeTrade）」，粘贴 API Key 和 API Secret 并保存，App 会马上验证能否使用。"))}
    </section>
    <section className="card trade-card">
      <div className="trade-title-row trade-safe"><Icon name="shield" /><strong>{tr("安全说明")}</strong>
        <InfoTip label={tr("安全说明")} text={[tr("建议只开需要的权限，并绑定 IP。不要把 API Key 或 Secret 告诉任何人，包括自称客服的人。"), handling].join("\n\n")} /></div>
    </section>
  </div>;
}
