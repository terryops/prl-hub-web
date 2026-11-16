// Icons only the Android 交易 tab uses (TradeTab.tsx and the pages it opens), from the same Ionicons 8.1.0
// package as icon-symbols.tsx (sources in ICONS.md). Kept out of that table, which the browser wallet shares.
import type { SVGProps } from "react";
import { Icon as BaseIcon, type IconName as BaseName } from "./Icons.tsx";

const tradeSymbols = {
  expand: <><path d="M432 320v112H320M421.8 421.77 304 304M80 192V80h112M90.2 90.23 208 208M320 80h112v112M421.77 90.2 304 208M192 432H80V320M90.23 421.8 208 304" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="32px" /></>,
  contract: <><path d="M304 416V304h112M314.2 314.23 432 432M208 96v112H96M197.8 197.77 80 80M416 208H304V96M314.23 197.8 432 80M96 304h112v112M197.77 314.2 80 432" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="32px" /></>,
  help: <><path d="M256 80a176 176 0 1 0 176 176A176 176 0 0 0 256 80Z" fill="none" stroke="currentColor" strokeMiterlimit="10" strokeWidth="32px" /><path d="M200 202.29s.84-17.5 19.57-32.57C230.68 160.77 244 158.18 256 158c10.93-.14 20.69 1.67 26.53 4.45 10 4.76 29.47 16.38 29.47 41.09 0 26-17 37.81-36.37 50.8S251 281.43 251 296" fill="none" stroke="currentColor" strokeLinecap="round" strokeMiterlimit="10" strokeWidth="28px" /><circle cx="250" cy="348" r="20" /></>,
  info: <><path d="M248 64C146.39 64 64 146.39 64 248s82.39 184 184 184 184-82.39 184-184S349.61 64 248 64Z" fill="none" stroke="currentColor" strokeMiterlimit="10" strokeWidth="32px" /><path d="M220 220h32v116" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="32px" /><path d="M208 340h88" fill="none" stroke="currentColor" strokeLinecap="round" strokeMiterlimit="10" strokeWidth="32px" /><path fill="currentColor" d="M248 130a26 26 0 1 0 26 26 26 26 0 0 0-26-26" /></>,
  deposit: <><path d="M176 262.62 256 342l80-79.38M256 330.97V170" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="32px" /><path d="M256 64C150 64 64 150 64 256s86 192 192 192 192-86 192-192S362 64 256 64Z" fill="none" stroke="currentColor" strokeMiterlimit="10" strokeWidth="32px" /></>,
  withdraw: <><path d="M176 249.38 256 170l80 79.38M256 181.03V342" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="32px" /><path d="M448 256c0-106-86-192-192-192S64 150 64 256s86 192 192 192 192-86 192-192Z" fill="none" stroke="currentColor" strokeMiterlimit="10" strokeWidth="32px" /></>,
} as const;
export type TradeIconName = keyof typeof tradeSymbols | BaseName;
export function Icon({ name, className = "", ...props }: SVGProps<SVGSVGElement> & { name: TradeIconName }) {
  if (!(name in tradeSymbols)) return <BaseIcon {...props} name={name as BaseName} className={className} />;
  return <svg {...props} viewBox="0 0 512 512" width="24" height="24" fill="currentColor" className={`icon ${className}`} aria-hidden="true" focusable="false">{tradeSymbols[name as keyof typeof tradeSymbols]}</svg>;
}
