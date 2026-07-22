import { toLineProtocol, type Point } from './lineprotocol';

const URL = process.env.INFLUXDB_URL ?? 'http://localhost:8086';
const TOKEN = process.env.INFLUXDB_TOKEN ?? 'test-token';
const ORG = process.env.INFLUXDB_ORG ?? 'grainwatch';
const BUCKET = process.env.INFLUXDB_BUCKET ?? 'grainwatch';
const DEVICE_GROUP = 'corn-watch-1';
const DEVICES = ['1.1', '1.2', '1.3', '1.4', '1.5'];

const authHeaders = { Authorization: `Token ${TOKEN}` };

async function waitForHealth(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${URL}/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('InfluxDB did not become healthy in time');
}

/** Ensures a v1 DBRP mapping db=BUCKET -> bucket so the backend's /query works. */
async function ensureDbrp(): Promise<void> {
  const bucketsRes = await fetch(`${URL}/api/v2/buckets?name=${encodeURIComponent(BUCKET)}`, { headers: authHeaders });
  const bucketId = (await bucketsRes.json() as { buckets?: Array<{ id: string }> }).buckets?.[0]?.id;
  if (!bucketId) throw new Error(`Bucket ${BUCKET} not found`);

  const existing = await fetch(`${URL}/api/v2/dbrps?org=${encodeURIComponent(ORG)}`, { headers: authHeaders });
  const dbrps = (await existing.json() as { content?: Array<{ database: string }> }).content ?? [];
  if (dbrps.some((d) => d.database === BUCKET)) return;

  const res = await fetch(`${URL}/api/v2/dbrps`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ org: ORG, bucketID: bucketId, database: BUCKET, retention_policy: 'autogen', default: true }),
  });
  if (!res.ok) throw new Error(`DBRP create failed: ${res.status} ${await res.text()}`);
}

function buildPoints(): Point[] {
  const nowS = Math.floor(Date.now() / 1000);
  const points: Point[] = [];
  // ~24 h of readings, one every 15 min, per device.
  for (let step = 96; step >= 0; step--) {
    const ts = nowS - step * 900;
    DEVICES.forEach((device, di) => {
      const base = 10 + di * 0.5;
      points.push({
        measurement: 'Temp',
        tags: { 'device-group': DEVICE_GROUP, device },
        fields: {
          'temp-top': round(base + 1.5 + Math.sin(step / 6)),
          'temp-mid': round(base + 0.8 + Math.sin(step / 7)),
          'temp-bottom': round(base + Math.sin(step / 8)),
          humidity: round(70 + Math.sin(step / 5) * 5),
          batteryMV: 436,
          measurementTimeS: ts,
        },
        tsSeconds: ts,
      });
    });
    points.push({ measurement: 'outdoor-temperature', tags: { device: DEVICE_GROUP }, fields: { temp: round(5 + Math.sin(step / 10) * 3) }, tsSeconds: ts });
    points.push({ measurement: 'outdoor-humidity', tags: { device: DEVICE_GROUP }, fields: { humidity: round(80 + Math.sin(step / 9) * 8) }, tsSeconds: ts });
  }
  return points;
}

function round(v: number): number { return Math.round(v * 10) / 10; }

async function write(points: Point[]): Promise<void> {
  const res = await fetch(`${URL}/api/v2/write?org=${encodeURIComponent(ORG)}&bucket=${encodeURIComponent(BUCKET)}&precision=s`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    body: toLineProtocol(points),
  });
  if (!res.ok) throw new Error(`Write failed: ${res.status} ${await res.text()}`);
}

async function main(): Promise<void> {
  await waitForHealth();
  await ensureDbrp();
  await write(buildPoints());
  console.log('[seed] wrote seed data and ensured DBRP mapping');
}

void main().catch((err) => { console.error('[seed]', err); process.exit(1); });
