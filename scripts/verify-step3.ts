/**
 * Step 3 verification helpers — run with:
 * npx tsx scripts/verify-step3.ts
 */
import assert from "node:assert/strict";
import axios from "axios";
import { resolveCanonicalName, resolveStation } from "../lib/cache";
import { renderTemplate } from "../lib/response-generator";
import {
  LanguageManager,
  detectLanguage,
  getEnglishWordRatio,
  isCodeMixedMalayalam,
} from "../lib/language-manager";
import { withRetry } from "../lib/sarvam-client";

async function testRetryLogic() {
  let attempts = 0;
  await withRetry(async () => {
    attempts += 1;
    if (attempts < 3) {
      throw new axios.AxiosError("server error", "ERR_BAD_RESPONSE", undefined, undefined, {
        status: 500,
        statusText: "Internal Server Error",
        headers: {},
        config: { headers: {} } as never,
        data: { message: "fail" },
      });
    }
    return "ok";
  }, 3);
  assert.equal(attempts, 3);
}

function testLanguageManager() {
  const manager = new LanguageManager();

  const ml = manager.detectAndSwitch("എനിക്ക് വൈറ്റിലയിൽ പോകണം", "ml-IN", 0.95);
  assert.equal(ml, "ml-IN");

  const en = manager.detectAndSwitch("I want to go to Vyttila", "en-IN", 0.95);
  assert.equal(en, "en-IN");

  manager.reset("ml-IN");
  const switched = manager.detectAndSwitch("Please speak in English", undefined, 0.9);
  assert.equal(switched, "en-IN");
  assert.equal(manager.wasSwitchedThisTurn(), true);

  manager.reset("ml-IN");
  const manglish = manager.detectAndSwitch("Enikku Lulu Mall-il pokanam", "ml-IN", 0.85);
  assert.equal(manglish, "ml-IN");
  assert.equal(isCodeMixedMalayalam("Enikku Lulu Mall-il pokanam"), true);
}

function testTemplatesAndAliases() {
  const route = renderTemplate("route_found", "en", {
    origin: "Aluva",
    destination: "Vyttila",
  });
  assert.match(route, /Aluva/);
  assert.match(route, /Vyttila/);

  assert.equal(resolveCanonicalName("lulu mall"), "Lulu Mall");
  assert.equal(resolveStation("lulu mall")?.code, "EDP");
  assert.equal(detectLanguage("എടപ്പള്ളി"), "ml");
  assert.ok(getEnglishWordRatio("I want to go to Vyttila") >= 0.6);
}

async function main() {
  testLanguageManager();
  testTemplatesAndAliases();
  await testRetryLogic();
  console.log("Step 3 verification passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
