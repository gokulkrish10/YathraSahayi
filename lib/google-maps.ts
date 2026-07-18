import { resolveCanonicalName, resolveStation } from "@/lib/cache";
import type { Language, RouteSegment, TransitRoute, TransportMode } from "@/types";

const ROUTES_API_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const DEFAULT_TIMEOUT_MS = 6500;

const ROUTES_FIELD_MASK = [
  "routes.duration",
  "routes.distanceMeters",
  "routes.polyline.encodedPolyline",
  "routes.localizedValues.duration",
  "routes.localizedValues.distance",
  "routes.localizedValues.transitFare",
  "routes.travelAdvisory.transitFare",
  "routes.legs.steps.travelMode",
  "routes.legs.steps.distanceMeters",
  "routes.legs.steps.staticDuration",
  "routes.legs.steps.polyline.encodedPolyline",
  "routes.legs.steps.localizedValues",
  "routes.legs.steps.navigationInstruction.instructions",
  "routes.legs.steps.transitDetails",
].join(",");

interface GoogleMoney {
  currencyCode?: string;
  units?: string | number;
  nanos?: number;
}

interface GoogleLocalizedText {
  text?: string;
}

interface GoogleLocalizedValues {
  distance?: GoogleLocalizedText;
  duration?: GoogleLocalizedText;
  staticDuration?: GoogleLocalizedText;
  transitFare?: GoogleLocalizedText;
}

interface GoogleStop {
  name?: string;
}

interface GoogleTransitDetails {
  stopDetails?: {
    arrivalStop?: GoogleStop;
    departureStop?: GoogleStop;
    arrivalTime?: string;
    departureTime?: string;
  };
  localizedValues?: {
    arrivalTime?: GoogleLocalizedText;
    departureTime?: GoogleLocalizedText;
  };
  headsign?: string;
  stopCount?: number;
  transitLine?: {
    name?: string;
    nameShort?: string;
    vehicle?: {
      type?: string;
      name?: string;
    };
  };
}

interface GoogleRouteStep {
  travelMode?: string;
  distanceMeters?: number;
  staticDuration?: string;
  duration?: string;
  localizedValues?: GoogleLocalizedValues;
  navigationInstruction?: {
    instructions?: string;
  };
  transitDetails?: GoogleTransitDetails;
  polyline?: {
    encodedPolyline?: string;
  };
}

interface GoogleRoute {
  duration?: string;
  distanceMeters?: number;
  polyline?: {
    encodedPolyline?: string;
  };
  localizedValues?: GoogleLocalizedValues;
  travelAdvisory?: {
    transitFare?: GoogleMoney;
  };
  legs?: Array<{
    steps?: GoogleRouteStep[];
  }>;
}

interface GoogleRoutesResponse {
  routes?: GoogleRoute[];
  error?: {
    message?: string;
  };
}

export interface GoogleTransitRouteOptions {
  language?: Language;
  timeContext?: string;
}

export interface GoogleDistanceResult {
  distanceKm: number;
  durationMinutes: number;
  localizedDistance?: string;
  localizedDuration?: string;
  provider: "google";
}

export function googleMapsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}

