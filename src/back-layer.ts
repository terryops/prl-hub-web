// Layers a page opens over itself (an editor sheet, a detail sheet) that the Android back button closes first:
// each registers while it's open, and main.tsx's back handler pops the top one before it leaves the page.
import { useEffect, useRef } from "react";

const stack: (() => void)[] = [];
export function useBackLayer(open: boolean, close: () => void) {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!open) return;
    const fn = () => latest.current();
    stack.push(fn);
    return () => { const i = stack.lastIndexOf(fn); if (i >= 0) stack.splice(i, 1); };
  }, [open]);
}
export const popBackLayer = () => { const top = stack.at(-1); if (!top) return false; top(); return true; };
