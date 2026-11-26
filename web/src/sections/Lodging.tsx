import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import {
  formatEstimate,
  lodgingFromCatalogStay,
  tripNights,
  validatePlanItem,
  type Catalog,
  type CatalogStay,
  type FieldError,
  type LodgingFields,
  type LodgingItem,
  type Membership,
  type ValidationContext,
} from "@tripwise/shared";
import { useApiClient } from "../api/ApiClientContext";
import { ApiError } from "../api/client";
import { getCatalog } from "../api/catalog";
import {
  createItem,
  deleteItem,
  getConfirmationDownloadUrl,
  updateItem,
  uploadConfirmation,
  readListingLink,
} from "../api/items";
import { LastModified } from "../components/LastModified";
import { StaleConflict } from "../components/StaleConflict";
import {
  Badge,
  Button,
  Card,
  CheckIcon,
  Checkbox,
  ConfirmDialog,
  Drawer,
  EmptyState,
  ErrorState,
  PlusIcon,
  Skeleton,
  TextArea,
  TextInput,
  cx,
  useToast,
} from "../ui";
import "./Lodging.css";

export interface LodgingProps {
  tripId: string;
  items: readonly LodgingItem[];
  members?: readonly Pick<Membership, "userId" | "displayName">[];
  /** Called after any successful write so the page can refetch. */
  onChanged: () => void | Promise<void>;
  /** Optional preloaded Catalog; fetched from GET /catalog when omitted. */
  catalog?: Catalog;
}

/** Form state; every input is kept as a string until submit. */
interface LodgingForm {
  name: string;
  listingUrl: string;
  address: string;
  checkIn: string;
  checkOut: string;
  confirmationNumber: string;
  sleeps: string;
  nightlyPrice: string;
  doorCode: string;
  checkInNotes: string;
  catalogStayId: string;
  features: string[];
  selected: boolean;
}

const EMPTY_FORM: LodgingForm = {
  name: "",
  listingUrl: "",
  address: "",
  checkIn: "",
  checkOut: "",
  confirmationNumber: "",
  sleeps: "",
  nightlyPrice: "",
  doorCode: "",
  checkInNotes: "",
  catalogStayId: "",
  features: [],
  selected: false,
};

// Lodging rules do not read trip context; validatePlanItem still requires one.
const LODGING_CTX: ValidationContext = {
  trip: { startDate: "1970-01-01", endDate: "1970-01-01" },
  memberIds: new Set(),
};

function centsToDollars(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

function dollarsToCents(s: string): number {
  const t = s.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return Number.NaN;
  const [whole = "0", frac = ""] = t.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

function formFromFields(f: Partial<LodgingFields>): LodgingForm {
  return {
    name: f.name ?? "",
    listingUrl: f.listingUrl ?? "",
    address: f.address ?? "",
    checkIn: f.checkIn ?? "",
    checkOut: f.checkOut ?? "",
    confirmationNumber: f.confirmationNumber ?? "",
    sleeps: f.sleeps === undefined ? "" : String(f.sleeps),
    nightlyPrice: f.nightlyPriceCents === undefined ? "" : centsToDollars(f.nightlyPriceCents),
    doorCode: f.checkInDetails?.doorCode ?? "",
    checkInNotes: f.checkInDetails?.notes ?? "",
    catalogStayId: f.catalogStayId ?? "",
    features: f.features ?? [],
    selected: f.selected ?? false,
  };
}

/** Builds the submitted fields, omitting empty optional values. Server-owned keys are never sent. */
function fieldsFromForm(form: LodgingForm): Record<string, unknown> {
  const out: Record<string, unknown> = {
    checkIn: form.checkIn,
    checkOut: form.checkOut,
    sleeps: form.sleeps.trim() === "" ? Number.NaN : Number(form.sleeps),
    nightlyPriceCents: dollarsToCents(form.nightlyPrice),
  };
  const opt = (key: string, value: string) => {
    if (value.trim() !== "") out[key] = value.trim();
  };
  opt("name", form.name);
  opt("listingUrl", form.listingUrl);
  opt("address", form.address);
  opt("confirmationNumber", form.confirmationNumber);
  opt("catalogStayId", form.catalogStayId);
  const details: Record<string, string> = {};
  if (form.doorCode.trim() !== "") details.doorCode = form.doorCode.trim();
  if (form.checkInNotes.trim() !== "") details.notes = form.checkInNotes.trim();
  if (Object.keys(details).length > 0) out.checkInDetails = details;
  if (form.features.length > 0) out.features = form.features;
  if (form.selected) out.selected = true;
  return out;
}

/** Maps API errors to readable text; 400 VALIDATION bodies become field errors. */
function describeError(err: unknown): { message: string; fields: FieldError[] } {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; message?: string; fields?: FieldError[] } | undefined;
    if (err.status === 400 && body?.error === "VALIDATION" && Array.isArray(body.fields)) {
      return { message: "Please fix the highlighted fields.", fields: body.fields };
    }
    if (err.status === 403) return { message: "You are not a Member of this trip.", fields: [] };
    if (body?.message) return { message: body.message, fields: [] };
    return { message: `Request failed (${err.status}${body?.error ? ` ${body.error}` : ""}).`, fields: [] };
  }
  return { message: err instanceof Error ? err.message : "Something went wrong.", fields: [] };
}

