// The 交易 nav icon beside the shared table's (Ionicons 8.1.0 swap-horizontal-outline.svg, ICONS.md): the Android
// tab bar and the website's sidebar both use it.
import { Icon, type IconName } from "./Icons.tsx";

export function TabIcon({ name }: { name: IconName | "trade" }) {
  if (name !== "trade") return <Icon name={name} />;
  return <svg viewBox="0 0 512 512" width="24" height="24" fill="currentColor" className="icon" aria-hidden="true" focusable="false">
    <path d="m304 48 112 112-112 112M398.87 160H96M208 464 96 352l112-112M114 352h302" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="32px" />
  </svg>;
}
