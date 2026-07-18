import assert from "node:assert/strict";
import { planGoogleTransitRoute } from "@/lib/google-maps";
import { planLiveRoute } from "@/lib/route-planner";
import {
  findRoute,
  generateRouteSummary,
  getApproxMetroFare,
  getMetroTravelTime,
} from "@/lib/transit-engine";

process.env.YATHRA_ROUTE_PROVIDER = "local";

function sumSegments(route: NonNullable<ReturnType<typeof findRoute>>) {
  return {
    fare: route.segments.reduce((total, segment) => total + segment.fare, 0),
    duration:
      route.segments.reduce((total, segment) => total + segment.duration, 0) +
      (route.transferWaitMinutes ?? 0),
  };
}

function testDirectMetro() {
  const route = findRoute("Aluva", "Vyttila");
  assert.ok(route);
  assert.equal(route.routeType, "direct_metro");
  assert.equal(route.segments.length, 1);
  assert.equal(route.segments[0].mode, "metro");
  assert.equal(route.segments[0].from, "Aluva");
  assert.equal(route.segments[0].to, "Vyttila");
  assert.ok(route.totalFare > 0);
}

function testLastMileWalk() {
  const route = findRoute("Edapally", "Lulu Mall");
  assert.ok(route);
  assert.equal(route.routeType, "metro_last_mile");
  assert.equal(route.segments[0].mode, "walk");
  assert.equal(route.segments[0].distance_km, 0.8);
  assert.equal(route.segments[0].fare, 0);
}

function testMetroWaterMetro() {
  const route = findRoute("Edapally", "Kakkanad");
  assert.ok(route);
  assert.equal(route.routeType, "water_metro");
  assert.equal(route.segments.some((segment) => segment.mode === "metro"), true);
  assert.equal(route.segments.some((segment) => segment.mode === "walk"), true);
  assert.equal(route.segments.some((segment) => segment.mode === "water_metro"), true);
  assert.match(route.segments.map((segment) => segment.details).join(" "), /Vyttila/i);
}

function testAutoOnly() {
  const route = findRoute("Kaloor", "Lissie Hospital");
  assert.ok(route);
  assert.equal(route.routeType, "auto_only");
  assert.equal(route.segments.length, 1);
  assert.equal(route.segments[0].mode, "auto");
  assert.equal(route.segments[0].fare, 30);
}

function testTravelTimeAndFareHelpers() {
  assert.equal(getMetroTravelTime("Edapally", "JLN Stadium"), 8);
  assert.equal(getApproxMetroFare("Aluva", "Vyttila"), 65);
}

function testSummariesAndTotals() {
  const route = findRoute("Edapally", "Kakkanad");
  assert.ok(route);

  const totals = sumSegments(route);
  assert.equal(route.totalFare, totals.fare);
  assert.equal(route.totalDuration, totals.duration);

  assert.match(generateRouteSummary(route, "en"), /Total journey/i);
  assert.match(generateRouteSummary(route, "ml"), /മൊത്തം യാത്ര/);
}

function testUnknownAndNightNote() {
  assert.equal(findRoute("Unknown Place", "Nowhere"), null);

  const route = findRoute("Aluva", "Vyttila", "night");
  assert.ok(route);
  assert.match(route.summary_en ?? "", /after 10 PM/i);
}

async function testSupportRoutes() {
  const feeder = await planLiveRoute("Palarivattom", "Kakkanad", "now", "ml", "bus");
  assert.ok(feeder);
  assert.equal(feeder.routeType, "feeder_bus");
  assert.match(feeder.summary_ml ?? "", /ഫീഡർ ബസ്/);

  const water = await planLiveRoute("Vyttila", "Kakkanad", "now", "ml", "water_metro");
  assert.ok(water);
  assert.equal(water.routeType, "water_metro");
  assert.match(water.summary_ml ?? "", /വാട്ടർ മെട്രോ/);
}

async function testGoogleRoutesAdapter() {
  const originalApiKey = process.env.GOOGLE_MAPS_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.GOOGLE_MAPS_API_KEY = "test-google-key";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), "https://routes.googleapis.com/directions/v2:computeRoutes");
    assert.equal(init?.method, "POST");
    assert.match(String(new Headers(init?.headers).get("X-Goog-FieldMask")), /routes\.legs\.steps\.transitDetails/);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.travelMode, "TRANSIT");
    assert.equal(body.languageCode, "en-IN");
    assert.equal(body.origin.address, "Ernakulam Junction Railway Station, Kochi, Kerala, India");
    assert.equal(body.destination.address, "Lulu Mall Kochi, Edappally, Kerala, India");

    return new Response(
      JSON.stringify({
        routes: [
          {
            duration: "2160s",
            distanceMeters: 8200,
            localizedValues: {
              duration: { text: "36 min" },
              distance: { text: "8.2 km" },
              transitFare: { text: "₹40" },
            },
            travelAdvisory: {
              transitFare: { currencyCode: "INR", units: "40" },
            },
            polyline: { encodedPolyline: "route-polyline" },
            legs: [
              {
                steps: [
                  {
                    travelMode: "WALK",
                    distanceMeters: 500,
                    staticDuration: "360s",
                    localizedValues: {
                      duration: { text: "6 min" },
                      distance: { text: "0.5 km" },
                    },
                    navigationInstruction: {
                      instructions: "Walk to Ernakulam South Metro Station",
                    },
                  },
                  {
                    travelMode: "TRANSIT",
                    staticDuration: "1200s",
                    localizedValues: { duration: { text: "20 min" } },
                    transitDetails: {
                      stopDetails: {
                        departureStop: { name: "Ernakulam South" },
                        arrivalStop: { name: "Edapally" },
                      },
                      headsign: "Aluva",
                      stopCount: 6,
                      transitLine: {
                        name: "Kochi Metro",
                        vehicle: { type: "SUBWAY", name: "Metro" },
                      },
                    },
                  },
                  {
                    travelMode: "WALK",
                    distanceMeters: 800,
                    staticDuration: "600s",
                    navigationInstruction: {
                      instructions: "Walk to Lulu Mall",
                    },
                  },
                ],
              },
            ],
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const route = await planGoogleTransitRoute("Ernakulam Junction", "Lulu Mall", {
      language: "en",
    });
    assert.ok(route);
    assert.equal(route.provider, "google");
    assert.equal(route.routeType, "google_transit");
    assert.equal(route.totalDuration, 36);
    assert.equal(route.totalFare, 40);
    assert.equal(route.localizedTotalDistance, "8.2 km");
    assert.equal(route.localizedTotalDuration, "36 min");
    assert.match(route.mapUrl ?? "", /google\.com\/maps\/dir/);
    assert.equal(route.segments.some((segment) => segment.mode === "metro"), true);
    assert.match(route.summary_en ?? "", /Google Maps/);
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.GOOGLE_MAPS_API_KEY;
    } else {
      process.env.GOOGLE_MAPS_API_KEY = originalApiKey;
    }
    globalThis.fetch = originalFetch;
  }
}

async function main() {
  testDirectMetro();
  testLastMileWalk();
  testMetroWaterMetro();
  testAutoOnly();
  testTravelTimeAndFareHelpers();
  testSummariesAndTotals();
  testUnknownAndNightNote();
  await testSupportRoutes();
  await testGoogleRoutesAdapter();
  console.log("Step 6 verification passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
