import axios, { AxiosError } from "axios";
import { renderTemplate } from "@/lib/response-generator";
import {
  languageToLocale,
  normalizeSarvamLanguageCode,
} from "@/lib/language-manager";
import type {
  Language,
  SarvamLanguageCode,
  SarvamLocale,
  SarvamSttResult,
  SarvamTtsResult,
  SarvamTtsStreamResult,
} from "@/types";

const SARVAM_BASE_URL = "https://api.sarvam.ai";
const STT_MODEL = "saaras:v3";
const TTS_MODEL = "bulbul:v3";
const MAX_AUDIO_SECONDS = 30;
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 400;

const MALAYALAM_SPEAKERS = ["pooja", "kavitha", "kavya", "suhani"] as const;
const ENGLISH_SPEAKERS = ["priya", "ishita", "shreya", "shubh"] as const;
const DEFAULT_TTS_PACE: Record<Language, number> = {
  ml: 1.18,
  en: 1.1,
};

type AudioMime = "audio/wav" | "audio/mpeg" | "audio/ogg" | "audio/webm";

export interface TranscribeOptions {
  languageCode?: SarvamLanguageCode;
  mimeType?: AudioMime;
  filename?: string;
}

export interface SynthesizeOptions {
  language?: Language;
  speaker?: string;
  pace?: number;
  pitch?: number;
  loudness?: number;
  stream?: boolean;
}

function getApiKey(): string | undefined {
  return process.env.SARVAM_API_KEY?.trim() || undefined;
}

export function sarvamConfigured(): boolean {
  return Boolean(getApiKey());
}

function getFallbackMessage(language: Language): string {
  return renderTemplate("sarvam_error", language);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  return !status || status >= 500 || status === 429;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  attempts = RETRY_ATTEMPTS
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryable(error)) break;
      await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

function detectMimeFromBuffer(buffer: Buffer): AudioMime {
  if (buffer.slice(0, 4).toString("ascii") === "RIFF") return "audio/wav";
  if (buffer.slice(0, 4).toString("ascii") === "OggS") return "audio/ogg";
  if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45) return "audio/webm";
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return "audio/mpeg";
  return "audio/wav";
}

export function prepareAudioBuffer(
  audioBase64: string,
  mimeType?: AudioMime
): { buffer: Buffer; mimeType: AudioMime; filename: string } {
  const buffer = Buffer.from(audioBase64, "base64");
  if (buffer.length === 0) {
    throw new Error("Empty audio buffer");
  }

  const resolvedMime = mimeType ?? detectMimeFromBuffer(buffer);
  const estimatedSeconds = buffer.length / (16000 * 2);
  if (resolvedMime === "audio/wav" && estimatedSeconds > MAX_AUDIO_SECONDS + 5) {
    throw new Error(`Audio exceeds ${MAX_AUDIO_SECONDS}s limit`);
  }

  const ext =
    resolvedMime === "audio/mpeg"
      ? "mp3"
      : resolvedMime === "audio/ogg"
        ? "ogg"
        : resolvedMime === "audio/webm"
          ? "webm"
          : "wav";

  return {
    buffer,
    mimeType: resolvedMime,
    filename: `utterance.${ext}`,
  };
}

function buildSttFormData(
  audioBase64: string,
  languageCode: SarvamLanguageCode,
  mimeType?: AudioMime
): FormData {
  const { buffer, mimeType: resolvedMime, filename } = prepareAudioBuffer(
    audioBase64,
    mimeType
  );
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type: resolvedMime }), filename);
  form.append("language_code", languageCode);
  form.append("model", STT_MODEL);
  form.append("mode", "codemix");
  form.append("with_timestamps", "false");
  return form;
}

function pickSpeaker(language: Language, speaker?: string): string {
  if (speaker) return speaker;
  return language === "ml" ? MALAYALAM_SPEAKERS[0] : ENGLISH_SPEAKERS[0];
}

function normalizeDetectedLocale(value?: string): SarvamLocale {
  const normalized = normalizeSarvamLanguageCode(value);
  return normalized === "unknown" ? "ml-IN" : normalized;
}

