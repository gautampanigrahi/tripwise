import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AVATAR_COLORS,
  Avatar,
  AvatarStack,
  Badge,
  Breadcrumbs,
  BreadcrumbsProvider,
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  ProgressBar,
  ScoreRing,
  Select,
  TabPanel,
  Tabs,
  TextInput,
  avatarColor,
  breadcrumbTrail,
  initialsFor,
  nextTabIndex,
  percentOf,
  scoreTone,
  tabIds,
} from "./index";

const html = (el: ReactElement) => renderToStaticMarkup(el);

describe("initialsFor", () => {
  it("uses the first and last word of a display name", () => {
    expect(initialsFor("Ada Lovelace")).toBe("AL");
    expect(initialsFor("  mary ann  smith ")).toBe("MS");
    expect(initialsFor("Cher")).toBe("C");
  });

  it("uses the local part of an email", () => {
    expect(initialsFor("grace.hopper@example.com")).toBe("GH");
    expect(initialsFor("bob@example.com")).toBe("B");
  });

  it("falls back to ? for empty or symbol-only input", () => {
    expect(initialsFor("")).toBe("?");
    expect(initialsFor("  ")).toBe("?");
    expect(initialsFor("--")).toBe("?");
  });
});

describe("avatarColor", () => {
  it("is deterministic, case-insensitive, and from the palette", () => {
    expect(avatarColor("Ada Lovelace")).toBe(avatarColor("ada lovelace "));
    for (const name of ["a", "Bob", "carol@example.com", ""]) {
      expect(AVATAR_COLORS).toContain(avatarColor(name));
    }
  });
});

describe("Avatar and AvatarStack", () => {
  it("renders initials with an accessible name", () => {
    const out = html(<Avatar name="Ada Lovelace" />);
    expect(out).toContain(">AL<");
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Ada Lovelace"');
  });

  it("shows the first `max` people and a +N count", () => {
    const people = ["A One", "B Two", "C Three", "D Four", "E Five"].map((name, i) => ({ id: `u${i}`, name }));
    const out = html(<AvatarStack people={people} max={3} />);
    expect(out.match(/class="avatar avatar--sm"/g)).toHaveLength(3);
    expect(out).toContain("+2");
    expect(out).toContain('aria-label="5 members"');
  });
});

describe("Button and IconButton", () => {
  it("defaults to type=button and applies variant and size classes", () => {
    const out = html(<Button variant="danger" size="sm">Delete</Button>);
    expect(out).toContain('type="button"');
    expect(out).toContain("btn--danger");
    expect(out).toContain("btn--sm");
  });

  it("disables and marks busy while loading", () => {
    const out = html(<Button loading>Save</Button>);
    expect(out).toContain("disabled");
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain("spinner");
  });

  it("IconButton carries its aria-label", () => {
    expect(html(<IconButton aria-label="Close" icon={<span />} />)).toContain('aria-label="Close"');
  });
});

describe("Badge", () => {
  it("maps pass/fail aliases to success/danger", () => {
    expect(html(<Badge tone="pass">Pass</Badge>)).toContain("badge--success");
    expect(html(<Badge tone="fail">Fail</Badge>)).toContain("badge--danger");
    expect(html(<Badge>Host</Badge>)).toContain("badge--neutral");
  });
});

describe("ProgressBar", () => {
  it("clamps the percentage", () => {
    expect(percentOf(50, 200)).toBe(25);
    expect(percentOf(300, 200)).toBe(100);
    expect(percentOf(-5, 200)).toBe(0);
    expect(percentOf(5, 0)).toBe(0);
  });

  it("exposes progressbar semantics", () => {
    const out = html(<ProgressBar label="Budget" value={1200} max={1500} tone="warning" valueText="$1,200 of $1,500" />);
    expect(out).toContain('role="progressbar"');
    expect(out).toContain('aria-label="Budget"');
    expect(out).toContain('aria-valuenow="1200"');
    expect(out).toContain('aria-valuemax="1500"');
    expect(out).toContain('aria-valuetext="$1,200 of $1,500"');
    expect(out).toContain("width:80%");
    expect(out).toContain("progress--warning");
  });
});

describe("ScoreRing", () => {
  it("picks a tone from the score", () => {
    expect(scoreTone(100)).toBe("success");
    expect(scoreTone(80)).toBe("success");
    expect(scoreTone(79)).toBe("warning");
    expect(scoreTone(49)).toBe("danger");
  });

  it("renders the clamped score and label", () => {
    const out = html(<ScoreRing value={142} label="Feasible" />);
    expect(out).toContain('aria-label="Feasibility score 100 out of 100, Feasible"');
    expect(out).toContain(">100<");
    expect(out).toContain("Feasible");
  });
});

