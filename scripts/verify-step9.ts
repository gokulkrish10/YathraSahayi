import assert from "node:assert/strict";
import { yathraSahayiOrchestrator } from "@/lib/orchestrator";

process.env.YATHRA_ROUTE_PROVIDER = "local";

async function testHelplineOpening() {
  const sessionId = "verify-step9-helpline-opening";
  yathraSahayiOrchestrator.resetSession(sessionId);

  const opening = await yathraSahayiOrchestrator.processTextInput({
    sessionId,
    text: "Hello, am I talking to Kochi Metro helpline AI assistant?",
    language: "en",
  });
  assert.equal(opening.intent.type, "general");
  assert.equal(opening.state.turnCount, 1);
  assert.match(opening.response, /Thank you for calling Kochi Metro Helpline/i);
  assert.match(opening.response, /How can I help you today/i);

  const followUp = await yathraSahayiOrchestrator.processTextInput({
    sessionId,
    text: "Route from Edapally to Vyttila",
    language: "en",
  });
  assert.equal(followUp.state.turnCount, 2);
  assert.ok(followUp.routeData);
  assert.doesNotMatch(followUp.response, /Thank you for calling/i);
}

async function testThreeTurnSessionAndContext() {
  const sessionId = "verify-step9-context";
  yathraSahayiOrchestrator.resetSession(sessionId);

  const first = await yathraSahayiOrchestrator.processTextInput({
    sessionId,
    text: "Edapally",
    language: "en",
  });
  assert.equal(first.state.turnCount, 1);
  assert.equal(first.state.pendingClarification, "destination");
  assert.equal(first.intent.origin, "Edapally");

  const second = await yathraSahayiOrchestrator.processTextInput({
    sessionId,
    text: "to Vyttila",
    language: "en",
  });
  assert.equal(second.state.turnCount, 2);
  assert.equal(second.intent.origin, "Edapally");
  assert.equal(second.intent.destination, "Vyttila");
  assert.ok(second.routeData);
  assert.equal(second.routeData?.segments.some((segment) => segment.mode === "metro"), true);

  const third = await yathraSahayiOrchestrator.processTextInput({
    sessionId,
    text: "Auto fare from Vyttila to Kakkanad at night",
    language: "en",
  });
  assert.equal(third.state.turnCount, 3);
  assert.ok(third.fareData);
  assert.match(third.response, /221|fare|₹/i);
}

async function testLanguageSwitchesAndResponses() {
  const sessionId = "verify-step9-language";
  yathraSahayiOrchestrator.resetSession(sessionId);

  const english = await yathraSahayiOrchestrator.processTextInput({
    sessionId,
    text: "switch to english",
    language: "ml",
  });
  assert.equal(english.language, "en");
  assert.match(english.response, /English/);

  const malayalam = await yathraSahayiOrchestrator.processTextInput({
    sessionId,
    text: "മലയാളത്തിൽ പറയൂ",
    language: "en",
  });
  assert.equal(malayalam.language, "ml");
  assert.match(malayalam.response, /മലയാള/);
}

async function testBilingualIntentHandling() {
  const naturalRoute = await yathraSahayiOrchestrator.processTextInput({
    sessionId: "verify-step9-natural-route",
    text: "I want to go from Aluva to MG Road, which metro service I should take?",
    language: "en",
  });
  assert.equal(naturalRoute.intent.type, "route");
  assert.equal(naturalRoute.intent.origin, "Aluva");
  assert.equal(naturalRoute.intent.destination, "MG Road");
  assert.ok(naturalRoute.routeData);
  assert.equal(naturalRoute.routeData?.provider, "demo");
  assert.match(naturalRoute.response, /direct Kochi Metro train from Aluva/i);

  const malayalamDemoRoute = await yathraSahayiOrchestrator.processTextInput({
    sessionId: "verify-step9-demo-ml-route",
    text: "എനിക്ക് ആലുവയിൽ നിന്ന് എം ജി റോഡിലേക്ക് മെട്രോയിൽ പോകണം.",
    language: "ml",
    intentOverride: {
      type: "route",
      origin: "Aluva",
      destination: "MG Road",
      transportMode: "metro",
      mode: "metro",
      language: "ml",
      timeContext: "now",
    },
  });
  assert.equal(malayalamDemoRoute.routeData?.provider, "demo");
  assert.equal(
    malayalamDemoRoute.response,
    "ആലുവയിൽ നിന്നും തൃപ്പൂണിത്തുറ ഭാഗത്തേക്കുള്ള മെട്രോയിൽ കയറി എം.ജി റോഡ് മെട്രോ സ്റ്റേഷനിൽ ഇറങ്ങുക."
  );

  const en = await yathraSahayiOrchestrator.processTextInput({
    sessionId: "verify-step9-en-route",
    text: "Route from Edapally to Kakkanad",
    language: "en",
    intentOverride: {
      type: "route",
      origin: "Edapally",
      destination: "Kakkanad",
      transportMode: "any",
      language: "en",
      timeContext: "now",
    },
  });
  assert.equal(en.language, "en");
  assert.ok(en.routeData);
  assert.equal(en.routeData?.segments.some((segment) => segment.mode === "water_metro"), true);
  assert.match(en.response, /Total journey/);

  const ml = await yathraSahayiOrchestrator.processTextInput({
    sessionId: "verify-step9-ml-route",
    text: "എടപ്പള്ളിയിൽ നിന്ന് കാക്കനാട്ടിലേക്ക് പോകണം",
    language: "ml",
    intentOverride: {
      type: "route",
      origin: "Edapally",
      destination: "Kakkanad",
      transportMode: "any",
      language: "ml",
      timeContext: "now",
    },
  });
  assert.equal(ml.language, "ml");
  assert.ok(ml.routeData);
  assert.match(ml.response, /മൊത്തം യാത്ര/);
}

