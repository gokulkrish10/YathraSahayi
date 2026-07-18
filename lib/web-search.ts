import { createHash, createHmac } from "node:crypto";

export type WebSearchProvider = "agentcore" | "brave" | "custom" | "unconfigured" | "error";

export interface WebSearchResult {
  title: string;
  url?: string;
  snippet: string;
  publishedDate?: string;
}

export interface WebSearchResponse {
  provider: WebSearchProvider;
  results: WebSearchResult[];
  error?: string;
}

interface SearchOptions {
  limit?: number;
  timeoutMs?: number;
}

interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

interface SignedRequest {
  headers: Record<string, string>;
}

const AGENTCORE_SERVICE = "bedrock-agentcore";
const DEFAULT_AGENTCORE_TOOL_NAME = "web-search-tool___WebSearch";

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function hmacHex(key: Buffer | string, value: string): string {
  return createHmac("sha256", key).update(value, "utf8").digest("hex");
}

function amzDate(date = new Date()): { full: string; short: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    full: iso,
    short: iso.slice(0, 8),
  };
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function canonicalUri(pathname: string): string {
  return pathname
    .split("/")
    .map((part) => encodeRfc3986(decodeURIComponent(part)))
    .join("/") || "/";
}

function canonicalQuery(searchParams: URLSearchParams): string {
  return Array.from(searchParams.entries())
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey)
    )
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join("&");
}

function getAwsCredentials(): AwsCredentials | null {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: process.env.AWS_SESSION_TOKEN,
  };
}

