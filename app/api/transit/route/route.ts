import { jsonError, jsonOk } from "@/lib/api-utils";
import { planLiveRoute } from "@/lib/route-planner";
import type { Language, TransportModePreference } from "@/types";

function parseLanguage(value: unknown): Language | undefined {
  return value === "ml" || value === "en" ? value : undefined;
}

function parseTransportMode(value: unknown): TransportModePreference {
  if (
    value === "metro" ||
    value === "water_metro" ||
    value === "bus" ||
    value === "auto" ||
    value === "walk" ||
    value === "any"
  ) {
    return value;
  }
  return "any";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = searchParams.get("origin");
  const destination = searchParams.get("destination");
  const timeContext = searchParams.get("timeContext") ?? undefined;
  const language = parseLanguage(searchParams.get("language"));
  const transportMode = parseTransportMode(searchParams.get("transportMode"));

  if (!origin || !destination) {
    return jsonError("Query params origin and destination are required", 400);
  }

  const route = await planLiveRoute(origin, destination, timeContext, language, transportMode);
  if (!route) {
    return jsonError("Could not resolve origin or destination", 404);
  }

  return jsonOk({ origin, destination, route });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const origin = body?.origin as string | undefined;
  const destination = body?.destination as string | undefined;
  const timeContext = body?.timeContext as string | undefined;
  const language = parseLanguage(body?.language);
  const transportMode = parseTransportMode(body?.transportMode);

  if (!origin || !destination) {
    return jsonError("Body fields origin and destination are required", 400);
  }

  const route = await planLiveRoute(origin, destination, timeContext, language, transportMode);
  if (!route) {
    return jsonError("Could not resolve origin or destination", 404);
  }

  return jsonOk({ origin, destination, route });
}
