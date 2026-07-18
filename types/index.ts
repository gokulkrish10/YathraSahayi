export type Language = "ml" | "en";
export type SarvamLocale = "ml-IN" | "en-IN";
export type SarvamLanguageCode = SarvamLocale | "unknown";
export type TransportMode = "metro" | "water_metro" | "bus" | "auto" | "walk";
export type IntentType = "route" | "fare" | "schedule" | "last_mile" | "general";
export type TransportModePreference = TransportMode | "any";

export interface FeederBus {
  name: string;
}

export interface TransitStation {
  id: string;
  name_en: string;
  name_ml: string;
  code: string;
  lat: number;
  lng: number;
  landmarks: string[];
  feederBuses: FeederBus[];
  chainage_km?: number;
  first_train?: string;
  last_train?: string;
  rail_interchange?: string | null;
}

export interface RouteSegment {
  mode: TransportMode;
  from: string;
  to: string;
  duration: number;
  fare: number;
  details: string;
  details_ml: string;
  distance_km?: number;
}

export interface TransitRoute {
  segments: RouteSegment[];
  totalDuration: number;
  totalFare: number;
  transfers: number;
  summary_en?: string;
  summary_ml?: string;
  transferWaitMinutes?: number;
  routeType?: "direct_metro" | "metro_last_mile" | "water_metro" | "auto_only" | "mixed";
  notes?: string[];
}

export interface AutoFareResult {
  distance_km: number;
  baseFare: number;
  totalFare: number;
  nightSurcharge: boolean;
  surchargeAmount: number;
  finalFare: number;
  breakdown: string;
  breakdown_ml: string;
}

export interface UserIntent {
  type: IntentType;
  origin?: string | null;
  destination?: string | null;
  transportMode?: TransportModePreference;
  mode?: string;
  language: Language;
  timeContext?: string;
}

export interface FareInput {
  origin: string;
  destination: string;
  currentTime?: Date;
  waitingMinutes?: number;
  luggagePieces?: number;
}

export interface FareOutput {
  distance_km: number;
  baseFare: number;
  meterFare: number;
  nightSurcharge: number;
  waitingCharge: number;
  luggageCharge: number;
  totalFare: number;
  isNightRate: boolean;
  breakdown_en: string;
  breakdown_ml: string;
}

export interface ConversationState {
  sessionId: string;
  language: Language;
  languageLocale: SarvamLocale;
  lastIntent: UserIntent | null;
  turnCount: number;
  pendingClarification: string | null;
  languageSwitched?: boolean;
}

export interface FareSlab {
  min_km: number;
  max_km: number | null;
  fare: number;
}

export interface MetroStationRaw {
  order: number;
  name_en: string;
  name_ml: string;
  code: string;
  chainage_km: number;
  coordinates: { latitude: number; longitude: number };
  landmarks: string[];
  feeder_buses: string[];
  first_train: string;
  last_train: string;
  rail_interchange: string | null;
}

export interface KochiTransitData {
  meta: Record<string, unknown>;
  metro: {
    line_id: string;
    operating_hours: { open: string; close: string; timezone: string };
    frequency: {
      peak_minutes: number;
      off_peak_minutes: number;
      peak_hours: string;
    };
    fare_slabs_inr: FareSlab[];
    stations: MetroStationRaw[];
  };
  water_metro: Record<string, unknown>;
  feeder_buses: Record<string, unknown>;
  auto_rickshaw: {
    rates: {
      minimum_fare_inr: number;
      minimum_distance_km: number;
      per_km_after_minimum_inr: number;
      waiting_charge_inr_per_5_min: number;
      night_surcharge: {
        applies: boolean;
        hours: string;
        multiplier: number;
      };
      luggage_charge_inr_per_piece_above_20kg: number;
    };
  };
  distance_matrix: {
    pairs: Array<{
      id: string;
      origin: { type: string; code?: string; name: string };
      destination: { type: string; name: string };
      distance_km: number;
      recommended_mode: string;
    }>;
  };
}

export interface BilingualTemplate {
  en: string;
  ml: string;
}

export type ResponseTemplatesMap = Record<string, BilingualTemplate>;

export type StationAliasesMap = Record<string, string>;

export interface SarvamSttResult {
  transcript: string;
  language_code: SarvamLocale;
  confidence?: number;
  provider: "sarvam" | "fallback";
  error?: string;
}

export interface SarvamTtsResult {
  audioBase64: string;
  contentType: string;
  speaker: string;
  provider: "sarvam" | "fallback";
  error?: string;
}

export interface SarvamTtsChunk {
  index: number;
  text: string;
  audioBase64: string;
}

export interface SarvamTtsStreamResult {
  chunks: SarvamTtsChunk[];
  contentType: string;
  speaker: string;
  provider: "sarvam" | "fallback";
  error?: string;
}

export interface ApiSuccessResponse<T = unknown> {
  ok: true;
  data: T;
}

export interface ApiErrorResponse {
  ok: false;
  error: string;
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;
