import { calculateAutoFare, calculateMetroFare, getDistance } from "@/lib/fare-calculator";
import { getStations, resolveCanonicalName, resolveStation } from "@/lib/cache";
import type { Language, RouteSegment, TransitRoute, TransportMode } from "@/types";

type AccessMode = Extract<TransportMode, "walk" | "auto" | "bus" | "water_metro">;

interface ProximityInfo {
  station: string;
  distance_km: number;
  mode: AccessMode;
}

interface WaterMetroRoute {
  id: string;
  name: string;
  stops: string[];
  duration: number;
  fare: number;
  frequency: number;
  firstService: string;
  lastService: string;
  connectsTo: {
    metro: string;
    walkDistance?: number;
    autoDistance?: number;
  };
}

export const STATION_PROXIMITY: Record<string, ProximityInfo> = {
  "Lulu Mall": { station: "Edapally", distance_km: 0.8, mode: "walk" },
  Kakkanad: { station: "Vyttila", distance_km: 8, mode: "auto" },
  Infopark: { station: "Palarivattom", distance_km: 9, mode: "auto" },
  "Fort Kochi": { station: "MG Road", distance_km: 8.2, mode: "auto" },
  Airport: { station: "Aluva", distance_km: 14, mode: "auto" },
  "Lissie Hospital": { station: "Kaloor", distance_km: 1.5, mode: "auto" },
  "Medical College": { station: "Edapally", distance_km: 3.2, mode: "auto" },
  "Marine Drive": { station: "MG Road", distance_km: 1.2, mode: "walk" },
  "Hill Palace": { station: "Tripunithura", distance_km: 2.5, mode: "auto" },
  "Ernakulam Junction": { station: "Ernakulam South", distance_km: 0.5, mode: "walk" },
  Vypin: { station: "Vyttila", distance_km: 0, mode: "water_metro" },
  Vypeen: { station: "Vyttila", distance_km: 0, mode: "water_metro" },
  "High Court Jetty": { station: "MG Road", distance_km: 1.5, mode: "auto" },
  "Ernakulam Boat Jetty": { station: "Vyttila", distance_km: 0, mode: "water_metro" },
};

export const WATER_METRO_ROUTES: WaterMetroRoute[] = [
  {
    id: "WM1",
    name: "Vyttila - Kakkanad",
    stops: ["Vyttila Hub", "South Chittoor", "Kakkanad"],
    duration: 25,
    fare: 30,
    frequency: 20,
    firstService: "06:30",
    lastService: "21:00",
    connectsTo: { metro: "Vyttila", walkDistance: 0.3 },
  },
  {
    id: "WM2",
    name: "High Court - Vypin",
    stops: ["High Court", "Fort Kochi", "Vypeen"],
    duration: 30,
    fare: 25,
    frequency: 20,
    firstService: "06:00",
    lastService: "21:30",
    connectsTo: { metro: "MG Road", autoDistance: 1.5 },
  },
  {
    id: "WM3",
    name: "Vyttila - Ernakulam Boat Jetty",
    stops: ["Vyttila Hub", "Ernakulam Boat Jetty"],
    duration: 15,
    fare: 20,
    frequency: 15,
    firstService: "06:15",
    lastService: "21:00",
    connectsTo: { metro: "Vyttila", walkDistance: 0.3 },
  },
];

const TRANSFER_BUFFER_MINUTES = 5;
const WATER_METRO_WAIT_FRACTION = 0.5;

function canonicalPlace(query: string): string {
  return resolveCanonicalName(query) ?? query.trim();
}

function normalizePlace(query: string): string {
  return canonicalPlace(query).toLowerCase();
}

function getStationIndex(stationName: string): number {
  const station = resolveStation(stationName);
  if (!station) return -1;
  return getStations().findIndex((item) => item.code === station.code);
}

function getProximity(query: string): ProximityInfo | null {
  const normalized = normalizePlace(query);
  const entry = Object.entries(STATION_PROXIMITY).find(
    ([place]) => place.toLowerCase() === normalized
  );
  return entry?.[1] ?? null;
}

