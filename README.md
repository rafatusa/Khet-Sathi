# Khet Sathi (খেত সাথী · खेत साथी)

**One voice, every farm decision.** A voice-first AI farm agent for smallholder farmers, built first for India and Bangladesh and working anywhere on Earth.
The farmer talks in Bangla or Hindi; the agent watches their land from space, listens to their shed, plans the
season, and handles buying and selling, with the farmer confirming every deal.

Built by Royal Bengal AI for the **Meta Global AI Developer Hackathon** (Oct 26 – Nov 4, 2026).

## Built during the hackathon

Everything in this repository was written during the hackathon, which opened on Mon Oct 26, 12:00 PM ET.
The git history shows the date of every change, and the release table at the bottom lists what was added
in each version and when.

Not part of this build: Zavora 360 (calls), MailPulse (email) and Prochar AI (marketing) are existing
Royal Bengal AI products. Khet Sathi names them as "connecting next" and never shows them working; no
code from them is in this repository.

## What it does

| Feature | Status |
|---|---|
| Farmer app at `/`: Bangla / Hindi / English; fields and poultry sheds are separate places in one switcher, each with its own Home and tabs; tabs in the header on desktop, bottom bar on phones (the earlier app stays at `/classic/`) | Live |
| Check the place first: OpenStreetMap says where the land is, ESA WorldCover 10 m says what covers it; houses or water get "no crops here" and Sathi never suggests a crop there | Live (real data) |
| Crops anywhere: the farmer's own district crops, hectares and sowing months (MIRCA-OS 2020); Muse Spark keeps the ones farmers there sow this season; money in the country's currency | Live (real data; FAO calendar still used in Bangladesh) |
| Market for a field: seed, fertilizer and plough crew sized to the field, the real seed and fertilizer shops near it (OpenStreetMap); on a real land "Sathi will call" is marked coming soon and nothing is faked; demo lands play a scripted demo call | Live (calling and email **coming soon**) |
| Shed camera wall: saved shed clips play as camera feeds with a clock; connect CCTV is coming soon | Live (**demo feed** for the demo shed) |
| Add land: photo + GPS → satellite view → SAM 3.1 finds the farmer's field and measures its acres | Live |
| Small-plot scan: SAM 3.1 runs on an enlarged 225 m close-up, so tiny Bengal plots are outlined one by one; wide 600 m view as fallback | Live |
| Honest empty states: "no farm field here" for a town spot, re-scan for older lands, SAM's answer shown on screen | Live |
| Tap a different field on the map if the guess is wrong | Live |
| Delete a saved land (asks once, removes its pictures too) | Live |
| Sathi speaks up on its own: alerts feed on Home for rain (skip irrigation), fungus weather, dry soil, sowing window closing and shed limits, each with a speaker button | Live (weather and sowing data real; sensor readings simulated) |
| Village sensor kit: field and shed readings in the format a real ESP32 kit would send | **Simulated** (no physical devices in this hackathon build) |
| Talk mode: farmer speaks Bangla/Hindi → agent → spoken reply | Live |
| Agent plans with tools: plot profile → input prices → draft order | Live (demo vendor data) |
| Empty land, what to grow: real soil (SoilGrids), 10-day rain and soil moisture (Open-Meteo) and FAO sowing windows pick 3 crops, with days left to sow, days to harvest and when to sow around rain | Live (Bangladesh; profit figures are samples) |
| Empty land: vendors and orders for the chosen crop | In progress (demo vendor data) |
| Crop calendar: every crop's sowing and harvest (selling) window for the farm's zone on a year bar, grouped into sow now, starting soon and later; tap a crop to ask Sathi | Live (Bangladesh, FAO data) |
| Standing crop: after the place check the farmer says what is growing and roughly when it was sown (or Sathi estimates the sowing from the Sentinel-2 green-up). Home shows days to harvest from the district crop calendar (MIRCA-OS), a readiness ring nudged by the greenness curve (past its peak means ripening), the expected harvest (field acres × FAOSTAT country yield, in maund, quintal or tonnes) and season steps from the real sowing date | Live (real data) |
| Harvest and sale: book the harvester and transport, set a selling rule (amount, lowest price, when, ask first), see real crop buyers near the field (Google Places or OpenStreetMap). Demo lands: sample prices, scripted demo calls to fictional buyers and crews, one-tap sale saved in Money. Real lands: no prices, "Sathi will call and update you" marked coming soon | Live (**demo calls and prices on demo lands**; calling coming soon) |
| Poultry shed: the farmer films the shed; SAM 3.1 counts birds frame by frame and rings birds that hardly move (not at night, when hens rest); Muse Spark 1.2 watches the clip with its sound for behaviour and unusual sounds. Warning signs only ever say "keep these birds apart and call the vet": the app never names a disease or a medicine | Live (needs the farmer's own video) |
| Saved shed clips: up to 5 of the farmer's own shed videos, each checked once and kept with its result; one can be set as "today's camera" so its warnings reach Home by themselves | Live (**simulated camera**: a saved clip stands in for a CCTV feed) |
| Symptoms to the vet: Sathi ticks the signs the video showed (from a fixed list), the farmer unticks or adds, answers "since when?" and "any deaths today?" by voice or buttons, reads the exact words and agrees; a demo call then plays them. Fixed sentence templates, no disease or medicine names | Live (**simulated vet and call**: no real call is made) |
| Egg sale: the farmer decides when to sell (egg count and/or every few days) and the lowest price per tray; Sathi calls the saved egg shops, bargains by fixed rules and never goes below that price; Muse Spark plays the shopkeepers; the farmer confirms the best offer with one tap | Live (**simulated shops, calls and money**; the deal is saved) |
| Shed care alerts: too hot or cold, humidity, ammonia, water and feed, light left on at night or in daylight, light off in the evening, heat or cold coming, egg count | Live (shed sensors and egg counter **simulated**) |
| Auto-sell: when eggs or harvest are ready, the agent phones shop owners and negotiates | Demo (scripted calls on demo lands and the demo shed); real calls planned |

## Models

| Model | Provider | Role |
|---|---|---|
| `muse-spark-1.3` | Meta Model API | Agent brain: reasoning, tool calls, reads satellite and field images |
| `muse-spark-1.2` | Meta Model API | Watches shed video with its sound and listens to shed sound clips (Meta recommends 1.2 for audio) |
| `meta-models/muse-spark-open-1026` | Baseten (Meta open weights) | Sathi's agent with tool calls and the egg-sale shopkeepers, when `BASETEN_API_KEY` is set; falls back to `muse-spark-1.3` |
| `muse-voice-transcribe-1.0` | Meta Model API | Hears the farmer: Bangla, Hindi, Marathi, Tamil, Telugu, Kannada, English |
| `sam-3.1` | Meta Model API | Finds every field on the satellite image, picks the one under the farmer's GPS point and measures it; tracks animals in video (planned) |
| Muse Spark Open | Meta open weights (Baseten) | Open-weight path for the same agent (planned) |
| `gemini-3.8-flash-tts` | Google Gemini API | **Voice output only.** Meta's lineup has speech-to-text but no text-to-speech, so the agent's reply is spoken with Gemini. All listening, seeing, reasoning and acting runs on Meta models |

## Data sources

- Satellite imagery: Esri World Imagery (Esri, Maxar, Earthstar Geographics). The server fetches a 600 m view around the farmer's location, then crops the centre 225 m and enlarges it 2.7x for SAM 3.1. At the full 600 m view SAM read Bolpur's small plots as one big field; on the close-up it outlined about 47 separate plots
- Field health: ESA Copernicus Sentinel-2 L2A (free cloud-optimised images on AWS, Earth Search STAC by Element 84, no key). For the farmer's own SAM outline the server reads red, near-infrared and the scene classification (cloud mask) for every pass in 150 days and computes NDVI per 10 m pixel, zones and a season curve; cached 6 hours per land
- Soil: ISRIC SoilGrids 250 m (CC BY 4.0), topsoil 0-15 cm texture and pH, looked up once per land and saved; dated copies for the demo plots in case the service is down
- Weather: Open-Meteo (CC BY 4.0), 10-day rain chance and amount, temperature and topsoil moisture, refreshed hourly
- Sowing windows, Bangladesh: FAO Crop Calendar by farming zone (AEZ), fetched daily, with a copy saved on Oct 27, 2026 as a fallback. FAO publishes no zone map, so only the Bogura demo plot is placed in its exact zone; other Bangladesh points use the same zone and say so on screen
- Sowing windows, everywhere else: MIRCA-OS v2 (Kebede et al. 2026, CC BY 4.0), 2020 crop calendars and growing areas by district or state, plus its 5 arc-minute gridded calendars where the district name does not match; FAOSTAT (CC BY 4.0) country areas rank crops when no district matches. Built offline by `tools/build_crop_data.py` into `lib/data/`. Known data issue: MIRCA-OS lists some South Asian winter crops (wheat, barley, mustard, potato on the plains) as sown in June on irrigated land; the app moves those to their usual winter months
- Place: OpenStreetMap Nominatim reverse geocoding (ODbL) and ESA WorldCover 2021 10 m land cover (CC BY 4.0, read from its cloud-optimised GeoTIFFs on AWS)
- Shops near a field: OpenStreetMap shops (agrarian, farm, garden centre, seeds, fertilizer) through the Overpass API, or Google Places when `GOOGLE_PLACES_KEY` is set
- Harvest amount: FAOSTAT (CC BY 4.0) average yield per hectare for the crop in the country, times the field size; shown as "about"
- Profit per acre on crop cards and crop prices on demo lands are **sample figures**, labelled on screen, until a market price source is added
- Demo plots (used when GPS is off or outside South Asia): Bogura (Bangladesh, default for empty land), Bolpur (West Bengal), Ludhiana (Punjab)
- Storage: Supabase Postgres + private storage bucket for land photos and satellite tiles; falls back to in-memory storage if not configured
- Real lands (the farmer's own GPS or photo) show only real data: no sample prices, no demo shops, no fake calls. The demo lands (Bogura, Bolpur, Ludhiana presets) and the demo shed keep their labelled demo calls
- Vendors, buyers, shop owners, sensors and shed cameras on the demo lands and the demo shed: **simulated** for the hackathon and labelled as such in the app. The sensor kit simulator starts from each plot's real weather and soil moisture and drifts in small steps every 10 minutes
- Orders and deals are drafts until the farmer confirms. Nothing is bought, sold or paid in this prototype

## Safety

Khet Sathi gives no medical, veterinary or pesticide-dosage advice. For animal health it flags warning signs
(inactive birds, coughing) and tells the farmer to isolate the animals and call a vet.
Signs passed on to the (simulated) vet come from a fixed list, are confirmed by the farmer, and are read out only after the farmer agrees. In the demo call every vet line is scripted.

## Run it

Hosted on Railway, deployed from this repo on every push.

| Variable | Required | Purpose |
|---|---|---|
| `MODEL_API_KEY` | Yes | Meta Model API key |
| `GEMINI_API_KEY` | For speech | Google AI Studio key, spoken replies |
| `APP_PASSCODE` | No longer used (v0.13.0) | Sign-in by email code replaced the shared passcode; the variable can be removed |
| `ADMIN_EMAILS` | Yes, for admin | Comma-separated emails that get the admin Settings tab and can edit the demo farm |
| `META_TRIES` | No | How many times a Meta call is tried when Meta answers `model_not_found` (default 10, pauses of at most 1 s) |
| `SUPABASE_URL` | For saving | Supabase project URL |
| `SUPABASE_SECRET_KEY` | For saving | Supabase secret key (server only; `SUPABASE_SERVICE_ROLE_KEY` also accepted) |
| `SPARK_MODEL`, `VOICE_MODEL`, `SAM_MODEL`, `TTS_MODEL`, `TTS_VOICE` | No | Override model IDs or the voice. Leave them unset unless you need a different model |

Every variable is cleaned of spaces, line endings and invisible characters when it is read, so values pasted through Railway's Raw editor work as typed.

Local: `npm install`, then `npm start` (Node 20+). Offline tests: `npm test`.

- `/` is the farmer app (phone-first).
- Admins (emails in `ADMIN_EMAILS`) get a Settings tab with live model and service checks, every farm (view one read only), usage against the daily limits, and the demo places. The `/check/` bench page is retired (v0.14.0).
- Database migrations live in `sql/`, numbered in run order (`001_…`, `002_…`). Run each new one once in the Supabase SQL Editor; every migration is safe to re-run.

## Releases

| Version | Date | What was built |
|---|---|---|
| v0.10.0 | Oct 28 | New app shell at `/next/` in the team's Khet_Saathi.html design (bottom nav, land switcher, বাং/हिं/EN): Home and Field on real data (Sentinel-2 NDVI per pass with clouds masked, zones, season curve and timelapse, next pass, Esri map with the SAM outline, soil, weather, FAO crops, season steps), Sathi chat on Muse Spark Open, add land in 4 steps; plus the shopkeeper currency fix, the bench model-list warning and the never-sow-after-the-window rule. The classic app stays at `/` until v0.11.0 |
| v0.10.1 | Oct 28 | New shell fits wide screens (1320 px, 6-column dashboard on laptops) and zones follow the field's real shape, so a small field shows 2 x 2 instead of empty cells. Poultry is back in the new shell: a Poultry tab and a shed card on Home (simulated shed kit, eggs today, egg stock) with buttons to the full shed and the egg sale |
| v0.11.0 | Oct 28 | The new app is the main app at `/` (classic at `/classic/`). Fields and poultry sheds are separate places with their own Home and tabs; add a shed. Full-width desktop with tabs in the header. Check the place first (OpenStreetMap, ESA WorldCover): no crops for houses or water. Crops for any country from MIRCA-OS district data, picked by Muse Spark, in local currency. Market: seed, fertilizer and crew for a field with real nearby shops; poultry Market with the egg sale. Shed tab: camera wall of saved clips, count, sound, vet. Real lands never fake a call (coming soon note); demo lands keep demo calls. SQL 005 |
| v0.11.1 | Oct 28 | Google Places shops for real fields (with `GOOGLE_PLACES_KEY`): names cleaned of emoji, only shops within 15 km. A real shop is never put in a demo call, even on a demo land: demo calls go only to the fictional demo shop, and tapping a real shop shows the coming-soon note |
| v0.11.2 | Oct 28 | Clip names follow the app language (Muse Spark translates each name once into Bangla, Hindi and English). The demo shed's clips are built-in demo camera feeds and cannot be deleted. A saved clip whose video upload never finished offers "Add this clip's video" so it plays as a feed |
| v0.15.0 | Oct 28 | Home yard: one photo of the open space in front of the house, SAM 3.1 outlines the open ground, the farmer gives the size in their country's units (feet and শতাংশ in Bangladesh, feet, डिसमिल and गज in India, feet and square feet in the USA, metres elsewhere; बीघा is never converted), and Sathi picks up to three plants from a 16-plant yard table by size, sun, month and weather, with a sample-priced shopping list and the nearest nurseries from Google Maps. Help with a crop problem: Sathi never names a disease or medicine; she finds the nearest agriculture office on Google Maps (Upazila Agriculture Office, Krishi Vigyan Kendra, cooperative extension office) with Call (the farmer's own phone) and Directions, and the government hotline (16123 in Bangladesh, 1800-180-1551 in India). New table: SQL 008 |
| v0.14.1 | Oct 28 | Meta's servers sometimes answer `model_not_found` for a model the team can use (reported by several builders, mostly from cloud servers). Every Meta call now retries that one error up to 10 times (`META_TRIES`) with pauses of at most 1 s; other errors are shown at once. An empty `/v1/models` list is asked again. A field scan skips its second SAM pass once SAM has failed every try. Settings shows how many tries each check took. No new SQL |
| v0.14.0 | Oct 28 | Landing page before sign-in (four steps, Sathi's calls, three languages, "Built this week" with what is new and what is not). One farm per person with real places only; the demo places live in a demo farm that anyone signed in can watch read only (demo calls play, up to 10 a day, nothing is saved) and admins edit. Admins (`ADMIN_EMAILS`): Settings tab with model and service checks (and which Meta key is in use), every farm with read-only viewing, usage today, and the demo places. When SAM 3.1 cannot answer, a labelled 1-acre estimate stands in until a rescan. Muse Spark chat goes through `/v1/responses` with `/chat/completions` as fallback; SAM pictures are uploaded to `/v1/files` first. Sathi names the Meta models she runs on and speaks as a woman in Hindi. `/check/` retired. No new SQL |
| v0.13.2 | Oct 28 | SAM 3.1 pictures uploaded to Meta's Files API first |
| v0.13.1 | Oct 28 | Sathi tells a new person what she can do: shops, lowest cost and orders, sowing to harvest, the shed camera and vet message, and demo calls that bargain and book; Zavora 360 (calls), MailPulse (email) and Prochar AI (marketing) are named as connecting next and never claimed as used. A "What can you do?" chip opens every conversation |
| v0.13.0 | Oct 28 | Sign in by email and a 6-digit code (Supabase Auth, no password, no link). Each person has their own farm: lands, sheds, deals, alerts and sell rules carry an owner, and a new farm gets its own copy of each demo land plus the shared demo shed. Daily limits per farm on field scans, camera checks, Sathi answers and shop searches replace the shared passcode. The classic app is retired. The app is now called Khet Sathi. Needs SQL 007 |
| v0.12.2 | Oct 28 | Shed camera notes follow the app language: after a clip is checked, Muse Spark writes its note and vet summary in the other two languages in the background (through the shed's disease and medicine filter; a failed sentence keeps the original); clips checked earlier get them the next time the list loads |
| v0.12.1 | Oct 28 | Harvest dates follow the crop calendar's own harvest months when the crop was sown in its season (Aman rice sown late July: harvest from 1 Dec, not 9 Jan); real buyers are searched by what buys the crop (rice mill, flour mill, oil mill, cold storage, grain elevator) inside a box around the field; "Pulses" named in every language |
| v0.12.0 | Oct 28 | A growing crop, followed to harvest and sale: "Something is growing" after the place check (district crops, sowing month or "not sure"), readiness from the MIRCA-OS calendar and the Sentinel-2 greenness curve, expected harvest from FAOSTAT yields, harvester and transport booking, a selling rule and real buyers near the field; demo lands play scripted demo calls to fictional buyers, real lands say calling is coming soon. Needs SQL 006 (lands.sown_on, lands.sell_rule) |
| v0.11.3 | Oct 28 | Sathi in poultry mode: with a shed picked, Sathi answers from the shed's facts (sensor kit, eggs, sell rule, last camera check) with its own quick questions, one conversation per place, alerts for that place only; every sentence passes the shed's disease and medicine filter. Credits: OpenStreetMap, ESA WorldCover, MIRCA-OS, FAOSTAT, SoilGrids, Open-Meteo, Copernicus and Esri credited on every page; Google Places shops carry the "Google Maps" credit in their own box and are never cached |
| v0.9.0 | Oct 28 | Open weights: Sathi's agent and the egg-sale shopkeepers run on Muse Spark Open (`meta-models/muse-spark-open-1026`) on Baseten when `BASETEN_API_KEY` is set, falling back to Muse Spark 1.3; each answer shows which model answered; bench row for a real open-weights tool call |
| v0.8.0 | Oct 28 | Egg sale: the farmer's sell rule (eggs reach N and/or every N days, lowest price per tray, shops, ask first), a simulated egg stock, Sathi calls the shops and bargains by fixed rules (never below the lowest price) while Muse Spark voices the shopkeepers, offers side by side, one tap saves the deal; `sql/004_sell_rules_v0.8.0.sql` |
| v0.7.5 | Oct 28 | Simulated vet name and village in the farmer's language; Sathi tells the vet "about N chickens in the shed" (source shown below the line); English text says chickens instead of birds |
| v0.7.4 | Oct 28 | Two-way demo vet call: after consent, Sathi and a simulated vet (second voice) take turns; the vet asks up to two scripted questions picked by the signs, Sathi answers only from the SAM count and the simulated shed kit (or says it does not know), the vet closes with a fixed safe line and a short summary |
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