describe("Tabs", () => {
  it("moves with arrows, wraps, and skips disabled tabs", () => {
    const disabled = [false, true, false, false];
    expect(nextTabIndex(0, "ArrowRight", disabled)).toBe(2);
    expect(nextTabIndex(3, "ArrowRight", disabled)).toBe(0);
    expect(nextTabIndex(0, "ArrowLeft", disabled)).toBe(3);
    expect(nextTabIndex(2, "ArrowLeft", disabled)).toBe(0);
    expect(nextTabIndex(2, "Home", disabled)).toBe(0);
    expect(nextTabIndex(0, "End", disabled)).toBe(3);
    expect(nextTabIndex(2, "Enter", disabled)).toBe(2);
    expect(nextTabIndex(0, "ArrowRight", [false, true])).toBe(0);
  });

  it("renders roving tabindex and links tabs to panels", () => {
    const tabs = [
      { id: "overview", label: "Overview" },
      { id: "lodging", label: "Lodging" },
    ];
    const out = html(
      <>
        <Tabs tabs={tabs} value="lodging" onChange={() => undefined} label="Trip sections" idPrefix="trip" />
        <TabPanel idPrefix="trip" tabId="lodging">
          Body
        </TabPanel>
      </>,
    );
    const ids = tabIds("trip", "lodging");
    expect(out).toContain('role="tablist"');
    expect(out).toContain('aria-label="Trip sections"');
    expect(out).toMatch(/id="trip-tab-overview"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
    expect(out).toMatch(new RegExp(`id="${ids.tab}"[^>]*aria-selected="true"[^>]*aria-controls="${ids.panel}"[^>]*tabindex="0"`));
    expect(out).toContain(`role="tabpanel" id="${ids.panel}" aria-labelledby="${ids.tab}"`);
  });
});

describe("Field wrappers", () => {
  it("wires label, hint, and error to the input", () => {
    const out = html(<TextInput id="name" label="Name" hint="Shown to members" error="Name is required." />);
    expect(out).toContain('for="name"');
    expect(out).toContain('id="name-hint"');
    expect(out).toContain('id="name-error"');
    expect(out).toContain('aria-describedby="name-hint name-error"');
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('role="alert"');
  });

  it("omits aria-invalid and describedby without hint or error", () => {
    const out = html(<Select id="kind" label="Kind" options={[{ value: "a", label: "A" }]} placeholder="Choose" />);
    expect(out).not.toContain("aria-invalid");
    expect(out).not.toContain("aria-describedby");
    expect(out).toContain('<option value="">Choose</option>');
  });

  it("Checkbox keeps the input inside its label", () => {
    const out = html(<Checkbox id="done" label="Done" error="Oops" />);
    expect(out).toMatch(/<label[^>]*for="done"[^>]*><input type="checkbox" id="done"/);
    expect(out).toContain('aria-describedby="done-error"');
  });
});

describe("EmptyState", () => {
  it("renders title, description, and action", () => {
    const out = html(<EmptyState title="No trips yet" description="Create one." action={<Button>New trip</Button>} />);
    expect(out).toContain("No trips yet");
    expect(out).toContain("Create one.");
    expect(out).toContain("New trip");
  });
});

describe("ErrorState and LoadingState", () => {
  it("announces the error and offers Retry", () => {
    const out = html(<ErrorState title="Could not load" message="Network down" onRetry={() => undefined} />);
    expect(out).toMatch(/^<div role="alert"/);
    expect(out).toContain("Could not load");
    expect(out).toContain("Network down");
    expect(out).toContain(">Retry</button>");
  });
  it("omits the Retry button without onRetry", () => {
    expect(html(<ErrorState title="Gone" />)).not.toContain("<button");
  });
  it("renders labelled skeleton cards", () => {
    const out = html(<LoadingState label="Loading trips…" cards={3} layout="grid" />);
    expect(out).toContain('role="status"');
    expect(out).toContain("Loading trips…");
    expect(out).toContain("loading-state--grid");
    expect(out.match(/skeleton-card/g)).toHaveLength(3);
  });
});

describe("Dialog", () => {
  it("renders nothing when closed", () => {
    expect(html(<Dialog open={false} onClose={() => undefined} title="Hi" />)).toBe("");
  });
});

describe("Breadcrumbs", () => {
  it("always starts with Trips and marks the last crumb as current", () => {
    expect(breadcrumbTrail([{ label: "Lake trip", to: "/trips/t1" }, { label: "Lodging" }])).toEqual([
      { label: "Trips", to: "/" },
      { label: "Lake trip", to: "/trips/t1" },
      { label: "Lodging" },
    ]);
    const out = html(
      <BreadcrumbsProvider>
        <Breadcrumbs />
      </BreadcrumbsProvider>,
    );
    expect(out).toContain('aria-label="Breadcrumb"');
    expect(out).toContain('aria-current="page"');
  });
});