export async function transcribeAudio(
  audioBase64: string,
  options: TranscribeOptions = {}
): Promise<SarvamSttResult> {
  const apiKey = getApiKey();
  const requestedLanguage = options.languageCode ?? "unknown";
  const fallbackLocale: SarvamLocale =
    requestedLanguage === "unknown" ? "ml-IN" : requestedLanguage;

  if (!apiKey) {
    return {
      transcript: "",
      language_code: fallbackLocale,
      provider: "fallback",
      error: "SARVAM_API_KEY not configured",
    };
  }

  try {
    const form = buildSttFormData(audioBase64, requestedLanguage, options.mimeType);
    const response = await withRetry(() =>
      axios.post(`${SARVAM_BASE_URL}/speech-to-text`, form, {
        headers: {
          "api-subscription-key": apiKey,
        },
        timeout: 45000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      })
    );

    const transcript = String(response.data?.transcript ?? response.data?.text ?? "").trim();
    const language_code = normalizeDetectedLocale(response.data?.language_code);

    return {
      transcript,
      language_code,
      confidence: typeof response.data?.confidence === "number" ? response.data.confidence : 0.9,
      provider: "sarvam",
    };
  } catch (error) {
    const message = axios.isAxiosError(error)
      ? error.response?.data?.message ?? error.message
      : "STT request failed";

    return {
      transcript: "",
      language_code: fallbackLocale,
      provider: "fallback",
      error: message,
    };
  }
}

export async function synthesizeSpeech(
  text: string,
  options: SynthesizeOptions = {}
): Promise<SarvamTtsResult> {
  const language = options.language ?? "ml";
  const locale = languageToLocale(language);
  const speaker = pickSpeaker(language, options.speaker);
  const apiKey = getApiKey();

  if (!apiKey) {
    return {
      audioBase64: "",
      contentType: "audio/wav",
      speaker,
      provider: "fallback",
      error: "SARVAM_API_KEY not configured",
    };
  }

  if (!text.trim()) {
    return {
      audioBase64: "",
      contentType: "audio/wav",
      speaker,
      provider: "fallback",
      error: "Empty text",
    };
  }

  try {
    const response = await withRetry(() =>
      axios.post(
        `${SARVAM_BASE_URL}/text-to-speech`,
        {
          text,
          target_language_code: locale,
          speaker,
          model: TTS_MODEL,
          pace: options.pace ?? DEFAULT_TTS_PACE[language],
        },
        {
          headers: {
            "api-subscription-key": apiKey,
            "Content-Type": "application/json",
          },
          timeout: 45000,
        }
      )
    );

    const audios = response.data?.audios ?? [];
    const audioBase64 = Array.isArray(audios) ? String(audios[0] ?? "") : String(audios ?? "");

    return {
      audioBase64,
      contentType: "audio/wav",
      speaker,
      provider: audioBase64 ? "sarvam" : "fallback",
    };
  } catch (error) {
    const message = axios.isAxiosError(error)
      ? error.response?.data?.message ?? error.message
      : "TTS request failed";

    return {
      audioBase64: "",
      contentType: "audio/wav",
      speaker,
      provider: "fallback",
      error: message,
    };
  }
}

function splitTextForStreaming(text: string, maxLen = 180): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return [trimmed];

  const sentences = trimmed.match(/[^.!?]+[.!?]?/g) ?? [trimmed];
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if ((current + sentence).length > maxLen && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [trimmed];
}

export async function synthesizeSpeechStream(
  text: string,
  options: SynthesizeOptions = {}
): Promise<SarvamTtsStreamResult> {
  const language = options.language ?? "ml";
  const speaker = pickSpeaker(language, options.speaker);
  const parts = splitTextForStreaming(text);
  const chunks: SarvamTtsStreamResult["chunks"] = [];

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const result = await synthesizeSpeech(part, { ...options, stream: false });
    chunks.push({
      index,
      text: part,
      audioBase64: result.audioBase64,
    });

    if (result.provider === "fallback" && result.error) {
      return {
        chunks,
        contentType: "audio/wav",
        speaker,
        provider: "fallback",
        error: result.error,
      };
    }
  }

  return {
    chunks,
    contentType: "audio/wav",
    speaker,
    provider: chunks.some((c) => c.audioBase64) ? "sarvam" : "fallback",
  };
}

export function getGracefulVoiceFallback(language: Language): string {
  return getFallbackMessage(language);
}

export function getAvailableSpeakers(language: Language): readonly string[] {
  return language === "ml" ? MALAYALAM_SPEAKERS : ENGLISH_SPEAKERS;
}

export type { AxiosError };
