import type { SVGProps } from "react";
import { iconSymbols, type IconName } from "./icon-symbols.tsx";
export type { IconName } from "./icon-symbols.tsx";
export function Icon({ name, className = "", ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return <svg {...props} viewBox="0 0 512 512" width="24" height="24" fill="currentColor" className={`icon ${className}`} aria-hidden="true" focusable="false">{iconSymbols[name]}</svg>;
}
