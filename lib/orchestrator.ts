import {
  getLanguageManager,
  languageToLocale,
  localeToLanguage,
} from "@/lib/language-detector";
import { parseIntent, buildClarificationQuestion } from "@/lib/intent-parser";
import { estimateLiveAutoFareBetween } from "@/lib/fare-planner";
import {
  getMetroFrequency,
  getMetroOperatingHours,
  resolveCanonicalName,
  resolveStation,
} from "@/lib/cache";
import { generateRouteSummary } from "@/lib/transit-engine";
import { planLiveRoute } from "@/lib/route-planner";
import { renderTemplate, languageSwitchConfirmation } from "@/lib/response-generator";
import { synthesizeSpeech, transcribeAudio } from "@/lib/sarvam-client";
import { generateAssistantResponse } from "@/lib/answer-generator";
import type { WebSearchResult } from "@/lib/web-search";
import type {
  AutoFareResult,
  ConversationState,
  FareOutput,
  Language,
  SarvamLanguageCode,
  SarvamTtsResult,
  TransitRoute,
  UserIntent,
} from "@/types";

type BrowserAudioMime = "audio/wav" | "audio/mpeg" | "audio/ogg" | "audio/webm";
type PendingClarification = "origin" | "destination" | null;

export interface OrchestratorTextInput {
  text: string;
  sessionId: string;
  language?: Language;
  detectedLanguageCode?: string;
  intentOverride?: UserIntent;
  synthesizeAudio?: boolean;
}

export interface OrchestratorVoiceInput {
  audioBuffer: Buffer;
  sessionId: string;
  language?: Language;
  mimeType?: BrowserAudioMime;
}

export interface OrchestratorResult {
  transcript: string;
  response: string;
  responseAudio: string;
  contentType: string;
  language: Language;
  intent: UserIntent;
  state: ConversationState;
  switchMessage: string | null;
  routeData?: TransitRoute;
  fareData?: AutoFareResult | FareOutput;
  scheduleData?: Record<string, unknown>;
  searchResults?: WebSearchResult[];
  providers: {
    stt?: string;
    tts: string;
    llm?: string;
    search?: string;
  };
  error?: string;
}

export const METRO_SCHEDULE = {
  firstTrain: "06:00",
  lastTrain: "22:00",
  lastDeparture: "21:45",
  peakFrequency: 5,
  offPeakFrequency: 10,
  peakHours: [
    { start: "07:30", end: "09:30" },
    { start: "17:00", end: "19:00" },
  ],
};

function createInitialState(sessionId: string, language: Language): ConversationState {
  return {
    sessionId,
    language,
    languageLocale: languageToLocale(language),
    lastIntent: null,
    turnCount: 0,
    pendingClarification: null,
    languageSwitched: false,
  };
}

function isSwitchCommand(text: string): boolean {
  const lower = text.toLowerCase();
  return [
    "english please",
    "speak english",
    "speak in english",
    "in english",
    "switch to english",
    "malayalam please",
    "speak malayalam",
    "speak in malayalam",
    "switch to malayalam",
    "malayalathil",
  ].some((phrase) => lower.includes(phrase)) || text.includes("മലയാളത്തിൽ");
}

function isHelplineOpening(text: string): boolean {
  const lower = text.toLowerCase();
  const hasGreeting =
    /\b(hello|hi|hey|namaskaram|good morning|good evening)\b/i.test(text) ||
    /നമസ്കാരം|ഹലോ/.test(text);
  const asksForAssistant = [
    "am i talking",
    "am i speaking",
    "are you",
    "kochi metro helpline",
    "kochi metro help line",
    "helpline assistant",
    "ai assistant",
    "yathra sahayi",
    "യാത്ര സഹായി",
  ].some((phrase) => lower.includes(phrase));
  const containsTravelRequest =
    /\b(route|fare|charge|from|last|next|reach|go to|pokanam|timing|schedule)\b/i.test(text) ||
    /റൂട്ട്|ചാർജ്|ഓട്ടോ|പോകണം|എത്തണം|അവസാന|അടുത്ത/.test(text);

  return (hasGreeting || asksForAssistant) && !containsTravelRequest;
}

