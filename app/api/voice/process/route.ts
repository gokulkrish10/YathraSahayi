import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-utils";
import { yathraSahayiOrchestrator } from "@/lib/orchestrator";
import type { Language } from "@/types";

interface ProcessBody {
  sessionId?: string;
  text?: string;
  language?: Language;
  detectedLanguageCode?: string;
}

export async function POST(request: Request) {
  const body = await parseJsonBody<ProcessBody>(request);
  if (!body?.text) {
    return jsonError("Missing text in request body", 400);
  }

  const sessionId = body.sessionId ?? `session-${Date.now()}`;
  const turn = await yathraSahayiOrchestrator.processTextInput({
    text: body.text,
    sessionId,
    language: body.language,
    detectedLanguageCode: body.detectedLanguageCode,
    synthesizeAudio: false,
  });

  return jsonOk({
    state: turn.state,
    responseText: turn.response,
    switchMessage: turn.switchMessage,
    intent: turn.intent,
    route: turn.routeData,
    fare: turn.fareData,
    schedule: turn.scheduleData,
    sources: turn.searchResults,
    error: turn.error,
  });
}

export async function GET() {
  return jsonOk({
    message: "Voice process orchestration endpoint",
    usage: "POST { text, sessionId?, language?, detectedLanguageCode? }",
  });
}