function hasMetroStation(query: string): boolean {
  const station = resolveStation(query);
  const canonical = canonicalPlace(query);
  return Boolean(station && station.name_en.toLowerCase() === canonical.toLowerCase());
}

function minutesForDistance(mode: TransportMode, distanceKm: number): number {
  switch (mode) {
    case "metro":
      return Math.max(3, Math.round(distanceKm * 2.5));
    case "water_metro":
      return Math.max(10, Math.round(distanceKm * 4));
    case "bus":
      return Math.max(8, Math.round(distanceKm * 3.5));
    case "auto":
      return Math.max(4, Math.round((distanceKm / 25) * 60));
    case "walk":
      return Math.max(3, Math.round(distanceKm * 12));
    default:
      return 10;
  }
}

export function getMetroTravelTime(fromStation: string, toStation: string): number {
  const fromIndex = getStationIndex(fromStation);
  const toIndex = getStationIndex(toStation);
  if (fromIndex < 0 || toIndex < 0) return 0;
  return Math.round(Math.abs(toIndex - fromIndex) * 2.5);
}

export function getApproxMetroFare(fromStation: string, toStation: string): number {
  const fromIndex = getStationIndex(fromStation);
  const toIndex = getStationIndex(toStation);
  if (fromIndex < 0 || toIndex < 0) return 0;

  const stationCount = Math.abs(toIndex - fromIndex);
  if (stationCount <= 2) return 10;
  if (stationCount <= 4) return 20;
  if (stationCount <= 6) return 30;
  if (stationCount <= 9) return 40;
  if (stationCount <= 12) return 50;
  if (stationCount <= 18) return 60;
  return 65;
}

function metroSegment(fromStation: string, toStation: string): RouteSegment | null {
  const from = resolveStation(fromStation);
  const to = resolveStation(toStation);
  if (!from || !to) return null;

  const fromIndex = getStationIndex(from.name_en);
  const toIndex = getStationIndex(to.name_en);
  const stopCount = Math.abs(toIndex - fromIndex);
  const direction = toIndex > fromIndex ? "southbound" : "northbound";
  const distance = Math.abs((to.chainage_km ?? 0) - (from.chainage_km ?? 0));
  const fare = calculateMetroFare(from.code, to.code) || getApproxMetroFare(from.name_en, to.name_en);
  const duration = getMetroTravelTime(from.name_en, to.name_en);

  return {
    mode: "metro",
    from: from.name_en,
    to: to.name_en,
    duration,
    fare,
    distance_km: Number(distance.toFixed(1)),
    details: `Take Kochi Metro Blue Line ${direction} for ${stopCount} stop(s).`,
    details_ml: `കൊച്ചി മെട്രോ ബ്ലൂ ലൈൻ ${direction === "southbound" ? "തെക്കോട്ട്" : "വടക്കോട്ട്"} ${stopCount} സ്റ്റോപ്പ് പോകുക.`,
  };
}

function accessSegment(from: string, to: string, mode: AccessMode, distanceKm: number): RouteSegment {
  const distanceText = `${distanceKm.toFixed(1)} km`;
  const fare =
    mode === "auto"
      ? calculateAutoFare({ distance_km: distanceKm, isNight: false }).finalFare
      : mode === "bus"
        ? 10
        : 0;
  const duration = minutesForDistance(mode, distanceKm);

  const labels: Record<AccessMode, { en: string; ml: string }> = {
    walk: { en: "Walk", ml: "നടക്കുക" },
    auto: { en: "Take an auto", ml: "ഓട്ടോ എടുക്കുക" },
    bus: { en: "Take a feeder bus", ml: "ഫീഡർ ബസ് എടുക്കുക" },
    water_metro: { en: "Transfer to Water Metro", ml: "വാട്ടർ മെട്രോയിലേക്ക് മാറുക" },
  };

  return {
    mode,
    from,
    to,
    duration,
    fare,
    distance_km: Number(distanceKm.toFixed(1)),
    details: `${labels[mode].en} from ${from} to ${to} (${distanceText}).`,
    details_ml: `${from} മുതൽ ${to} വരെ ${labels[mode].ml} (${distanceText}).`,
  };
}