function resolveSwitchLanguage(text: string, current: Language): Language {
  const lower = text.toLowerCase();
  if (lower.includes("english")) return "en";
  if (lower.includes("malayalam") || lower.includes("malayalathil") || text.includes("മലയാള")) {
    return "ml";
  }
  return current === "ml" ? "en" : "ml";
}

function resolveSttLanguageCode(language?: Language): SarvamLanguageCode {
  if (language === "ml") return "ml-IN";
  if (language === "en") return "en-IN";
  return "unknown";
}

function normalizeIntentPlaces(intent: UserIntent): UserIntent {
  const origin = intent.origin ? cleanPlace(intent.origin) : intent.origin;
  const destination = intent.destination ? cleanPlace(intent.destination) : intent.destination;

  return {
    ...intent,
    origin: origin ? resolveCanonicalName(origin) ?? origin : origin,
    destination: destination ? resolveCanonicalName(destination) ?? destination : destination,
  };
}

function cleanPlace(place: string): string {
  return place
    .trim()
    .replace(/\s+(at\s+night|in\s+the\s+morning|in\s+the\s+evening|tonight|now)$/i, "")
    .replace(/\s+(രാത്രി|ഇപ്പോൾ)$/i, "")
    .trim();
}

function resolvePlaceFragment(place: string): string | undefined {
  const cleaned = cleanPlace(place)
    .replace(/^['"\s,.;:!?-]+|['"\s,.;:!?-]+$/g, "")
    .trim();

  if (!cleaned) return undefined;
  return resolveCanonicalName(cleaned) ?? resolveStation(cleaned)?.name_en;
}

function findStandalonePlace(text: string): string | undefined {
  const trimmed = text.trim().replace(/[?.!,]+$/g, "");
  if (!trimmed || trimmed.split(/\s+/).length > 4) return undefined;
  return resolvePlaceFragment(trimmed);
}

function extractOriginFromFragment(text: string): string | undefined {
  const patterns = [
    /(?:my\s+starting\s+location\s+is|my\s+start\s+location\s+is|starting\s+location\s+is|current\s+location\s+is|my\s+location\s+is|starting\s+from|start\s+from|from|i(?:'m| am)\s+(?:starting\s+from|at|in))\s+([^,.?]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return resolvePlaceFragment(match[1]);
  }

  return undefined;
}

function extractDestinationFromFragment(text: string): string | undefined {
  const match = text.match(/(?:to|towards|for|->)\s+([^,.?]+)/i);
  if (!match?.[1]) return undefined;
  return resolvePlaceFragment(match[1]) ?? match[1].trim();
}

function isNightContext(timeContext?: string): boolean {
  if (!timeContext) return false;
  return /night|late|10\s*pm|11\s*pm|22:|23:|after\s*10/i.test(timeContext);
}

function shouldPreserveActiveLanguageForClarification(
  text: string,
  pending: string | null,
  activeLanguage: Language,
  parsedLanguage?: Language
): boolean {
  if (!pending || !parsedLanguage || parsedLanguage === activeLanguage) return false;
  if (/[\u0D00-\u0D7F]/.test(text)) return false;

  return Boolean(
    findStandalonePlace(text) ||
      (pending === "origin" && extractOriginFromFragment(text)) ||
      (pending === "destination" && extractDestinationFromFragment(text))
  );
}

export class YathraSahayiOrchestrator {
  private sessions = new Map<string, ConversationState>();

  getSession(sessionId: string, fallbackLanguage: Language = "ml"): ConversationState {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const state = createInitialState(sessionId, fallbackLanguage);
    this.sessions.set(sessionId, state);
    return state;
  }

  resetSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    getLanguageManager(sessionId).reset();
  }

  async processVoiceInput(input: OrchestratorVoiceInput): Promise<OrchestratorResult> {
    const session = this.getSession(input.sessionId, input.language ?? "ml");
    const stt = await transcribeAudio(input.audioBuffer.toString("base64"), {
      languageCode: input.language ? resolveSttLanguageCode(input.language) : "unknown",
      mimeType: input.mimeType,
    });

    if (!stt.transcript.trim() && stt.error) {
      return this.gracefulError(input.sessionId, session.language, stt.error, stt.provider);
    }

    const result = await this.processTextInput({
      text: stt.transcript,
      sessionId: input.sessionId,
      language: input.language,
      detectedLanguageCode: stt.language_code,
      synthesizeAudio: true,
    });
    return {
      ...result,
      providers: {
        ...result.providers,
        stt: stt.provider,
      },
    };
  }

  async processTextInput(input: OrchestratorTextInput): Promise<OrchestratorResult> {
    const session = this.getSession(input.sessionId, input.language ?? "ml");
    const manager = getLanguageManager(input.sessionId);
    const previousLanguage = session.language;

    try {
      manager.detectAndSwitch(input.text, input.detectedLanguageCode, 0.9);
      const managerLanguage = localeToLanguage(manager.getCurrentLanguage());
      let language = input.detectedLanguageCode
        ? managerLanguage
        : input.language ?? managerLanguage;

      if (isSwitchCommand(input.text)) {
        language = resolveSwitchLanguage(input.text, language);
        manager.reset(languageToLocale(language));
        const response = languageSwitchConfirmation(language);
        const intent: UserIntent = { type: "general", language, transportMode: "any" };
        const state = this.updateSession(input.sessionId, session, intent, language, null, true);
        const tts = await this.maybeSynthesize(response, language, input.synthesizeAudio);
        return this.buildResult(input.text, response, tts, language, intent, state, {
          switchMessage: response,
        });
      }

      if (session.turnCount === 0 && isHelplineOpening(input.text)) {
        const response = renderTemplate("helpline_opening", language);
        const intent: UserIntent = { type: "general", language, transportMode: "any" };
        const state = this.updateSession(input.sessionId, session, intent, language, null, false);
        const tts = await this.maybeSynthesize(response, language, input.synthesizeAudio);
        return this.buildResult(input.text, response, tts, language, intent, state);
      }

      let intent =
        input.intentOverride ??
        (await parseIntent(input.text, language, {
          pendingClarification: session.pendingClarification,
          lastIntent: session.lastIntent,
        }));
      const activeLanguage = language;
      language = shouldPreserveActiveLanguageForClarification(
        input.text,
        session.pendingClarification,
        activeLanguage,
        intent.language
      )
        ? activeLanguage
        : intent.language ?? activeLanguage;
      intent = this.applyContext(normalizeIntentPlaces({ ...intent, language }), session, input.text);

      const handled = await this.handleIntent(intent, language);
      const framed = await generateAssistantResponse({
        transcript: input.text,
        language,
        intent: handled.intent,
        baseResponse: handled.response,
        pendingClarification: handled.pendingClarification,
        routeData: handled.routeData,
        fareData: handled.fareData,
        scheduleData: handled.scheduleData,
      });
      const response = framed.text;

      const state = this.updateSession(
        input.sessionId,
        session,
        handled.intent,
        language,
        handled.pendingClarification,
        previousLanguage !== language
      );
      const switchMessage =
        previousLanguage !== language ? languageSwitchConfirmation(language) : null;
      const spokenResponse = switchMessage
        ? `${switchMessage} ${response}`
        : response;
      const tts = await this.maybeSynthesize(
        spokenResponse,
        language,
        input.synthesizeAudio
      );

      return this.buildResult(input.text, response, tts, language, handled.intent, state, {
        switchMessage,
        routeData: handled.routeData,
        fareData: handled.fareData,
        scheduleData: handled.scheduleData,
        llmProvider: framed.llmProvider,
        searchProvider: framed.searchProvider,
        searchResults: framed.searchResults,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected orchestrator error";
      return this.gracefulError(input.sessionId, session.language, message);
    }
  }

  private applyContext(intent: UserIntent, session: ConversationState, text: string): UserIntent {
    const next = { ...intent };
    const pending = session.pendingClarification as PendingClarification;
    const standalonePlace = findStandalonePlace(text);
    const originFragment = pending === "origin" ? extractOriginFromFragment(text) : undefined;
    const destinationFragment =
      pending === "destination" ? extractDestinationFromFragment(text) : undefined;
    const previousMode =
      session.lastIntent?.transportMode && session.lastIntent.transportMode !== "any"
        ? session.lastIntent.transportMode
        : undefined;

    if (pending === "origin" && (standalonePlace || originFragment)) {
      next.origin = standalonePlace ?? originFragment;
      next.destination = session.lastIntent?.destination ?? next.destination;
      next.type = session.lastIntent?.type === "fare" ? "fare" : "route";
      next.transportMode = next.transportMode === "any" ? previousMode ?? "any" : next.transportMode;
      next.mode = next.transportMode === "any" ? undefined : next.transportMode;
    }

    if (pending === "destination" && (standalonePlace || destinationFragment)) {
      next.origin = session.lastIntent?.origin ?? next.origin;
      next.destination = standalonePlace ?? destinationFragment;
      next.type = session.lastIntent?.type === "fare" ? "fare" : "route";
      next.transportMode = next.transportMode === "any" ? previousMode ?? "any" : next.transportMode;
      next.mode = next.transportMode === "any" ? undefined : next.transportMode;
    }

    if (next.type === "general" && standalonePlace) {
      next.type = "route";
      next.origin = standalonePlace;
      next.destination = session.lastIntent?.destination ?? undefined;
      next.transportMode = "any";
    }

    if (!next.destination) {
      next.destination = extractDestinationFromFragment(text) ?? next.destination;
    }

    if (!next.origin && session.lastIntent?.origin) {
      next.origin = session.lastIntent.origin;
    }
    if (!next.destination && session.lastIntent?.destination) {
      next.destination = session.lastIntent.destination;
    }

    if (next.type === "general" && (next.origin || next.destination)) {
      next.type = session.lastIntent?.type === "fare" ? "fare" : "route";
      next.transportMode = next.transportMode ?? "any";
    }

    if (!next.transportMode) next.transportMode = "any";
    if (!next.timeContext) next.timeContext = session.lastIntent?.timeContext ?? "now";

    return normalizeIntentPlaces(next);
  }

  private async handleIntent(intent: UserIntent, language: Language): Promise<{
    intent: UserIntent;
    response: string;
    pendingClarification: PendingClarification;
    routeData?: TransitRoute;
    fareData?: AutoFareResult;
    scheduleData?: Record<string, unknown>;
  }> {
    if (intent.type === "route") {
      if (!intent.origin) {
        return {
          intent,
          response: buildClarificationQuestion(intent, language),
          pendingClarification: "origin",
        };
      }
      if (!intent.destination) {
        return {
          intent,
          response: buildClarificationQuestion(intent, language),
          pendingClarification: "destination",
        };
      }

      const routeData = await planLiveRoute(
        intent.origin,
        intent.destination,
        intent.timeContext,
        language,
        intent.transportMode ?? "any"
      );
      const routeSummary = routeData
        ? routeData.summary_ml && language === "ml"
          ? routeData.summary_ml
          : routeData.summary_en && language === "en"
            ? routeData.summary_en
            : generateRouteSummary(routeData, language)
        : null;
      return {
        intent,
        response: routeData
          ? routeData.provider === "demo"
            ? routeSummary ?? renderTemplate("no_route", language)
            : `${renderTemplate("route_summary_prefix", language)} ${routeSummary}`
          : renderTemplate("no_route", language),
        pendingClarification: null,
        routeData: routeData ?? undefined,
      };
    }

    if (intent.type === "fare") {
      if (!intent.origin || !intent.destination) {
        return {
          intent,
          response: renderTemplate("ask_origin_and_destination_for_fare", language),
          pendingClarification: !intent.origin ? "origin" : "destination",
        };
      }

      const isNight = isNightContext(intent.timeContext);
      const fareData = await estimateLiveAutoFareBetween(intent.origin, intent.destination, {
        language,
        isNight,
        at: isNight ? new Date("2024-01-01T23:00:00") : undefined,
      });

      if (!fareData) {
        return {
          intent,
          response: renderTemplate("distance_not_available", language),
          pendingClarification: null,
        };
      }

      return {
        intent,
        response: renderTemplate("auto_fare", language, {
          distance: fareData.distance_km.toFixed(1),
          fare: fareData.finalFare,
          nightNote: fareData.nightSurcharge
            ? renderTemplate("night_surcharge_note", language)
            : "",
        }),
        pendingClarification: null,
        fareData,
      };
    }

    if (intent.type === "schedule") {
      const schedule = this.getScheduleResponse(intent, language);
      return {
        intent,
        response: schedule.response,
        pendingClarification: null,
        scheduleData: schedule.data,
      };
    }

    return {
      intent,
      response: renderTemplate("clarification", language),
      pendingClarification: null,
    };
  }

  private getScheduleResponse(
    intent: UserIntent,
    language: Language
  ): { response: string; data: Record<string, unknown> } {
    const station = resolveStation(intent.origin ?? "Aluva");
    const hours = getMetroOperatingHours();
    const freq = getMetroFrequency();
    const closed = isNightContext(intent.timeContext);

    if (closed) {
      return {
        response: renderTemplate("schedule_closed", language, {
          first: station?.first_train ?? METRO_SCHEDULE.firstTrain,
        }),
        data: { station, operatingHours: hours, frequency: freq, closed: true },
      };
    }

    return {
      response: renderTemplate("schedule_next", language, {
        station: station?.name_en ?? "Kochi Metro",
        frequency: freq.peak_minutes,
        last: station?.last_train ?? METRO_SCHEDULE.lastDeparture,
      }),
      data: { station, operatingHours: hours, frequency: freq, closed: false },
    };
  }

  private updateSession(
    sessionId: string,
    current: ConversationState,
    intent: UserIntent,
    language: Language,
    pendingClarification: PendingClarification,
    languageSwitched: boolean
  ): ConversationState {
    const state: ConversationState = {
      ...current,
      sessionId,
      language,
      languageLocale: languageToLocale(language),
      lastIntent: intent,
      turnCount: current.turnCount + 1,
      pendingClarification,
      languageSwitched,
    };
    this.sessions.set(sessionId, state);
    return state;
  }

  private async maybeSynthesize(
    text: string,
    language: Language,
    shouldSynthesize = false
  ): Promise<SarvamTtsResult> {
    if (!shouldSynthesize) {
      return {
        audioBase64: "",
        contentType: "audio/wav",
        speaker: language === "ml" ? "pooja" : "priya",
        provider: "fallback",
      };
    }
    return synthesizeSpeech(text, { language });
  }

  private buildResult(
    transcript: string,
    response: string,
    tts: SarvamTtsResult,
    language: Language,
    intent: UserIntent,
    state: ConversationState,
    options: {
      switchMessage?: string | null;
      routeData?: TransitRoute;
      fareData?: AutoFareResult | FareOutput;
      scheduleData?: Record<string, unknown>;
      llmProvider?: string;
      searchProvider?: string;
      searchResults?: WebSearchResult[];
    } = {}
  ): OrchestratorResult {
    return {
      transcript,
      response,
      responseAudio: tts.audioBase64,
      contentType: tts.contentType,
      language,
      intent,
      state,
      switchMessage: options.switchMessage ?? null,
      routeData: options.routeData,
      fareData: options.fareData,
      scheduleData: options.scheduleData,
      searchResults: options.searchResults,
      providers: {
        tts: tts.provider,
        llm: options.llmProvider,
        search: options.searchProvider,
      },
    };
  }

  private async gracefulError(
    sessionId: string,
    language: Language,
    error: string,
    sttProvider?: string
  ): Promise<OrchestratorResult> {
    const state = this.getSession(sessionId, language);
    const response = renderTemplate("error_generic", language);
    const tts = await this.maybeSynthesize(response, language, false);
    return {
      transcript: "",
      response,
      responseAudio: tts.audioBase64,
      contentType: tts.contentType,
      language,
      intent: { type: "general", language, transportMode: "any" },
      state,
      switchMessage: null,
      providers: { stt: sttProvider, tts: tts.provider },
      error,
    };
  }
}

export const yathraSahayiOrchestrator = new YathraSahayiOrchestrator();
