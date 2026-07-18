import { yathraSahayiOrchestrator } from "@/lib/orchestrator";
import type { ConversationState, Language, UserIntent } from "@/types";

export interface VoiceTurnInput {
  text: string;
  sessionId: string;
  language?: Language;
  detectedLanguageCode?: string;
  intentOverride?: UserIntent;
}

export interface VoiceTurnResult {
  state: ConversationState;
  responseText: string;
  switchMessage: string | null;
  intent: UserIntent;
  payload: Record<string, unknown>;
}

export async function executeVoiceTurn(input: VoiceTurnInput): Promise<VoiceTurnResult> {
  const result = await yathraSahayiOrchestrator.processTextInput({
    ...input,
    synthesizeAudio: false,
  });

  return {
    state: result.state,
    responseText: result.response,
    switchMessage: result.switchMessage,
    intent: result.intent,
    payload: {
      intent: result.intent,
      route: result.routeData,
      fare: result.fareData,
      schedule: result.scheduleData,
      sources: result.searchResults,
      error: result.error,
    },
  };
}
