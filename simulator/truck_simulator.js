'use strict';

const DEFAULT_VIN = 'MMBF71E3VRK123456';
const DEFAULT_TRIP_CODE = 'TRP-20261120-001';
const DEFAULT_URL = process.env.BACKEND_URL || 'http://127.0.0.1:3000';
const DEFAULT_INTERVAL_MS = Number(process.env.SIM_INTERVAL_MS || 3000);
const ODOMETER_START_KM = 12450.6;
const FUEL_TANK_LITERS = 70;
const START_FUEL_PCT = 70;
const KG_PER_HYDRAULIC_BAR = 150;
const ROUTE_DEVIATION_LNG_OFFSET = 0.006;

const ORIGIN = { lng: 106.8763119, lat: -6.9055104 };
const DESTINATION = { lng: 106.8780, lat: -6.3773 };

const SCENARIOS = [
  'normal',
  'overspeed',
  'overload',
  'route_deviation',
  'illegal_dump',
  'fuel_theft',
  'dtc_error'
];

const HELP = `Penggunaan:
  node simulator/truck_simulator.js [skenario] [opsi]

Skenario:
  normal            Perjalanan sesuai rute dan batas kecepatan
  overspeed         Kecepatan di atas 65 km/jam
  overload          Muatan membuat GVW melebihi 5150 kg
  route_deviation   Posisi menyimpang lebih dari 150 meter lebih dari 60 detik
  illegal_dump      Tekanan hidrolik naik lalu turun dengan penurunan muatan
  fuel_theft        Kendaraan diam dan solar berkurang lebih dari 3 liter
  dtc_error         Kode DTC aktif memicu Mesin Kritis

Opsional:
  --scenario, -s    Nama skenario (default: normal)
  --ticks           Jumlah pengiriman, 0 untuk tanpa batas (default: 40)
  --interval        Interval pengiriman milidetik (default: 3000)
  --url             Alamat backend (default: http://127.0.0.1:3000)
  --vin             VIN kendaraan (default: MMBF71E3VRK123456)
  --help, -h        Tampilkan bantuan ini

Contoh:
  node simulator/truck_simulator.js normal --ticks 20
  node simulator/truck_simulator.js overspeed --ticks 10
  node simulator/truck_simulator.js overload --ticks 10
  node simulator/truck_simulator.js route_deviation --ticks 30
  node simulator/truck_simulator.js illegal_dump --ticks 12
  node simulator/truck_simulator.js fuel_theft --ticks 15
  node simulator/truck_simulator.js dtc_error --ticks 10`;

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians) {
  return (radians * 180) / Math.PI;
}

function haversineMeters(from, to) {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function bearingDegrees(from, to) {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const dLng = toRadians(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRoutePoint(value) {
  const lat = Array.isArray(value) ? numberOrNull(value[1]) : numberOrNull(value && value.lat);
  const lng = Array.isArray(value) ? numberOrNull(value[0]) : numberOrNull(value && value.lng);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }
  return { lat, lng };
}

function buildRoute(points, source) {
  if (!Array.isArray(points)) {
    return null;
  }
  const normalized = points.map(normalizeRoutePoint).filter(Boolean);
  if (normalized.length < 2) {
    return null;
  }
  const segments = normalized.slice(1).map((to, index) => ({
    from: normalized[index],
    to,
    length_m: haversineMeters(normalized[index], to)
  }));
  const lengthMeters = segments.reduce((total, segment) => total + segment.length_m, 0);
  if (lengthMeters <= 0) {
    return null;
  }
  return { points: normalized, segments, lengthMeters, source };
}

function pointAtDistance(route, distanceMeters) {
  let remaining = clamp(distanceMeters, 0, route.lengthMeters);
  for (let index = 0; index < route.segments.length; index += 1) {
    const segment = route.segments[index];
    if (remaining <= segment.length_m || index === route.segments.length - 1) {
      const ratio = segment.length_m === 0 ? 0 : clamp(remaining / segment.length_m, 0, 1);
      return {
        lat: segment.from.lat + (segment.to.lat - segment.from.lat) * ratio,
        lng: segment.from.lng + (segment.to.lng - segment.from.lng) * ratio
      };
    }
    remaining -= segment.length_m;
  }
  return route.points[route.points.length - 1];
}

async function fetchActiveRoute(baseUrl) {
  const endpoint = `${baseUrl.replace(/\/$/, '')}/api/v1/route`;
  try {
    const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return buildRoute(data.coordinates, data.source || 'backend');
  } catch (error) {
    return null;
  }
}

function parseArgs(argv) {
  const options = {
    scenario: 'normal',
    ticks: 40,
    intervalMs: DEFAULT_INTERVAL_MS,
    url: DEFAULT_URL,
    vin: process.env.VIN || DEFAULT_VIN,
    tripCode: process.env.TRIP_CODE || DEFAULT_TRIP_CODE,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg.startsWith('--scenario=')) {
      options.scenario = arg.slice('--scenario='.length);
      continue;
    }
    if (arg === '--scenario' || arg === '-s') {
      options.scenario = argv[++index] || '';
      continue;
    }
    if (arg.startsWith('--ticks=')) {
      options.ticks = Number(arg.slice('--ticks='.length));
      continue;
    }
    if (arg === '--ticks') {
      options.ticks = Number(argv[++index]);
      continue;
    }
    if (arg.startsWith('--interval=')) {
      options.intervalMs = Number(arg.slice('--interval='.length));
      continue;
    }
    if (arg === '--interval') {
      options.intervalMs = Number(argv[++index]);
      continue;
    }
    if (arg.startsWith('--url=')) {
      options.url = arg.slice('--url='.length);
      continue;
    }
    if (arg === '--url') {
      options.url = argv[++index] || '';
      continue;
    }
    if (arg.startsWith('--vin=')) {
      options.vin = arg.slice('--vin='.length);
      continue;
    }
    if (arg === '--vin') {
      options.vin = argv[++index] || '';
      continue;
    }
    if (SCENARIOS.includes(arg)) {
      options.scenario = arg;
      continue;
    }
    throw new Error(`Opsi tidak dikenali: ${arg}`);
  }

  if (!SCENARIOS.includes(options.scenario)) {
    throw new Error(`Skenario tidak dikenali: ${options.scenario}`);
  }
  if (!Number.isInteger(options.ticks) || options.ticks < 0) {
    throw new Error('Nilai --ticks harus bilangan bulat lebih besar atau sama dengan 0.');
  }
  if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) {
    throw new Error('Nilai --interval harus bilangan positif.');
  }
  if (!options.url) {
    throw new Error('Nilai --url tidak boleh kosong.');
  }
  if (!options.vin) {
    throw new Error('Nilai --vin tidak boleh kosong.');
  }

  return options;
}

