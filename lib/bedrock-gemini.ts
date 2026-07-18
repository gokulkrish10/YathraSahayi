import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandInput,
} from "@aws-sdk/client-bedrock-runtime";

export interface BedrockGeminiOptions {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface BedrockGeminiResult {
  text: string;
  latencyMs?: number;
  provider: "bedrock" | "unconfigured";
  error?: string;
}

function getBedrockClient(): BedrockRuntimeClient | null {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    return null;
  }

  return new BedrockRuntimeClient({
    region: process.env.AWS_REGION ?? "ap-southeast-2",
    credentials: {
      accessKeyId,
      secretAccessKey,
      sessionToken: process.env.AWS_SESSION_TOKEN,
    },
  });
}

export function bedrockConfigured(): boolean {
  return Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

export function getBedrockModelId(): string {
  return (
    process.env.BEDROCK_MODEL_ID ??
    "apac.google.gemini-2.5-flash-preview-05-20:0"
  );
}

export async function invokeBedrockGemini(
  options: BedrockGeminiOptions
): Promise<BedrockGeminiResult> {
  const client = getBedrockClient();
  if (!client) {
    return { text: "", provider: "unconfigured", error: "AWS credentials not configured" };
  }

  const input: ConverseCommandInput = {
    modelId: getBedrockModelId(),
    system: [{ text: options.systemPrompt }],
    messages: [
      {
        role: "user",
        content: [{ text: options.userPrompt }],
      },
    ],
    inferenceConfig: {
      temperature: options.temperature ?? 0.1,
      maxTokens: options.maxTokens ?? 200,
    },
  };

  if (options.jsonMode) {
    input.additionalModelRequestFields = {
      generationConfig: {
        responseMimeType: "application/json",
      },
    };
  }

  try {
    const response = await client.send(new ConverseCommand(input));
    const text =
      response.output?.message?.content
        ?.map((block) => ("text" in block ? block.text : ""))
        .join("")
        .trim() ?? "";

    return {
      text,
      latencyMs: response.metrics?.latencyMs,
      provider: "bedrock",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bedrock invocation failed";
    return { text: "", provider: "bedrock", error: message };
  }
}
