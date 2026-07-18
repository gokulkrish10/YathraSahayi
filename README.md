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
| `TWILIO_ACCOUNT_SID` | Twilio voice webhooks |
| `TWILIO_AUTH_TOKEN` | Twilio auth |
| `TWILIO_PHONE_NUMBER` | Display/callback number |
| `NEXT_PUBLIC_BASE_URL` | Public app URL |

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
