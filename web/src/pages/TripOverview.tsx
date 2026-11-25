import type { ReactNode } from "react";
import type {
  Catalog,
  CheckOutcome,
  CheckResult,
  ChecklistItem,
  GroceriesFields,
  IsoDate,
  ItineraryItem,
  LodgingItem,
  Membership,
  PlanItem,
  Section,
  Trip,
  TripConstraints,
} from "@tripwise/shared";
import { formatDollars } from "../checks/format";
import { Badge, Button, Card, PlusIcon, ProgressBar, ScoreRing, type ProgressTone } from "../ui";

/** Tabs the Overview's quick actions and card links can switch to. */
export type OverviewTarget = "Lodging" | "Itinerary" | "Groceries" | "Checklist" | "Constraints" | "Checks";

// ---------- pure helpers (exported for tests) ----------

/** Today's date in the browser's local time zone as YYYY-MM-DD. */
export function localToday(now: Date = new Date()): IsoDate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD), using UTC so DST never shifts the count. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const ms = (d: IsoDate) => {
    const [y, m, day] = d.split("-").map(Number);
    return Date.UTC(y ?? 0, (m ?? 1) - 1, day ?? 1);
  };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

export type Countdown =
  | { kind: "upcoming"; days: number }
  | { kind: "today" }
  | { kind: "ongoing"; day: number; totalDays: number }
  | { kind: "ended" };

/** Where `today` falls relative to the trip dates. */
export function tripCountdown(startDate: IsoDate, endDate: IsoDate, today: IsoDate): Countdown {
  const untilStart = daysBetween(today, startDate);
  if (untilStart > 0) return { kind: "upcoming", days: untilStart };
  if (untilStart === 0) return { kind: "today" };
  if (daysBetween(today, endDate) >= 0) {
    return { kind: "ongoing", day: 1 - untilStart, totalDays: daysBetween(startDate, endDate) + 1 };
  }
  return { kind: "ended" };
}

export function countdownText(c: Countdown): string {
  switch (c.kind) {
    case "upcoming":
      return c.days === 1 ? "Starts tomorrow" : `${c.days} days to go`;
    case "today":
      return "Starts today";
    case "ongoing":
      return `Day ${c.day} of ${c.totalDays}`;
    case "ended":
      return "Trip ended";
  }
}

/** Newest standard (non-alternative) Check_Result; `results` is newest first (Req 13.6). */
export function latestStandardResult(results: readonly CheckResult[]): CheckResult | undefined {
  return results.find((r) => r.kind !== "alternative");
}

export function costOutcome(result: CheckResult | undefined): CheckOutcome | undefined {
  return result?.outcomes.find((o) => o.check === "Cost");
}

/** Bar tone for budget use: fail over the limit, warning at 90% or more, otherwise pass. */
export function budgetTone(measured: number, limit: number): ProgressTone {
  if (limit <= 0 || measured > limit) return "fail";
  if (measured / limit >= 0.9) return "warning";
  return "pass";
}

/** The stay marked selected, if any. */
export function selectedStay(stays: readonly LodgingItem[]): LodgingItem | undefined {
  return stays.find((s) => s.fields.selected === true);
}

export function countDone<T>(items: readonly T[], isDone: (item: T) => boolean): { done: number; total: number } {
  return { done: items.filter(isDone).length, total: items.length };
}

/** Itinerary stops on or after `today`, ordered by day then start time, up to `limit`. */
export function nextStops(items: readonly ItineraryItem[], today: IsoDate, limit = 3): ItineraryItem[] {
  return items
    .filter((i) => i.fields.day >= today)
    .slice()
    .sort((a, b) =>
      a.fields.day === b.fields.day
        ? a.fields.startTime.localeCompare(b.fields.startTime)
        : a.fields.day.localeCompare(b.fields.day),
    )
    .slice(0, limit);
}

/** "Jun 12" style label for a YYYY-MM-DD date (formatted in UTC so the day never shifts). */
export function shortDate(d: IsoDate): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, day ?? 1)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// ---------- component ----------

