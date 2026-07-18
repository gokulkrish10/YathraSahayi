# Yathra Sahayi (യാത്ര സഹായി)

Voice-first bilingual transit assistant for Kochi Metro, Water Metro, feeder buses, and Kerala MVD auto fares.

## Quick start

```bash
cd yathra-sahayi
cp .env.example .env.local
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

| Variable | Purpose |
|----------|---------|
| `SARVAM_API_KEY` | Sarvam AI STT/TTS |
| `AWS_ACCESS_KEY_ID` | AWS credentials for Bedrock |
| `AWS_SECRET_ACCESS_KEY` | AWS credentials for Bedrock |
| `AWS_SESSION_TOKEN` | Optional session token for temporary AWS creds |
| `AWS_REGION` | Bedrock region (e.g. `ap-southeast-2`) |
| `BEDROCK_MODEL_ID` | Gemini model on Bedrock for intent parsing |
| `GOOGLE_MAPS_API_KEY` | Server-side Google Maps Platform key for live transit routes |
| `YATHRA_ROUTE_PROVIDER` | `auto` prefers Google when configured; use `google` or `local` to force |
| `GOOGLE_MAPS_TIMEOUT_MS` | Google route request timeout, default `6500` |
| `YATHRA_DEMO_METRO_ROUTES` | `true` by default; set `false` to disable hardcoded hackathon metro demo answers |
| `YATHRA_WEB_SEARCH` | Set `true` to enable optional web grounding |
| `WEB_SEARCH_PROVIDER` | Set `agentcore` for AWS Bedrock AgentCore Web Search |
| `AGENTCORE_REGION` | AgentCore Web Search region, currently `us-east-1` |
| `AGENTCORE_GATEWAY_URL` | AgentCore Gateway MCP endpoint, usually ending in `/mcp` |
| `AGENTCORE_WEB_SEARCH_TOOL_NAME` | MCP tool name, default `web-search-tool___WebSearch` |
| `AGENTCORE_GATEWAY_AUTH` | Optional: `bearer` for JWT gateways or `none` for test gateways; default uses IAM/SigV4 |
| `AGENTCORE_GATEWAY_BEARER_TOKEN` | Optional bearer token for JWT-authorized gateways |
| `TWILIO_ACCOUNT_SID` | Twilio voice webhooks |
| `TWILIO_AUTH_TOKEN` | Twilio auth |
| `TWILIO_PHONE_NUMBER` | Display/callback number |
| `NEXT_PUBLIC_BASE_URL` | Public app URL |

### Live Google Maps routing

Yathra Sahayi can use Google Maps Platform as the primary routing source.
Enable the **Routes API** for your Google Cloud project, set
`GOOGLE_MAPS_API_KEY` in `.env.local`, and keep `YATHRA_ROUTE_PROVIDER=auto`
or set it to `google`.

Runtime flow:

```text
Browser mic -> Sarvam STT -> Bedrock intent/context -> Google Routes API
  -> Bedrock spoken answer -> Sarvam TTS -> browser audio reply
```

The Google key is used only on the server. The browser receives the assistant
reply, route metadata, and a Google Maps directions URL.

For hackathon judging, selected Kochi Metro-only demo routes are hardcoded ahead
of Google routing so common questions return stable polished English/Malayalam
answers. Set `YATHRA_DEMO_METRO_ROUTES=false` to use only live/offline routing.

### AWS AgentCore Web Search

The app prefers AWS Bedrock AgentCore Web Search when `WEB_SEARCH_PROVIDER=agentcore`.
Create an AgentCore Gateway in `us-east-1`, add the built-in Web Search connector target,
then set `AGENTCORE_GATEWAY_URL` in `.env.local`.

Example target setup:

```bash
aws bedrock-agentcore-control create-gateway-target \
  --gateway-identifier "<GATEWAY_ID>" \
  --name "web-search-tool" \
  --target-configuration '{
    "mcp": {
      "connector": {
        "source": { "connectorId": "web-search" },
        "configurations": [
          { "name": "WebSearch", "parameterValues": {} }
        ]
      }
    }
  }' \
  --credential-provider-configurations '[{"credentialProviderType":"GATEWAY_IAM_ROLE"}]' \
  --region "us-east-1"
```

For IAM/SigV4 gateway auth, the app uses the AWS credentials in `.env.local`.
For JWT gateway auth, set `AGENTCORE_GATEWAY_AUTH=bearer` and
`AGENTCORE_GATEWAY_BEARER_TOKEN`.

## API routes (scaffold)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/voice/incoming` | Twilio/Daily call webhook |
| POST | `/api/voice/process` | Main orchestration |
| POST | `/api/voice/respond` | TTS response |
| GET/POST | `/api/transit/route` | Metro route planning |
| GET/POST | `/api/transit/fare` | Auto fare calculator |
| GET/POST | `/api/transit/schedule` | Schedule lookup |
| POST | `/api/sarvam/stt` | Speech-to-text proxy |
| POST | `/api/sarvam/tts` | Text-to-speech proxy |

## Data

Transit cache lives in `data/kochi-transit.json` (from Step 1). Aliases and response templates are in `data/station-aliases.json` and `data/response-templates.json`.

See `../aiagenthelper.md` for agent-oriented documentation.

## Build

```bash
npm run build
```