function createTripState(route) {
  return {
    route,
    travelledMeters: 0,
    location: { ...route.points[0] },
    heading: 0,
    fuelPct: START_FUEL_PCT,
    coolantTempC: 86,
    transOilTempC: 77,
    hydraulicBar: 14,
    brakeVacuumKpa: 68
  };
}

function speedForTick(tick, progress) {
  if (tick % 19 === 0) {
    return 8;
  }
  const slowZone = (progress > 0.18 && progress < 0.3) || (progress > 0.56 && progress < 0.66);
  let speed = 42 + Math.sin(tick / 4) * 5 + Math.cos(tick / 9) * 2.5;
  if (slowZone) {
    speed *= 0.55;
  }
  if (progress > 0.98) {
    speed *= 0.4;
  }
  return round(clamp(speed, 12, 56), 1);
}

function hydraulicForTick(tick, scenario) {
  let bar = 14 + Math.sin(tick / 7) * 0.5;
  if (scenario === 'overload') {
    bar = 19.2 + Math.sin(tick / 6) * 0.3;
  }
  if (scenario === 'illegal_dump') {
    if (tick === 8) {
      bar = 21.2;
    } else if (tick === 9) {
      bar = 10.4;
    }
  }
  if (scenario === 'fuel_theft' && tick >= 6) {
    bar = 14;
  }
  return round(bar, 2);
}

