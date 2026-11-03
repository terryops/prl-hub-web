import { useState } from "react";
import { fill, type AndroidCopy } from "./android.ts";
import type { Rule } from "./types.ts";
import { cents, number, limitDecimals, usd, priceRule } from "./android-rule.ts";
import { InfoTip } from "./InfoTip.tsx";

// The Android app's price-alert editor, after the iOS AlertEditorSheet (prl-hub Sources/Settings/
// AlertEditorSheet.swift): 到价提醒 takes only a target and works out "above" or "below" from the
// current price; 涨跌幅提醒 takes a percentage over 5 minutes, 1 hour or 24 hours.
export function AndroidRuleForm({ a, initialRule, current, onSave, onDelete }: {
  a: AndroidCopy; initialRule?: Rule | null; current?: number;
  onSave: (kind: Rule["kind"], value: number, window: number, repeat: boolean) => void;
  onDelete?: () => void;
}) {
  const [mode, setMode] = useState<"price" | "move">(initialRule?.kind === "move" ? "move" : "price");
  const [reach, setReach] = useState(initialRule?.kind === "reach");
  const [priceText, setPriceText] = useState(initialRule && initialRule.kind !== "move" ? initialRule.value.toFixed(2) : "");
  const [pctText, setPctText] = useState(initialRule?.kind === "move" ? String(initialRule.value) : "10");
  const [window, setWindow] = useState(initialRule?.kind === "move" ? initialRule.window || 86400 : 86400);
  const [repeat, setRepeat] = useState(initialRule?.repeat === true);
  const target = number(priceText), pct = number(pctText);
  const price = target == null ? null : priceRule(target, current, initialRule, reach);
  const move = pct != null && cents(pct) >= 0.5 && cents(pct) <= 1000 ? cents(pct) : null;
  const ready = mode === "price" ? !!price : move != null;
  return <form className="android-rule-form" onSubmit={(e) => {
    e.preventDefault();
    if (mode === "price" && price) onSave(price.kind, price.value, 0, repeat);
    else if (mode === "move" && move != null) onSave("move", move, window, repeat);
  }}>
    <div className="android-segments android-rule-modes" role="tablist">
      <button type="button" role="tab" aria-selected={mode === "price"} onClick={() => setMode("price")}>{a.rulePrice}</button>
      <button type="button" role="tab" aria-selected={mode === "move"} onClick={() => setMode("move")}>{a.ruleMove}</button>
    </div>
    {mode === "price" ? <>
      <label className="form-field">{a.targetPrice}
        <div className="android-money-input"><span>$</span><input aria-label={a.targetPriceUsd} inputMode="decimal" placeholder="0.00" value={priceText} onChange={(e) => setPriceText(limitDecimals(e.target.value))} /></div>
      </label>
      {current != null && <p className="android-rule-line"><span>{a.currentPrice}</span><b>{usd(current)}</b></p>}
      <label className="form-field">{a.ruleCondition}
        <select value={reach ? "reach" : "direction"} onChange={(e) => setReach(e.target.value === "reach")}>
          <option value="direction">{a.ruleDirection}</option>
          <option value="reach">{a.ruleReach}</option>
        </select>
      </label>
      {/* iOS: what saving does is said back (the direction comes from the current price); nothing until a target is typed. */}
      {(price || priceText.trim()) && <p className="muted">{price ? fill(price.kind === "reach" ? a.ruleReachNote : price.kind === "above" ? a.ruleUp : a.ruleDown, usd(price.value)) : a.ruleNeedTarget}</p>}
    </> : <>
      <label className="form-field">{a.ruleWindow}
        <select value={window} onChange={(e) => setWindow(Number(e.target.value))}>
          <option value={300}>{a.min5}</option>
          <option value={3600}>{a.hour1}</option>
          <option value={86400}>{a.hour24}</option>
        </select>
      </label>
      {/* The ⓘ sits beside the label, outside it: a button inside a <label> would take the label's clicks. */}
      <div className="form-field">
        <span className="android-title-tip">{a.ruleChange}<InfoTip label={a.ruleChange} text={a.ruleMoveNote} /></span>
        <div className="android-money-input"><input aria-label={a.ruleChangePct} inputMode="decimal" placeholder={a.ruleChangePct} value={pctText} onChange={(e) => setPctText(limitDecimals(e.target.value))} /><span>%</span></div>
      </div>
      {move == null && <p className="muted" role="status">{a.ruleBadPct}</p>}
    </>}
    <div className="form-field">
      <span className="android-title-tip">{a.ruleFrequency}<InfoTip label={repeat ? a.ruleRepeat : a.ruleOnce} text={repeat ? a.ruleRepeatNote : a.ruleOnceNote} /></span>
      <select aria-label={a.ruleFrequency} value={repeat ? "repeat" : "once"} onChange={(e) => setRepeat(e.target.value === "repeat")}>
        <option value="once">{a.ruleOnce}</option>
        <option value="repeat">{a.ruleRepeat}</option>
      </select>
    </div>
    <div className="actions form-actions">
      {onDelete && <button type="button" className="danger" onClick={onDelete}>{a.ruleDelete}</button>}
      <button className="primary" disabled={!ready}>{initialRule ? a.save : a.add}</button>
    </div>
  </form>;
}
