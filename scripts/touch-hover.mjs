// PostCSS plugin for the Android app builds (this page and prl-hub-wallet's Android wallet keep the
// same copy in scripts/touch-hover.mjs). A touch screen leaves :hover on the last element tapped,
// so a tapped button or row stayed highlighted until the next tap somewhere else. Each :hover rule
// is kept for a real pointer, `@media (hover: hover)`, and becomes an :active rule on touch screens,
// `@media (hover: none)`, so the same style shows only while the finger is down.
export const touchHover = () => ({
  postcssPlugin: "touch-hover",
  Once(root, { AtRule }) {
    const rules = [];
    root.walkRules((rule) => {
      if (!rule.selector.includes(":hover")) return;
      if (rule.parent?.type === "atrule" && /\bhover\s*:/.test(rule.parent.params)) return;
      if (rule.parent?.type === "atrule" && /keyframes$/.test(rule.parent.name)) return;
      rules.push(rule);
    });
    for (const rule of rules) {
      const hover = rule.selectors.filter((s) => s.includes(":hover"));
      const rest = rule.selectors.filter((s) => !s.includes(":hover"));
      const pointer = new AtRule({ name: "media", params: "(hover: hover)" });
      pointer.append(rule.clone({ selectors: hover }));
      const touch = new AtRule({ name: "media", params: "(hover: none)" });
      touch.append(rule.clone({ selectors: [...new Set(hover.map((s) => s.replaceAll(":hover", ":active")))] }));
      rule.after(touch);
      rule.after(pointer);
      if (rest.length) rule.selectors = rest;
      else rule.remove();
    }
  },
});
touchHover.postcss = true;
