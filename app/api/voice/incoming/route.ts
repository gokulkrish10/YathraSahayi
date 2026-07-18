import { jsonOk, getEnvStatus } from "@/lib/api-utils";
import { greeting } from "@/lib/response-generator";

export async function GET() {
  return jsonOk({
    message: "Voice incoming webhook ready",
    greeting: greeting("en"),
    env: getEnvStatus(),
  });
}

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const jsonBody = formData ? null : await request.json().catch(() => null);

  const callSid =
    (formData?.get("CallSid") as string | null) ??
    (jsonBody as { CallSid?: string } | null)?.CallSid ??
    "placeholder-call";

  const from =
    (formData?.get("From") as string | null) ??
    (jsonBody as { From?: string } | null)?.From ??
    "unknown";

  return jsonOk({
    status: "received",
    callSid,
    from,
    nextStep: "/api/voice/process",
    twimlHint: "Connect caller to process endpoint for orchestration",
    env: getEnvStatus(),
  });
}

export async function OPTIONS() {
  return jsonOk({ status: "ok" });
}
