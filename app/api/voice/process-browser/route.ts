import { jsonError, jsonOk } from "@/lib/api-utils";
import { yathraSahayiOrchestrator } from "@/lib/orchestrator";
import type { IntentType, Language, UserIntent } from "@/types";

type BrowserAudioMime = "audio/wav" | "audio/mpeg" | "audio/ogg" | "audio/webm";

function resolveLanguage(value: FormDataEntryValue | null): Language | undefined {
  if (value === "ml" || value === "en") return value;
  return undefined;
}

function resolveSttMime(type: string): BrowserAudioMime | undefined {
  if (type.includes("webm")) return "audio/webm";
  if (type.includes("wav")) return "audio/wav";
  if (type.includes("mpeg") || type.includes("mp3")) return "audio/mpeg";
  if (type.includes("ogg")) return "audio/ogg";
  return undefined;
}

function resolveDirectIntent(formData: FormData, language?: Language): UserIntent | null {
  const intentType = formData.get("intentType") as IntentType | null;
  if (!intentType) return null;
  const resolvedLanguage = language ?? "en";

  const origin = (formData.get("origin") as string | null)?.trim() || undefined;
  const destination = (formData.get("destination") as string | null)?.trim() || undefined;
  const timeContext = (formData.get("timeContext") as string | null)?.trim() || "now";
  const transportMode =
    intentType === "fare" ? "auto" : intentType === "schedule" ? "metro" : "any";

  return {
    type: intentType === "last_mile" ? "route" : intentType,
    origin,
    destination,
    transportMode,
    mode: transportMode === "any" ? undefined : transportMode,
    language: resolvedLanguage,
    timeContext,
  };
}

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return jsonError("Expected multipart form data", 400);
  }

  const sessionId =
    (formData.get("sessionId") as string | null)?.trim() || `browser-${Date.now()}`;
  const preferredLanguage = resolveLanguage(formData.get("language"));
  const textInput = (formData.get("text") as string | null)?.trim() ?? "";
  const audioFile = formData.get("audio");
  const directIntent = resolveDirectIntent(formData, preferredLanguage);

  if (!directIntent && !textInput && audioFile instanceof File && audioFile.size > 0) {
    const buffer = Buffer.from(await audioFile.arrayBuffer());
    if (buffer.length === 0) {
      return jsonError("Empty audio recording", 400);
    }

    const result = await yathraSahayiOrchestrator.processVoiceInput({
      audioBuffer: buffer,
      sessionId,
      language: preferredLanguage,
      mimeType: resolveSttMime(audioFile.type),
    });

    return jsonOk({
      sessionId,
      transcript: result.transcript,
      detectedLanguage: result.language,
      responseLanguage: result.language,
      intent: result.intent,
      responseText: result.response,
      switchMessage: result.switchMessage,
      audioBase64: result.responseAudio,
      contentType: result.contentType,
      state: result.state,
      providers: result.providers,
      route: result.routeData,
      fare: result.fareData,
      schedule: result.scheduleData,
      sources: result.searchResults,
      error: result.error,
    });
  }

  if (!directIntent && !textInput) {
    return jsonError("No speech detected. Hold the mic button and speak clearly.", 400);
  }

  const result = await yathraSahayiOrchestrator.processTextInput({
    text: textInput || `${directIntent?.type ?? "preset"} query`,
    sessionId,
    language: preferredLanguage,
    intentOverride: directIntent ?? undefined,
    synthesizeAudio: true,
  });

  return jsonOk({
    sessionId,
    transcript: directIntent ? textInput || `${directIntent.type} query` : textInput,
    detectedLanguage: result.language,
    responseLanguage: result.language,
    intent: result.intent,
    responseText: result.response,
    switchMessage: result.switchMessage,
    audioBase64: result.responseAudio,
    contentType: result.contentType,
    state: result.state,
    providers: {
      stt: directIntent ? "preset" : "text",
      tts: result.providers.tts,
      llm: result.providers.llm,
      search: result.providers.search,
    },
    route: result.routeData,
    fare: result.fareData,
    schedule: result.scheduleData,
    sources: result.searchResults,
    error: result.error,
  });
}

export async function GET() {
  return jsonOk({
    message: "Browser voice pipeline (Step 8)",
    usage:
      "POST multipart: audio (File) OR text, optional sessionId. Omit language for auto detection.",
  });
}
