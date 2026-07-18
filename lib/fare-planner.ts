import { calculateAutoFare, estimateAutoFareBetween } from "@/lib/fare-calculator";
import { getGoogleDrivingDistance } from "@/lib/google-maps";
import type { AutoFareResult, Language } from "@/types";

export async function estimateLiveAutoFareBetween(
  origin: string,
  destination: string,
  options: {
    language?: Language;
    isNight?: boolean;
    luggagePieces?: number;
    at?: Date;
  } = {}
): Promise<AutoFareResult | null> {
  const localFare = estimateAutoFareBetween(origin, destination, {
    isNight: options.isNight,
    luggagePieces: options.luggagePieces,
    at: options.at,
  });
  if (localFare) return localFare;

  const googleDistance = await getGoogleDrivingDistance(
    origin,
    destination,
    options.language ?? "en"
  );
  if (!googleDistance) return null;

  return calculateAutoFare({
    distance_km: googleDistance.distanceKm,
    isNight: options.isNight,
    luggagePieces: options.luggagePieces ?? 0,
    at: options.at,
  });
}
