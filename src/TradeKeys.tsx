// 设置 → 交易: SafeTrade & Gate API key management (iOS SafeTradeSettingsSection / GateSettingsSection)
// and 如何获取 API 密钥 (SafeTradeKeyGuide / GateKeyGuide). Keys are encrypted in the Android Keystore;
// the page only ever sees the masked key once saved.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./trade-icons.tsx";
import * as stClient from "./safetrade-client.ts";
import * as gateClient from "./gate-client.ts";
import { GATE_API_KEYS_URL } from "./gate.ts";
import { cleanCredential, EXCHANGE_LABELS, isCredential, type Tr, type TradeExchange } from "./safetrade.ts";
import { CopyButton, InfoTip, Spinner } from "./TradeUI.tsx";

type Message = { text: string; warning: boolean; id: number };

async function readStatus(exchange: TradeExchange) {
  const fn = exchange === "gate" ? gateClient.keyStatus : stClient.keyStatus;
  for (let i = 0; i < 3; i++) {
    try { return await fn(); } catch { await new Promise((r) => setTimeout(r, 800)); }
  }
  return null;
}

export function KeySettings({
  tr,
  exchange = "safetrade",
  onGuide,
  onSaved,
  onChanged,
}: {
  tr: Tr;
  exchange?: TradeExchange;
  onGuide: () => void;
  onSaved?: (exchange: TradeExchange) => void;
  onChanged?: () => void;
}) {
  const isGate = exchange === "gate";
  const client = isGate ? gateClient : stClient;
  const [masked, setMasked] = useState<string | null | undefined>(undefined);
  const [key, setKey] = useState(""), [secret, setSecret] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    setMasked(undefined);
    void readStatus(exchange).then((k) => setMasked(k?.set ? k.masked : null));
    return () => clearTimeout(timer.current);
  }, [exchange]);

  const flash = (text: string, warning = false, sticky = false) => {
    const m = { text, warning, id: Date.now() };
    setMessage(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage((x) => x?.id === m.id ? null : x), sticky ? 10000 : 3000);
  };
  const clear = async () => {
    try { await client.clearKeys(); } catch { /* Read back below. */ }
    const k = await readStatus(exchange);
    if (k) setMasked(k.set ? k.masked : null);
    if (k && !k.set) flash(tr("已清除"));
    onChanged?.();
  };
  const save = async () => {
    const k = cleanCredential(key), sc = cleanCredential(secret);
    if (!isCredential(k) || !isCredential(sc)) {
      flash(isGate ? tr("API Key 或 Secret 里有不该有的字符，请从 Gate 重新复制") : tr("API Key 或 Secret 里有不该有的字符，请从 SafeTrade 重新复制"), true, true);
      return;
    }
    setVerifying(true); setMessage(null);
    const check = await client.verifyCredentials(k, sc);
    let saved: string | null = null;
    try { saved = await client.saveKeys(k, sc); } catch { saved = null; }
    setKey(""); setSecret(""); setVerifying(false);
    const status = await readStatus(exchange);
    setMasked(status ? (status.set ? status.masked : null) : saved);
    if (saved) onSaved?.(exchange);
    onChanged?.();
    if (!saved) { flash(tr("无法保存到本机的 Android 密钥库"), true); return; }
    if (check.kind === "ok") { flash(tr("已保存并通过验证")); return; }
    if (isGate) {
      if (check.kind === "rejected" && check.problem.kind === "untrustedIP") flash(tr("已保存，但当前网络的 IP 不在这把密钥的白名单里。到交易页查看当前 IP（可能是 IPv6 地址），把它加进 Gate 白名单。"), true, true);
      else if (check.kind === "rejected" && check.problem.kind === "clock") flash(tr("已保存，但验证未通过：本机时间和 Gate 相差太多，请打开「自动设置时间」。"), true, true);
      else if (check.kind === "rejected" && check.problem.kind === "firewall") flash(tr("已保存，但请求被 Gate 的防火墙拦截（网络或代理），换个网络后在交易页确认。"), true, true);
      else if (check.kind === "rejected") flash(tr("已保存，但验证未通过：API Key/Secret 可能不正确，或未开启现货/只读权限。请在 Gate 后台核对密钥权限与 IP 白名单。"), true, true);
      else if (check.kind === "serverError") flash(tr("已保存，但交易所返回错误（HTTP {0}）。请稍后在交易页重试。", String(check.status)), true, true);
      else flash(tr("已保存，但暂时无法连接 Gate（网络问题）。请检查网络后在交易页确认。"), true, true);
    } else {
      if (check.kind === "rejected" && check.problem.kind === "untrustedIP") flash(tr("已保存，但当前网络的 IP 不在这把密钥的 Trusted IPs 里。到交易页查看 SafeTrade 看到的 IP（可能是 IPv6 地址），把它加进白名单。"), true, true);
      else if (check.kind === "rejected" && check.problem.kind === "clock") flash(tr("已保存，但验证未通过：本机时间和 SafeTrade 相差太多，请打开「自动设置时间」。"), true, true);
      else if (check.kind === "rejected" && check.problem.kind === "firewall") flash(tr("已保存，但请求被 SafeTrade 的防火墙拦截（网络或代理），换个网络后在交易页确认。"), true, true);
      else if (check.kind === "rejected") flash(tr("已保存，但验证未通过：API Key/Secret 可能不正确，或当前 IP 未加入白名单。请在 SafeTrade 后台核对密钥，并为此网络的 IP 开通访问权限。"), true, true);
      else if (check.kind === "serverError") flash(tr("已保存，但交易所返回错误（HTTP {0}）。请稍后在交易页重试。", String(check.status)), true, true);
      else flash(tr("已保存，但暂时无法连接 SafeTrade（网络问题）。请检查网络后在交易页确认。"), true, true);
    }
  };
  const title = isGate ? tr("Gate API 密钥") : tr("SafeTrade API 密钥");
  return <section className="android-group">
    <h2 className="trade-group-title">{title}<InfoTip label={title} text={tr("API 密钥用 Android 密钥库加密，只存在这台设备上：不进备份，也不同步到其他设备；助记词同样只在本机。")} /></h2>
    <div className="card android-card trade-keys">
      {masked === undefined ? <div className="trade-keys-body"><Spinner /></div> : masked ? <>
        <div className="android-row"><span className="android-row-label">{tr("当前 Key")}</span><span className="android-row-value">{masked}</span></div>
        <div className="android-row"><span className="android-row-label">{tr("当前 Secret")}</span><span className="android-row-value">{tr("已设置 ✓")}</span></div>
        <button type="button" className="android-row danger" onClick={() => void clear()}><span className="android-row-label">{tr("清除密钥")}</span></button>
      </> : <form className="trade-keys-body" onSubmit={(e) => { e.preventDefault(); if (key && secret && !verifying) void save(); }}>
        <input type="password" placeholder="API Key" aria-label={isGate ? "Gate API Key" : "SafeTrade API Key"} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} />
        <input type="password" placeholder="API Secret" aria-label={isGate ? "Gate API Secret" : "SafeTrade API Secret"} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={secret} onChange={(e) => setSecret(e.target.value)} />
        <button className="primary wide" disabled={!key || !secret || verifying}>{verifying ? <><Spinner />{tr("验证中…")}</> : tr("保存密钥")}</button>
      </form>}
      {message && <p className={message.warning ? "trade-line trade-warn trade-keys-message" : "trade-line trade-ok trade-keys-message"} role="status"><Icon name={message.warning ? "warning" : "check"} /><span>{message.text}</span></p>}
      <button type="button" className="android-row" onClick={onGuide}><span className="android-row-icon"><Icon name="help" /></span><span className="android-row-label">{tr("如何获取 API 密钥")}</span><Icon name="chevron" className="android-row-chevron" /></button>
    </div>
  </section>;
}

