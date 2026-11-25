import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  formatEstimate,
  lodgingFromCatalogStay,
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
} from "../api/items";
import { LastModified } from "../components/LastModified";
import { StaleConflict } from "../components/StaleConflict";

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
    const body = err.body as { error?: string; fields?: FieldError[] } | undefined;
    if (err.status === 400 && body?.error === "VALIDATION" && Array.isArray(body.fields)) {
      return { message: "Please fix the highlighted fields.", fields: body.fields };
    }
    if (err.status === 403) return { message: "You are not a Member of this trip.", fields: [] };
    return { message: `Request failed (${err.status}${body?.error ? ` ${body.error}` : ""}).`, fields: [] };
  }
  return { message: err instanceof Error ? err.message : "Something went wrong.", fields: [] };
}

function priceLabel(fields: LodgingFields, stays: readonly CatalogStay[]): string {
  const stay = fields.catalogStayId ? stays.find((s) => s.id === fields.catalogStayId) : undefined;
  if (stay && stay.nightlyPrice.cents === fields.nightlyPriceCents) {
    return formatEstimate(stay.nightlyPrice, "night");
  }
  return `$${centsToDollars(fields.nightlyPriceCents)}/night`;
}

type Editing = { mode: "create" } | { mode: "edit"; itemId: string; expectedLastModifiedAt: string };

