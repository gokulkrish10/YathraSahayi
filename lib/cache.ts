import transitData from "@/data/kochi-transit.json";
import stationAliases from "@/data/station-aliases.json";
import responseTemplates from "@/data/response-templates.json";
import type {
  BilingualTemplate,
  KochiTransitData,
  ResponseTemplatesMap,
  StationAliasesMap,
  TransitStation,
} from "@/types";

const data = transitData as KochiTransitData;
const aliasMap = stationAliases as StationAliasesMap;
const templates = responseTemplates as ResponseTemplatesMap;

const POI_NEAREST_METRO: Record<string, string> = {
  Kakkanad: "PLR",
  "Fort Kochi": "MGR",
  "Lulu Mall": "EDP",
};

let stationCache: TransitStation[] | null = null;

function mapStation(raw: KochiTransitData["metro"]["stations"][number]): TransitStation {
  return {
    id: raw.code,
    name_en: raw.name_en,
    name_ml: raw.name_ml,
    code: raw.code,
    lat: raw.coordinates.latitude,
    lng: raw.coordinates.longitude,
    landmarks: raw.landmarks,
    feederBuses: raw.feeder_buses.map((name) => ({ name })),
    chainage_km: raw.chainage_km,
    first_train: raw.first_train,
    last_train: raw.last_train,
    rail_interchange: raw.rail_interchange,
  };
}

export function getTransitData(): KochiTransitData {
  return data;
}

export function getStations(): TransitStation[] {
  if (!stationCache) {
    stationCache = data.metro.stations.map(mapStation);
  }
  return stationCache;
}

export function getStationByCode(code: string): TransitStation | undefined {
  return getStations().find((s) => s.code.toUpperCase() === code.toUpperCase());
}

export function resolveCanonicalName(query: string): string | undefined {
  const trimmed = query.trim();
  if (!trimmed) return undefined;

  const lower = trimmed.toLowerCase();
  if (aliasMap[lower]) return aliasMap[lower];
  if (aliasMap[trimmed]) return aliasMap[trimmed];

  const station = getStations().find(
    (s) =>
      s.name_en.toLowerCase() === lower ||
      s.name_en.toLowerCase().includes(lower) ||
      s.name_ml === trimmed ||
      s.code.toLowerCase() === lower
  );

  return station?.name_en;
}

export function resolveStation(query: string): TransitStation | undefined {
  const trimmed = query.trim();
  if (!trimmed) return undefined;

  const canonical = resolveCanonicalName(trimmed);
  const lookup = canonical ?? trimmed;

  const byExactName = getStations().find(
    (s) => s.name_en.toLowerCase() === lookup.toLowerCase() || s.name_ml === lookup
  );
  if (byExactName) return byExactName;

  const nearestCode = POI_NEAREST_METRO[lookup];
  if (nearestCode) return getStationByCode(nearestCode);

  const lower = trimmed.toLowerCase();
  return getStations().find(
    (s) =>
      s.name_en.toLowerCase().includes(lower) ||
      s.name_ml.includes(trimmed) ||
      s.code.toLowerCase() === lower
  );
}

export function getStationAliases(): StationAliasesMap {
  return aliasMap;
}

export function getResponseTemplates(): ResponseTemplatesMap {
  return templates;
}

export function getResponseTemplate(key: string): BilingualTemplate | undefined {
  return templates[key];
}

export function getMetroFareSlabs() {
  return data.metro.fare_slabs_inr;
}

export function getAutoRates() {
  return data.auto_rickshaw.rates;
}

export function getDistanceMatrix() {
  return data.distance_matrix.pairs;
}

export function getWaterMetroRoutes() {
  return data.water_metro;
}

export function getFeederBusRoutes() {
  return data.feeder_buses;
}

export function getMetroOperatingHours() {
  return data.metro.operating_hours;
}

export function getMetroFrequency() {
  return data.metro.frequency;
}
