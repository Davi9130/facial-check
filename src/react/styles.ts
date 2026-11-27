import type { CSSProperties } from "react";

/**
 * Default look of the components. Every color / size reads a CSS variable,
 * so the theme can be changed from CSS:
 *
 * ```css
 * .my-liveness { --fc-primary: #7c3aed; --fc-radius: 8px; }
 * ```
 *
 * | Variable | Default |
 * | --- | --- |
 * | `--fc-primary` | `#2563eb` |
 * | `--fc-success` | `#16a34a` |
 * | `--fc-warning` | `#d97706` |
 * | `--fc-error` | `#dc2626` |
 * | `--fc-text` | `#111827` |
 * | `--fc-muted` | `#6b7280` |
 * | `--fc-background` | `#ffffff` |
 * | `--fc-track` | `#e5e7eb` |
 * | `--fc-overlay` | `rgba(17, 24, 39, 0.55)` |
 * | `--fc-radius` | `16px` |
 * | `--fc-max-width` | `480px` |
 * | `--fc-font` | `system-ui, sans-serif` |
 */
export const cssVar = {
  primary: "var(--fc-primary, #2563eb)",
  success: "var(--fc-success, #16a34a)",
  warning: "var(--fc-warning, #d97706)",
  error: "var(--fc-error, #dc2626)",
  text: "var(--fc-text, #111827)",
  muted: "var(--fc-muted, #6b7280)",
  background: "var(--fc-background, #ffffff)",
  track: "var(--fc-track, #e5e7eb)",
  overlay: "var(--fc-overlay, rgba(17, 24, 39, 0.55))",
  radius: "var(--fc-radius, 16px)",
  maxWidth: "var(--fc-max-width, 480px)",
  font: "var(--fc-font, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif)",
} as const;

/** Joins class names, skipping empty values. */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

/** Default style merged with the user style (`unstyled` drops the default). */
export function sx(base: CSSProperties, style: CSSProperties | undefined, unstyled: boolean | undefined): CSSProperties | undefined {
  if (unstyled) return style;
  return style ? { ...base, ...style } : base;
}

export const buttonStyle: CSSProperties = {
  appearance: "none",
  border: "none",
  borderRadius: "999px",
  background: cssVar.primary,
  color: "#fff",
  font: "inherit",
  fontWeight: 600,
  fontSize: "1rem",
  padding: "0.75rem 1.5rem",
  minHeight: "44px",
  width: "100%",
  maxWidth: "320px",
  cursor: "pointer",
};
