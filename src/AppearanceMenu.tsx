import { useEffect, useRef } from "react";
import { Icon } from "./Icons.tsx";
import type { TextKey } from "./i18n/index.ts";
import type { State } from "./types.ts";

type Appearance = Pick<State, "theme"> & { palette?: unknown };

export function AppearanceMenu({ state, t, onChange }: {
  state: Appearance;
  t: (key: TextKey) => string;
  onChange: (appearance: Partial<Appearance>) => void;
}) {
  const control = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismissOutside = (event: Event) => {
      if (control.current?.open && !control.current.contains(event.target as Node)) control.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !control.current?.open) return;
      control.current.open = false;
      control.current.querySelector("summary")?.focus();
      event.preventDefault();
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  return (
    <details className="appearance-control" ref={control}>
      <summary className="appearance-button" aria-label={t("palette")} title={t("palette")}>
        <Icon name="appearance" />
      </summary>
      <div className="appearance-menu">
        <label className="form-field">
          {t("theme")}
          <select aria-label={t("theme")} value={state.theme || "system"} onChange={(e) => onChange({ theme: e.target.value as State["theme"] })}>
            {(["system", "light", "dark"] as const).map((value) => (
              <option key={value} value={value}>{t(value === "system" ? "systemTheme" : value)}</option>
            ))}
          </select>
        </label>
        <label className="form-field">
          {t("palette")}
          <select aria-label={t("palette")} value={state.palette === "mono" ? "mono" : "classic"} onChange={(e) => onChange({ palette: e.target.value })}>
            <option value="classic">{t("classicBlue")}</option>
            <option value="mono">{t("modernSilver")}</option>
          </select>
        </label>
      </div>
    </details>
  );
}