function getTimeoutMs(): number {
  const parsed = Number(process.env.GOOGLE_MAPS_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function localeForGoogle(language: Language): string {
  return language === "ml" ? "ml-IN" : "en-IN";
}

function canonicalPlace(place: string): string {
  return resolveCanonicalName(place) ?? place.trim();
}

function isExactMetroStation(place: string): boolean {
  const canonical = canonicalPlace(place);
  const station = resolveStation(canonical);
  return Boolean(station && station.name_en.toLowerCase() === canonical.toLowerCase());
}

function googleAddress(place: string): string {
  const canonical = canonicalPlace(place);

  const knownPlaces: Record<string, string> = {
    "Lulu Mall": "Lulu Mall Kochi, Edappally, Kerala, India",
    "Ernakulam Junction": "Ernakulam Junction Railway Station, Kochi, Kerala, India",
    Infopark: "Infopark Kochi, Kakkanad, Kerala, India",
    Kakkanad: "Kakkanad, Kochi, Kerala, India",
    "Fort Kochi": "Fort Kochi, Kerala, India",
  };

  if (knownPlaces[canonical]) return knownPlaces[canonical];
  if (isExactMetroStation(canonical)) {
    return `${canonical} Metro Station, Kochi, Kerala, India`;
  }
  if (/\b(kochi|ernakulam|kerala|india)\b/i.test(canonical)) return canonical;
  return `${canonical}, Kochi, Kerala, India`;
}

function buildGoogleMapsUrl(origin: string, destination: string): string {
  const params = new URLSearchParams({
    api: "1",
    origin: googleAddress(origin),
    destination: googleAddress(destination),
    travelmode: "transit",
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function durationToMinutes(duration?: string): number {
  const seconds = Number(duration?.replace(/s$/i, ""));
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.max(1, Math.round(seconds / 60));
}

function moneyToFare(money?: GoogleMoney): number {
  if (!money) return 0;
  const units = Number(money.units ?? 0);
  const nanos = Number(money.nanos ?? 0) / 1_000_000_000;
  const total = units + nanos;
  return Number.isFinite(total) ? Math.round(total) : 0;
}

function moneyToText(money?: GoogleMoney): string | undefined {
  if (!money) return undefined;
  const fare = moneyToFare(money);
  if (fare <= 0) return undefined;
  return money.currencyCode === "INR" || !money.currencyCode
    ? `₹${fare}`
    : `${fare} ${money.currencyCode}`;
}

function stripInstruction(text?: string): string {
  return (text ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function modeFromGoogleStep(step: GoogleRouteStep): TransportMode {
  const travelMode = step.travelMode ?? "";
  const vehicleType = step.transitDetails?.transitLine?.vehicle?.type ?? "";
  const vehicleName = step.transitDetails?.transitLine?.vehicle?.name ?? "";
  const combined = `${travelMode} ${vehicleType} ${vehicleName}`.toUpperCase();

  if (combined.includes("WALK")) return "walk";
  if (combined.includes("BUS")) return "bus";
  if (combined.includes("FERRY")) return "water_metro";
  return "metro";
}

function modeName(mode: TransportMode): string {
  const names: Record<TransportMode, string> = {
    metro: "Metro",
    water_metro: "Water Metro",
    bus: "bus",
    auto: "auto",
    walk: "walk",
  };
  return names[mode];
}

function malayalamModeAction(mode: TransportMode): string {
  const actions: Record<TransportMode, string> = {
    metro: "മെട്രോ എടുക്കുക",
    water_metro: "വാട്ടർ മെട്രോ എടുക്കുക",
    bus: "ബസ് എടുക്കുക",
    auto: "ഓട്ടോ എടുക്കുക",
    walk: "നടക്കുക",
  };
  return actions[mode];
}

function findPreviousTransitArrival(steps: GoogleRouteStep[], index: number): string | undefined {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const arrival = steps[cursor].transitDetails?.stopDetails?.arrivalStop?.name;
    if (arrival) return arrival;
  }
  return undefined;
}

function findNextTransitDeparture(steps: GoogleRouteStep[], index: number): string | undefined {
  for (let cursor = index + 1; cursor < steps.length; cursor += 1) {
    const departure = steps[cursor].transitDetails?.stopDetails?.departureStop?.name;
    if (departure) return departure;
  }
  return undefined;
}

function buildTransitDetails(
  step: GoogleRouteStep,
  mode: TransportMode,
  from: string,
  to: string
): { en: string; ml: string; lineName?: string } {
  const details = step.transitDetails;
  const lineName =
    details?.transitLine?.nameShort ??
    details?.transitLine?.name ??
    details?.transitLine?.vehicle?.name ??
    modeName(mode);
  const headsign = details?.headsign ? ` toward ${details.headsign}` : "";
  const stopCount =
    details?.stopCount && details.stopCount > 0 ? ` for ${details.stopCount} stop(s)` : "";

  return {
    en: `Take ${lineName}${headsign} from ${from} to ${to}${stopCount}.`,
    ml: `${from} മുതൽ ${to} വരെ ${lineName} ${malayalamModeAction(mode)}.`,
    lineName,
  };
}

function googleStepToSegment(
  step: GoogleRouteStep,
  steps: GoogleRouteStep[],
  index: number,
  origin: string,
  destination: string
): RouteSegment {
  const mode = modeFromGoogleStep(step);
  const departureStop = step.transitDetails?.stopDetails?.departureStop?.name;
  const arrivalStop = step.transitDetails?.stopDetails?.arrivalStop?.name;
  const from =
    departureStop ??
    findPreviousTransitArrival(steps, index) ??
    (index === 0 ? canonicalPlace(origin) : "current point");
  const to =
    arrivalStop ??
    findNextTransitDeparture(steps, index) ??
    (index === steps.length - 1 ? canonicalPlace(destination) : "next point");
  const duration = durationToMinutes(step.staticDuration ?? step.duration);
  const distanceKm =
    typeof step.distanceMeters === "number"
      ? Number((step.distanceMeters / 1000).toFixed(1))
      : undefined;
  const fallbackInstruction = stripInstruction(step.navigationInstruction?.instructions);
  const transit = mode === "walk" ? null : buildTransitDetails(step, mode, from, to);
  const details =
    transit?.en ??
    (fallbackInstruction
      ? `${fallbackInstruction}.`
      : `Walk from ${from} to ${to}.`);
  const detailsMl =
    transit?.ml ?? `${from} മുതൽ ${to} വരെ നടക്കുക.`;

  return {
    mode,
    from,
    to,
    duration,
    fare: 0,
    details,
    details_ml: detailsMl,
    distance_km: distanceKm,
    lineName: transit?.lineName,
    departureTime:
      step.transitDetails?.localizedValues?.departureTime?.text ??
      step.transitDetails?.stopDetails?.departureTime,
    arrivalTime:
      step.transitDetails?.localizedValues?.arrivalTime?.text ??
      step.transitDetails?.stopDetails?.arrivalTime,
    polyline: step.polyline?.encodedPolyline,
    localizedDistance: step.localizedValues?.distance?.text,
    localizedDuration: step.localizedValues?.duration?.text ?? step.localizedValues?.staticDuration?.text,
  };
}

function buildGoogleSummary(route: TransitRoute, language: Language): string {
  if (route.segments.length === 0) {
    return language === "ml"
      ? "Google Maps പ്രകാരം നിങ്ങൾ ലക്ഷ്യസ്ഥാനത്താണ്."
      : "Google Maps shows that you are already at the destination.";
  }

  const stepText = route.segments
    .slice(0, 6)
    .map((segment) => (language === "ml" ? segment.details_ml : segment.details))
    .join(" ");
  const duration =
    route.localizedTotalDuration ??
    (language === "ml" ? `${route.totalDuration} മിനിറ്റ്` : `${route.totalDuration} minutes`);
  const distance = route.localizedTotalDistance ? `, ${route.localizedTotalDistance}` : "";
  const fare =
    route.localizedFare ??
    (route.totalFare > 0 ? (language === "ml" ? `${route.totalFare} രൂപ` : `₹${route.totalFare}`) : "");
  const fareText = fare ? (language === "ml" ? `, ഏകദേശ നിരക്ക് ${fare}` : `, estimated fare ${fare}`) : "";
  const prefix = language === "ml" ? "Google Maps പ്രകാരം " : "Google Maps shows this route: ";
  const total =
    language === "ml"
      ? `മൊത്തം സമയം ${duration}${distance}${fareText}.`
      : `Total time ${duration}${distance}${fareText}.`;

  return `${prefix}${stepText} ${total}`.trim();
}

function routeFromGoogle(
  googleRoute: GoogleRoute,
  origin: string,
  destination: string
): TransitRoute | null {
  const steps = googleRoute.legs?.flatMap((leg) => leg.steps ?? []) ?? [];
  if (steps.length === 0) return null;

  const fare =
    moneyToFare(googleRoute.travelAdvisory?.transitFare) ||
    moneyToFare((googleRoute as { travel_advisory?: { transitFare?: GoogleMoney } }).travel_advisory?.transitFare);
  const localizedFare =
    googleRoute.localizedValues?.transitFare?.text ??
    moneyToText(googleRoute.travelAdvisory?.transitFare);
  const segments = steps.map((step, index) =>
    googleStepToSegment(step, steps, index, origin, destination)
  );

  if (fare > 0) {
    const transitSegments = segments.filter((segment) => segment.mode !== "walk");
    const fareSegment = transitSegments[0];
    if (fareSegment) {
      fareSegment.fare = fare;
    }
  }

  const totalDuration =
    durationToMinutes(googleRoute.duration) ||
    segments.reduce((sum, segment) => sum + segment.duration, 0);
  const route: TransitRoute = {
    segments,
    totalDuration,
    totalFare: fare,
    transfers: Math.max(0, segments.filter((segment) => segment.mode !== "walk").length - 1),
    routeType: "google_transit",
    provider: "google",
    source: "Google Maps Routes API",
    totalDistanceMeters: googleRoute.distanceMeters,
    localizedTotalDistance: googleRoute.localizedValues?.distance?.text,
    localizedTotalDuration: googleRoute.localizedValues?.duration?.text,
    localizedFare,
    polyline: googleRoute.polyline?.encodedPolyline,
    mapUrl: buildGoogleMapsUrl(origin, destination),
  };

  return {
    ...route,
    summary_en: buildGoogleSummary(route, "en"),
    summary_ml: buildGoogleSummary(route, "ml"),
  };
}

export async function planGoogleTransitRoute(
  origin: string,
  destination: string,
  options: GoogleTransitRouteOptions = {}
): Promise<TransitRoute | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());
  const language = options.language ?? "en";

  try {
    const response = await fetch(ROUTES_API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": ROUTES_FIELD_MASK,
      },
      body: JSON.stringify({
        origin: { address: googleAddress(origin) },
        destination: { address: googleAddress(destination) },
        travelMode: "TRANSIT",
        computeAlternativeRoutes: true,
        languageCode: localeForGoogle(language),
        units: "METRIC",
        departureTime: new Date().toISOString(),
        transitPreferences: {
          allowedTravelModes: ["SUBWAY", "TRAIN", "LIGHT_RAIL", "RAIL", "BUS"],
          routingPreference: "FEWER_TRANSFERS",
        },
      }),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as GoogleRoutesResponse;
    const route = data.routes?.[0];
    if (!route) return null;
    return routeFromGoogle(route, origin, destination);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getGoogleDrivingDistance(
  origin: string,
  destination: string,
  language: Language = "en"
): Promise<GoogleDistanceResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());

  try {
    const response = await fetch(ROUTES_API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "routes.duration,routes.distanceMeters,routes.localizedValues.duration,routes.localizedValues.distance",
      },
      body: JSON.stringify({
        origin: { address: googleAddress(origin) },
        destination: { address: googleAddress(destination) },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
        languageCode: localeForGoogle(language),
        units: "METRIC",
      }),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as GoogleRoutesResponse;
    const route = data.routes?.[0];
    if (!route?.distanceMeters) return null;

    return {
      distanceKm: Number((route.distanceMeters / 1000).toFixed(1)),
      durationMinutes: durationToMinutes(route.duration),
      localizedDistance: route.localizedValues?.distance?.text,
      localizedDuration: route.localizedValues?.duration?.text,
      provider: "google",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