export interface TripOverviewProps {
  trip: Trip;
  members: readonly Membership[];
  itemsBySection: Record<Section, PlanItem[]>;
  constraints: TripConstraints | null;
  /** Newest first. */
  checkResults: readonly CheckResult[];
  catalog?: Catalog;
  onNavigate: (tab: OverviewTarget) => void;
  onInvite: () => void;
  /** Override for tests; defaults to the local date. */
  today?: IsoDate;
}

/** Dashboard of the data the Trip page already loaded. No fetching here. */
export function TripOverview({
  trip,
  members,
  itemsBySection,
  constraints,
  checkResults,
  catalog,
  onNavigate,
  onInvite,
  today = localToday(),
}: TripOverviewProps) {
  const stays = itemsBySection.Lodging as unknown as LodgingItem[];
  const stay = selectedStay(stays);
  const latest = latestStandardResult(checkResults);
  const cost = costOutcome(latest);
  const checklist = countDone(itemsBySection.Checklist as unknown as ChecklistItem[], (i) => i.fields.done === true);
  const groceries = countDone(
    itemsBySection.Groceries as unknown as PlanItem<GroceriesFields>[],
    (i) => i.fields.purchased === true,
  );
  const stops = nextStops(itemsBySection.Itinerary as unknown as ItineraryItem[], today);
  const catalogStay = stay?.fields.catalogStayId
    ? catalog?.stays.find((s) => s.id === stay.fields.catalogStayId)
    : undefined;
  const link = (tab: OverviewTarget, label: string) => (
    <Button variant="ghost" size="sm" onClick={() => onNavigate(tab)}>
      {label}
    </Button>
  );

  return (
    <div className="trip-overview">
      <Card title="Where you're staying" actions={link("Lodging", "Lodging")} className="trip-overview__stay">
        {stay ? (
          <div className="trip-overview__stay-body">
            <p className="trip-overview__big">{stay.fields.name ?? catalogStay?.name ?? "Selected stay"}</p>
            {stay.fields.address && <p className="trip-overview__muted">{stay.fields.address}</p>}
            <p>
              {shortDate(stay.fields.checkIn)} to {shortDate(stay.fields.checkOut)} · sleeps {stay.fields.sleeps} ·{" "}
              {formatDollars(stay.fields.nightlyPriceCents)}/night
            </p>
            {catalogStay && (
              <p className="trip-overview__muted">Estimated as of {catalogStay.nightlyPrice.estimatedAsOf}</p>
            )}
            <Badge tone="accent">Selected</Badge>
          </div>
        ) : (
          <Prompt
            text={stays.length > 0 ? "No stay is marked as selected yet." : "No stays added yet."}
            action={link("Lodging", stays.length > 0 ? "Choose a stay" : "Add a stay")}
          />
        )}
      </Card>

      <Card title="Feasibility" actions={link("Checks", "Checks")} className="trip-overview__score">
        {latest ? (
          <div className="trip-overview__score-body">
            <ScoreRing value={latest.score} label={latest.label} />
            <div>
              <Badge tone={latest.label === "Feasible" ? "pass" : "fail"} dot>
                {latest.label}
              </Badge>
              <p className="trip-overview__muted">
                {latest.score}% of checks passed for {latest.evaluatedStay.name}
              </p>
            </div>
          </div>
        ) : (
          <Prompt text="No checks have been run for this trip." action={<RunCheck onNavigate={onNavigate} />} />
        )}
      </Card>

      <Card title="Budget" actions={link("Constraints", "Constraints")} className="trip-overview__budget">
        {cost ? (
          <>
            <ProgressBar
              label="Estimated cost against budget"
              value={cost.measured}
              max={cost.limit}
              tone={budgetTone(cost.measured, cost.limit)}
              valueText={`${formatDollars(cost.measured)} of ${formatDollars(cost.limit)}`}
            />
            <p className="trip-overview__muted">
              {cost.measured > cost.limit
                ? `${formatDollars(cost.measured - cost.limit)} over budget`
                : `${formatDollars(cost.limit - cost.measured)} left`}{" "}
              · from the latest check
            </p>
          </>
        ) : latest ? (
          <Prompt
            text={constraints ? "The latest check has no cost result." : "Set a budget to track spending."}
            action={constraints ? <RunCheck onNavigate={onNavigate} /> : link("Constraints", "Set constraints")}
          />
        ) : (
          <Prompt text="Run a check to compare estimated cost with your budget." action={<RunCheck onNavigate={onNavigate} />} />
        )}
      </Card>

      <Card title="Progress" className="trip-overview__progress">
        <div className="trip-overview__progress-body">
          <ProgressRow
            label="Checklist done"
            counts={checklist}
            emptyText="No checklist tasks"
            action={link("Checklist", "Checklist")}
          />
          <ProgressRow
            label="Groceries purchased"
            counts={groceries}
            emptyText="No groceries listed"
            action={link("Groceries", "Groceries")}
          />
        </div>
      </Card>

      <Card title="Next stops" actions={link("Itinerary", "Itinerary")} className="trip-overview__stops">
        {stops.length > 0 ? (
          <ol className="trip-overview__stop-list">
            {stops.map((s) => (
              <li key={s.itemId}>
                <span className="trip-overview__stop-when">
                  {shortDate(s.fields.day)} · {s.fields.startTime}
                  {s.fields.endTime ? `–${s.fields.endTime}` : ""}
                </span>
                <span className="trip-overview__stop-name">{s.fields.stopName}</span>
              </li>
            ))}
          </ol>
        ) : (
          <Prompt text="No upcoming itinerary stops." action={link("Itinerary", "Add a stop")} />
        )}
      </Card>

      <Card title="Quick actions" className="trip-overview__actions">
        <div className="trip-overview__action-row">
          <Button variant="secondary" size="sm" icon={<PlusIcon />} onClick={() => onNavigate("Lodging")}>
            Add a stay
          </Button>
          <Button variant="secondary" size="sm" icon={<PlusIcon />} onClick={() => onNavigate("Itinerary")}>
            Add a stop
          </Button>
          <Button variant="secondary" size="sm" icon={<PlusIcon />} onClick={() => onNavigate("Checklist")}>
            Add a task
          </Button>
          <RunCheck onNavigate={onNavigate} variant="primary" />
          <Button variant="secondary" size="sm" onClick={onInvite}>
            Invite ({members.length} {members.length === 1 ? "member" : "members"})
          </Button>
        </div>
        <p className="trip-overview__muted">
          {trip.destination} · {shortDate(trip.startDate)} to {shortDate(trip.endDate)}
        </p>
      </Card>
    </div>
  );
}

function RunCheck({
  onNavigate,
  variant = "secondary",
}: {
  onNavigate: (tab: OverviewTarget) => void;
  variant?: "primary" | "secondary";
}) {
  return (
    <Button variant={variant} size="sm" onClick={() => onNavigate("Checks")}>
      Run a check
    </Button>
  );
}

function Prompt({ text, action }: { text: string; action: ReactNode }) {
  return (
    <div className="trip-overview__prompt">
      <p className="trip-overview__muted">{text}</p>
      {action}
    </div>
  );
}

function ProgressRow({
  label,
  counts,
  emptyText,
  action,
}: {
  label: string;
  counts: { done: number; total: number };
  emptyText: string;
  action: ReactNode;
}) {
  return (
    <div className="trip-overview__progress-row">
      {counts.total > 0 ? (
        <ProgressBar
          label={label}
          value={counts.done}
          max={counts.total}
          tone={counts.done === counts.total ? "pass" : "accent"}
          valueText={`${counts.done} of ${counts.total}`}
        />
      ) : (
        <p className="trip-overview__muted">{emptyText}</p>
      )}
      {action}
    </div>
  );
}
