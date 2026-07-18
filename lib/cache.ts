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
  "Ernakulam Junction": "ERS",
  Kakkanad: "PLR",
  "Fort Kochi": "MGR",
  "Lulu Mall": "EDP",
};

let stationCache: TransitStation[] | null = null;

const MALAYALAM_PLACE_SUFFIXES = [
  "യിലേയ്ക്ക്",
  "യിലേക്ക്",
  "ഇലേക്ക്",
  "ിലേക്ക്",
  "ലേക്ക്",
  "യിൽ",
  "യില്",
  "ഇൽ",
  "ഇല്",
  "ിൽ",
  "ില്",
  "വരെ",
  "മുതൽ",
  "നിന്നും",
  "നിന്ന്",
];

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

  const candidates = expandPlaceCandidates(trimmed);

  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    if (aliasMap[lower]) return aliasMap[lower];
    if (aliasMap[candidate]) return aliasMap[candidate];
  }

  const withoutKochiSuffix = trimmed.replace(/,?\s+kochi$/i, "").trim();
  if (withoutKochiSuffix && withoutKochiSuffix !== trimmed) {
    const canonicalWithoutSuffix = resolveCanonicalName(withoutKochiSuffix);
    if (canonicalWithoutSuffix) return canonicalWithoutSuffix;
  }

  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    const station = getStations().find(
      (s) =>
        s.name_en.toLowerCase() === lower ||
        s.name_en.toLowerCase().includes(lower) ||
        s.name_ml === candidate ||
        s.code.toLowerCase() === lower
    );
    if (station) return station.name_en;
  }

  return undefined;
}

function expandPlaceCandidates(query: string): string[] {
  const candidates = new Set<string>();
  const enqueue = (value: string) => {
    const trimmed = value.trim().replace(/\s+/g, " ");
    if (!trimmed) return;
    candidates.add(trimmed);

    const withoutKochiSuffix = trimmed.replace(/,?\s+kochi$/i, "").trim();
    if (withoutKochiSuffix && withoutKochiSuffix !== trimmed) {
      candidates.add(withoutKochiSuffix);
    }

    const withoutMalayalamCopula = trimmed
      .replace(/\s*(?:നിന്നാണ്|നിന്നാണു|ആണ്|ആണു)$/u, "")
      .trim();
    if (withoutMalayalamCopula && withoutMalayalamCopula !== trimmed) {
      candidates.add(withoutMalayalamCopula);
    }
  };

  enqueue(query);

  for (const candidate of Array.from(candidates)) {
    for (const suffix of MALAYALAM_PLACE_SUFFIXES) {
      if (!candidate.endsWith(suffix)) continue;
      const stripped = candidate.slice(0, -suffix.length).trim();
      if (!stripped) continue;
      enqueue(stripped);
      for (const expanded of expandMalayalamTerminal(stripped)) {
        enqueue(expanded);
      }
    }
  }

  return Array.from(candidates);
}

function expandMalayalamTerminal(place: string): string[] {
  const expansions: string[] = [];
  const last = place.at(-1);
  if (!last) return expansions;

  if (["ഡ", "ട", "ദ", "ക", "ഗ", "ച", "ജ", "പ", "ബ"].includes(last)) {
    expansions.push(`${place}്`);
  }

  const chilluMap: Record<string, string> = {
    ര: "ർ",
    റ: "ർ",
    ള: "ൾ",
    ല: "ൽ",
    ന: "ൻ",
    ണ: "ൺ",
  };
  const chillu = chilluMap[last];
  if (chillu) expansions.push(`${place.slice(0, -1)}${chillu}`);

  return expansions;
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
