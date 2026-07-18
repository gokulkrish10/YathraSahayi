import { z } from "zod";
import { resolveCanonicalName, getStationAliases, getStations, resolveStation } from "@/lib/cache";
import { detectLanguage, normalizeLanguage } from "@/lib/language-detector";
import { invokeBedrockGemini, bedrockConfigured } from "@/lib/bedrock-gemini";
import { renderTemplate } from "@/lib/response-generator";
import type { IntentType, Language, TransportMode, UserIntent } from "@/types";

const SYSTEM_PROMPT = `You are an intent extraction engine for a Kochi (Kerala, India) transit system called Yathra Sahayi.

Your ONLY job is to extract structured information from user utterances. You do NOT generate routes or fares. You ONLY extract entities.

Given a user's transcribed speech (in Malayalam, English, or code-mixed), extract:
1. intent_type: One of ["route", "fare", "schedule", "last_mile", "general"]
2. origin: The starting point mentioned (station name, landmark, or area)
3. destination: The ending point mentioned
4. transport_mode: Preferred mode if mentioned ["metro", "water_metro", "bus", "auto", "any"]
5. time_context: Any time mentioned ["now", "morning", "evening", "night", "last", specific time]
6. language: The language of the utterance ["ml", "en"]

IMPORTANT RULES:
- For Malayalam inputs, transliterate place names to English canonical form
- "Lulu Mall" should map to origin/destination as "Lulu Mall" (near Edapally)
- "Infopark" or "Kakkanad IT" should map to "Kakkanad"
- If origin is missing, set origin to null (the system will ask)
- If destination is missing, set destination to null
- If conversation context says the system is waiting for origin or destination, use the user's current answer to fill only that missing field and preserve the known previous endpoint
- "Auto rate" or "ഓട്ടോ ചാർജ്" queries are intent_type: "fare"
- "Water Metro" or "വാട്ടർ മെട്രോ" queries are intent_type: "route" with transport_mode "water_metro"
- "Feeder bus", "bus", "ഫീഡർ ബസ്", or "ബസ്" queries are intent_type: "route" with transport_mode "bus"
- "Next metro" or "അടുത്ത മെട്രോ" queries are intent_type: "schedule"
- NEVER hallucinate or guess locations not mentioned by the user
- Return ONLY valid JSON, no explanations`;

const IntentSchema = z.object({
  intent_type: z.enum(["route", "fare", "schedule", "last_mile", "general"]),
  origin: z.string().nullable(),
  destination: z.string().nullable(),
  transport_mode: z.enum(["metro", "water_metro", "bus", "auto", "any"]),
  time_context: z.string(),
  language: z.enum(["ml", "en"]),
});

type ParsedIntent = z.infer<typeof IntentSchema>;

export interface IntentParsingContext {
  pendingClarification?: "origin" | "destination" | string | null;
  lastIntent?: UserIntent | null;
}

function levenshtein(a: string, b: string): number {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}

function fuzzyResolvePlace(name: string | null | undefined): string | null | undefined {
  if (!name) return name;

  const direct = resolveCanonicalName(name);
  if (direct) return direct;

  const normalized = name.trim().toLowerCase();
  const aliases = getStationAliases();

  for (const [alias, canonical] of Object.entries(aliases)) {
    const normalizedAlias = alias.toLowerCase();
    if (normalizedAlias.length >= 3 && normalized.includes(normalizedAlias)) {
      return canonical;
    }
  }

  let bestMatch: string | null = null;
  let bestDistance = Infinity;

  for (const [alias, canonical] of Object.entries(aliases)) {
    const distance = levenshtein(normalized, alias.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = canonical;
    }
  }

  if (bestMatch && bestDistance < 3) {
    return bestMatch;
  }

  return name;
}

export function resolveAliases(intent: UserIntent): UserIntent {
  return {
    ...intent,
    origin: fuzzyResolvePlace(intent.origin) ?? undefined,
    destination: fuzzyResolvePlace(intent.destination) ?? undefined,
  };
}

function mapIntentType(type: ParsedIntent["intent_type"]): IntentType {
  if (type === "last_mile") return "route";
  return type;
}

