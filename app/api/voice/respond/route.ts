import { jsonOk, parseJsonBody } from "@/lib/api-utils";
import {
  getGracefulVoiceFallback,
  sarvamConfigured,
  synthesizeSpeech,
  synthesizeSpeechStream,
} from "@/lib/sarvam-client";
import {
  getLanguageManager,
  localeToLanguage,
  normalizeLanguage,
} from "@/lib/language-detector";
import { placeholderVoiceResponse } from "@/lib/response-generator";
import type { Language } from "@/types";

interface RespondBody {
  text?: string;
  language?: Language;
  sessionId?: string;
  stream?: boolean;
  speaker?: string;
}

export async function POST(request: Request) {
  const body = await parseJsonBody<RespondBody>(request);
  const sessionId = body?.sessionId ?? `session-${Date.now()}`;
  const manager = getLanguageManager(sessionId);
  const language = body?.language ?? localeToLanguage(manager.getCurrentLanguage());
  const text = body?.text ?? placeholderVoiceResponse(language);

  if (body?.stream) {
    const streamResult = await synthesizeSpeechStream(text, {
      language,
      speaker: body.speaker,
    });

    return jsonOk({
      sessionId,
      text,
      language,
      stream: true,
      chunks: streamResult.chunks,
      contentType: streamResult.contentType,
      provider: streamResult.provider,
      fallbackMessage:
        streamResult.error && streamResult.provider === "fallback"
          ? getGracefulVoiceFallback(language)
          : undefined,
      configured: sarvamConfigured(),
    });
  }

  const tts = await synthesizeSpeech(text, { language, speaker: body?.speaker });

  return jsonOk({
    sessionId,
    text,
    language,
    audioBase64: tts.audioBase64,
    contentType: tts.contentType,
    speaker: tts.speaker,
    provider: tts.provider,
    fallbackMessage:
      tts.error && tts.provider === "fallback" ? getGracefulVoiceFallback(language) : undefined,
    configured: sarvamConfigured(),
  });
}

export async function GET() {
  return jsonOk({
    message: "TTS response endpoint",
    usage: "POST { text, language?, sessionId?, stream?, speaker? }",
    configured: sarvamConfigured(),
  });
}

export async function OPTIONS() {
  return jsonOk({ status: "ok" });
}