/** "Est. $X/night (as of …)" when the price still matches its Catalog stay, otherwise "$X/night". */
export function priceLabel(fields: LodgingFields, stays: readonly CatalogStay[]): string {
  const stay = fields.catalogStayId ? stays.find((s) => s.id === fields.catalogStayId) : undefined;
  if (stay && stay.nightlyPrice.cents === fields.nightlyPriceCents) {
    return formatEstimate(stay.nightlyPrice, "night");
  }
  return `$${centsToDollars(fields.nightlyPriceCents)}/night`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Number of nights between check-in and check-out, or undefined when either date is missing or invalid. */
export function nightsBetween(checkIn: string, checkOut: string): number | undefined {
  if (!ISO_DATE.test(checkIn) || !ISO_DATE.test(checkOut)) return undefined;
  const n = tripNights(checkIn, checkOut).length;
  return Number.isFinite(n) ? n : undefined;
}

/** "Fri, Jun 12, 2026" for an ISO date; the raw value when it does not parse. */
export function formatStayDate(day: string): string {
  if (!ISO_DATE.test(day)) return day;
  const d = new Date(`${day}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? day
    : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/** Catalog features are a map of name → available; only available ones are shown. */
function catalogFeatures(stay: CatalogStay): string[] {
  return Object.entries(stay.features)
    .filter(([, on]) => on)
    .map(([name]) => name);
}

type Editing = { mode: "create" } | { mode: "edit"; itemId: string; expectedLastModifiedAt: string };

function sourceLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function Lodging({ tripId, items, members, onChanged, catalog: catalogProp }: LodgingProps) {
  const client = useApiClient();
  const toast = useToast();
  const formId = useId();
  const [catalog, setCatalog] = useState<Catalog | undefined>(catalogProp);
  const [catalogError, setCatalogError] = useState<string>();
  // Bumped by Retry to run the Catalog fetch again.
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [form, setForm] = useState<LodgingForm>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [filling, setFilling] = useState(false);
  const [fromListing, setFromListing] = useState(false);
  const [sources, setSources] = useState<string[]>([]);
  const [stale, setStale] = useState<LodgingItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<LodgingItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [fileBusy, setFileBusy] = useState<string | null>(null);

  useEffect(() => {
    if (catalogProp) {
      setCatalog(catalogProp);
      return;
    }
    let cancelled = false;
    setCatalogError(undefined);
    getCatalog(client)
      .then((c) => {
        if (!cancelled) setCatalog(c);
      })
      .catch((err: unknown) => {
        if (!cancelled) setCatalogError(describeError(err).message);
      });
    return () => {
      cancelled = true;
    };
  }, [client, catalogProp, catalogAttempt]);

  const stays = useMemo(() => catalog?.stays ?? [], [catalog]);
  const errorFor = (field: string) =>
    fieldErrors
      .filter((e) => e.field === field || e.field.startsWith(`${field}.`))
      .map((e) => e.message)
      .join("; ") || undefined;

  function set<K extends keyof LodgingForm>(key: K, value: LodgingForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function resetForm() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFieldErrors([]);
    setError(undefined);
    setStale(null);
    setFromListing(false);
    setSources([]);
  }

  function startCreate() {
    resetForm();
    setEditing({ mode: "create" });
  }

  function startEdit(item: LodgingItem) {
    resetForm();
    setEditing({ mode: "edit", itemId: item.itemId, expectedLastModifiedAt: item.lastModifiedAt });
    setForm(formFromFields(item.fields));
  }

  /** Prefills name, address, sleeps, price, features, and catalogStayId; keeps entered dates (Req 6.6). */
  function applyStay(stayId: string) {
    const stay = stays.find((s) => s.id === stayId);
    if (!stay) return;
    const prefill = lodgingFromCatalogStay(stay);
    setForm((f) => ({ ...formFromFields({ ...prefill }), ...pickKept(f) }));
    setFromListing(false);
    setSources([]);
    if (!editing) setEditing({ mode: "create" });
  }

  async function fillFromLink() {
    const listingUrl = form.listingUrl.trim();
    if (!listingUrl) {
      setFieldErrors([{ field: "listingUrl", message: "Enter an https listing link" }]);
      return;
    }
    setFilling(true);
    setFieldErrors([]);
    setError(undefined);
    try {
      const facts = await readListingLink(client, tripId, listingUrl);
      setForm((f) => ({
        ...f,
        name: facts.name ?? f.name,
        address: facts.address ?? f.address,
        sleeps: facts.sleeps === undefined ? f.sleeps : String(facts.sleeps),
        nightlyPrice: facts.nightlyPrice ?? f.nightlyPrice,
        catalogStayId: "",
        features: [],
      }));
      setFromListing(true);
      setSources((facts.sources ?? []).filter((url) => url.startsWith("https://")));
      toast.success("Filled from the listing. Check the details, then save.");
    } catch (err) {
      const described = describeError(err);
      setFieldErrors(described.fields);
      setError(described.message);
    } finally {
      setFilling(false);
    }
  }

  function pickKept(f: LodgingForm): Partial<LodgingForm> {
    return {
      checkIn: f.checkIn,
      checkOut: f.checkOut,
      listingUrl: f.listingUrl,
      confirmationNumber: f.confirmationNumber,
      doorCode: f.doorCode,
      checkInNotes: f.checkInNotes,
      selected: f.selected,
    };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const fields = fieldsFromForm(form);
    const result = validatePlanItem("Lodging", fields, LODGING_CTX);
    if (!result.ok) {
      setFieldErrors(result.errors);
      setError("Please fix the highlighted fields.");
      return;
    }
    setBusy(true);
    setFieldErrors([]);
    setError(undefined);
    try {
      if (editing.mode === "create") {
        await createItem(client, tripId, "Lodging", result.value);
      } else {
        const res = await updateItem(
          client,
          tripId,
          "Lodging",
          editing.itemId,
          result.value,
          editing.expectedLastModifiedAt,
        );
        if (!res.ok) {
          setStale(res.current as LodgingItem);
          toast.error("Someone else changed this stay. Review their version before saving.");
          return;
        }
      }
      const name = result.value.name ?? "Lodging";
      toast.success(editing.mode === "create" ? `Added ${name}.` : `Saved ${name}.`);
      resetForm();
      await onChanged();
    } catch (err) {
      const d = describeError(err);
      setError(d.message);
      setFieldErrors(d.fields);
      toast.error(`Could not save: ${d.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    const item = pendingDelete;
    if (!item) return;
    setDeleting(true);
    try {
      await deleteItem(client, tripId, "Lodging", item.itemId);
      if (editing?.mode === "edit" && editing.itemId === item.itemId) resetForm();
      toast.success(`Deleted ${item.fields.name ?? "lodging"}.`);
      setPendingDelete(null);
      await onChanged();
    } catch (err) {
      toast.error(`Could not delete: ${describeError(err).message}`);
    } finally {
      setDeleting(false);
    }
  }

  async function upload(item: LodgingItem, file: File | undefined) {
    if (!file) return;
    setFileBusy(item.itemId);
    try {
      await uploadConfirmation(client, tripId, item.itemId, file);
      toast.success(`Uploaded ${file.name}.`);
      await onChanged();
    } catch (err) {
      toast.error(`Upload failed: ${describeError(err).message}`);
    } finally {
      setFileBusy(null);
    }
  }

  async function download(item: LodgingItem) {
    setFileBusy(item.itemId);
    try {
      const { url } = await getConfirmationDownloadUrl(client, tripId, item.itemId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(`Download failed: ${describeError(err).message}`);
    } finally {
      setFileBusy(null);
    }
  }

  const linkedStay = form.catalogStayId ? stays.find((s) => s.id === form.catalogStayId) : undefined;

  return (
    <section aria-labelledby="lodging-heading" className="lodging">
      <div className="lodging__header">
        <h2 id="lodging-heading">Lodging</h2>
        {items.length > 0 && (
          <Button icon={<PlusIcon size={16} />} onClick={startCreate}>
            Add lodging
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="No lodging yet"
          description="Add a stay you are considering, or pick one from the San Diego Catalog."
          action={
            <Button icon={<PlusIcon size={16} />} onClick={startCreate}>
              Add lodging
            </Button>
          }
        />
      ) : (
        <ul className="lodging__list">
          {items.map((item) => (
            <StayCard
              key={item.itemId}
              item={item}
              stays={stays}
              members={members}
              fileBusy={fileBusy === item.itemId}
              onEdit={() => startEdit(item)}
              onDelete={() => setPendingDelete(item)}
              onUpload={(file) => upload(item, file)}
              onDownload={() => void download(item)}
            />
          ))}
        </ul>
      )}

      <Drawer
        open={editing !== null}
        onClose={() => {
          if (!busy) resetForm();
        }}
        title={editing?.mode === "edit" ? "Edit lodging" : "Add lodging"}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={resetForm} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <form id={formId} className="lodging-form" onSubmit={(e) => void submit(e)} noValidate>
          {stale && (
            <StaleConflict
              current={stale}
              members={members}
              onUseCurrent={(current) => {
                setEditing({ mode: "edit", itemId: current.itemId, expectedLastModifiedAt: current.lastModifiedAt });
                setForm(formFromFields(current.fields));
                setStale(null);
              }}
              onDismiss={() => {
                // Keep local edits; the next save overwrites the stored version the Member has now seen.
                setEditing({ mode: "edit", itemId: stale.itemId, expectedLastModifiedAt: stale.lastModifiedAt });
                setStale(null);
              }}
            />
          )}

          <fieldset className="lodging-form__group">
            <legend>Choose a stay from the Catalog</legend>
            {catalogError ? (
              <ErrorState
                compact
                headingLevel={4}
                title="Could not load the Catalog"
                message={`${catalogError} You can still enter a stay by hand below.`}
                onRetry={() => setCatalogAttempt((n) => n + 1)}
              />
            ) : !catalog ? (
              <div className="catalog-picker" role="status" aria-busy="true">
                <span className="visually-hidden">Loading Catalog…</span>
                <Skeleton variant="rect" height={96} />
                <Skeleton variant="rect" height={96} />
              </div>
            ) : stays.length === 0 ? (
              <p className="text-muted">The Catalog has no stays.</p>
            ) : (
              <ul className="catalog-picker">
                {stays.map((s) => {
                  const picked = form.catalogStayId === s.id;
                  return (
                    <li key={s.id} className={cx("catalog-stay", picked && "catalog-stay--picked")}>
                      <div className="catalog-stay__body">
                        <strong className="catalog-stay__name">{s.name}</strong>
                        <span className="catalog-stay__meta">{s.address}</span>
                        <span className="catalog-stay__meta">Sleeps {s.sleeps}</span>
                        <span className="catalog-stay__price">{formatEstimate(s.nightlyPrice, "night")}</span>
                        {catalogFeatures(s).length > 0 && (
                          <span className="lodging__features">
                            {catalogFeatures(s).map((feat) => (
                              <Badge key={feat}>{feat}</Badge>
                            ))}
                          </span>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant={picked ? "secondary" : "primary"}
                        icon={picked ? <CheckIcon size={14} /> : undefined}
                        aria-pressed={picked}
                        aria-label={picked ? `${s.name} prefilled` : `Use ${s.name}`}
                        onClick={() => applyStay(s.id)}
                      >
                        {picked ? "Prefilled" : "Use this stay"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            {form.catalogStayId && (
              <p className="lodging-form__linked">
                Linked to Catalog stay {linkedStay?.name ?? form.catalogStayId}.{" "}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setForm((f) => ({ ...f, catalogStayId: "", features: [] }))}
                >
                  Unlink
                </Button>
              </p>
            )}
          </fieldset>

          <fieldset className="lodging-form__group">
            <legend>Stay</legend>
            <TextInput label="Name" value={form.name} error={errorFor("name")} onChange={(e) => set("name", e.target.value)} />
            <TextInput
              label="Listing link"
              type="url"
              placeholder="https://"
              value={form.listingUrl}
              error={errorFor("listingUrl")}
              onChange={(e) => set("listingUrl", e.target.value)}
            />
            <Button
              type="button"
              variant="secondary"
              loading={filling}
              disabled={form.listingUrl.trim() === ""}
              onClick={() => void fillFromLink()}
            >
              Fill from link
            </Button>
            <p className="lodging-form__hint">
              TripWise reads the public page and searches the web for the name, address, sleeps, and nightly price. The stay is saved when you submit the form.
            </p>
            {sources.length > 0 && (
              <ul className="lodging-form__sources">
                {sources.map((url) => (
                  <li key={url}>
                    <a href={url} target="_blank" rel="noreferrer">
                      {sourceLabel(url)}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <TextInput
              label="Address"
              value={form.address}
              error={errorFor("address")}
              onChange={(e) => set("address", e.target.value)}
            />
            <div className="lodging-form__row">
              <TextInput
                label="Check-in date"
                type="date"
                required
                value={form.checkIn}
                error={errorFor("checkIn")}
                onChange={(e) => set("checkIn", e.target.value)}
              />
              <TextInput
                label="Check-out date"
                type="date"
                required
                value={form.checkOut}
                error={errorFor("checkOut")}
                onChange={(e) => set("checkOut", e.target.value)}
              />
            </div>
            <div className="lodging-form__row">
              <TextInput
                label="Sleeps"
                type="number"
                min={1}
                step={1}
                required
                value={form.sleeps}
                error={errorFor("sleeps")}
                onChange={(e) => set("sleeps", e.target.value)}
              />
              <TextInput
                label="Nightly price (USD)"
                inputMode="decimal"
                required
                value={form.nightlyPrice}
                hint={fromListing ? "Estimated from the listing page. Check it before saving." : linkedStay ? formatEstimate(linkedStay.nightlyPrice, "night") : undefined}
                error={errorFor("nightlyPriceCents")}
                onChange={(e) => set("nightlyPrice", e.target.value)}
              />
            </div>
            <Checkbox
              label="Selected stay for feasibility checks"
              checked={form.selected}
              onChange={(e) => set("selected", e.target.checked)}
            />
          </fieldset>

          <fieldset className="lodging-form__group">
            <legend>Check-in details</legend>
            <TextInput
              label="Confirmation number"
              value={form.confirmationNumber}
              error={errorFor("confirmationNumber")}
              onChange={(e) => set("confirmationNumber", e.target.value)}
            />
            <TextInput
              label="Door code"
              value={form.doorCode}
              error={errorFor("checkInDetails.doorCode")}
              onChange={(e) => set("doorCode", e.target.value)}
            />
            <TextArea
              label="Check-in notes"
              value={form.checkInNotes}
              error={errorFor("checkInDetails.notes")}
              onChange={(e) => set("checkInNotes", e.target.value)}
            />
          </fieldset>

          {error && (
            <p role="alert" className="alert alert--danger">
              {error}
            </p>
          )}
        </form>
      </Drawer>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete ${pendingDelete?.fields.name ?? "this lodging"}?`}
        message="This removes the stay and its confirmation link for everyone on the trip."
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}

interface StayCardProps {
  item: LodgingItem;
  stays: readonly CatalogStay[];
  members?: readonly Pick<Membership, "userId" | "displayName">[];
  fileBusy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onUpload: (file: File | undefined) => Promise<void>;
  onDownload: () => void;
}

/** One Lodging item: summary always visible, door code and confirmation behind a toggle. */
export function StayCard({ item, stays, members, fileBusy, onEdit, onDelete, onUpload, onDownload }: StayCardProps) {
  const f = item.fields;
  const [showDetails, setShowDetails] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const detailsId = useId();
  const nights = nightsBetween(f.checkIn, f.checkOut);
  const hasDetails = Boolean(f.confirmationNumber || f.checkInDetails?.doorCode || f.checkInDetails?.notes);
  const name = f.name ?? "Lodging";

  return (
    <Card
      as="li"
      className={cx("stay-card", f.selected && "stay-card--selected")}
      title={name}
      subtitle={f.address}
      actions={
        f.selected ? (
          <Badge tone="success" icon={<CheckIcon size={12} />}>
            Selected
          </Badge>
        ) : undefined
      }
      footer={
        <div className="stay-card__footer">
          <LastModified lastModifiedBy={item.lastModifiedBy} lastModifiedAt={item.lastModifiedAt} members={members} />
          <div className="row">
            <Button size="sm" variant="secondary" onClick={onEdit} aria-label={`Edit ${name}`}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={onDelete} aria-label={`Delete ${name}`}>
              Delete
            </Button>
          </div>
        </div>
      }
    >
      <dl className="stay-card__facts">
        <div>
          <dt>Dates</dt>
          <dd>
            <time dateTime={f.checkIn}>{formatStayDate(f.checkIn)}</time> –{" "}
            <time dateTime={f.checkOut}>{formatStayDate(f.checkOut)}</time>
          </dd>
        </div>
        {nights !== undefined && (
          <div>
            <dt>Nights</dt>
            <dd>{nights}</dd>
          </div>
        )}
        <div>
          <dt>Sleeps</dt>
          <dd>{f.sleeps}</dd>
        </div>
        <div>
          <dt>Price</dt>
          <dd>{priceLabel(f, stays)}</dd>
        </div>
      </dl>

      {f.features && f.features.length > 0 && (
        <div className="lodging__features" aria-label="Features">
          {f.features.map((feat) => (
            <Badge key={feat}>{feat}</Badge>
          ))}
        </div>
      )}

      {f.listingUrl && (
        <p className="stay-card__link">
          <a href={f.listingUrl} target="_blank" rel="noopener noreferrer">
            View listing
          </a>
        </p>
      )}

      {hasDetails && (
        <div className="stay-card__details">
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={showDetails}
            aria-controls={detailsId}
            onClick={() => setShowDetails((v) => !v)}
          >
            {showDetails ? "Hide check-in details" : "Show check-in details"}
          </Button>
          {showDetails && (
            <dl id={detailsId} className="stay-card__secret">
              {f.confirmationNumber && (
                <div>
                  <dt>Confirmation number</dt>
                  <dd>{f.confirmationNumber}</dd>
                </div>
              )}
              {f.checkInDetails?.doorCode && (
                <div>
                  <dt>Door code</dt>
                  <dd className="stay-card__code">{f.checkInDetails.doorCode}</dd>
                </div>
              )}
              {f.checkInDetails?.notes && (
                <div>
                  <dt>Check-in notes</dt>
                  <dd>{f.checkInDetails.notes}</dd>
                </div>
              )}
            </dl>
          )}
        </div>
      )}

      <div className="stay-card__file row">
        <input
          ref={fileInputRef}
          type="file"
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          disabled={fileBusy}
          onChange={(e) => {
            const input = e.currentTarget;
            void onUpload(input.files?.[0]).finally(() => {
              input.value = "";
            });
          }}
        />
        <Button size="sm" variant="secondary" loading={fileBusy} onClick={() => fileInputRef.current?.click()}>
          {f.confirmationKey ? "Replace confirmation file" : "Upload confirmation file"}
        </Button>
        {f.confirmationKey && (
          <Button size="sm" variant="ghost" disabled={fileBusy} onClick={onDownload}>
            Download confirmation
          </Button>
        )}
      </div>
    </Card>
  );
}