function toUserIntent(parsed: ParsedIntent, fallbackLanguage: Language): UserIntent {
  return {
    type: mapIntentType(parsed.intent_type),
    origin: parsed.origin ?? undefined,
    destination: parsed.destination ?? undefined,
    transportMode: parsed.transport_mode,
    mode: parsed.transport_mode === "any" ? undefined : parsed.transport_mode,
    language: normalizeLanguage(parsed.language ?? fallbackLanguage),
    timeContext: parsed.time_context,
  };
}

function extractJson(text: string): string | null {
  const match = text.match(/\{[\s\S]*\}/);
  return match?.[0] ?? null;
}

function cleanExtractedPlace(place: string): string | undefined {
  const directCanonical = resolveCanonicalName(place);
  if (directCanonical) return directCanonical;

  const cleaned = place
    .trim()
    .replace(/^['"\s,.;:!?-]+|['"\s,.;:!?-]+$/g, "")
    .replace(/^(?:from|to|towards|at|near)\s+/i, "")
    .replace(/\s+(?:which|what|how|where|when)\b.*$/i, "")
    .replace(/\s+(?:should\s+i\s+take|i\s+should\s+take|can\s+i\s+take)\b.*$/i, "")
    .replace(/\s+(?:metro\s+)?(?:route|vazhi)\s+(?:venam|please|pls)$/i, "")
    .replace(/\s+(?:please|pls|venam)$/i, "")
    .replace(/\s+by\s+(?:metro|train|bus|auto|cab|taxi)$/i, "")
    .replace(/\s+using\s+(?:metro|train|bus|auto|cab|taxi)$/i, "")
    .replace(/\s+(?:ഓട്ടോ|വാട്ടർ മെട്രോ|വാട്ടര് മെട്രോ|ഫീഡർ ബസ്|ഫീഡര് ബസ്|ബസ്|മെട്രോ)\s*(?:ചാർജ്|ചാര്‍ജ്|നിരക്ക്|കൂലി|റൂട്ട്|വഴി)?\b.*$/i, "")
    .replace(
      /\s+(?:metro\s+station|metro\s+service|metro\s+train|metro|train|station|service)\s*$/i,
      ""
    )
    .replace(/[-\s]*(?:ലേക്ക്|യിലേക്ക്|ഇലേക്ക്|യിൽ|യിലേയ്ക്ക്|യില്|വരെ|മുതൽ|നിന്ന്|നിന്നും|ilekku|ilekk|lekku|ilek)$/i, "")
    .replace(/\s*(?:മെട്രോ|മെട്രോ സ്റ്റേഷൻ|മെട്രോ സ്റ്റേഷന്|സ്റ്റേഷൻ|സ്റ്റേഷനിൽ|സ്റ്റേഷനില്)$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  const canonical = resolveCanonicalName(cleaned);
  if (canonical) return canonical;

  if (
    /^(?:i|i want|i need|i would like|please|can|could|how|what|which|tell me|show me|go|travel|reach)$/i.test(
      cleaned
    )
  ) {
    return undefined;
  }

  return cleaned || undefined;
}

function detectTransportMode(text: string): TransportMode | "any" {
  const lower = text.toLowerCase();
  if (/water\s*metro|വാട്ടർ\s*മെട്രോ|വാട്ടര്\s*മെട്രോ/.test(lower)) {
    return "water_metro";
  }
  if (/feeder\s*bus|\bbus\b|ഫീഡർ\s*ബസ്|ഫീഡര്\s*ബസ്|ബസ്/.test(lower)) {
    return "bus";
  }
  if (/\bauto\b|ഓട്ടോ/.test(lower)) return "auto";
  if (/\bmetro\b|മെട്രോ/.test(lower)) return "metro";
  return "any";
}

function extractKnownPlacesInOrder(text: string): string[] {
  const lower = text.toLowerCase();
  const matches: Array<{ index: number; canonical: string; length: number }> = [];
  const aliases = getStationAliases();

  for (const [alias, canonical] of Object.entries(aliases)) {
    if (alias.trim().length < 3) continue;
    const index = lower.indexOf(alias.toLowerCase());
    if (index >= 0) {
      matches.push({ index, canonical, length: alias.length });
    }
  }

  for (const station of getStations()) {
    const index = lower.indexOf(station.name_en.toLowerCase());
    if (index >= 0) {
      matches.push({ index, canonical: station.name_en, length: station.name_en.length });
    }
    if (station.name_ml.length >= 3) {
      const mlIndex = text.indexOf(station.name_ml);
      if (mlIndex >= 0) {
        matches.push({ index: mlIndex, canonical: station.name_en, length: station.name_ml.length });
      }
    }
  }

  const ordered = matches
    .sort((a, b) => a.index - b.index || b.length - a.length)
    .filter((match, index, array) => {
      const previous = array[index - 1];
      return !(previous && match.index >= previous.index && match.index < previous.index + previous.length);
    });

  const unique: string[] = [];
  for (const match of ordered) {
    if (!unique.includes(match.canonical)) unique.push(match.canonical);
  }
  return unique;
}

function parseRoutePair(text: string): { origin: string; destination: string } | null {
  const malayalamFromTo = text.match(
    /(.+?)\s*(?:മുതൽ|നിന്ന്|നിന്നും|യിൽ നിന്ന്|യില് നിന്ന്|ഇൽ നിന്ന്|ഇല് നിന്ന്)\s+(.+?)(?=$|[,.?]|ഓട്ടോ|വാട്ടർ|വാട്ടര്|ഫീഡർ|ഫീഡര്|ബസ്|ചാർജ്|ചാര്‍ജ്|നിരക്ക്|കൂലി|പോകണം|പോകാൻ|പോകാന്)/i
  );
  if (malayalamFromTo) {
    const origin = cleanExtractedPlace(malayalamFromTo[1]);
    const destination = cleanExtractedPlace(malayalamFromTo[2]);
    if (origin && destination) return { origin, destination };
  }

  const manglishFromTo = text.match(
    /(?:enikku|eniku|njan)\s+(.+?)\s+(?:ninnu|ninn|il\s+ninnu|il\s+ninn)\s+(.+?)(?=$|[,.?])/i
  );
  if (manglishFromTo) {
    const origin = cleanExtractedPlace(manglishFromTo[1]);
    const destination = cleanExtractedPlace(manglishFromTo[2]);
    if (origin && destination) return { origin, destination };
  }

  const fromToPatterns = [
    /(?:^|[\s,])(?:from|starting from|start from)\s+(.+?)\s+(?:to|towards|->)\s+(.+?)(?=$|[,.?])/i,
    /(?:^|[\s,])(?:go|travel|route|reach).*?\s+from\s+(.+?)\s+(?:to|towards|->)\s+(.+?)(?=$|[,.?])/i,
  ];

  for (const pattern of fromToPatterns) {
    const match = text.match(pattern);
    const origin = match?.[1] ? cleanExtractedPlace(match[1]) : undefined;
    const destination = match?.[2] ? cleanExtractedPlace(match[2]) : undefined;
    if (origin && destination) return { origin, destination };
  }

  const destinationFirst = text.match(
    /(?:\bgo\s+to\b|\breach\b|\btravel\s+to\b|\btowards\b)\s+(.+?)\s+(?:from|starting from|start from)\s+(.+?)(?=$|[,.?])/i
  );
  if (destinationFirst) {
    const destination = cleanExtractedPlace(destinationFirst[1]);
    const origin = cleanExtractedPlace(destinationFirst[2]);
    if (origin && destination) return { origin, destination };
  }

  const directPair = text.match(
    /^(?:route\s+)?(?:from\s+)?(.+?)\s+(?:to|towards|->)\s+(.+?)(?=$|[,.?])/i
  );
  const origin = directPair?.[1] ? cleanExtractedPlace(directPair[1]) : undefined;
  const destination = directPair?.[2] ? cleanExtractedPlace(directPair[2]) : undefined;
  if (origin && destination && !/^(?:i|i want|i need|please|can|could|how|what|which)\b/i.test(origin)) {
    return { origin, destination };
  }

  return null;
}

function parsePlace(text: string, side: "origin" | "destination"): string | undefined {
  const patterns =
    side === "origin"
      ? [
          /(?:from|starting from|start from)\s+([^,.?]+?)(?:\s+(?:to|towards|->)|[,.?]|$)/i,
          /(?:at|near|starting at|i'?m at|i am at)\s+([^,.?]+?)(?:\s+(?:and|to|->)|[,.?]|$)/i,
          /^([^,.]+?)\s+(?:to|->|ile|il ninnu|ninnu|il ninn)/i,
          /(?:^|\s)([A-Za-z\u0D00-\u0D7F][^,.]*?)\s+(?:to|->)/i,
        ]
      : [
          /(?:from|starting from|start from)\s+[^,.?]+?\s+(?:to|towards|->)\s+([^,.?]+)/i,
          /([A-Za-z\u0D00-\u0D7F][A-Za-z\u0D00-\u0D7F\s'.-]*?)(?:[-\s]*(?:ലേക്ക്|യിലേക്ക്|ഇലേക്ക്|ിലേക്ക്|യിൽ|യില്|യിലേയ്ക്ക്|ilekku|ilekk|lekku|ilek))/i,
          /(?:\bgo\s+to\b|\breach\b|pokanam|povannam|povuka|\bile\b|\bil\b)\s+([^,?]+)/i,
          /(?:\bto\b|->)\s+([^,.]+)/i,
        ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return cleanExtractedPlace(match[1]);
    }
  }

  return undefined;
}

export function regexParseIntent(text: string, language: Language): UserIntent {
  const lower = text.toLowerCase();
  const transportMode = detectTransportMode(text);
  const routePair = parseRoutePair(text);
  const knownPlaces = extractKnownPlacesInOrder(text);
  const parsedOrigin = parsePlace(text, "origin");
  const parsedDestination = parsePlace(text, "destination");
  const fallbackOrigin = routePair?.origin ?? (knownPlaces.length > 1 ? knownPlaces[0] : undefined);
  const fallbackDestination = routePair?.destination ?? (knownPlaces.length > 1 ? knownPlaces[1] : undefined);
  const destinationOnlyFallback =
    !parsedOrigin && !routePair?.origin && knownPlaces.length === 1 ? knownPlaces[0] : undefined;

  if (
    /auto fare|auto charge|auto rate|ഓട്ടോ\s*(?:ചാർജ്|ചാര്‍ജ്|നിരക്ക്|കൂലി)|nirekk|how much.*auto|charge.*auto|ഓട്ടോയിൽ.*എത്ര|ഓട്ടോയില്.*എത്ര/.test(
      lower
    )
  ) {
    return resolveAliases({
      type: "fare",
      origin: routePair?.origin ?? parsedOrigin ?? fallbackOrigin,
      destination: routePair?.destination ?? parsedDestination ?? fallbackDestination ?? destinationOnlyFallback,
      transportMode: "auto",
      mode: "auto",
      language,
      timeContext: /night|രാത്രി|11\s*pm|10\s*pm|22:/.test(lower) ? "night" : "now",
    });
  }

  if (
    /last metro|next metro|first metro|schedule|timing|last train|first train/.test(lower) ||
    /അവസാന\s*മെട്രോ|അടുത്ത\s*മെട്രോ|ആദ്യ\s*മെട്രോ|മെട്രോ\s*സമയം/.test(text)
  ) {
    return resolveAliases({
      type: "schedule",
      origin: parsedOrigin ?? fallbackOrigin ?? destinationOnlyFallback,
      destination: undefined,
      transportMode: /metro/.test(lower) ? "metro" : "any",
      mode: /metro/.test(lower) ? "metro" : undefined,
      language,
      timeContext: /last/.test(lower) || /അവസാന/.test(text) ? "last" : "now",
    });
  }

  if (routePair) {
    return resolveAliases({
      type: "route",
      origin: routePair.origin,
      destination: routePair.destination,
      transportMode,
      mode: transportMode === "any" ? undefined : transportMode,
      language,
      timeContext: /evening|morning|night|രാത്രി/.test(lower) ? "evening" : "now",
    });
  }

  if (
    /pokanam|povannam|go to|reach|travel|route|vazhi|engane|how to|water\s*metro|feeder\s*bus|\bbus\b/.test(lower) ||
    /പോകണം|പോകാം|പോകാമെന്ന്|എങ്ങനെ|എങ്ങിനെ|എത്തണം|ലേക്ക്|യിലേക്ക്|ഇലേക്ക്|വഴി|മെട്രോയിൽ|വാട്ടർ മെട്രോ|വാട്ടര് മെട്രോ|ഫീഡർ ബസ്|ഫീഡര് ബസ്|ബസ്/.test(
      text
    )
  ) {
    const manglishMatch = text.match(/(?:enikku|eniku)\s+(.+?)\s+pokanam/i);
    if (manglishMatch) {
      return resolveAliases({
        type: "route",
        origin: undefined,
        destination: cleanExtractedPlace(manglishMatch[1]),
        transportMode,
        mode: transportMode === "any" ? undefined : transportMode,
        language,
        timeContext: "now",
      });
    }

    return resolveAliases({
      type: "route",
      origin: parsedOrigin ?? fallbackOrigin,
      destination: parsedDestination ?? fallbackDestination ?? destinationOnlyFallback,
      transportMode,
      mode: transportMode === "any" ? undefined : transportMode,
      language,
      timeContext: "now",
    });
  }

  return { type: "general", language, transportMode: "any" };
}

async function extractWithBedrockGemini(
  transcript: string,
  language: Language,
  context?: IntentParsingContext
): Promise<UserIntent | null> {
  if (!bedrockConfigured()) return null;

  const userPrompt = context?.pendingClarification
    ? [
        "Conversation context:",
        JSON.stringify({
          pendingClarification: context.pendingClarification,
          lastIntent: context.lastIntent
            ? {
                type: context.lastIntent.type,
                origin: context.lastIntent.origin ?? null,
                destination: context.lastIntent.destination ?? null,
                transportMode: context.lastIntent.transportMode ?? "any",
                timeContext: context.lastIntent.timeContext ?? "now",
              }
            : null,
        }),
        "Current user utterance:",
        transcript,
      ].join("\n")
    : transcript;

  const result = await invokeBedrockGemini({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    temperature: 0.1,
    maxTokens: 200,
    jsonMode: true,
  });

  if (!result.text || result.error) return null;

  const jsonText = extractJson(result.text);
  if (!jsonText) return null;

  try {
    const parsed = IntentSchema.parse(JSON.parse(jsonText));
    return resolveAliases(toUserIntent(parsed, language));
  } catch {
    return null;
  }
}

export async function parseIntent(
  transcript: string,
  preferredLanguage?: Language,
  context?: IntentParsingContext
): Promise<UserIntent> {
  const language = preferredLanguage ?? detectLanguage(transcript);
  const bedrockIntent = await extractWithBedrockGemini(transcript, language, context);
  if (bedrockIntent) return bedrockIntent;
  return regexParseIntent(transcript, language);
}

export function buildClarificationQuestion(intent: UserIntent, language: Language): string {
  if (!intent.origin && !intent.destination) {
    return renderTemplate("clarification", language);
  }
  if (!intent.origin) {
    if (intent.destination) {
      if (intent.transportMode && !["any", "metro"].includes(intent.transportMode)) {
        return renderTemplate("ask_origin_for_destination", language, {
          destination: intent.destination,
        });
      }

      const nearest = resolveStation(intent.destination);
      const isDifferentPlace =
        nearest && nearest.name_en.toLowerCase() !== intent.destination.toLowerCase();

      return isDifferentPlace
        ? renderTemplate("ask_origin_for_destination_nearest", language, {
            destination: intent.destination,
            station: nearest.name_en,
          })
        : renderTemplate("ask_origin_for_destination", language, {
            destination: intent.destination,
          });
    }

    return renderTemplate("ask_origin", language);
  }
  if (!intent.destination) {
    if (intent.origin) {
      return renderTemplate("ask_destination_from_origin", language, {
        origin: intent.origin,
      });
    }

    return renderTemplate("ask_destination", language);
  }
  return renderTemplate("clarification", language);
}

export { IntentSchema, SYSTEM_PROMPT };
