import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-utils";
import {
  getAvailableSpeakers,
  getGracefulVoiceFallback,
  sarvamConfigured,
  synthesizeSpeech,
  synthesizeSpeechStream,
} from "@/lib/sarvam-client";
import { normalizeLanguage } from "@/lib/language-detector";
import type { Language } from "@/types";

interface TtsBody {
  text?: string;
  language?: Language;
  speaker?: string;
  stream?: boolean;
}

export async function POST(request: Request) {
  const body = await parseJsonBody<TtsBody>(request);
  if (!body?.text) {
    return jsonError("text is required", 400);
  }

  const language = normalizeLanguage(body.language);
  const speaker = body.speaker ?? getAvailableSpeakers(language)[0];

  if (body.stream) {
    const streamResult = await synthesizeSpeechStream(body.text, { language, speaker });
    if (streamResult.provider === "fallback" && streamResult.error) {
      return jsonOk({
        text: body.text,
        language,
        speaker,
        stream: true,
        chunks: streamResult.chunks,
        fallbackMessage: getGracefulVoiceFallback(language),
        provider: streamResult.provider,
        configured: sarvamConfigured(),
        error: streamResult.error,
      });
    }

    return jsonOk({
      text: body.text,
      language,
      speaker,
      stream: true,
      chunks: streamResult.chunks,
      contentType: streamResult.contentType,
      provider: streamResult.provider,
      configured: sarvamConfigured(),
    });
  }

  const result = await synthesizeSpeech(body.text, { language, speaker });

  if (result.provider === "fallback" && result.error) {
    return jsonOk({
      text: body.text,
      language,
      speaker: result.speaker,
      audioBase64: result.audioBase64,
      contentType: result.contentType,
      fallbackMessage: getGracefulVoiceFallback(language),
      provider: result.provider,
      configured: sarvamConfigured(),
      error: result.error,
    });
  }

  return jsonOk({
    text: body.text,
    language,
    speaker: result.speaker,
    audioBase64: result.audioBase64,
    contentType: result.contentType,
    provider: result.provider,
    configured: sarvamConfigured(),
  });
}

export async function GET() {
  return jsonOk({
    message: "Sarvam TTS proxy (Bulbul v1)",
    usage: "POST { text, language?, speaker?, stream? }",
    speakers: {
      ml: getAvailableSpeakers("ml"),
      en: getAvailableSpeakers("en"),
    },
    configured: sarvamConfigured(),
  });
}