export function AllKeySettings({
  tr,
  preferred = "safetrade",
  onGuide,
  onSaved,
  onChanged,
}: {
  tr: Tr;
  preferred?: TradeExchange;
  onGuide: (exchange: TradeExchange) => void;
  onSaved?: (exchange: TradeExchange) => void;
  onChanged?: () => void;
}) {
  const order: TradeExchange[] = preferred === "gate" ? ["gate", "safetrade"] : ["safetrade", "gate"];
  return <>
    {order.map((ex) => <KeySettings key={ex} tr={tr} exchange={ex} onGuide={() => onGuide(ex)} onSaved={onSaved} onChanged={onChanged} />)}
  </>;
}

export function KeyGuide({
  tr,
  exchange = "safetrade",
  onExchangeChange,
  onFillKeys,
}: {
  tr: Tr;
  exchange?: TradeExchange;
  onExchangeChange?: (exchange: TradeExchange) => void;
  onFillKeys?: (exchange: TradeExchange) => void;
}) {
  const [active, setActive] = useState<TradeExchange>(exchange);
  useEffect(() => { setActive(exchange); }, [exchange]);
  const pickExchange = (next: TradeExchange) => {
    setActive(next);
    onExchangeChange?.(next);
  };
  const isGate = active === "gate";
  const [ip, setIP] = useState<string | null>(null), [failed, setFailed] = useState(false);
  const lookUp = () => {
    setIP(null);
    setFailed(false);
    const target = active;
    void (target === "gate" ? gateClient.publicIP() : stClient.publicIP()).then(
      (resolved) => setIP(resolved),
      () => setFailed(true),
    );
  };
  useEffect(lookUp, [active]);
  const step = (n: number, title: string, text: string, extra?: ReactNode, info?: string) => <div className="trade-step">
    <span className="trade-step-n">{n}</span>
    <div><span className="trade-step-title"><strong>{title}</strong>{info && <InfoTip label={title} text={info} />}</span><p>{text}</p>{extra}</div>
  </div>;
  const ipBox = <div className="trade-ip trade-ip-box">{ip ? <><code>{ip}</code><CopyButton value={ip} tr={tr} /></>
    : failed ? <><span className="trade-warn-text">{tr("暂时查不到当前 IP，请稍后再试。")}</span><button type="button" className="text-button" onClick={lookUp}>{tr("重试")}</button></>
    : <Spinner label={tr("正在查询…")} />}</div>;
  const fillBtn = onFillKeys
    ? <button type="button" className="primary trade-step-fill" onClick={() => onFillKeys(active)}><Icon name="key" />{tr("填写 API 密钥")}</button>
    : undefined;
  const switcher = <div className="android-segments trade-two trade-exchange-picker" role="tablist" aria-label={tr("交易所")}>
    {(["safetrade", "gate"] as const).map((ex) => <button key={ex} type="button" role="tab" aria-selected={active === ex}
      onClick={() => pickExchange(ex)}>{EXCHANGE_LABELS[ex]}</button>)}
  </div>;
  const handling = [
    tr("API Key 和 Secret 只存在这台设备上（用 Android 密钥库加密），不会上传到我们的服务器。"),
    isGate
      ? tr("App 直接连接 api.gateio.ws，中间不经过我们或任何第三方。Secret 只在你的设备上用来给请求签名，本身从不发送出去。")
      : tr("App 直接连接 safetrade.com，中间不经过我们或任何第三方。Secret 只在你的设备上用来给请求签名，本身从不发送出去。"),
    tr("每次提现前都要通过设备验证（指纹、人脸或锁屏密码）。"),
  ].join("\n\n");

  if (isGate) {
    return <div className="trade-guide">
      {switcher}
      <section className="card trade-card trade-steps">
        {step(1, tr("开启安全验证"), tr("登录 gate.com 或 Gate App，确保账户已开启谷歌验证（2FA）和资金密码。"))}
        {step(2, tr("创建 API v4 密钥"), tr("网页端右上角头像进入「API 管理」（手机 App 在左上角头像 →「安全中心 / 更多 → API 管理」），点「创建 API Key」，在「账户类型」弹窗里选「交易账户」，备注随便填（如 Pearl Hub），API Key 类型选「API v4 Key」。"),
          <a className="trade-link" href={GATE_API_KEYS_URL} target="_blank" rel="noreferrer"><Icon name="external" />{tr("打开 Gate API 页面")}</a>,
          tr("「账户类型」弹窗有三种：选「交易账户」。不要选「模拟交易」（虚拟盘，无法读写实盘资产），也不要选「第三方应用」（仅限 Gate 预设的合作托管平台固定服务器 IP，Pearl Hub 由你的设备本机直连 Gate）。"))}
        {step(3, tr("勾选权限"), tr("开启「现货 → 读写」（仅查余额可选「只读」）和「钱包 → 只读」（查充值地址、提币手续费与地址簿必需）；「提现 → 读写」按需开启，其余合约、杠杆等全部保持关闭。"),
          undefined,
          tr("只开「现货 + 提现」而不勾「钱包 → 只读」会导致充值和提现页无法读取地址与手续费。开启 API 提币时，Gate 还要求目标收款地址已先在 Gate 后台加入提币白名单（或手动成功提过一次）。"))}
        {step(4, tr("绑定 IP 白名单"), tr("选「绑定 IP」并填入当前网络的公网 IP（多个 IP 用英文逗号隔开，最多 20 个）："),
          ipBox,
          tr("开启提现权限时 Gate 强制要求绑定 IP；不开提现也可暂不绑定（有效期 90 天）。手机网络可能在 IPv4 与 IPv6 之间切换，换网络后提示 IP 不在白名单时把新 IP 补进去即可。新建或修改白名单约 1–5 分钟生效。"))}
        {step(5, tr("复制 Key 和 Secret"), tr("提交并确认风险提示，输入资金密码和二次验证码后，立即复制显示的 API Key 和 Secret（Secret 只显示这一次）。"))}
        {step(6, tr("填进 App"), tr("回到「设置 → 交易」，在 Gate 区域粘贴 API Key 和 Secret 并保存，App 会马上验证权限与白名单状态。"), fillBtn)}
      </section>
      <section className="card trade-card">
        <div className="trade-title-row trade-safe"><Icon name="shield" /><strong>{tr("安全说明")}</strong>
          <InfoTip label={tr("安全说明")} text={[tr("建议只开需要的权限，并绑定 IP。不要把 API Key 或 Secret 告诉任何人，包括自称客服的人。"), handling].join("\n\n")} /></div>
      </section>
    </div>;
  }

  return <div className="trade-guide">
    {switcher}
    <section className="card trade-card trade-steps">
      {step(1, tr("开启谷歌验证"), tr("登录 safetrade.com。创建 API 密钥需要谷歌验证（2FA），还没开的话先在账户安全设置里开启。"))}
      {step(2, tr("打开 API Keys 页面"), tr("在 SafeTrade 顶部菜单点「API」，或直接打开 safetrade.com/my/api，然后点「Create」。"),
        <a className="trade-link" href="https://safetrade.com/my/api" target="_blank" rel="noreferrer"><Icon name="external" />{tr("打开 SafeTrade API 页面")}</a>)}
      {step(3, tr("设置权限"), tr("Label 随便填（例如 Pearl Hub）。Restrictions 里勾选 Enable Reading 和 Enable Trading；只有要在 App 里提现时才勾 Enable Withdraw。"))}
      {step(4, tr("填写 Trusted IPs"), tr("SafeTrade 只接受这里列出的 IP。填入 SafeTrade 现在看到的你的 IP："),
        ipBox,
        tr("多个 IP 用空格隔开，IPv4 和 IPv6 都可以，最多 20 个。手机可能时而用 IPv4、时而用 IPv6，换网络后 IP 也会变——以后交易页提示 IP 不在白名单时，把它显示的新 IP 补进来即可。"))}
      {step(5, tr("保存 API Key 和 Secret"), tr("输入谷歌验证码确认后，页面会显示 API Key 和 API Secret。Secret 只显示这一次，请立刻复制。"))}
      {step(6, tr("填进 App"), tr("回到「设置 → 交易」，粘贴 API Key 和 API Secret 并保存，App 会马上验证能否使用。"), fillBtn)}
    </section>
    <section className="card trade-card">
      <div className="trade-title-row trade-safe"><Icon name="shield" /><strong>{tr("安全说明")}</strong>
        <InfoTip label={tr("安全说明")} text={[tr("建议只开需要的权限，并绑定 IP。不要把 API Key 或 Secret 告诉任何人，包括自称客服的人。"), handling].join("\n\n")} /></div>
    </section>
  </div>;
}
