import type { Rule } from "./types.ts";
import { fresh } from "./store.ts";
export const sameCondition = (a: Pick<Rule, "kind" | "value" | "window">, b: Pick<Rule, "kind" | "value" | "window">) => a.kind === b.kind && a.value === b.value && a.window === b.window;
/// A changed condition is a new one-shot alert, while keeping its sync id.
export function applyingEdit(old: Rule, edit: Pick<Rule, "kind" | "value" | "window"> & { repeat?: boolean }): Rule {
  const repeating = edit.repeat ?? old.repeat ?? false;
  if (sameCondition(old, edit) && repeating === (old.repeat === true)) return old;
  return { ...old, ...edit, repeat: repeating, enabled: true, seen_fired: sameCondition(old, edit) ? old.seen_fired : 0, updated: Math.max(fresh(), old.updated + 1) };
}
/// A reply to an older condition must not switch off the newly edited rule.
export function reconcileRule(rule: Rule, remote?: Pick<Rule, "kind" | "value" | "window" | "enabled" | "repeat"> & { last_fired: number | null }): Rule {
  return remote && sameCondition(rule, remote) && (rule.repeat === true) === (remote.repeat === true) && (remote.last_fired || 0) > rule.seen_fired
    ? { ...rule, enabled: rule.repeat ? rule.enabled : remote.enabled, seen_fired: remote.last_fired!, updated: rule.repeat ? rule.updated : Math.max(fresh(), rule.updated + 1) }
    : rule;
}
export function relativeTime(t: number, lang: string, now = Date.now() / 1000) {
  const seconds = t - now;
  const units = [[86400, "day"], [3600, "hour"], [60, "minute"], [1, "second"]] as const;
  const [divisor, unit] = units.find(([d]) => Math.abs(seconds) >= d) || units.at(-1)!;
  return new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(Math.round(seconds / divisor), unit);
}