function waterMetroForDestination(destination: string): WaterMetroRoute | null {
  const normalized = normalizePlace(destination);
  return (
    WATER_METRO_ROUTES.find((route) =>
      route.stops.some((stop) => stop.toLowerCase() === normalized)
    ) ?? null
  );
}

function waterMetroSegment(route: WaterMetroRoute, destination: string): RouteSegment {
  const fromStop = route.stops[0];
  const toStop =
    route.stops.find((stop) => stop.toLowerCase() === normalizePlace(destination)) ??
    canonicalPlace(destination);

  return {
    mode: "water_metro",
    from: fromStop,
    to: toStop,
    duration: route.duration,
    fare: route.fare,
    details: `Take Water Metro ${route.name}; service runs every ${route.frequency} minutes until ${route.lastService}.`,
    details_ml: `${route.name} വാട്ടർ മെട്രോ എടുക്കുക; ${route.frequency} മിനിറ്റിന് ഒരിക്കൽ സർവീസ്, അവസാന സർവീസ് ${route.lastService}.`,
  };
}

function directAutoRoute(origin: string, destination: string, distanceKm: number): TransitRoute {
  const segment = accessSegment(origin, destination, "auto", distanceKm);
  const route = createRoute([segment], "auto_only");
  return withSummaries(route);
}

function createRoute(
  segments: RouteSegment[],
  routeType: NonNullable<TransitRoute["routeType"]>,
  options: { transferWaitMinutes?: number; notes?: string[] } = {}
): TransitRoute {
  const transferWaitMinutes = options.transferWaitMinutes ?? 0;
  return {
    segments,
    totalDuration:
      segments.reduce((total, segment) => total + segment.duration, 0) + transferWaitMinutes,
    totalFare: segments.reduce((total, segment) => total + segment.fare, 0),
    transfers: Math.max(0, segments.length - 1),
    transferWaitMinutes,
    routeType,
    notes: options.notes ?? [],
  };
}

function withSummaries(route: TransitRoute): TransitRoute {
  return {
    ...route,
    summary_en: generateRouteSummary(route, "en"),
    summary_ml: generateRouteSummary(route, "ml"),
  };
}

function planViaWaterMetro(origin: string, destination: string): TransitRoute | null {
  const waterRoute = waterMetroForDestination(destination);
  if (!waterRoute) return null;

  const connectionMetro = waterRoute.connectsTo.metro;
  const originStation = resolveStation(origin);
  const segments: RouteSegment[] = [];

  if (originStation && originStation.name_en !== connectionMetro) {
    const metro = metroSegment(originStation.name_en, connectionMetro);
    if (metro) segments.push(metro);
  }

  if (!originStation) {
    const originProximity = getProximity(origin);
    if (!originProximity) return null;

    segments.push(
      accessSegment(
        canonicalPlace(origin),
        originProximity.station,
        originProximity.mode === "water_metro" ? "auto" : originProximity.mode,
        originProximity.distance_km
      )
    );

    if (originProximity.station !== connectionMetro) {
      const metro = metroSegment(originProximity.station, connectionMetro);
      if (metro) segments.push(metro);
    }
  }

  if (waterRoute.connectsTo.walkDistance !== undefined) {
    segments.push(
      accessSegment(
        connectionMetro,
        waterRoute.stops[0],
        "walk",
        waterRoute.connectsTo.walkDistance
      )
    );
  } else if (waterRoute.connectsTo.autoDistance !== undefined) {
    segments.push(
      accessSegment(
        connectionMetro,
        waterRoute.stops[0],
        "auto",
        waterRoute.connectsTo.autoDistance
      )
    );
  }

  segments.push(waterMetroSegment(waterRoute, destination));

  return withSummaries(
    createRoute(segments, "water_metro", {
      transferWaitMinutes: Math.round(waterRoute.frequency * WATER_METRO_WAIT_FRACTION),
      notes: [`Water Metro connection via ${connectionMetro}.`],
    })
  );
}

