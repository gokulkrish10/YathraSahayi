import type { Language, SarvamLocale } from "@/types";

const MALAYALAM_REGEX = /[\u0D00-\u0D7F]/;
const ENGLISH_SWITCH_PHRASES = [
  "please speak in english",
  "speak in english",
  "english please",
  "switch to english",
  "talk in english",
];
const MALAYALAM_SWITCH_PHRASES = [
  "മലയാളത്തിൽ പറയൂ",
  "മലയാളം",
  "malayalamil parayoo",
  "speak in malayalam",
  "switch to malayalam",
];

const ENGLISH_WORD_REGEX = /\b[a-zA-Z]+\b/g;

export class LanguageManager {
  private currentLanguage: SarvamLocale = "ml-IN";
  private confidence = 0;
  private locked = false;
  private switchedThisTurn = false;

  getCurrentLanguage(): SarvamLocale {
    return this.currentLanguage;
  }

  getConfidence(): number {
    return this.confidence;
  }

  wasSwitchedThisTurn(): boolean {
    return this.switchedThisTurn;
  }

  toAppLanguage(): Language {
    return this.currentLanguage === "ml-IN" ? "ml" : "en";
  }

  reset(defaultLanguage: SarvamLocale = "ml-IN"): void {
    this.currentLanguage = defaultLanguage;
    this.confidence = 0;
    this.locked = false;
    this.switchedThisTurn = false;
  }

  detectAndSwitch(transcript: string, detectedLang?: string, confidence = 0.85): SarvamLocale {
    this.switchedThisTurn = false;
    const text = transcript.trim();
    const lower = text.toLowerCase();

    if (MALAYALAM_SWITCH_PHRASES.some((p) => lower.includes(p.toLowerCase()) || text.includes(p))) {
      return this.applySwitch("ml-IN", confidence);
    }

    if (ENGLISH_SWITCH_PHRASES.some((p) => lower.includes(p))) {
      return this.applySwitch("en-IN", confidence);
    }

    if (detectedLang === "ml-IN" || detectedLang === "en-IN") {
      this.confidence = confidence;
      if (!this.locked) {
        this.currentLanguage = detectedLang;
        this.locked = true;
      } else if (detectedLang !== this.currentLanguage) {
        const englishRatio = getEnglishWordRatio(text);
    if (
      this.currentLanguage === "ml-IN" &&
      detectedLang === "en-IN" &&
      englishRatio >= 0.6 &&
      !isCodeMixedMalayalam(text)
    ) {
      return this.applySwitch("en-IN", confidence);
    }
        if (
          this.currentLanguage === "en-IN" &&
          detectedLang === "ml-IN" &&
          MALAYALAM_REGEX.test(text)
        ) {
          return this.applySwitch("ml-IN", confidence);
        }
      }
      return this.currentLanguage;
    }

    if (MALAYALAM_REGEX.test(text)) {
      this.confidence = Math.max(this.confidence, 0.8);
      if (!this.locked) {
        this.currentLanguage = "ml-IN";
        this.locked = true;
      }
      return this.currentLanguage;
    }

    const englishRatio = getEnglishWordRatio(text);
    if (englishRatio >= 0.6 && this.currentLanguage === "ml-IN" && this.locked) {
      return this.applySwitch("en-IN", englishRatio);
    }

    if (!this.locked) {
      this.currentLanguage = englishRatio >= 0.6 ? "en-IN" : "ml-IN";
      this.locked = true;
      this.confidence = englishRatio || 0.7;
    }

    return this.currentLanguage;
  }

  private applySwitch(next: SarvamLocale, confidence: number): SarvamLocale {
    if (next !== this.currentLanguage) {
      this.switchedThisTurn = true;
    }
    this.currentLanguage = next;
    this.confidence = confidence;
    this.locked = true;
    return this.currentLanguage;
  }
}

const sessionManagers = new Map<string, LanguageManager>();

export function getLanguageManager(sessionId: string): LanguageManager {
  let manager = sessionManagers.get(sessionId);
  if (!manager) {
    manager = new LanguageManager();
    sessionManagers.set(sessionId, manager);
  }
  return manager;
}

export function localeToLanguage(locale: SarvamLocale): Language {
  return locale === "ml-IN" ? "ml" : "en";
}

export function languageToLocale(language: Language): SarvamLocale {
  return language === "ml" ? "ml-IN" : "en-IN";
}

export function getEnglishWordRatio(text: string): number {
  const words = text.match(ENGLISH_WORD_REGEX) ?? [];
  if (words.length === 0) return 0;
  const tokens = text.split(/\s+/).filter(Boolean);
  return words.length / Math.max(tokens.length, 1);
}

export function detectLanguage(text: string): Language {
  if (MALAYALAM_REGEX.test(text)) return "ml";
  return getEnglishWordRatio(text) >= 0.6 ? "en" : "ml";
}

export function shouldSwitchLanguage(
  current: Language,
  detected: Language,
  consecutiveTurns: number
): boolean {
  if (current === detected) return false;
  return consecutiveTurns >= 1;
}

export function normalizeLanguage(input?: string | null): Language {
  if (!input) return "ml";
  const value = input.toLowerCase();
  if (value === "ml" || value === "malayalam" || value === "ml-in" || value === "മലയാളം") {
    return "ml";
  }
  if (value === "en" || value === "english" || value === "en-in") return "en";
  return detectLanguage(input);
}

export function normalizeSarvamLanguageCode(input?: string | null): "ml-IN" | "en-IN" | "unknown" {
  if (!input) return "unknown";
  const value = input.toLowerCase();
  if (value === "ml" || value === "ml-in" || value === "malayalam") return "ml-IN";
  if (value === "en" || value === "en-in" || value === "english") return "en-IN";
  if (value === "unknown" || value === "auto") return "unknown";
  return "unknown";
}

export function mergeLanguagePreference(sessionLanguage: Language, userText: string): Language {
  const detected = detectLanguage(userText);
  if (detected === "ml") return "ml";
  if (detected === "en") return "en";
  return sessionLanguage;
}

const MANGlish_PATTERNS =
  /\b(enikku|eniku|pokanam|povannam|evide|engane|venda|ille|povam|varanam|undu|illa)\b|-il\b|-inu\b|-aano\b/i;

export function isCodeMixedMalayalam(text: string): boolean {
  if (MALAYALAM_REGEX.test(text)) return true;
  if (MANGlish_PATTERNS.test(text)) return true;
  return getEnglishWordRatio(text) < 0.6;
}
