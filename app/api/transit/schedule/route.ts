import { jsonError, jsonOk } from "@/lib/api-utils";
import {
  getMetroFrequency,
  getMetroOperatingHours,
  getStations,
  resolveStation,
} from "@/lib/cache";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const stationQuery = searchParams.get("station");

  const operatingHours = getMetroOperatingHours();
  const frequency = getMetroFrequency();

  if (!stationQuery) {
    return jsonOk({
      operatingHours,
      frequency,
      stations: getStations().length,
    });
  }

  const station = resolveStation(stationQuery);
  if (!station) {
    return jsonError(`Station not found: ${stationQuery}`, 404);
  }

  return jsonOk({
    station,
    operatingHours,
    frequency,
    firstTrain: station.first_train,
    lastTrain: station.last_train,
  });
}

export async function POST(request: Request) {
  return GET(request);
}
