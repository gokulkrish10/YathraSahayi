import { jsonError, jsonOk } from "@/lib/api-utils";
import {
  calculateAutoFare,
  calculateAutoFareByRoute,
  estimateAutoFareBetween,
  getDistance,
} from "@/lib/fare-calculator";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const distance = Number(searchParams.get("distance_km"));
  const origin = searchParams.get("origin");
  const destination = searchParams.get("destination");
  const isNight = searchParams.get("night") === "true";

  if (origin && destination) {
    const fare = estimateAutoFareBetween(origin, destination, {
      isNight,
      at: isNight ? new Date("2024-01-01T23:00:00") : undefined,
    });
    if (!fare) {
      return jsonError("Could not estimate fare for given origin/destination", 404);
    }
    return jsonOk({ origin, destination, fare, distance_km: getDistance(origin, destination) });
  }

  if (Number.isFinite(distance)) {
    const fare = calculateAutoFare({ distance_km: distance, isNight });
    return jsonOk({ fare });
  }

  return jsonError("Provide distance_km or origin+destination", 400);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const origin = body?.origin as string | undefined;
  const destination = body?.destination as string | undefined;

  if (origin && destination) {
    const fare = calculateAutoFareByRoute({
      origin,
      destination,
      currentTime: body?.currentTime ? new Date(body.currentTime) : undefined,
      waitingMinutes: Number(body?.waitingMinutes ?? 0),
      luggagePieces: Number(body?.luggagePieces ?? 0),
    });

    if (!fare) {
      return jsonError("Distance not available for route", 404);
    }

    return jsonOk({ origin, destination, fare });
  }

  const distance = Number(body?.distance_km);
  const isNight = Boolean(body?.isNight);
  const luggagePieces = Number(body?.luggagePieces ?? 0);

  if (!Number.isFinite(distance)) {
    return jsonError("origin+destination or distance_km is required", 400);
  }

  const fare = calculateAutoFare({
    distance_km: distance,
    isNight,
    luggagePieces: Number.isFinite(luggagePieces) ? luggagePieces : 0,
  });

  return jsonOk({ fare });
}
