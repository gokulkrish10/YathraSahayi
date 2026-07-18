import { NextResponse } from "next/server";
import type { ApiResponse } from "@/types";
import { bedrockConfigured, getBedrockModelId } from "@/lib/bedrock-gemini";

export function jsonOk<T>(data: T, init?: ResponseInit) {
  const body: ApiResponse<T> = { ok: true, data };
  return NextResponse.json(body, { status: 200, ...init });
}

export function jsonError(error: string, status = 500) {
  const body: ApiResponse = { ok: false, error };
  return NextResponse.json(body, { status });
}

export function getEnvStatus() {
  return {
    sarvam: Boolean(process.env.SARVAM_API_KEY),
    bedrock: bedrockConfigured(),
    bedrockModelId: getBedrockModelId(),
    twilio: Boolean(
      process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        process.env.TWILIO_PHONE_NUMBER
    ),
    baseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000",
  };
}

export async function parseJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
