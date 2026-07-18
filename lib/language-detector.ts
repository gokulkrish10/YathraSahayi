export {
  LanguageManager,
  detectLanguage,
  getEnglishWordRatio,
  getLanguageManager,
  isCodeMixedMalayalam,
  languageToLocale,
  localeToLanguage,
  mergeLanguagePreference,
  normalizeLanguage,
  normalizeSarvamLanguageCode,
  shouldSwitchLanguage,
} from "@/lib/language-manager";

import type { Language, UserIntent } from "@/types";

export function createDefaultIntent(language: Language): UserIntent {
  return {
    type: "general",
    language,
  };
}