export function Lodging({ tripId, items, members, onChanged, catalog: catalogProp }: LodgingProps) {
  const client = useApiClient();
  const [catalog, setCatalog] = useState<Catalog | undefined>(catalogProp);
  const [catalogError, setCatalogError] = useState<string>();
  const [pickedStayId, setPickedStayId] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [form, setForm] = useState<LodgingForm>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState<LodgingItem | null>(null);
  const [fileBusy, setFileBusy] = useState<string | null>(null);
  const [fileMessage, setFileMessage] = useState<{ itemId: string; text: string } | null>(null);

  useEffect(() => {
    if (catalogProp) {
      setCatalog(catalogProp);
      return;
    }
    let cancelled = false;
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
  }, [client, catalogProp]);

  const stays = useMemo(() => catalog?.stays ?? [], [catalog]);
  const errorFor = (field: string) =>
    fieldErrors
      .filter((e) => e.field === field || e.field.startsWith(`${field}.`))
      .map((e) => e.message)
      .join("; ");

  function set<K extends keyof LodgingForm>(key: K, value: LodgingForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function resetForm() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFieldErrors([]);
    setError(undefined);
    setStale(null);
    setPickedStayId("");
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
    if (!editing) setEditing({ mode: "create" });
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
          return;
        }
      }
      resetForm();
      await onChanged();
    } catch (err) {
      const d = describeError(err);
      setError(d.message);
      setFieldErrors(d.fields);
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: LodgingItem) {
    if (!window.confirm(`Delete ${item.fields.name ?? "this lodging"}?`)) return;
    setError(undefined);
    try {
      await deleteItem(client, tripId, "Lodging", item.itemId);
      if (editing?.mode === "edit" && editing.itemId === item.itemId) resetForm();
      await onChanged();
    } catch (err) {
      setError(describeError(err).message);
    }
  }

  async function upload(item: LodgingItem, file: File | undefined) {
    if (!file) return;
    setFileBusy(item.itemId);
    setFileMessage(null);
    try {
      await uploadConfirmation(client, tripId, item.itemId, file);
      setFileMessage({ itemId: item.itemId, text: `Uploaded ${file.name}.` });
      await onChanged();
    } catch (err) {
      setFileMessage({ itemId: item.itemId, text: `Upload failed: ${describeError(err).message}` });
    } finally {
      setFileBusy(null);
    }
  }

  async function download(item: LodgingItem) {
    setFileBusy(item.itemId);
    setFileMessage(null);
    try {
      const { url } = await getConfirmationDownloadUrl(client, tripId, item.itemId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setFileMessage({ itemId: item.itemId, text: `Download failed: ${describeError(err).message}` });
    } finally {
      setFileBusy(null);
    }
  }

  return (
    <section aria-labelledby="lodging-heading">
      <h2 id="lodging-heading">Lodging</h2>

      {items.length === 0 ? (
        <p>No lodging yet.</p>
      ) : (
        <ul>
          {items.map((item) => {
            const f = item.fields;
            return (
              <li key={item.itemId} className="card">
                <h3>
                  {f.name ?? "Lodging"}
                  {f.selected ? " (selected)" : ""}
                </h3>
                {f.address && <p>{f.address}</p>}
                {f.listingUrl && (
                  <p>
                    <a href={f.listingUrl} target="_blank" rel="noopener noreferrer">
                      Listing
                    </a>
                  </p>
                )}
                <p>
                  {f.checkIn} to {f.checkOut} · Sleeps {f.sleeps} · {priceLabel(f, stays)}
                </p>
                {f.features && f.features.length > 0 && <p>Features: {f.features.join(", ")}</p>}
                {f.confirmationNumber && <p>Confirmation number: {f.confirmationNumber}</p>}
                {f.checkInDetails?.doorCode && <p>Door code: {f.checkInDetails.doorCode}</p>}
                {f.checkInDetails?.notes && <p>Check-in notes: {f.checkInDetails.notes}</p>}
                <LastModified
                  lastModifiedBy={item.lastModifiedBy}
                  lastModifiedAt={item.lastModifiedAt}
                  members={members}
                />
                <div>
                  <button type="button" onClick={() => startEdit(item)}>
                    Edit
                  </button>
                  <button type="button" onClick={() => void remove(item)}>
                    Delete
                  </button>
                </div>
                <div>
                  <label>
                    {f.confirmationKey ? "Replace confirmation file" : "Upload confirmation file"}{" "}
                    <input
                      type="file"
                      disabled={fileBusy === item.itemId}
                      onChange={(e) => {
                        const input = e.currentTarget;
                        void upload(item, input.files?.[0]).finally(() => {
                          input.value = "";
                        });
                      }}
                    />
                  </label>
                  {f.confirmationKey && (
                    <button type="button" disabled={fileBusy === item.itemId} onClick={() => void download(item)}>
                      Download confirmation
                    </button>
                  )}
                  {fileMessage?.itemId === item.itemId && <p role="status">{fileMessage.text}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div>
        <h3>Choose a stay from the Catalog</h3>
        {catalogError ? (
          <p role="alert">Could not load the Catalog: {catalogError}</p>
        ) : !catalog ? (
          <p>Loading Catalog…</p>
        ) : (
          <>
            <label>
              Catalog stay{" "}
              <select value={pickedStayId} onChange={(e) => setPickedStayId(e.target.value)}>
                <option value="">Select a stay…</option>
                {stays.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · sleeps {s.sleeps} · {formatEstimate(s.nightlyPrice, "night")}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" disabled={!pickedStayId} onClick={() => applyStay(pickedStayId)}>
              Prefill from stay
            </button>
          </>
        )}
      </div>

      {!editing ? (
        <button type="button" onClick={startCreate}>
          Add lodging
        </button>
      ) : (
        <form onSubmit={(e) => void submit(e)} noValidate>
          <h3>{editing.mode === "create" ? "Add lodging" : "Edit lodging"}</h3>
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
          <Field label="Name" error={errorFor("name")}>
            <input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Listing link" error={errorFor("listingUrl")}>
            <input
              type="url"
              placeholder="https://"
              value={form.listingUrl}
              onChange={(e) => set("listingUrl", e.target.value)}
            />
          </Field>
          <Field label="Address" error={errorFor("address")}>
            <input value={form.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
          <Field label="Check-in date" error={errorFor("checkIn")}>
            <input type="date" value={form.checkIn} onChange={(e) => set("checkIn", e.target.value)} />
          </Field>
          <Field label="Check-out date" error={errorFor("checkOut")}>
            <input type="date" value={form.checkOut} onChange={(e) => set("checkOut", e.target.value)} />
          </Field>
          <Field label="Sleeps" error={errorFor("sleeps")}>
            <input
              type="number"
              min={1}
              step={1}
              value={form.sleeps}
              onChange={(e) => set("sleeps", e.target.value)}
            />
          </Field>
          <Field label="Nightly price (USD)" error={errorFor("nightlyPriceCents")}>
            <input
              inputMode="decimal"
              value={form.nightlyPrice}
              onChange={(e) => set("nightlyPrice", e.target.value)}
            />
            {(() => {
              const stay = form.catalogStayId ? stays.find((s) => s.id === form.catalogStayId) : undefined;
              return stay ? <small> {formatEstimate(stay.nightlyPrice, "night")}</small> : null;
            })()}
          </Field>
          <Field label="Confirmation number" error={errorFor("confirmationNumber")}>
            <input value={form.confirmationNumber} onChange={(e) => set("confirmationNumber", e.target.value)} />
          </Field>
          <Field label="Door code" error={errorFor("checkInDetails.doorCode")}>
            <input value={form.doorCode} onChange={(e) => set("doorCode", e.target.value)} />
          </Field>
          <Field label="Check-in details" error={errorFor("checkInDetails.notes")}>
            <textarea value={form.checkInNotes} onChange={(e) => set("checkInNotes", e.target.value)} />
          </Field>
          <label>
            <input type="checkbox" checked={form.selected} onChange={(e) => set("selected", e.target.checked)} />{" "}
            Selected stay for feasibility checks
          </label>
          {form.catalogStayId && (
            <p>
              From Catalog stay {form.catalogStayId}{" "}
              <button type="button" onClick={() => setForm((f) => ({ ...f, catalogStayId: "", features: [] }))}>
                Unlink
              </button>
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={resetForm} disabled={busy}>
            Cancel
          </button>
        </form>
      )}
    </section>
  );
}

function Field({ label, error, children }: { label: string; error: string; children: ReactNode }) {
  return (
    <div>
      <label>
        {label} {children}
      </label>
      {error && <span role="alert" className="field-error"> {error}</span>}
    </div>
  );
}