async function testClarificationsAndSchedule() {
  const luluSessionId = "verify-step9-lulu-clarification";
  yathraSahayiOrchestrator.resetSession(luluSessionId);
  const luluMissingOrigin = await yathraSahayiOrchestrator.processTextInput({
    sessionId: luluSessionId,
    text: "Lullu Mall-ലേക്ക് Metro-യിൽ എങ്ങനെ simple ആയി പോകാമെന്ന് പറഞ്ഞു തരാമോ?",
    language: "ml",
  });
  assert.equal(luluMissingOrigin.intent.type, "route");
  assert.equal(luluMissingOrigin.intent.destination, "Lulu Mall");
  assert.equal(luluMissingOrigin.state.pendingClarification, "origin");
  assert.match(luluMissingOrigin.response, /എവിടെ|Where/i);

  const luluFollowUp = await yathraSahayiOrchestrator.processTextInput({
    sessionId: luluSessionId,
    text: "ആലുവയിൽ നിന്നാണ്",
    language: "ml",
  });
  assert.equal(luluFollowUp.intent.origin, "Aluva");
  assert.equal(luluFollowUp.intent.destination, "Lulu Mall");
  assert.ok(luluFollowUp.routeData);
  assert.equal(luluFollowUp.routeData?.provider, "demo");
  assert.match(luluFollowUp.response, /സ്കൈവാക്ക് വഴി ലുലു മാളിലേക്ക്/);

  const englishLuluSessionId = "verify-step9-english-lulu-clarification";
  yathraSahayiOrchestrator.resetSession(englishLuluSessionId);
  const englishLuluMissingOrigin = await yathraSahayiOrchestrator.processTextInput({
    sessionId: englishLuluSessionId,
    text: "I want to go to Lulu Mall, Kochi. How can I go there using Metro?",
    language: "en",
  });
  assert.equal(englishLuluMissingOrigin.intent.type, "route");
  assert.equal(englishLuluMissingOrigin.intent.origin, undefined);
  assert.equal(englishLuluMissingOrigin.intent.destination, "Lulu Mall");
  assert.equal(englishLuluMissingOrigin.state.pendingClarification, "origin");
  assert.doesNotMatch(englishLuluMissingOrigin.response, /couldn't find that route/i);
  assert.match(englishLuluMissingOrigin.response, /where are you|starting/i);

  const englishLuluFollowUp = await yathraSahayiOrchestrator.processTextInput({
    sessionId: englishLuluSessionId,
    text: "Ernakulam Junction",
    language: "en",
  });
  assert.equal(englishLuluFollowUp.intent.origin, "Ernakulam Junction");
  assert.equal(englishLuluFollowUp.intent.destination, "Lulu Mall");
  assert.equal(englishLuluFollowUp.state.pendingClarification, null);
  assert.ok(englishLuluFollowUp.routeData);
  assert.equal(englishLuluFollowUp.routeData?.provider, "demo");
  assert.doesNotMatch(englishLuluFollowUp.response, /where are you|starting from right now/i);
  assert.match(englishLuluFollowUp.response, /nearest metro station to Ernakulam Junction/i);

  const verboseOriginSessionId = "verify-step9-english-lulu-verbose-origin";
  yathraSahayiOrchestrator.resetSession(verboseOriginSessionId);
  await yathraSahayiOrchestrator.processTextInput({
    sessionId: verboseOriginSessionId,
    text: "I want to go to Lulu Mall Kochi, which metro service I can use for that?",
    language: "en",
  });
  const verboseOriginFollowUp = await yathraSahayiOrchestrator.processTextInput({
    sessionId: verboseOriginSessionId,
    text: "Right now I'm starting my starting location is Ernakulam Junction.",
    language: "en",
  });
  assert.equal(verboseOriginFollowUp.intent.origin, "Ernakulam Junction");
  assert.equal(verboseOriginFollowUp.intent.destination, "Lulu Mall");
  assert.equal(verboseOriginFollowUp.state.pendingClarification, null);
  assert.ok(verboseOriginFollowUp.routeData);
  assert.equal(verboseOriginFollowUp.routeData?.provider, "demo");

  const missingOrigin = await yathraSahayiOrchestrator.processTextInput({
    sessionId: "verify-step9-missing-origin",
    text: "I want to go to Lulu Mall",
    language: "en",
    intentOverride: {
      type: "route",
      destination: "Lulu Mall",
      transportMode: "any",
      language: "en",
      timeContext: "now",
    },
  });
  assert.equal(missingOrigin.state.pendingClarification, "origin");
  assert.match(missingOrigin.response, /Where are you/i);

  const missingDestination = await yathraSahayiOrchestrator.processTextInput({
    sessionId: "verify-step9-missing-destination",
    text: "I am at Edapally",
    language: "en",
    intentOverride: {
      type: "route",
      origin: "Edapally",
      transportMode: "any",
      language: "en",
      timeContext: "now",
    },
  });
  assert.equal(missingDestination.state.pendingClarification, "destination");
  assert.match(missingDestination.response, /destination|where would you like to go/i);

  const schedule = await yathraSahayiOrchestrator.processTextInput({
    sessionId: "verify-step9-schedule-night",
    text: "Last metro from Palarivattom at night",
    language: "en",
    intentOverride: {
      type: "schedule",
      origin: "Palarivattom",
      transportMode: "metro",
      mode: "metro",
      language: "en",
      timeContext: "night",
    },
  });
  assert.match(schedule.response, /does not operate after 10 PM/i);
  assert.equal(schedule.scheduleData?.closed, true);

  const malayalamSchedule = await yathraSahayiOrchestrator.processTextInput({
    sessionId: "verify-step9-ml-last-metro",
    text: "ആലുവയിൽ നിന്ന് അവസാന മെട്രോ സമയം എപ്പോൾ?",
    language: "ml",
  });
  assert.equal(malayalamSchedule.intent.type, "schedule");
  assert.equal(malayalamSchedule.intent.origin, "Aluva");
  assert.match(malayalamSchedule.response, /അവസാന മെട്രോ/);

  const waterClarificationSessionId = "verify-step9-water-clarification";
  yathraSahayiOrchestrator.resetSession(waterClarificationSessionId);
  const waterMissingOrigin = await yathraSahayiOrchestrator.processTextInput({
    sessionId: waterClarificationSessionId,
    text: "I want to go to Fort Kochi by water metro",
    language: "en",
  });
  assert.equal(waterMissingOrigin.state.pendingClarification, "origin");
  assert.equal(waterMissingOrigin.intent.transportMode, "water_metro");

  const waterFollowUp = await yathraSahayiOrchestrator.processTextInput({
    sessionId: waterClarificationSessionId,
    text: "High Court",
    language: "en",
  });
  assert.equal(waterFollowUp.intent.origin, "High Court");
  assert.equal(waterFollowUp.intent.destination, "Fort Kochi");
  assert.equal(waterFollowUp.intent.transportMode, "water_metro");
  assert.equal(waterFollowUp.routeData?.routeType, "water_metro");

  const feederClarificationSessionId = "verify-step9-feeder-clarification";
  yathraSahayiOrchestrator.resetSession(feederClarificationSessionId);
  const feederMissingDestination = await yathraSahayiOrchestrator.processTextInput({
    sessionId: feederClarificationSessionId,
    text: "I am at Vyttila metro. Is there a feeder bus?",
    language: "en",
  });
  assert.equal(feederMissingDestination.state.pendingClarification, "destination");
  assert.equal(feederMissingDestination.intent.origin, "Vyttila");
  assert.equal(feederMissingDestination.intent.transportMode, "bus");

  const feederFollowUp = await yathraSahayiOrchestrator.processTextInput({
    sessionId: feederClarificationSessionId,
    text: "Kakkanad",
    language: "en",
  });
  assert.equal(feederFollowUp.intent.origin, "Vyttila");
  assert.equal(feederFollowUp.intent.destination, "Kakkanad");
  assert.equal(feederFollowUp.intent.transportMode, "bus");
  assert.equal(feederFollowUp.routeData?.routeType, "feeder_bus");
}

async function testMalayalamNonMetroSupport() {
  const autoFare = await yathraSahayiOrchestrator.processTextInput({
    sessionId: "verify-step9-ml-auto-fare",
    text: "വൈറ്റിലയിൽ നിന്ന് കാക്കനാട്ടേക്ക് ഓട്ടോ നിരക്ക് എത്ര?",
    language: "ml",
  });
  assert.equal(autoFare.intent.type, "fare");
  assert.equal(autoFare.intent.origin, "Vyttila");
  assert.equal(autoFare.intent.destination, "Kakkanad");
  assert.ok(autoFare.fareData);
  assert.match(autoFare.response, /ഓട്ടോ ചാർജ് 147 രൂപ/);
  assert.doesNotMatch(autoFare.response, /ദൂരം ഇപ്പോൾ ലഭ്യമല്ല/);

  const luluAutoFare = await yathraSahayiOrchestrator.processTextInput({
    sessionId: "verify-step9-ml-lulu-auto-fare",
    text: "ഇടപ്പള്ളിയിൽ നിന്ന് ലുലു മാളിലേക്ക് ഓട്ടോ ചാർജ് എത്ര വരും?",
    language: "ml",
  });
  assert.equal(luluAutoFare.intent.type, "fare");
  assert.equal(luluAutoFare.intent.origin, "Edapally");
  assert.equal(luluAutoFare.intent.destination, "Lulu Mall");
  assert.match(luluAutoFare.response, /ഓട്ടോ ചാർജ് 30 രൂപ/);

  const feederBus = await yathraSahayiOrchestrator.processTextInput({
    sessionId: "verify-step9-ml-feeder-bus",
    text: "പാലാരിവട്ടം മെട്രോയിൽ നിന്ന് ഇൻഫോപാർക്കിലേക്ക് ഫീഡർ ബസ് ഉണ്ടോ?",
    language: "ml",
  });
  assert.equal(feederBus.intent.transportMode, "bus");
  assert.equal(feederBus.routeData?.routeType, "feeder_bus");
  assert.match(feederBus.response, /101 അല്ലെങ്കിൽ 102 ഫീഡർ ബസ്/);
  assert.doesNotMatch(feederBus.response, /റൂട്ട് കണ്ടെത്താൻ കഴിഞ്ഞില്ല/);

  const kaloorFeederBus = await yathraSahayiOrchestrator.processTextInput({
    sessionId: "verify-step9-ml-kaloor-feeder-bus",
    text: "കലൂരിൽ നിന്ന് മെഡിക്കൽ ട്രസ്റ്റിലേക്ക് ബസ് ഉണ്ടോ?",
    language: "ml",
  });
  assert.equal(kaloorFeederBus.intent.origin, "Kaloor");
  assert.equal(kaloorFeederBus.intent.destination, "Medical Trust");
  assert.equal(kaloorFeederBus.routeData?.routeType, "feeder_bus");

  const waterMetro = await yathraSahayiOrchestrator.processTextInput({
    sessionId: "verify-step9-ml-water-metro",
    text: "വൈറ്റിലയിൽ നിന്ന് കാക്കനാട്ടേക്ക് വാട്ടർ മെട്രോ ഉണ്ടോ?",
    language: "ml",
  });
  assert.equal(waterMetro.intent.transportMode, "water_metro");
  assert.equal(waterMetro.routeData?.routeType, "water_metro");
  assert.match(waterMetro.response, /വൈറ്റില വാട്ടർ മെട്രോ ടെർമിനലിൽ/);
  assert.doesNotMatch(waterMetro.response, /റൂട്ട് കണ്ടെത്താൻ കഴിഞ്ഞില്ല/);
}

async function testGracefulFallbackAndTiming() {
  const started = Date.now();
  const result = await yathraSahayiOrchestrator.processTextInput({
    sessionId: "verify-step9-timing",
    text: "Route from Aluva to Vyttila",
    language: "en",
    intentOverride: {
      type: "route",
      origin: "Aluva",
      destination: "Vyttila",
      transportMode: "metro",
      mode: "metro",
      language: "en",
      timeContext: "now",
    },
  });
  assert.ok(Date.now() - started < 3000);
  assert.ok(result.routeData);

  const voiceFallback = await yathraSahayiOrchestrator.processVoiceInput({
    sessionId: "verify-step9-voice-fallback",
    audioBuffer: Buffer.alloc(0),
    language: "en",
    mimeType: "audio/wav",
  });
  assert.match(voiceFallback.response, /something went wrong|try again/i);
  assert.equal(voiceFallback.intent.type, "general");
}

async function main() {
  await testHelplineOpening();
  await testThreeTurnSessionAndContext();
  await testLanguageSwitchesAndResponses();
  await testBilingualIntentHandling();
  await testClarificationsAndSchedule();
  await testMalayalamNonMetroSupport();
  await testGracefulFallbackAndTiming();
  console.log("Step 9 verification passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
