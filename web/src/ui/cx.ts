/** Joins truthy class names with spaces. */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}
