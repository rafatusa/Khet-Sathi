# Khet Saathi (খেত সাথী · खेत साथी)

**One voice, every farm decision.** A voice-first AI farm agent for smallholder farmers in India and Bangladesh.
The farmer talks in Bangla or Hindi; the agent watches their land from space, listens to their shed, plans the
season, and handles buying and selling, with the farmer confirming every deal.

Built by Royal Bengal AI for the **Meta Global AI Developer Hackathon** (Oct 26 – Nov 4, 2026).

## Built during the hackathon

Everything in this repository was written during the hackathon, which opened on Mon Oct 26, 12:00 PM ET.
The git history shows the date of every change, and the release table at the bottom lists what was added
in each version and when.

## What it does

| Feature | Status |
|---|---|
| Farmer app: Bangla / Hindi / English, big picture buttons, hold-to-talk on every screen | Live |
| Add land: photo + GPS → satellite view → SAM 3.1 finds the farmer's field and measures its acres | Live |
| Small-plot scan: SAM 3.1 runs on an enlarged 225 m close-up, so tiny Bengal plots are outlined one by one; wide 600 m view as fallback | Live |
| Honest empty states: "no farm field here" for a town spot, re-scan for older lands, SAM's answer shown on screen | Live |
| Tap a different field on the map if the guess is wrong | Live |
| Delete a saved land (asks once, removes its pictures too) | Live |
| Saathi speaks up on its own: alerts feed on Home for rain (skip irrigation), fungus weather, dry soil, sowing window closing and shed limits, each with a speaker button | Live (weather and sowing data real; sensor readings simulated) |
| Village sensor kit: field and shed readings in the format a real ESP32 kit would send | **Simulated** (no physical devices in this hackathon build) |
| Talk mode: farmer speaks Bangla/Hindi → agent → spoken reply | Live |
| Agent plans with tools: plot profile → input prices → draft order | Live (demo vendor data) |
| Empty land, what to grow: real soil (SoilGrids), 10-day rain and soil moisture (Open-Meteo) and FAO sowing windows pick 3 crops, with days left to sow, days to harvest and when to sow around rain | Live (Bangladesh; profit figures are samples) |
| Empty land: vendors and orders for the chosen crop | In progress (demo vendor data) |
| Crop calendar: every crop's sowing and harvest (selling) window for the farm's zone on a year bar, grouped into sow now, starting soon and later; tap a crop to ask Saathi | Live (Bangladesh, FAO data) |
| Standing crop: harvest readiness, field health, harvester → transport → buyer | Planned |
| Poultry shed: the farmer films the shed; SAM 3.1 counts birds frame by frame and rings birds that hardly move (not at night, when hens rest); Muse Spark 1.2 watches the clip with its sound for behaviour and unusual sounds. Warning signs only ever say "keep these birds apart and call the vet": the app never names a disease or a medicine | Live (needs the farmer's own video) |
| Saved shed clips: up to 5 of the farmer's own shed videos, each checked once and kept with its result; one can be set as "today's camera" so its warnings reach Home by themselves | Live (**simulated camera**: a saved clip stands in for a CCTV feed) |
| Symptoms to the vet: Saathi ticks the signs the video showed (from a fixed list), the farmer unticks or adds, answers "since when?" and "any deaths today?" by voice or buttons, reads the exact words and agrees; a demo call then plays them. Fixed sentence templates, no disease or medicine names | Live (**simulated vet and call**: no real call is made) |
| Shed care alerts: too hot or cold, humidity, ammonia, water and feed, light left on at night or in daylight, light off in the evening, heat or cold coming, egg count | Live (shed sensors and egg counter **simulated**) |
| Auto-sell: when eggs or harvest are ready, the agent phones shop owners and negotiates | Planned |

## Models

| Model | Provider | Role |
|---|---|---|
| `muse-spark-1.3` | Meta Model API | Agent brain: reasoning, tool calls, reads satellite and field images |
| `muse-spark-1.2` | Meta Model API | Watches shed video with its sound and listens to shed sound clips (Meta recommends 1.2 for audio) |
| `muse-voice-transcribe-1.0` | Meta Model API | Hears the farmer: Bangla, Hindi, Marathi, Tamil, Telugu, Kannada, English |
| `sam-3.1` | Meta Model API | Finds every field on the satellite image, picks the one under the farmer's GPS point and measures it; tracks animals in video (planned) |
| Muse Spark Open | Meta open weights (Baseten) | Open-weight path for the same agent (planned) |
| `gemini-3.8-flash-tts` | Google Gemini API | **Voice output only.** Meta's lineup has speech-to-text but no text-to-speech, so the agent's reply is spoken with Gemini. All listening, seeing, reasoning and acting runs on Meta models |

## Data sources

- Satellite imagery: Esri World Imagery (Esri, Maxar, Earthstar Geographics). The server fetches a 600 m view around the farmer's location, then crops the centre 225 m and enlarges it 2.7x for SAM 3.1. At the full 600 m view SAM read Bolpur's small plots as one big field; on the close-up it outlined about 47 separate plots
- Soil: ISRIC SoilGrids 250 m (CC BY 4.0), topsoil 0-15 cm texture and pH, looked up once per land and saved; dated copies for the demo plots in case the service is down
- Weather: Open-Meteo (CC BY 4.0), 10-day rain chance and amount, temperature and topsoil moisture, refreshed hourly
- Sowing windows: FAO Crop Calendar for Bangladesh by farming zone (AEZ), fetched daily, with a copy saved on Oct 27, 2026 as a fallback. FAO has no calendar for India, so Indian plots show soil and weather only. FAO publishes no zone map, so only the Bogura demo plot is placed in its exact zone; other Bangladesh points use the same zone and say so on screen
- Profit per acre on crop cards is a **sample figure**, labelled on screen, until a market price source is added
- Demo plots (used when GPS is off or outside South Asia): Bogura (Bangladesh, default for empty land), Bolpur (West Bengal), Ludhiana (Punjab)
- Storage: Supabase Postgres + private storage bucket for land photos and satellite tiles; falls back to in-memory storage if not configured
- Vendors, buyers, shop owners, sensors and shed cameras: **simulated** for the hackathon and labelled as such in the app. The sensor kit simulator starts from each plot's real weather and soil moisture and drifts in small steps every 10 minutes
- Orders and deals are drafts until the farmer confirms. Nothing is bought, sold or paid in this prototype

## Safety

Khet Saathi gives no medical, veterinary or pesticide-dosage advice. For animal health it flags warning signs
(inactive birds, coughing) and tells the farmer to isolate the animals and call a vet.
Signs passed on to the (simulated) vet come from a fixed list, are confirmed by the farmer, and are read out only after the farmer agrees. In the demo call every vet line is scripted.

## Run it

Hosted on Railway, deployed from this repo on every push.

| Variable | Required | Purpose |
|---|---|---|
| `MODEL_API_KEY` | Yes | Meta Model API key |
| `GEMINI_API_KEY` | For speech | Google AI Studio key, spoken replies |
| `APP_PASSCODE` | Recommended | Protects the API routes on a public URL |
| `SUPABASE_URL` | For saving | Supabase project URL |
| `SUPABASE_SECRET_KEY` | For saving | Supabase secret key (server only; `SUPABASE_SERVICE_ROLE_KEY` also accepted) |
| `SPARK_MODEL`, `VOICE_MODEL`, `SAM_MODEL`, `TTS_MODEL`, `TTS_VOICE` | No | Override model IDs or the voice. Leave them unset unless you need a different model |

Every variable is cleaned of spaces, line endings and invisible characters when it is read, so values pasted through Railway's Raw editor work as typed.

Local: `npm install`, then `npm start` (Node 20+). Offline tests: `npm test`.

- `/` is the farmer app (phone-first).
- `/check/` is the model-check bench with a live verification table for every model and the database.
- Database migrations live in `sql/`, numbered in run order (`001_…`, `002_…`). Run each new one once in the Supabase SQL Editor; every migration is safe to re-run.

## Releases

| Version | Date | What was built |
|---|---|---|
| v0.7.5 | Oct 28 | Simulated vet name and village in the farmer's language; Saathi tells the vet "about N chickens in the shed" (source shown below the line); English text says chickens instead of birds |
| v0.7.4 | Oct 28 | Two-way demo vet call: after consent, Saathi and a simulated vet (second voice) take turns; the vet asks up to two scripted questions picked by the signs, Saathi answers only from the SAM count and the simulated shed kit (or says it does not know), the vet closes with a fixed safe line and a short summary |
| v0.7.3 | Oct 27 | Fix: the clip list is kept in server memory and saved with no-cache, because storage served a stale copy for about 20 s and a second clip upload failed with "Clip not found"; saves run one at a time; the "Tell the vet" icon is sized like the others |
| v0.7.2 | Oct 27 | Symptoms to the vet: auto-filled signs from the camera check, two voice questions, consent and a simulated call; "+ From phone" picks a saved video from the gallery |
| v0.7.1 | Oct 27 | Shed clip library (simulated camera): save up to 5 named clips with their frames and last result in a private `shed-clips` bucket, re-check on demand, choose today's camera for automatic alerts, delete with a confirm sheet; `sql/003_shed_clips_v0.7.1.sql` |
| v0.7.0 | Oct 27 | Poultry shed screen: phone video, frames pulled in the browser, SAM 3.1 bird count and "not moving" rings (suppressed at night), Muse Spark 1.2 video and sound check through the Files and Responses APIs, safety filter that drops any disease or medicine words, simulated vet; shed care rules for cold, humidity, light schedule, heat and cold forecast and eggs; simulated egg counter. No database change |
| v0.6.0 | Oct 27 | Crop calendar screen from the Home tile: real FAO sowing and harvest windows for the zone, year bars with today marked, closing-first order; new agent tool get_sowing_calendar for "when do I sow, when can I sell" questions. No database change |
| v0.5.0 | Oct 27 | Simulated village sensor kit (field and shed) and the alerts engine: rules on real weather, FAO sowing windows and simulated sensor readings write alerts every 10 minutes; Home shows them as traffic-light cards with a speaker and a read tick; bench buttons for one tick and demo values (dry soil, hot shed). No database change |
| v0.4.0 | Oct 27 | What to grow (Scenario 1): soil from SoilGrids, weather from Open-Meteo, sowing windows from the FAO crop calendar; top 3 crops by window and soil, rain-aware sowing advice; the agent's plot and crop tools now use this real data; bench rows for soil, weather and calendar; `sql/002_land_soil_v0.4.0.sql` |
| v0.3.2 | Oct 27 | Delete a saved land from its screen, with a confirm sheet; removes the land and both of its pictures from storage. Visible keyboard focus on buttons |
| v0.3.1 | Oct 27 | Zoomed SAM 3.1 scan for small plots (centre 225 m enlarged, concept "field", wide "farm field" fallback); whole-image outlines ignored; re-scan for lands saved with 0 fields; "no farm field here" screen with demo land; agent refuses soil advice where no field was found; acres under 1 shown to 2 decimals; bench shows 0 outlines as WARN and adds the farmer-app scan; all environment variables trimmed. New dependency: `sharp` (image crop) |
| v0.3.0 | Oct 27 | Farmer app: language picker, home, add land with photo + GPS, SAM 3.1 plot detection and acreage, tap-to-correct field, ask by voice or tap with spoken answers; Supabase storage (`sql/001_core_tables_v0.3.0.sql`); dev bench moved to /check/ |
| v0.2.1 | Oct 27 | README rewritten for the full product scope; developer documentation kept out of the repo |
| v0.2.0 | Oct 26 | Talk mode with spoken Bangla/Hindi replies; agent plans only when asked |
| v0.1.1 | Oct 26 | Fixed empty scene descriptions; agent completes profile → prices → draft order in one run |
| v0.1.0 | Oct 26 | Model check: satellite plot, SAM 3.1 outlines, Spark vision, tool-calling agent, voice transcription, verification table |
