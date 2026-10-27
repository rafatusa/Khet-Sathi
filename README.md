# Khet Saathi (খেত সাথী · खेत साथी)

**One voice, every farm decision.** A voice-first AI farm agent for smallholder farmers in India and Bangladesh.
The farmer talks in Bangla or Hindi; the agent watches their land from space, listens to their shed, plans the
season, and handles buying and selling, with the farmer confirming every deal.

Built by Royal Bengal AI for the **Meta Global AI Developer Hackathon** (Oct 26 – Nov 4, 2026).
**Everything in this repository was written during the hackathon.**

## What it does

| Feature | Status |
|---|---|
| Talk mode: farmer speaks Bangla/Hindi → agent → spoken reply | Live |
| Satellite view of a plot with SAM 3.1 field outlines | Live |
| Agent plans with tools: plot profile → input prices → draft order | Live (demo vendor data) |
| Empty land: photo + satellite + soil + weather → what to grow → vendors | In progress |
| Crop calendar: when to sow which crop, with proactive alerts | In progress |
| Standing crop: harvest readiness, field health, harvester → transport → buyer | Planned |
| Poultry shed: bird counting and inactivity from video, cough detection from audio, shed sensors | Planned |
| Auto-sell: when eggs or harvest are ready, the agent phones shop owners and negotiates | Planned |

## Models

| Model | Provider | Role |
|---|---|---|
| `muse-spark-1.3` | Meta Model API | Agent brain: reasoning, tool calls, reads satellite and field images |
| `muse-voice-transcribe-1.0` | Meta Model API | Hears the farmer: Bangla, Hindi, Marathi, Tamil, Telugu, Kannada, English |
| `sam-3.1` | Meta Model API | Segments individual fields on satellite imagery; tracks animals in video |
| Muse Spark Open | Meta open weights (Baseten) | Open-weight path for the same agent (planned) |
| `gemini-3.8-flash-tts` | Google Gemini API | **Voice output only.** Meta's lineup has speech-to-text but no text-to-speech, so the agent's reply is spoken with Gemini. All listening, seeing, reasoning and acting runs on Meta models |

## Data sources

- Satellite imagery: Esri World Imagery (Esri, Maxar, Earthstar Geographics)
- Vendors, buyers, shop owners, sensors and shed cameras: **simulated** for the hackathon and labelled as such in the app
- Orders and deals are drafts until the farmer confirms. Nothing is bought, sold or paid in this prototype

## Safety

Khet Saathi gives no medical, veterinary or pesticide-dosage advice. For animal health it flags warning signs
(inactive birds, coughing) and tells the farmer to isolate the animals and call a vet.

## Run it

Hosted on Railway, deployed from this repo on every push.

| Variable | Required | Purpose |
|---|---|---|
| `MODEL_API_KEY` | Yes | Meta Model API key |
| `GEMINI_API_KEY` | For speech | Google AI Studio key, spoken replies |
| `APP_PASSCODE` | Recommended | Protects the API routes on a public URL |
| `SPARK_MODEL`, `VOICE_MODEL`, `SAM_MODEL`, `TTS_MODEL`, `TTS_VOICE` | No | Override model IDs or the voice |

Local: `npm install`, then `npm start` (Node 20+). Offline tests: `npm test`.

The page at `/` is currently the model-check bench with a live verification table; the farmer app replaces it as the
build progresses.

## Releases

| Version | Date | What was built |
|---|---|---|
| v0.2.1 | Oct 27 | README rewritten for the full product scope; developer documentation kept out of the repo |
| v0.2.0 | Oct 26 | Talk mode with spoken Bangla/Hindi replies; agent plans only when asked |
| v0.1.1 | Oct 26 | Fixed empty scene descriptions; agent completes profile → prices → draft order in one run |
| v0.1.0 | Oct 26 | Model check: satellite plot, SAM 3.1 outlines, Spark vision, tool-calling agent, voice transcription, verification table |