function planMetroLastMile(origin: string, destination: string): TransitRoute | null {
  const originStation = resolveStation(origin);
  const destinationProximity = getProximity(destination);
  if (!originStation || !destinationProximity) return null;

  const directDistance = getDistance(origin, destination);
  if (directDistance !== null && directDistance <= 3) {
    return directAutoRoute(canonicalPlace(origin), canonicalPlace(destination), directDistance);
  }

  const segments: RouteSegment[] = [];
  if (originStation.name_en !== destinationProximity.station) {
    const metro = metroSegment(originStation.name_en, destinationProximity.station);
    if (metro) segments.push(metro);
  }

  if (destinationProximity.distance_km > 0) {
    segments.push(
      accessSegment(
        destinationProximity.station,
        canonicalPlace(destination),
        destinationProximity.mode,
        destinationProximity.distance_km
      )
    );
  }

  if (segments.length === 0) return null;
  return withSummaries(createRoute(segments, "metro_last_mile"));
}

function planBetweenOffMetroPlaces(origin: string, destination: string): TransitRoute | null {
  const originProximity = getProximity(origin);
  const destinationProximity = getProximity(destination);
  if (!originProximity || !destinationProximity) return null;

  const directDistance = getDistance(origin, destination);
  if (directDistance !== null && directDistance < 5) {
    return directAutoRoute(canonicalPlace(origin), canonicalPlace(destination), directDistance);
  }

  const segments: RouteSegment[] = [];
  if (originProximity.distance_km > 0) {
    segments.push(
      accessSegment(
        canonicalPlace(origin),
        originProximity.station,
        originProximity.mode === "water_metro" ? "auto" : originProximity.mode,
        originProximity.distance_km
      )
    );
  }

  if (originProximity.station !== destinationProximity.station) {
    const metro = metroSegment(originProximity.station, destinationProximity.station);
    if (metro) segments.push(metro);
  }

  if (destinationProximity.distance_km > 0) {
    segments.push(
      accessSegment(
        destinationProximity.station,
        canonicalPlace(destination),
        destinationProximity.mode === "water_metro" ? "auto" : destinationProximity.mode,
        destinationProximity.distance_km
      )
    );
  }

  if (segments.length === 0) return null;
  return withSummaries(createRoute(segments, "mixed"));
}

export function planMetroRoute(originQuery: string, destinationQuery: string): TransitRoute | null {
  const origin = resolveStation(originQuery);
  const destination = resolveStation(destinationQuery);

  if (!origin || !destination) return null;

  if (origin.code === destination.code) {
    const route = createRoute([], "direct_metro");
    return withSummaries(route);
  }

  const segment = metroSegment(origin.name_en, destination.name_en);
  if (!segment) return null;
  return withSummaries(createRoute([segment], "direct_metro"));
}

export function findRoute(
  originQuery: string,
  destinationQuery: string,
  timeContext?: string
): TransitRoute | null {
  const origin = canonicalPlace(originQuery);
  const destination = canonicalPlace(destinationQuery);
  const notes: string[] = [];

  if (timeContext === "night") {
    notes.push("Metro and Water Metro services may be closed after 10 PM; use auto as fallback.");
  }

  const originIsMetro = hasMetroStation(origin);
  const destinationIsMetro = hasMetroStation(destination);
  const destinationProximity = getProximity(destination);

  if (
    originIsMetro &&
    destinationProximity?.mode === "walk" &&
    resolveStation(origin)?.name_en === destinationProximity.station
  ) {
    return withSummaries(
      createRoute(
        [
          accessSegment(
            origin,
            destination,
            "walk",
            destinationProximity.distance_km
          ),
        ],
        "metro_last_mile",
        { notes }
      )
    );
  }

  const directDistance = getDistance(origin, destination);
  if (directDistance !== null && directDistance < 3) {
    const route = directAutoRoute(origin, destination, directDistance);
    return withSummaries({ ...route, notes: [...(route.notes ?? []), ...notes] });
  }

  let route: TransitRoute | null = null;

  if (originIsMetro && destinationIsMetro) {
    route = planMetroRoute(origin, destination);
  } else {
    route =
      planViaWaterMetro(origin, destination) ??
      (originIsMetro ? planMetroLastMile(origin, destination) : null) ??
      planBetweenOffMetroPlaces(origin, destination);
  }

  if (!route && directDistance !== null) {
    route = directAutoRoute(origin, destination, directDistance);
  }

  if (!route) return null;

  const mergedNotes = [...(route.notes ?? []), ...notes];
  return withSummaries({ ...route, notes: mergedNotes });
}