function signAwsRequest(
  url: URL,
  body: string,
  region: string,
  credentials: AwsCredentials
): SignedRequest {
  const { full, short } = amzDate();
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": full,
  };

  if (credentials.sessionToken) {
    headers["x-amz-security-token"] = credentials.sessionToken;
  }

  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((name) => `${name}:${headers[name].trim().replace(/\s+/g, " ")}`)
    .join("\n");
  const canonicalRequest = [
    "POST",
    canonicalUri(url.pathname),
    canonicalQuery(url.searchParams),
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${short}/${region}/${AGENTCORE_SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    full,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, short), region), AGENTCORE_SERVICE),
    "aws4_request"
  );
  const signature = hmacHex(signingKey, stringToSign);

  headers.authorization = [
    `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  return { headers };
}

function normalizeResult(item: unknown): WebSearchResult | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  const title = getString(record.title) ?? getString(record.name) ?? "Web search result";
  const snippet =
    getString(record.description) ??
    getString(record.snippet) ??
    getString(record.text) ??
    getString(record.content);

  if (!snippet) return null;

  return {
    title,
    url: getString(record.url) ?? getString(record.link),
    snippet,
    publishedDate: getString(record.publishedDate) ?? getString(record.date),
  };
}

function extractResults(data: unknown, limit: number): WebSearchResult[] {
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  const result = record.result && typeof record.result === "object"
    ? (record.result as Record<string, unknown>)
    : null;
  const structuredContent = result?.structuredContent && typeof result.structuredContent === "object"
    ? (result.structuredContent as Record<string, unknown>)
    : null;
  const web = record.web && typeof record.web === "object"
    ? (record.web as Record<string, unknown>)
    : null;
  const candidates =
    (Array.isArray(record.results) && record.results) ||
    (Array.isArray(record.organic_results) && record.organic_results) ||
    (Array.isArray(web?.results) && web.results) ||
    (Array.isArray(result?.results) && result.results) ||
    (Array.isArray(structuredContent?.results) && structuredContent.results) ||
    [];

  return candidates
    .map(normalizeResult)
    .filter((resultItem): resultItem is WebSearchResult => Boolean(resultItem))
    .slice(0, limit);
}

function extractAgentCoreResults(data: unknown, limit: number): WebSearchResult[] {
  const direct = extractResults(data, limit);
  if (direct.length > 0 || !data || typeof data !== "object") return direct;

  const record = data as Record<string, unknown>;
  const result = record.result && typeof record.result === "object"
    ? (record.result as Record<string, unknown>)
    : record;
  const content = Array.isArray(result.content) ? result.content : [];

  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const text = getString((block as Record<string, unknown>).text);
    if (!text) continue;

    try {
      const parsed = JSON.parse(text);
      const parsedResults = extractResults(parsed, limit);
      if (parsedResults.length > 0) return parsedResults;
    } catch {
      return [{ title: "AgentCore Web Search", snippet: text }];
    }
  }

  return [];
}

function customSearchUrl(query: string): string | null {
  const endpoint = process.env.WEB_SEARCH_ENDPOINT;
  if (!endpoint) return null;
  if (endpoint.includes("{query}")) {
    return endpoint.replace("{query}", encodeURIComponent(query));
  }

  const url = new URL(endpoint);
  url.searchParams.set("q", query);
  return url.toString();
}

function agentCoreGatewayUrl(): URL | null {
  const raw = process.env.AGENTCORE_GATEWAY_URL ?? process.env.BEDROCK_AGENTCORE_GATEWAY_URL;
  if (!raw) return null;
  const url = new URL(raw);
  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/mcp";
  }
  return url;
}

function selectedProvider(): WebSearchProvider {
  const explicit = process.env.WEB_SEARCH_PROVIDER?.trim().toLowerCase();
  if (explicit === "agentcore" || explicit === "aws" || explicit === "bedrock") {
    return "agentcore";
  }
  if (explicit === "brave") return "brave";
  if (explicit === "custom") return "custom";
  if (agentCoreGatewayUrl()) return "agentcore";
  if (process.env.BRAVE_SEARCH_API_KEY) return "brave";
  if (process.env.WEB_SEARCH_ENDPOINT) return "custom";
  return "unconfigured";
}

function agentCoreConfigured(): boolean {
  const authMode = process.env.AGENTCORE_GATEWAY_AUTH?.trim().toLowerCase();
  const hasGateway = Boolean(agentCoreGatewayUrl());
  const hasBearer = Boolean(process.env.AGENTCORE_GATEWAY_BEARER_TOKEN);
  const hasAwsCredentials = Boolean(getAwsCredentials());
  return hasGateway && (authMode === "none" || hasBearer || hasAwsCredentials);
}

export function webSearchConfigured(): boolean {
  const provider = selectedProvider();
  if (provider === "agentcore") return agentCoreConfigured();
  if (provider === "brave") return Boolean(process.env.BRAVE_SEARCH_API_KEY);
  if (provider === "custom") return Boolean(process.env.WEB_SEARCH_ENDPOINT);
  return false;
}

async function searchWithAgentCore(
  query: string,
  limit: number,
  timeoutMs: number
): Promise<WebSearchResponse> {
  const gatewayUrl = agentCoreGatewayUrl();
  if (!gatewayUrl) {
    return { provider: "unconfigured", results: [], error: "AGENTCORE_GATEWAY_URL is missing" };
  }

  const authMode = process.env.AGENTCORE_GATEWAY_AUTH?.trim().toLowerCase();
  const bearerToken = process.env.AGENTCORE_GATEWAY_BEARER_TOKEN;
  const toolName = process.env.AGENTCORE_WEB_SEARCH_TOOL_NAME ?? DEFAULT_AGENTCORE_TOOL_NAME;
  const region =
    process.env.AGENTCORE_REGION ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: `web-search-${Date.now()}`,
    method: "tools/call",
    params: {
      name: toolName,
      arguments: {
        query: query.slice(0, 200),
        maxResults: Math.min(Math.max(limit, 1), 25),
      },
    },
  });

  let headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };

  if (authMode === "none") {
    // The gateway is expected to enforce its own external controls when auth is disabled.
  } else if (bearerToken || authMode === "bearer" || authMode === "jwt") {
    if (!bearerToken) {
      return {
        provider: "unconfigured",
        results: [],
        error: "AGENTCORE_GATEWAY_BEARER_TOKEN is missing",
      };
    }
    headers.authorization = `Bearer ${bearerToken}`;
  } else {
    const credentials = getAwsCredentials();
    if (!credentials) {
      return {
        provider: "unconfigured",
        results: [],
        error: "AWS credentials are missing for AgentCore Gateway SigV4 auth",
      };
    }
    headers = signAwsRequest(gatewayUrl, body, region, credentials).headers;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(gatewayUrl, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        provider: "agentcore",
        results: [],
        error: `AgentCore Gateway failed with ${response.status}`,
      };
    }

    const data = await response.json();
    const results = extractAgentCoreResults(data, limit);
    return { provider: "agentcore", results };
  } catch (error) {
    const message = error instanceof Error ? error.message : "AgentCore Gateway request failed";
    return { provider: "error", results: [], error: message };
  } finally {
    clearTimeout(timeout);
  }
}

async function searchWithBrave(
  query: string,
  limit: number,
  timeoutMs: number
): Promise<WebSearchResponse> {
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!braveKey) return { provider: "unconfigured", results: [] };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(
        query
      )}&count=${limit}&country=IN&search_lang=en`,
      {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": braveKey,
        },
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      return {
        provider: "brave",
        results: [],
        error: `Search failed with ${response.status}`,
      };
    }

    const data = await response.json();
    return {
      provider: "brave",
      results: extractResults(data, limit),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search request failed";
    return { provider: "error", results: [], error: message };
  } finally {
    clearTimeout(timeout);
  }
}

async function searchWithCustomEndpoint(
  query: string,
  limit: number,
  timeoutMs: number
): Promise<WebSearchResponse> {
  const url = customSearchUrl(query);
  if (!url) return { provider: "unconfigured", results: [] };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        provider: "custom",
        results: [],
        error: `Search failed with ${response.status}`,
      };
    }

    const data = await response.json();
    return {
      provider: "custom",
      results: extractResults(data, limit),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search request failed";
    return { provider: "error", results: [], error: message };
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchTransitWeb(
  query: string,
  options: SearchOptions = {}
): Promise<WebSearchResponse> {
  const limit = options.limit ?? 3;
  const timeoutMs = options.timeoutMs ?? 2500;
  const provider = selectedProvider();

  if (provider === "agentcore") {
    return searchWithAgentCore(query, limit, timeoutMs);
  }
  if (provider === "brave") {
    return searchWithBrave(query, limit, timeoutMs);
  }
  if (provider === "custom") {
    return searchWithCustomEndpoint(query, limit, timeoutMs);
  }

  return { provider: "unconfigured", results: [] };
}
