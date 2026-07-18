import { executeVoiceTurn } from "@/lib/voice-turn";
import assert from "node:assert/strict";

process.env.YATHRA_ROUTE_PROVIDER = "local";

async function testPresetFareTurn() {
  const turn = await executeVoiceTurn({
    sessionId: "verify-step8-fare",
    text: "Auto fare from Vyttila to Kakkanad at night",
    language: "en",
    intentOverride: {
      type: "fare",
      origin: "Vyttila",
      destination: "Kakkanad",
      transportMode: "auto",
      mode: "auto",
      language: "en",
      timeContext: "night",
    },
  });

  assert.equal(turn.intent.type, "fare");
  assert.match(turn.responseText, /221|₹|fare/i);
}

async function testManglishTurn() {
  const turn = await executeVoiceTurn({
    sessionId: "verify-step8-manglish",
    text: "Enikku Lulu Mall pokanam",
    language: "ml",
    intentOverride: {
      type: "route",
      destination: "Lulu Mall",
      transportMode: "any",
      language: "ml",
      timeContext: "now",
    },
  });

  assert.equal(turn.intent.type, "route");
  assert.match(turn.responseText, /Where are you|origin|എവിടെ/i);
}

async function main() {
  await testPresetFareTurn();
  await testManglishTurn();
  console.log("Step 8 verification passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
