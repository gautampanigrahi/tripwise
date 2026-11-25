import type { Membership } from "@tripwise/shared";

export interface LastModifiedProps {
  lastModifiedBy: string;
  lastModifiedAt: string;
  members?: readonly Pick<Membership, "userId" | "displayName">[];
}

/** Resolves a user ID to the Member's display name, falling back to the ID. */
export function memberName(
  userId: string,
  members?: readonly Pick<Membership, "userId" | "displayName">[],
): string {
  const name = members?.find((m) => m.userId === userId)?.displayName;
  return name && name.trim() !== "" ? name : userId;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Shows who last changed a Plan_Item and when (Req 5.7). */
export function LastModified({ lastModifiedBy, lastModifiedAt, members }: LastModifiedProps) {
  return (
    <small className="last-modified">
      Last modified by {memberName(lastModifiedBy, members)} at{" "}
      <time dateTime={lastModifiedAt}>{formatTime(lastModifiedAt)}</time>
    </small>
  );
}
