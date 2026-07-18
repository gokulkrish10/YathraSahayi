import { buildClarificationQuestion, parseIntent, regexParseIntent, resolveAliases } from "@/lib/intent-parser";
import { calculateAutoFareByRoute, getDistance } from "@/lib/fare-calculator";
import assert from "node:assert/strict";

async function testRegexParser() {
  const mlRoute = regexParseIntent("Edapally to Vyttila", "ml");
  assert.equal(mlRoute.type, "route");
  assert.equal(mlRoute.origin, "Edapally");
  assert.equal(mlRoute.destination, "Vyttila");

  const enRoute = regexParseIntent("Aluva to Tripunithura metro", "ml");
  assert.ok(enRoute.origin?.toLowerCase().includes("aluva"));
  assert.ok(enRoute.destination?.toLowerCase().includes("tripunithura"));

  const naturalRoute = regexParseIntent(
    "I want to go from Aluva to MG Road, which metro service I should take?",
    "en"
  );
  assert.equal(naturalRoute.type, "route");
  assert.equal(naturalRoute.origin, "Aluva");
  assert.equal(naturalRoute.destination, "MG Road");

  const byMetroRoute = regexParseIntent(
    "I want to go from Aluva to MG Road by metro.",
    "en"
  );
  assert.equal(byMetroRoute.type, "route");
  assert.equal(byMetroRoute.origin, "Aluva");
  assert.equal(byMetroRoute.destination, "MG Road");

  const usingMetroRoute = regexParseIntent(
    "How can I go from Edapally to Vyttila using Metro?",
    "en"
  );
  assert.equal(usingMetroRoute.type, "route");
  assert.equal(usingMetroRoute.origin, "Edapally");
  assert.equal(usingMetroRoute.destination, "Vyttila");

  const pleaseRoute = regexParseIntent("Route from Kalamassery to Maharaja’s College please.", "en");
  assert.equal(pleaseRoute.type, "route");
  assert.equal(pleaseRoute.origin, "Kalamassery");
  assert.equal(pleaseRoute.destination, "Maharaja's College");

  const manglishPair = regexParseIntent("Enikku Edapally ninnu Vyttila metro route venam.", "ml");
  assert.equal(manglishPair.type, "route");
  assert.equal(manglishPair.origin, "Edapally");
  assert.equal(manglishPair.destination, "Vyttila");

  const missingOriginRoute = regexParseIntent(
    "I want to go to Lulu Mall, Kochi. How can I go there using Metro?",
    "en"
  );
  assert.equal(missingOriginRoute.type, "route");
  assert.equal(missingOriginRoute.origin, undefined);
  assert.equal(missingOriginRoute.destination, "Lulu Mall");

  const missingOriginRouteNoComma = regexParseIntent(
    "I want to go to Lulu Mall Kochi, which metro service I can use for that?",
    "en"
  );
  assert.equal(missingOriginRouteNoComma.type, "route");
  assert.equal(missingOriginRouteNoComma.origin, undefined);
  assert.equal(missingOriginRouteNoComma.destination, "Lulu Mall");

  const manglish = resolveAliases(regexParseIntent("Enikku Lulu Mall pokanam", "ml"));
  assert.equal(manglish.destination, "Lulu Mall");

  const malayalamSuffixRoute = regexParseIntent(
    "Lullu Mall-ലേക്ക് Metro-യിൽ എങ്ങനെ simple ആയി പോകാമെന്ന് പറഞ്ഞു തരാമോ?",
    "ml"
  );
  assert.equal(malayalamSuffixRoute.type, "route");
  assert.equal(malayalamSuffixRoute.origin, undefined);
  assert.equal(malayalamSuffixRoute.destination, "Lulu Mall");

  const fare = regexParseIntent("ഓട്ടോ ചാർജ് എത്ര", "ml");
  assert.equal(fare.type, "fare");

  const malayalamAutoFare = regexParseIntent(
    "വൈറ്റിലയിൽ നിന്ന് കാക്കനാട്ടേക്ക് ഓട്ടോ നിരക്ക് എത്ര?",
    "ml"
  );
  assert.equal(malayalamAutoFare.type, "fare");
  assert.equal(malayalamAutoFare.origin, "Vyttila");
  assert.equal(malayalamAutoFare.destination, "Kakkanad");

  const malayalamFeederBus = regexParseIntent(
    "പാലാരിവട്ടം മെട്രോയിൽ നിന്ന് ഇൻഫോപാർക്കിലേക്ക് ഫീഡർ ബസ് ഉണ്ടോ?",
    "ml"
  );
  assert.equal(malayalamFeederBus.type, "route");
  assert.equal(malayalamFeederBus.origin, "Palarivattom");
  assert.equal(malayalamFeederBus.destination, "Kakkanad");
  assert.equal(malayalamFeederBus.transportMode, "bus");

  const malayalamWaterMetro = regexParseIntent(
    "വൈറ്റിലയിൽ നിന്ന് കാക്കനാട്ടേക്ക് വാട്ടർ മെട്രോ ഉണ്ടോ?",
    "ml"
  );
  assert.equal(malayalamWaterMetro.type, "route");
  assert.equal(malayalamWaterMetro.origin, "Vyttila");
  assert.equal(malayalamWaterMetro.destination, "Kakkanad");
  assert.equal(malayalamWaterMetro.transportMode, "water_metro");

  const schedule = regexParseIntent("last metro from Kaloor", "en");
  assert.equal(schedule.type, "schedule");
  assert.ok(schedule.origin?.toLowerCase().includes("kaloor"));

  const clarified = buildClarificationQuestion(
    { type: "route", language: "en", origin: undefined, destination: "Vyttila" },
    "en"
  );
  assert.match(clarified, /Where are you/i);

  const alias = resolveAliases({
    type: "route",
    language: "en",
    origin: "lulu",
    destination: "Vyttila",
  });
  assert.equal(alias.origin, "Lulu Mall");

  const fuzzy = resolveAliases({
    type: "route",
    language: "en",
    origin: "palarivattam",
    destination: "Vyttila",
  });
  assert.equal(fuzzy.origin, "Palarivattom");
}

function testFareMatrix() {
  const lulu = calculateAutoFareByRoute({ origin: "Edapally", destination: "Lulu Mall" });
  assert.equal(lulu?.totalFare, 30);

  const day = calculateAutoFareByRoute({ origin: "Vyttila", destination: "Kakkanad" });
  assert.equal(day?.totalFare, 147);

  const night = calculateAutoFareByRoute({
    origin: "Vyttila",
    destination: "Kakkanad",
    currentTime: new Date("2024-01-01T23:00:00"),
  });
  assert.equal(night?.totalFare, 221);

  const afternoon = calculateAutoFareByRoute({
    origin: "Vyttila",
    destination: "Kakkanad",
    currentTime: new Date("2024-01-01T15:00:00"),
  });
  assert.equal(afternoon?.isNightRate, false);

  assert.equal(getDistance("Kakkanad", "Vyttila"), 8.0);
  assert.equal(getDistance("Unknown", "Nowhere"), null);
}

async function main() {
  await testRegexParser();
  testFareMatrix();
  console.log("Step 4/5 verification passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