export function planRoute(
  originQuery: string,
  destinationQuery: string,
  timeContext?: string
): TransitRoute | null {
  return findRoute(originQuery, destinationQuery, timeContext);
}

function modeLabel(mode: TransportMode, language: Language): string {
  const labels: Record<TransportMode, { en: string; ml: string }> = {
    metro: { en: "Metro", ml: "മെട്രോ" },
    water_metro: { en: "Water Metro", ml: "വാട്ടർ മെട്രോ" },
    bus: { en: "bus", ml: "ബസ്" },
    auto: { en: "auto", ml: "ഓട്ടോ" },
    walk: { en: "walk", ml: "നടക്കുക" },
  };
  return labels[mode][language];
}

function malayalamSegmentText(segment: RouteSegment, index: number): string {
  const fareText = segment.fare > 0 ? `${segment.fare} രൂപ` : "ചാർജ് ഇല്ല";
  const prefix = index === 0 ? "" : "പിന്നെ ";
  const action: Record<TransportMode, string> = {
    metro: "മെട്രോ എടുക്കുക",
    water_metro: "വാട്ടർ മെട്രോ എടുക്കുക",
    bus: "ബസ് എടുക്കുക",
    auto: "ഓട്ടോ എടുക്കുക",
    walk: "നടക്കുക",
  };

  return `${prefix}${segment.from} മുതൽ ${segment.to} വരെ ${action[segment.mode]}, ഏകദേശം ${segment.duration} മിനിറ്റ്, ${fareText}.`;
}

export function generateRouteSummary(route: TransitRoute, lang: Language): string {
  if (route.segments.length === 0) {
    return lang === "ml"
      ? "നിങ്ങൾ ഇതിനകം ലക്ഷ്യസ്ഥാനത്താണ്."
      : "You are already at the destination.";
  }

  const segmentTexts = route.segments.map((segment, index) => {
    if (lang === "ml") {
      return malayalamSegmentText(segment, index);
    }

    const fareText = segment.fare > 0 ? `₹${segment.fare}` : "no fare";
    const prefix = index === 0 ? "" : "Then ";
    return `${prefix}Take ${modeLabel(segment.mode, lang)} from ${segment.from} to ${
      segment.to
    }, about ${segment.duration} minutes, ${fareText}.`;
  });

  const waitText =
    route.transferWaitMinutes && route.transferWaitMinutes > 0
      ? lang === "ml"
        ? ` മാറ്റത്തിനായി ഏകദേശം ${route.transferWaitMinutes} മിനിറ്റ് കൂടി കണക്കാക്കുക.`
        : ` Add about ${route.transferWaitMinutes} minutes for transfer/wait time.`
      : "";

  const notesText =
    route.notes && route.notes.length > 0
      ? lang === "ml"
        ? ` ശ്രദ്ധിക്കുക: ${route.notes.join(" ")}`
        : ` Note: ${route.notes.join(" ")}`
      : "";

  const total =
    lang === "ml"
      ? `മൊത്തം യാത്ര: ${route.totalDuration} മിനിറ്റ്, ${route.totalFare} രൂപ.`
      : `Total journey: ${route.totalDuration} minutes, ₹${route.totalFare}.`;

  return `${segmentTexts.join(" ")}${waitText} ${total}${notesText}`.trim();
}

export function listAllStations() {
  return getStations();
}
