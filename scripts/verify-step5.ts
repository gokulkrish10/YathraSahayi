import {
  calculateAutoFareByRoute,
  generateFareBreakdown,
  getDistance,
  isNightTime,
} from "@/lib/fare-calculator";
import assert from "node:assert/strict";

function testMinimumFares() {
  const lulu = calculateAutoFareByRoute({
    origin: "Edapally",
    destination: "Lulu Mall",
  });
  assert.equal(lulu?.totalFare, 30);

  const marine = calculateAutoFareByRoute({
    origin: "MG Road",
    destination: "Marine Drive",
  });
  assert.equal(marine?.totalFare, 30);
}

function testDayAndNightRates() {
  const day = calculateAutoFareByRoute({
    origin: "Vyttila",
    destination: "Kakkanad",
  });
  assert.equal(day?.totalFare, 147);
  assert.equal(day?.isNightRate, false);

  const night = calculateAutoFareByRoute({
    origin: "Vyttila",
    destination: "Kakkanad",
    currentTime: new Date("2024-01-01T23:00:00"),
  });
  assert.equal(night?.totalFare, 221);
  assert.equal(night?.isNightRate, true);

  const afternoon = calculateAutoFareByRoute({
    origin: "Vyttila",
    destination: "Kakkanad",
    currentTime: new Date("2024-01-01T15:00:00"),
  });
  assert.equal(afternoon?.isNightRate, false);
  assert.equal(isNightTime(new Date("2024-01-01T23:00:00")), true);
  assert.equal(isNightTime(new Date("2024-01-01T15:00:00")), false);
}

function testLongRoute() {
  const airport = calculateAutoFareByRoute({
    origin: "Aluva",
    destination: "Airport",
  });
  assert.equal(airport?.totalFare, 255);
}

function testReverseLookup() {
  const forward = getDistance("Vyttila", "Kakkanad");
  const reverse = getDistance("Kakkanad", "Vyttila");
  assert.equal(forward, 8.0);
  assert.equal(reverse, forward);

  const forwardFare = calculateAutoFareByRoute({
    origin: "Vyttila",
    destination: "Kakkanad",
  });
  const reverseFare = calculateAutoFareByRoute({
    origin: "Kakkanad",
    destination: "Vyttila",
  });
  assert.equal(forwardFare?.totalFare, reverseFare?.totalFare);

  const malayalamAliasDistance = getDistance("വൈറ്റില", "കാക്കനാട്");
  assert.equal(malayalamAliasDistance, 8.0);
}

function testUnknownRoute() {
  assert.equal(getDistance("Unknown", "Nowhere"), null);
  assert.equal(
    calculateAutoFareByRoute({ origin: "Unknown", destination: "Nowhere" }),
    null
  );
}

function testWaitingAndLuggage() {
  const withWaiting = calculateAutoFareByRoute({
    origin: "Vyttila",
    destination: "Kakkanad",
    waitingMinutes: 10,
    luggagePieces: 2,
  });
  assert.equal(withWaiting?.waitingCharge, 10);
  assert.equal(withWaiting?.luggageCharge, 10);
  assert.equal(withWaiting?.meterFare, 147);
  assert.equal(withWaiting?.totalFare, 167);
}

function testBreakdownStrings() {
  const fare = calculateAutoFareByRoute({
    origin: "Vyttila",
    destination: "Kakkanad",
    currentTime: new Date("2024-01-01T23:00:00"),
  });
  assert.ok(fare);

  const en = generateFareBreakdown(fare!, "en");
  assert.match(en, /₹221/);
  assert.match(en, /night surcharge/i);
  assert.match(en, /₹147/);

  const ml = generateFareBreakdown(fare!, "ml");
  assert.match(ml, /221/);
  assert.match(ml, /രാത്രി സർചാർജ്/);
  assert.match(ml, /147/);
}

function main() {
  testMinimumFares();
  testDayAndNightRates();
  testLongRoute();
  testReverseLookup();
  testUnknownRoute();
  testWaitingAndLuggage();
  testBreakdownStrings();
  console.log("Step 5 verification passed");
}

main();