function buildPayload(tick, options, state) {
  const intervalSeconds = options.intervalMs / 1000;
  const progress = state.route.lengthMeters > 0 ? state.travelledMeters / state.route.lengthMeters : 0;

  let speedKmh = speedForTick(tick, progress);
  let rpm = speedKmh === 0 ? 750 : Math.round(1050 + speedKmh * 24 + Math.sin(tick / 5) * 45);
  if (options.scenario === 'overspeed') {
    speedKmh = round(72 + Math.sin(tick / 3) * 3, 1);
    rpm = Math.round(1200 + speedKmh * 26);
  }
  if (options.scenario === 'fuel_theft' && tick >= 6) {
    speedKmh = 0;
    rpm = 0;
  }

  const distanceDeltaMeters = (speedKmh / 3.6) * intervalSeconds;
  state.travelledMeters = clamp(state.travelledMeters + distanceDeltaMeters, 0, state.route.lengthMeters);
  const routePoint = pointAtDistance(state.route, state.travelledMeters);
  if (distanceDeltaMeters > 0.1) {
    state.heading = round(bearingDegrees(state.location, routePoint), 1);
  }
  state.location = { ...routePoint };

  let lat = routePoint.lat;
  let lng = routePoint.lng;
  if (options.scenario === 'route_deviation') {
    lng = round(lng + ROUTE_DEVIATION_LNG_OFFSET, 6);
  }

  state.hydraulicBar = hydraulicForTick(tick, options.scenario);
  const loadKg = state.hydraulicBar * KG_PER_HYDRAULIC_BAR;
  const litersPerKm = 0.19 + (loadKg / 1000) * 0.012;
  const consumedLiters = litersPerKm * (distanceDeltaMeters / 1000) + 1.4 * (intervalSeconds / 3600);
  state.fuelPct = clamp(state.fuelPct - (consumedLiters / FUEL_TANK_LITERS) * 100, 0, 100);
  if (options.scenario === 'fuel_theft' && tick >= 10) {
    state.fuelPct = START_FUEL_PCT - 10;
  }

  const loadFactor = (state.hydraulicBar - 14) / 8;
  const slowZone = (progress > 0.18 && progress < 0.3) || (progress > 0.56 && progress < 0.66);
  const targetCoolant = 84 + speedKmh * 0.16 + loadFactor * 4 + (slowZone ? 2 : 0);
  state.coolantTempC = clamp(
    state.coolantTempC + (targetCoolant - state.coolantTempC) * 0.12 + Math.sin(tick / 11) * 0.15,
    80,
    94
  );

  const targetTrans = 72 + speedKmh * 0.12 + loadFactor * 5 + (slowZone ? 3 : 0);
  state.transOilTempC = clamp(
    state.transOilTempC + (targetTrans - state.transOilTempC) * 0.1 + Math.cos(tick / 13) * 0.2,
    70,
    102
  );

  const targetVacuum = speedKmh === 0 ? 28 : 64 + Math.sin(tick / 8) * 4;
  state.brakeVacuumKpa = clamp(
    state.brakeVacuumKpa + (targetVacuum - state.brakeVacuumKpa) * 0.25,
    20,
    78
  );

  const dtcCodes = options.scenario === 'dtc_error' ? ['P0191', 'P0201'] : [];
  const remainingDistanceMeters = clamp(state.route.lengthMeters - state.travelledMeters, 0, state.route.lengthMeters);
  const fuelPct = round(state.fuelPct, 2);

  return {
    vin: options.vin,
    trip_code: options.tripCode,
    timestamp: new Date().toISOString(),
    gps: {
      lat: round(lat, 6),
      lng: round(lng, 6),
      satellites: 12,
      heading_deg: state.heading,
      remaining_distance_m: round(remainingDistanceMeters, 1)
    },
    can_bus: {
      speed_kmh: speedKmh,
      rpm,
      odometer_km: round(ODOMETER_START_KM + state.travelledMeters / 1000, 2),
      coolant_temp_c: round(state.coolantTempC, 1),
      fuel_pct: fuelPct,
      fuel_level_liters: round((fuelPct / 100) * FUEL_TANK_LITERS, 2),
      dtc_codes: dtcCodes
    },
    external_sensors: {
      trans_oil_temp_c: round(state.transOilTempC, 1),
      brake_vacuum_kpa: round(state.brakeVacuumKpa, 1),
      brake_fluid_ok: true,
      hydraulic_bar: state.hydraulicBar
    }
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function sendTelemetry(payload, baseUrl) {
  const endpoint = `${baseUrl.replace(/\/$/, '')}/api/v1/telemetry`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || `HTTP ${response.status}`);
  }
  return result;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(HELP);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    console.log(HELP);
    return;
  }

  const activeRoute = await fetchActiveRoute(options.url);
  const fallbackRoute = buildRoute([ORIGIN, DESTINATION], 'interpolasi');
  const route = activeRoute || fallbackRoute;
  const state = createTripState(route);

  console.log(
    `Simulator ${options.scenario} -> ${options.url}, rute=${route.source}, ` +
      `titik=${route.points.length}, jarak=${round(route.lengthMeters / 1000, 2)} km, ` +
      `interval ${options.intervalMs} ms.`
  );

  let stopped = false;
  process.on('SIGINT', () => {
    stopped = true;
    console.log('\nSimulator dihentikan.');
  });

  let tick = 0;
  while (!stopped && (options.ticks === 0 || tick < options.ticks)) {
    tick += 1;
    const payload = buildPayload(tick, options, state);
    const progressPct = round((state.travelledMeters / state.route.lengthMeters) * 100, 1);

    console.log(
      `[${tick}] kecepatan=${payload.can_bus.speed_kmh} km/jam, rpm=${payload.can_bus.rpm}, ` +
        `progres=${progressPct}%, sisa=${round(payload.gps.remaining_distance_m / 1000, 2)} km, ` +
        `arah=${payload.gps.heading_deg}°, ` +
        `solar=${payload.can_bus.fuel_pct}% (${payload.can_bus.fuel_level_liters} L), ` +
        `pendingin=${payload.can_bus.coolant_temp_c}°C, ` +
        `oli=${payload.external_sensors.trans_oil_temp_c}°C, ` +
        `vakum=${payload.external_sensors.brake_vacuum_kpa} kPa, ` +
        `hidrolik=${payload.external_sensors.hydraulic_bar} bar, ` +
        `posisi=${payload.gps.lat},${payload.gps.lng}`
    );

    try {
      const result = await sendTelemetry(payload, options.url);
      for (const alert of result.alerts || []) {
        console.log(`  [ALERT ${alert.rule_code}] ${alert.message_id}`);
      }
    } catch (error) {
      console.error(`  Gagal mengirim telemetri: ${error.message}`);
    }

    if (stopped || (options.ticks !== 0 && tick >= options.ticks)) {
      break;
    }
    await sleep(options.intervalMs);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
