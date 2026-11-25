import type { CSSProperties } from "react";
import { cx } from "./cx";

/** Background colors with white text at >= 4.5:1 contrast. */
export const AVATAR_COLORS = [
  "#4f46e5", // indigo
  "#0e7490", // cyan
  "#047857", // emerald
  "#b45309", // amber
  "#be123c", // rose
  "#7c3aed", // violet
  "#1d4ed8", // blue
  "#a21caf", // fuchsia
] as const;

/**
 * Up to two uppercase initials from a display name or an email address.
 * "Ada Lovelace" -> "AL", "grace.hopper@example.com" -> "GH", "" -> "?".
 */
export function initialsFor(nameOrEmail: string): string {
  let source = nameOrEmail.trim();
  if (source.includes("@") && !/\s/.test(source)) source = source.split("@")[0] ?? "";
  const words = source.split(/[\s._\-+]+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  const letter = (w: string) => Array.from(w).find((c) => /[\p{L}\p{N}]/u.test(c)) ?? "";
  const first = words[0];
  if (!first) return "?";
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  return (letter(first) + (last ? letter(last) : "")).toUpperCase();
}

/** Stable color for a name: the same input always maps to the same palette entry. */
export function avatarColor(key: string): string {
  let hash = 0;
  const normalized = key.trim().toLowerCase();
  for (let i = 0; i < normalized.length; i++) hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}

export type AvatarSize = "sm" | "md" | "lg";

export interface AvatarProps {
  /** Member display name, or email when there is no name. */
  name: string;
  /** Key for the color; defaults to `name` (pass a user ID for colors that survive renames). */
  colorKey?: string;
  size?: AvatarSize;
  className?: string;
  /** Set when a visible name is next to the avatar, so screen readers do not read it twice. */
  decorative?: boolean;
}

/** Circle with a Member's initials on a stable color. */
export function Avatar({ name, colorKey, size = "md", className, decorative = false }: AvatarProps) {
  const style: CSSProperties = { background: avatarColor(colorKey ?? name) };
  const label = name.trim() || "Unknown member";
  return (
    <span
      className={cx("avatar", `avatar--${size}`, className)}
      style={style}
      title={label}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
    >
      {initialsFor(name)}
    </span>
  );
}

export interface AvatarStackPerson {
  /** Stable key (e.g. user ID). Falls back to `name`. */
  id?: string;
  name: string;
}

export interface AvatarStackProps {
  people: readonly AvatarStackPerson[];
  /** How many avatars to show before the "+N" bubble (default 4). */
  max?: number;
  size?: AvatarSize;
  className?: string;
  /** Accessible label for the group; defaults to "N members". */
  label?: string;
}

/** Overlapping avatars for the first `max` people plus a "+N" count. */
export function AvatarStack({ people, max = 4, size = "sm", className, label }: AvatarStackProps) {
  const shown = people.slice(0, Math.max(0, max));
  const extra = people.length - shown.length;
  const groupLabel = label ?? `${people.length} ${people.length === 1 ? "member" : "members"}`;
  return (
    <span className={cx("avatar-stack", className)} role="group" aria-label={groupLabel}>
      {shown.map((p, i) => (
        <Avatar key={p.id ?? `${p.name}-${i}`} name={p.name} colorKey={p.id ?? p.name} size={size} />
      ))}
      {extra > 0 && (
        <span
          className={cx("avatar", `avatar--${size}`, "avatar--overflow")}
          role="img"
          aria-label={`and ${extra} more`}
          title={people.slice(shown.length).map((p) => p.name).join(", ")}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}
