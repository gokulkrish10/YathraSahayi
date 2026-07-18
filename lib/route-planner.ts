import { googleMapsConfigured, planGoogleTransitRoute } from "@/lib/google-maps";
import { findDemoMetroRoute } from "@/lib/demo-metro-routes";
import { findSupportRoute } from "@/lib/support-routes";
import { planRoute as planLocalRoute } from "@/lib/transit-engine";
import type { Language, TransitRoute, TransportModePreference } from "@/types";

type RouteProviderPreference = "auto" | "google" | "local";

export function getRouteProviderPreference(): RouteProviderPreference {
  const configured = process.env.YATHRA_ROUTE_PROVIDER?.toLowerCase();
  if (configured === "google" || configured === "local" || configured === "auto") {
    return configured;
  }
  return "auto";
}

export function liveRoutingConfigured(): boolean {
  return googleMapsConfigured();
}

function withLocalProvider(route: TransitRoute, usedFallback: boolean): TransitRoute {
  const notes = [...(route.notes ?? [])];
  if (usedFallback) {
    notes.push("Live Google Maps route was unavailable; using offline Kochi transit fallback.");
  }
  return {
    ...route,
    provider: "local",
    source: "Offline Kochi transit cache",
    notes,
  };
}

export async function planLiveRoute(
  origin: string,
  destination: string,
  timeContext?: string,
  language: Language = "en",
  transportMode: TransportModePreference = "any"
): Promise<TransitRoute | null> {
  const preference = getRouteProviderPreference();

  if (transportMode === "bus" || transportMode === "water_metro") {
    const supportRoute = findSupportRoute(origin, destination, transportMode);
    if (supportRoute) return supportRoute;
  }

  const demoRoute = findDemoMetroRoute(origin, destination);
  if (demoRoute) return demoRoute;

  if (preference === "google") {
    if (!googleMapsConfigured()) return null;
    return planGoogleTransitRoute(origin, destination, {
      language,
      timeContext,
    });
  }

  if (preference === "auto" && googleMapsConfigured()) {
    const googleRoute = await planGoogleTransitRoute(origin, destination, {
      language,
      timeContext,
    });
    if (googleRoute) return googleRoute;
  }

  const localRoute = planLocalRoute(origin, destination, timeContext);
  if (!localRoute) return null;
  return withLocalProvider(localRoute, preference !== "local" && googleMapsConfigured());
}
