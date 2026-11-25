import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import type { IsoDate, ItineraryFields, ItineraryItem, LodgingItem } from "@tripwise/shared";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useApiClient } from "../api/ApiClientContext";
import { createItem, deleteItem, updateItem } from "../api/items";
import { geocode, routePlaces, searchPlaces, type GeoHit } from "../map/geo";
import {
  addMinutes,
  datesInclusive,
  driveNote,
  mergeNotes,
  nextStartTime,
  placeQuery,
  readPin,
  stayQuery,
  type MapPlace,
  type TravelLeg,
} from "../map/places";
import { Button, Card, ConfirmDialog, Select, TextInput, useToast } from "../ui";
import { describeError } from "./planSectionHelpers";
import "./PlaceMap.css";

export interface PlaceMapProps {
  tripId: string;
  trip: { destination: string; startDate: IsoDate; endDate: IsoDate };
  items: readonly ItineraryItem[];
  lodging: readonly LodgingItem[];
  onChanged: () => void | Promise<void>;
}

interface RoutePlan {
  order: MapPlace[];
  legs: TravelLeg[];
  line: [number, number][];
  approximate: boolean;
}

const STAY_MINUTES = 60;

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
}

function pinIcon(label: string, tone: "stop" | "idea" | "stay"): L.DivIcon {
  return L.divIcon({
    className: "place-pin",
    html: `<span class="place-pin__dot place-pin__dot--${tone}">${escapeHtml(label)}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function sortedItems(items: readonly ItineraryItem[]): ItineraryItem[] {
  return [...items].sort((a, b) => {
    const byDay = a.fields.day.localeCompare(b.fields.day);
    if (byDay !== 0) return byDay;
    return a.fields.startTime.localeCompare(b.fields.startTime);
  });
}

export function PlaceMap({ tripId, trip, items, lodging, onChanged }: PlaceMapProps) {
  const client = useApiClient();
  const toast = useToast();
  const searchId = useId();
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<GeoHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<MapPlace | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [located, setLocated] = useState<MapPlace[]>([]);
  const [missed, setMissed] = useState<string[]>([]);
  const [stay, setStay] = useState<MapPlace | null>(null);
  const [city, setCity] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [route, setRoute] = useState<RoutePlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [day, setDay] = useState<IsoDate>(trip.startDate);

  const days = useMemo(() => datesInclusive(trip.startDate, trip.endDate), [trip.startDate, trip.endDate]);
  const signature = useMemo(() => {
    const stops = sortedItems(items)
      .map((item) => `${item.itemId}|${item.fields.stopName}|${item.fields.day}|${item.fields.startTime}`)
      .join("\n");
    const stays = lodging.map((item) => `${item.itemId}|${item.fields.address ?? ""}|${item.fields.name ?? ""}`).join("\n");
    return `${trip.destination}\n${stops}\n${stays}`;
  }, [items, lodging, trip.destination]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || mapRef.current) return;
    const map = L.map(host, { scrollWheelZoom: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    map.setView([39.8, -98.6], 4);
    mapRef.current = map;
    requestAnimationFrame(() => map.invalidateSize());
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLocating(true);
    setLocateError(null);
    setRoute(null);
    void (async () => {
      const pins: MapPlace[] = [];
      const missing: string[] = [];
      try {
        const cityHit = await geocode(trip.destination);
        if (cancelled) return;
        setCity(cityHit);
        const staySource = lodging.find((item) => item.fields.address?.trim() || item.fields.name?.trim());
        const stayText = staySource ? stayQuery(staySource.fields, trip.destination) : null;
        const stayHit = stayText ? await geocode(stayText) : null;
        if (cancelled) return;
        setStay(
          stayHit && staySource
            ? {
                id: `stay-${staySource.itemId}`,
                name: staySource.fields.name?.trim() || staySource.fields.address?.trim() || "Stay",
                lat: stayHit.lat,
                lng: stayHit.lng,
                kind: "stay",
              }
            : null,
        );
        for (const item of sortedItems(items)) {
          const stored =
            item.fields.lat !== undefined && item.fields.lng !== undefined
              ? { lat: item.fields.lat, lng: item.fields.lng }
              : readPin(item.fields.notes);
          const hit = stored ?? (await geocode(placeQuery(item.fields.stopName, trip.destination)));
          if (cancelled) return;
          if (!hit) {
            missing.push(item.fields.stopName);
            continue;
          }
          pins.push({
            id: item.itemId,
            itemId: item.itemId,
            name: item.fields.stopName,
            lat: hit.lat,
            lng: hit.lng,
            notes: item.fields.notes,
            endTime: item.fields.endTime,
            lastModifiedAt: item.lastModifiedAt,
            kind: "stop",
          });
        }
        if (cancelled) return;
        setLocated(pins);
        setMissed(missing);
      } catch (err) {
        if (!cancelled) setLocateError(err instanceof Error ? err.message : "Could not look up these places.");
      } finally {
        if (!cancelled) setLocating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signature, items, lodging, trip.destination]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const numbers = new Map<string, number>();
    let n = 0;
    for (const place of route?.order ?? located) {
      if (place.kind === "stop") numbers.set(place.id, ++n);
    }
    const pins = [...(stay ? [stay] : []), ...located];
    for (const pin of pins) {
      const label = pin.kind === "stay" ? "S" : String(numbers.get(pin.id) ?? "");
      const tone = pin.kind === "stay" ? "stay" : "stop";
      L.marker([pin.lat, pin.lng], { icon: pinIcon(label, tone), title: pin.name, zIndexOffset: pin.kind === "stay" ? 0 : 100 })
        .bindPopup(`<strong>${escapeHtml(pin.name)}</strong>`)
        .addTo(layer);
    }
    if (route && route.line.length > 1) {
      L.polyline(route.line, { color: "#4f46e5", weight: 4, opacity: 0.9 }).addTo(layer);
    }
    if (pins.length > 0) {
      map.fitBounds(L.latLngBounds(pins.map((pin) => [pin.lat, pin.lng])), { padding: [32, 32], maxZoom: 14 });
    } else if (city) {
      map.setView([city.lat, city.lng], 12);
    }
    requestAnimationFrame(() => map.invalidateSize());
  }, [located, stay, route, city]);

  const stops = located.length;
  const canPlan = stops >= 1 && stops + (stay ? 1 : 0) >= 2;

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    const text = query.trim();
    if (!text) return;
    setSearching(true);
    setHits([]);
    try {
      const found = await searchPlaces(placeQuery(text, trip.destination), 5);
      setHits(found);
      if (found.length === 0) toast.info("No matching place. Try a more specific name.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Place search failed.");
    } finally {
      setSearching(false);
    }
  }

  async function addHit(hit: GeoHit) {
    setAdding(true);
    try {
      const startTime = nextStartTime(
        items.filter((item) => item.fields.day === trip.startDate).map((item) => item.fields.startTime),
      );
      const fields: ItineraryFields = {
        day: trip.startDate,
        startTime,
        stopName: hit.name,
        lat: hit.lat,
        lng: hit.lng,
      };
      await createItem(client, tripId, "Itinerary", fields);
      setHits([]);
      setQuery("");
      setRoute(null);
      toast.success(`${hit.name} is on the map for everyone on this trip.`);
      await onChanged();
    } catch (err) {
      toast.error(describeError(err).message);
    } finally {
      setAdding(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete?.itemId) return;
    setDeleting(true);
    try {
      await deleteItem(client, tripId, "Itinerary", pendingDelete.itemId);
      setRoute(null);
      toast.success(`Removed ${pendingDelete.name}.`);
      setPendingDelete(null);
      await onChanged();
    } catch (err) {
      toast.error(describeError(err).message);
    } finally {
      setDeleting(false);
    }
  }

  async function planRoute() {
    const points = [...(stay ? [stay] : []), ...located];
    if (points.length < 2) return;
    setPlanning(true);
    try {
      const planned = await routePlaces(points, Boolean(stay));
      setRoute(planned);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not plan a route.");
    } finally {
      setPlanning(false);
    }
  }

  async function saveRoute() {
    if (!route) return;
    const ordered = route.order.filter((place) => place.kind === "stop");
    if (ordered.length === 0) return;
    setSaving(true);
    let time = "09:00";
    try {
      for (const stop of ordered) {
        const index = route.order.findIndex((place) => place.id === stop.id);
        const incoming = index > 0 ? route.legs[index - 1] : undefined;
        const notes = mergeNotes(stop.notes, driveNote(incoming, route.order[index - 1]?.kind === "stay"));
        const fields: ItineraryFields = { day, startTime: time, stopName: stop.name, lat: stop.lat, lng: stop.lng };
        if (stop.endTime) fields.endTime = stop.endTime;
        if (notes) fields.notes = notes;
        if (!stop.itemId || !stop.lastModifiedAt) continue;
        const result = await updateItem(client, tripId, "Itinerary", stop.itemId, fields, stop.lastModifiedAt);
        if (!result.ok) {
          toast.error("Someone else just edited a stop. The trip was reloaded, so plan the route again.");
          await onChanged();
          return;
        }
        time = addMinutes(time, STAY_MINUTES + (route.legs[index]?.minutes ?? 0));
      }
      setRoute(null);
      toast.success(`Saved ${ordered.length} stop${ordered.length === 1 ? "" : "s"} to ${dayLabel(day)}.`);
      await onChanged();
    } catch (err) {
      toast.error(describeError(err).message);
    } finally {
      setSaving(false);
    }
  }

  const listed = (route ? route.order : located).filter((place) => place.kind === "stop");

  return (
    <div className="place-map">
      <p className="place-map__intro">
        Every itinerary stop is pinned here for the whole group. Adding a place saves it on the itinerary, so the
        next person who opens the map sees the same pins. Plan the route when you want a driving order.
      </p>
      <div className="place-map__layout">
        <div className="place-map__stage">
          <div ref={hostRef} className="place-map__canvas" role="region" aria-label="Trip map" />
          <p className="place-map__credit">Map data from OpenStreetMap. Roads from the public OSRM router.</p>
        </div>
        <Card className="place-map__panel">
          <form className="place-map__search" onSubmit={onSearch}>
            <TextInput
              id={searchId}
              label="Add a place"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`A place in ${trip.destination}`}
            />
            <Button type="submit" variant="secondary" loading={searching} disabled={!query.trim()}>
              Search
            </Button>
          </form>
          {hits.length > 0 && (
            <ul className="place-map__hits">
              {hits.map((hit) => (
                <li key={`${hit.lat},${hit.lng}`}>
                  <button type="button" className="place-map__hit" disabled={adding} onClick={() => void addHit(hit)}>
                    {hit.name}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="place-map__status" aria-live="polite">
            {locating && <p>Placing itinerary stops on the map…</p>}
            {locateError && <p className="place-map__warn">{locateError}</p>}
            {missed.length > 0 && (
              <p className="place-map__warn">
                Could not find {missed.join(", ")} near {trip.destination}. Those stops stay on the itinerary as written.
              </p>
            )}
          </div>

          {listed.length === 0 && !locating ? (
            <p className="place-map__empty">No stops yet. Add one on the Itinerary tab, or add a place here.</p>
          ) : (
            <ol className="place-map__stops">
              {listed.map((stop) => {
                const index = route ? route.order.findIndex((place) => place.id === stop.id) : -1;
                const incoming = route && index > 0 ? route.legs[index - 1] : undefined;
                return (
                  <li key={stop.id} className="place-map__stop">
                    <div>
                      <span className="place-map__stop-name">{stop.name}</span>
                      <span className="place-map__stop-meta">
                        On the itinerary
                        {incoming ? ` · ${incoming.minutes} min, ${incoming.km} km` : ""}
                      </span>
                    </div>
                    {stop.itemId && (
                      <Button variant="ghost" size="sm" onClick={() => setPendingDelete(stop)}>
                        Remove
                      </Button>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {stay && <p className="place-map__stay">The drive starts at {stay.name}.</p>}
          {route?.approximate && (
            <p className="place-map__warn">Road directions were unavailable, so this order uses straight-line distance.</p>
          )}

          <Select
            label="Save onto"
            value={day}
            options={days.map((value) => ({ value, label: dayLabel(value) }))}
            onChange={(event) => setDay(event.target.value as IsoDate)}
          />
          <div className="place-map__actions">
            <Button variant="secondary" onClick={() => void planRoute()} loading={planning} disabled={!canPlan || locating}>
              Plan the route
            </Button>
            <Button onClick={() => void saveRoute()} loading={saving} disabled={!route || saving}>
              Save to itinerary
            </Button>
          </div>
          {!canPlan && stops > 0 && !stay && (
            <p className="place-map__hint">Add one more place to plan a route between them.</p>
          )}
        </Card>
      </div>
      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete ? `Remove ${pendingDelete.name}?` : "Remove this place?"}
        message="This removes the pin for everyone on the trip."
        confirmLabel="Remove"
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
