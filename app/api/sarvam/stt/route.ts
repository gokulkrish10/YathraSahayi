import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-utils";
import {
  getGracefulVoiceFallback,
  sarvamConfigured,
  transcribeAudio,
} from "@/lib/sarvam-client";
import {
  getLanguageManager,
  localeToLanguage,
  normalizeSarvamLanguageCode,
} from "@/lib/language-detector";
import { languageSwitchConfirmation } from "@/lib/response-generator";
import type { SarvamLanguageCode } from "@/types";

interface SttBody {
  audioBase64?: string;
  language?: string;
  language_code?: SarvamLanguageCode;
  sessionId?: string;
  mimeType?: "audio/wav" | "audio/mpeg" | "audio/ogg";
}

export async function POST(request: Request) {
  const body = await parseJsonBody<SttBody>(request);
  if (!body?.audioBase64) {
    return jsonError("audioBase64 is required", 400);
  }

  const sessionId = body.sessionId ?? `session-${Date.now()}`;
  const languageCode =
    normalizeSarvamLanguageCode(body.language_code ?? body.language) ?? "unknown";

  const result = await transcribeAudio(body.audioBase64, {
    languageCode,
    mimeType: body.mimeType,
  });

  const manager = getLanguageManager(sessionId);
  const previousLocale = manager.getCurrentLanguage();
  const activeLocale = manager.detectAndSwitch(
    result.transcript,
    result.language_code,
    result.confidence ?? 0.9
  );
  const language = localeToLanguage(activeLocale);
  const switched = manager.wasSwitchedThisTurn();

  let switchMessage: string | null = null;
  if (switched && previousLocale !== activeLocale) {
    switchMessage = languageSwitchConfirmation(language);
  }

  if (result.error && result.provider === "fallback") {
    return jsonOk({
      sessionId,
      transcript: result.transcript,
      language,
      language_code: activeLocale,
      languageSwitched: switched,
      switchMessage,
      fallbackMessage: getGracefulVoiceFallback(language),
      provider: result.provider,
      configured: sarvamConfigured(),
      error: result.error,
    });
  }

  return jsonOk({
    sessionId,
    transcript: result.transcript,
    language,
    language_code: activeLocale,
    confidence: result.confidence ?? manager.getConfidence(),
    languageSwitched: switched,
    switchMessage,
    provider: result.provider,
    configured: sarvamConfigured(),
  });
}

export async function GET() {
  return jsonOk({
    message: "Sarvam STT proxy (Saarika v2)",
    usage: "POST { audioBase64, language_code?: 'ml-IN'|'en-IN'|'unknown', sessionId?, mimeType? }",
    configured: sarvamConfigured(),
  });
}
