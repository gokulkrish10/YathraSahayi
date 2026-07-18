import { getResponseTemplate } from "@/lib/cache";
import type { Language } from "@/types";

type TemplateVars = Record<string, string | number | undefined>;

function fillTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = vars[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

export function renderTemplate(key: string, language: Language, vars: TemplateVars = {}): string {
  const template = getResponseTemplate(key);
  if (!template) {
    return language === "ml" ? "ടെംപ്ലേറ്റ് കണ്ടെത്തിയില്ല." : "Template not found.";
  }

  const base = language === "ml" ? template.ml : template.en;
  return fillTemplate(base, vars);
}

export function renderBilingualTemplate(
  key: string,
  vars: TemplateVars = {}
): { en: string; ml: string } {
  return {
    en: renderTemplate(key, "en", vars),
    ml: renderTemplate(key, "ml", vars),
  };
}

export function greeting(language: Language): string {
  return renderTemplate("greeting", language);
}

export function helplineOpening(language: Language): string {
  return renderTemplate("helpline_opening", language);
}

export function placeholderVoiceResponse(language: Language): string {
  return renderTemplate("placeholder_voice", language);
}

export function languageSwitchConfirmation(language: Language): string {
  return renderTemplate("language_switch_confirm", language);
}

export function sarvamErrorMessage(language: Language): string {
  return renderTemplate("sarvam_error", language);
}
