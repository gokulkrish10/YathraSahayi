import { bedrockConfigured, invokeBedrockGemini } from "@/lib/bedrock-gemini";
import {
  searchTransitWeb,
  webSearchConfigured,
  type WebSearchResponse,
  type WebSearchResult,
} from "@/lib/web-search";
import type {
  AutoFareResult,
  FareOutput,
  Language,
  TransitRoute,
  UserIntent,
} from "@/types";

type PendingClarification = "origin" | "destination" | null;

export interface AssistantResponseInput {
  transcript: string;
  language: Language;
  intent: UserIntent;
  baseResponse: string;
  pendingClarification: PendingClarification;
  routeData?: TransitRoute;
  fareData?: AutoFareResult | FareOutput;
  scheduleData?: Record<string, unknown>;
}

export interface AssistantResponse {
  text: string;
  llmProvider: "bedrock" | "template" | "unconfigured" | "error";
  searchProvider?: "agentcore" | "brave" | "custom" | "unconfigured" | "error";
  searchResults?: WebSearchResult[];
}

const RESPONSE_SYSTEM_PROMPT = `You are Yathra Sahayi, a warm Kochi Metro helpline voice assistant for elderly callers.

Write one natural spoken reply in the requested language.
Rules:
- Match the user's language: Malayalam for "ml", English for "en". Station names may stay in English.
- Sound like a patient human helpline operator, not a chatbot.
- Use the verified route/answer as the source of truth. If route provider is Google, trust the Google Maps route data.
- Web snippets are only supporting context; never invent fares, timings, or routes that are not in the verified route/answer.
- If one location is missing, ask exactly one clear follow-up question and do not ask for information already known.
- Keep the answer short enough for TTS: one or two sentences, no markdown, no bullet points.`;

function shouldUseLlm(input: AssistantResponseInput): boolean {
  if (!bedrockConfigured()) return false;
  if (process.env.DISABLE_LLM_RESPONSES === "true") return false;
  return (
    Boolean(input.pendingClarification) ||
    input.routeData?.provider === "google" ||
    process.env.YATHRA_LLM_RESPONSES === "true"
  );
}

function shouldSearch(input: AssistantResponseInput): boolean {
  if (!webSearchConfigured()) return false;
  if (process.env.DISABLE_WEB_SEARCH === "true") return false;
  if (input.routeData?.provider === "google") return false;
  return (
    process.env.YATHRA_WEB_SEARCH === "true" ||
    input.intent.type === "schedule" ||
    Boolean(input.pendingClarification && input.intent.destination)
  );
}

function buildSearchQuery(input: AssistantResponseInput): string {
  const places = [input.intent.origin, input.intent.destination].filter(Boolean).join(" to ");
  const topic =
    input.intent.type === "schedule"
      ? "latest timings"
      : input.intent.type === "fare"
        ? "fare"
        : "route nearest station";

  return `Kochi Metro ${places || input.transcript} ${topic}`;
}

function compactJson(value: unknown): string {
  return JSON.stringify(value, null, 2).slice(0, 2500);
}

function cleanLlmText(text: string): string | null {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\s*["']|["']\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return null;
  if (/as an ai|language model/i.test(cleaned)) return null;
  return cleaned.length > 420 ? `${cleaned.slice(0, 417).trim()}...` : cleaned;
}

export async function generateAssistantResponse(
  input: AssistantResponseInput
): Promise<AssistantResponse> {
  if (input.routeData?.provider === "demo" || input.routeData?.source?.includes("demo cache")) {
    return {
      text: input.baseResponse,
      llmProvider: "template",
      searchProvider: webSearchConfigured() ? "unconfigured" : undefined,
    };
  }

  if (!shouldUseLlm(input)) {
    return {
      text: input.baseResponse,
      llmProvider: bedrockConfigured() ? "template" : "unconfigured",
      searchProvider: webSearchConfigured() ? "unconfigured" : undefined,
    };
  }

  const search: WebSearchResponse = shouldSearch(input)
    ? await searchTransitWeb(buildSearchQuery(input), { limit: 3 })
    : { provider: "unconfigured", results: [] };

  const userPrompt = `Language: ${input.language}
User transcript: ${input.transcript}
Intent: ${compactJson(input.intent)}
Pending clarification: ${input.pendingClarification ?? "none"}
Verified answer: ${input.baseResponse}
Route provider: ${input.routeData?.source ?? input.routeData?.provider ?? "none"}
Route data: ${compactJson(input.routeData ?? null)}
Fare data: ${compactJson(input.fareData ?? null)}
Schedule data: ${compactJson(input.scheduleData ?? null)}
Web snippets: ${compactJson(search.results)}

Return only the spoken reply.`;

  const result = await invokeBedrockGemini({
    systemPrompt: RESPONSE_SYSTEM_PROMPT,
    userPrompt,
    temperature: 0.25,
    maxTokens: 180,
  });

  if (result.error || !result.text) {
    return {
      text: input.baseResponse,
      llmProvider: result.provider === "bedrock" ? "error" : "unconfigured",
      searchProvider: search.provider,
      searchResults: search.results,
    };
  }

  return {
    text: cleanLlmText(result.text) ?? input.baseResponse,
    llmProvider: "bedrock",
    searchProvider: search.provider,
    searchResults: search.results,
  };
}
