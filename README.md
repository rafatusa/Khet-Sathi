# Khet Saathi (खेत साथी · ক্ষেত সাথী)

A voice-first AI farm agent for smallholder farmers in India and Bangladesh. A farmer adds a plot,
the agent looks at it from space, listens in their own language, plans the season and drafts seed,
fertilizer and crop-sale orders that the farmer confirms.

Built by Royal Bengal AI for the **Meta Global AI Developer Hackathon** (Oct 26 – Nov 4, 2026).
**Everything in this repository was written during the hackathon.**

## Meta models used

| Model | What it does in Khet Saathi |
|---|---|
| `muse-spark-1.3` (Meta Model API) | Agent brain: plans with tool calls, reads satellite images |
| `muse-voice-transcribe-1.0` | Farmer speaks Hindi, Bangla, Marathi, Tamil, Telugu, Kannada or English |
| `sam-3.1` | Outlines individual fields on satellite imagery |
| Muse Spark Open (Baseten) | Open-weight path for the same agent (planned) |

## Releases

| Version | What was built |
|---|---|
| v0.1.0 | Model check: satellite plot image, SAM 3.1 field outlines, Spark vision, Spark tool-calling agent (demo data), voice transcription, live verification table |

## Run on Railway

1. New Project → Deploy from GitHub repo → `khet-saathi`
2. Variables: `MODEL_API_KEY` (required), `APP_PASSCODE` (recommended)
3. Settings → Networking → Generate Domain

Optional variables: `SPARK_MODEL`, `VOICE_MODEL`, `SAM_MODEL` to switch model IDs.

## Notes

- Satellite imagery: Esri World Imagery (Esri, Maxar, Earthstar Geographics).
- In v0.1.0, agent tools return labelled demo data and orders are drafts only. Nothing is bought or sold.
- Khet Saathi does not give medical, veterinary or pesticide-dosage advice.
