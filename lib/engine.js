// Runs the village kit simulator and the alert rules for the most recent lands.
// Called every 10 minutes by the server and when Home asks for alerts (at most every 2 minutes).
import { fieldDevice, SHED_DEVICE, latestByDevice, seedField, seedShed, stepField, stepShed, toRows, FIELD_METRICS, SHED_METRICS } from './sensors.js';
import { fieldAlerts, shedAlerts, dedupe, toRow, DEDUPE_HOURS } from './alerts.js';

const MAX_LANDS = 5;

export function createEngine({ store, planForLand, rand = Math.random, log = () => {} }) {
  let running = null;
  let lastRun = 0;
  let lastSummary = null;
  const overrides = new Map(); // `${device}|${metric}` -> { value, ticks }

  const valuesFrom = (latest, metrics) => {
    if (!latest) return null;
    const v = {};
    for (const m of metrics) {
      if (latest[m] == null) return null;
      v[m] = latest[m].value;
    }
    return v;
  };
  const applyOverrides = (device, values) => {
    for (const m of Object.keys(values)) {
      const o = overrides.get(`${device}|${m}`);
      if (!o) continue;
      values[m] = o.value;
      if (--o.ticks <= 0) overrides.delete(`${device}|${m}`);
    }
    return values;
  };

  async function tick() {
    const started = Date.now();
    const summary = { at: new Date().toISOString(), lands: 0, readings: 0, alerts: [], errors: [] };
    const list = (await store.listLands()).slice(0, MAX_LANDS);
    const lands = [];
    for (const l of list) {
      const full = await store.getLand(l.id).catch(() => null);
      if (full && (full.objects || []).length) lands.push(full);
    }
    const devices = [...lands.map((l) => fieldDevice(l.id)), SHED_DEVICE];
    const recentReadings = await store.latestReadings(devices, 400).catch((e) => (summary.errors.push(e.message), []));
    const latest = latestByDevice(recentReadings);
    const rows = [];
    const candidates = [];
    let firstAir = null;

    for (const land of lands) {
      const device = fieldDevice(land.id);
      let plan = null;
      try {
        plan = await planForLand(land);
      } catch (e) {
        summary.errors.push(`plan ${device}: ${e.message}`);
      }
      const prev = valuesFrom(latest[device], FIELD_METRICS);
      const raining = Boolean(plan?.weather?.days?.find((d) => d.date === plan.today && ((d.rainMm ?? 0) >= 5)));
      const next = applyOverrides(device, prev ? stepField(prev, { raining, rand }) : seedField(plan?.weather));
      firstAir ??= next.air_temp;
      rows.push(...toRows(device, 'field', next));
      const older = recentReadings.filter((r) => r.device === device && r.metric === 'soil_moisture').map((r) => r.value);
      if (plan) candidates.push(...fieldAlerts(land, plan, [next.soil_moisture, ...older]));
      summary.lands++;
    }

    const shedPrev = valuesFrom(latest[SHED_DEVICE], SHED_METRICS);
    const shed = applyOverrides(SHED_DEVICE, shedPrev ? stepShed(shedPrev, { rand }) : seedShed(firstAir ?? 28));
    rows.push(...toRows(SHED_DEVICE, 'shed', shed));
    candidates.push(...shedAlerts(shed));

    summary.readings = await store.insertReadings(rows).catch((e) => (summary.errors.push(e.message), 0));
    const recent = await store.recentAlerts(DEDUPE_HOURS).catch(() => []);
    const fresh = dedupe(candidates, recent);
    if (fresh.length) {
      const saved = await store.insertAlerts(fresh.map(toRow)).catch((e) => (summary.errors.push(e.message), []));
      summary.alerts = saved.map((a) => a.title);
    }
    summary.ms = Date.now() - started;
    lastRun = Date.now();
    lastSummary = summary;
    log(`engine tick: ${summary.lands} lands, ${summary.readings} readings, alerts [${summary.alerts.join(', ')}]${summary.errors.length ? `, errors ${summary.errors.join('; ')}` : ''}`);
    return summary;
  }

  function run() {
    if (!running) running = tick().finally(() => (running = null));
    return running;
  }

  return {
    run,
    // Runs only if the last run is older than maxAgeMs; waits at most waitMs.
    async runIfStale(maxAgeMs = 120000, waitMs = 8000) {
      if (Date.now() - lastRun < maxAgeMs && !running) return lastSummary;
      const p = run();
      return Promise.race([p, new Promise((r) => setTimeout(() => r(null), waitMs))]);
    },
    // Demo control: hold a metric at a value for the next `ticks` readings, then run them now.
    async force(device, metric, value, ticks = 2) {
      overrides.set(`${device}|${metric}`, { value: Number(value), ticks });
      let s = null;
      const raised = [];
      for (let i = 0; i < ticks; i++) {
        s = await run();
        raised.push(...(s?.alerts || []));
      }
      return { ...s, alerts: raised }; // alerts raised across all forced ticks
    },
    status: () => ({ lastRun: lastRun ? new Date(lastRun).toISOString() : null, last: lastSummary }),
  };
}
