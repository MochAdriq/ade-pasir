'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns');
const { URL } = require('node:url');
const { Pool } = require('pg');

const ALERT_LABELS = {
  OVERSPEED: 'Kecepatan Berlebih',
  OVERLOAD: 'Kelebihan Muatan',
  ROUTE_DEVIATION: 'Penyimpangan Rute',
  ILLEGAL_DUMP: 'Pembuangan Ilegal',
  FUEL_THEFT: 'Indikasi Pencurian Solar',
  ENGINE_CRITICAL: 'Mesin Kritis'
};

function loadEnvFile() {
  const candidates = [path.join(__dirname, '.env'), path.join(__dirname, '..', '.env')];
  for (const file of candidates) {
    if (!fs.existsSync(file)) {
      continue;
    }
    const content = fs.readFileSync(file, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      const separator = trimmed.indexOf('=');
      if (separator <= 0) {
        continue;
      }
      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
    return;
  }
}

loadEnvFile();

const MAX_HISTORY = Number(process.env.MAX_HISTORY || 500);
const DB_MODE = (process.env.DB_MODE || 'auto').toLowerCase();

function connectionStringFromEnvironment() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  const database = process.env.PGDATABASE;
  const user = process.env.PGUSER;
  if (!database || !user) {
    return null;
  }
  const password = process.env.PGPASSWORD
    ? `${encodeURIComponent(user)}:${encodeURIComponent(process.env.PGPASSWORD)}`
    : encodeURIComponent(user);
  const host = process.env.PGHOST || '127.0.0.1';
  const port = process.env.PGPORT || '5432';
  return `postgresql://${password}@${host}:${port}/${database}`;
}

function round(value, digits = 2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(parsed * factor) / factor;
}

function numeric(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  if (min !== undefined && parsed < min) {
    return min;
  }
  if (max !== undefined && parsed > max) {
    return max;
  }
  return parsed;
}

function pushLimited(list, item) {
  list.push(item);
  if (list.length > MAX_HISTORY) {
    list.splice(0, list.length - MAX_HISTORY);
  }
}

const memory = {
  telemetry: [],
  alerts: [],
  route: null
};

const entityCache = new Map();
let pool = null;
let mode = 'memory';
let lastError = null;
let initialized = false;

function noteDatabaseFailure(error) {
  lastError = error && error.message ? error.message : String(error);
  console.warn(`Operasi database gagal, memakai fallback memori sementara: ${lastError}`);
  if (!pool) {
    mode = 'memory';
  }
}

async function withClient(callback) {
  if (!pool || DB_MODE === 'memory') {
    return null;
  }
  const client = await pool.connect();
  try {
    const result = await callback(client);
    mode = 'postgres';
    return result;
  } finally {
    client.release();
  }
}

async function resolveConnectionStringHost(rawConnectionString) {
  try {
    const parsed = new URL(rawConnectionString);
    const hostname = parsed.hostname;
    if (!hostname || hostname === '127.0.0.1' || hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      return rawConnectionString;
    }
    try {
      const lookupResult = await dns.promises.lookup(hostname, { family: 4 });
      if (lookupResult && lookupResult.address) {
        parsed.hostname = lookupResult.address;
        return parsed.toString();
      }
    } catch {
      // Fallback ke DNS resolver publik jika getaddrinfo lokal gagal (misal router fe80::1)
    }
    const resolver = new dns.promises.Resolver();
    resolver.setServers(['1.1.1.1', '8.8.8.8']);
    const addresses = await resolver.resolve4(hostname);
    if (Array.isArray(addresses) && addresses.length > 0) {
      parsed.hostname = addresses[0];
      return parsed.toString();
    }
  } catch {
    // Gunakan connectionString asli jika gagal
  }
  return rawConnectionString;
}

async function init() {
  if (initialized) {
    return getStatus();
  }
  initialized = true;

  if (DB_MODE === 'memory') {
    mode = 'memory';
    return getStatus();
  }

  const rawConnectionString = connectionStringFromEnvironment();
  if (!rawConnectionString) {
    lastError = 'DATABASE_URL belum diset.';
    mode = 'memory';
    return getStatus();
  }

  try {
    const connectionString = await resolveConnectionStringHost(rawConnectionString);
    const isLocalHost = /@(127\.0\.0\.1|localhost)(:|\/|$)/i.test(rawConnectionString);
    pool = new Pool({
      connectionString,
      max: Number(process.env.DB_POOL_MAX || 5),
      connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000),
      idleTimeoutMillis: 30000,
      ssl: isLocalHost ? false : { rejectUnauthorized: false }
    });
    pool.on('error', (err) => {
      lastError = err && err.message ? err.message : String(err);
    });
    await pool.query('SELECT 1 AS ok');
    mode = 'postgres';
    lastError = null;
  } catch (error) {
    noteDatabaseFailure(error);
    if (pool) {
      pool.end().catch(() => {});
      pool = null;
    }
  }

  return getStatus();
}

const AUTO_REGISTER_VEHICLES = process.env.AUTO_REGISTER_VEHICLES !== '0';

async function resolveEntityIds(client, vin, tripCode) {
  const cacheKey = `${vin}|${tripCode || ''}`;
  if (entityCache.has(cacheKey)) {
    return entityCache.get(cacheKey);
  }

  const vehicleResult = await client.query('SELECT vehicle_id FROM vehicles WHERE vin = $1 LIMIT 1', [vin]);
  let vehicleId = vehicleResult.rows[0] ? Number(vehicleResult.rows[0].vehicle_id) : null;

  if (!vehicleId && AUTO_REGISTER_VEHICLES && /^[A-Za-z0-9_-]{3,32}$/.test(vin)) {
    const countResult = await client.query('SELECT count(*) AS total FROM vehicles');
    const totalVehicles = Number(countResult.rows[0]?.total || 0);
    if (totalVehicles < 100) {
      await client.query(`
        INSERT INTO vehicles (
          vin, vehicle_code, model_name, model_year, emission_standard,
          drivetrain, engine_code, transmission_code, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
        ON CONFLICT (vin) DO NOTHING
      `, [
        vin,
        `IOT-${vin}`.slice(0, 32),
        'Canter FE 71 · perangkat IoT',
        2022,
        'Euro 4',
        '4x2',
        'UNKNOWN',
        'UNKNOWN'
      ]);
      const inserted = await client.query('SELECT vehicle_id FROM vehicles WHERE vin = $1 LIMIT 1', [vin]);
      vehicleId = inserted.rows[0] ? Number(inserted.rows[0].vehicle_id) : null;
    }
  }

  let tripId = null;
  if (tripCode) {
    const tripResult = await client.query('SELECT trip_id FROM trips WHERE trip_code = $1 LIMIT 1', [tripCode]);
    tripId = tripResult.rows[0] ? Number(tripResult.rows[0].trip_id) : null;
  }

  const ids = { vehicleId, tripId };
  entityCache.set(cacheKey, ids);
  return ids;
}

async function appendTelemetry(record, metrics, rawPayload) {
  let telemetryId = null;
  if (mode === 'postgres') {
    try {
      telemetryId = await withClient(async (client) => {
        const ids = await resolveEntityIds(client, record.vin, record.trip_code);
        const gps = record.gps || {};
        const canBus = record.can_bus || {};
        const sensors = record.external_sensors || {};
        const satellites = numeric(gps.satellites, 0, 50);
        const result = await client.query(`
          INSERT INTO telemetry_logs (
            vehicle_id, trip_id, recorded_at, received_at, position, satellite_count,
            speed_kmh, rpm, odometer_km, coolant_temp_c, fuel_pct, fuel_level_liters,
            dtc_codes, trans_oil_temp_c, brake_vacuum_kpa, brake_fluid_ok, hydraulic_bar,
            tare_weight_kg, estimated_load_kg, gvw_kg, route_deviation_m,
            distance_to_destination_m, source, raw_payload
          ) VALUES (
            $1, $2, $3, $4,
            CASE WHEN $5::double precision IS NULL AND $6::double precision IS NULL THEN NULL
                 ELSE ST_SetSRID(ST_MakePoint($5, $6), 4326) END,
            $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
            $20, $21, $22, $23, $24, $25::jsonb
          )
          RETURNING telemetry_id
        `, [
          ids.vehicleId,
          ids.tripId,
          record.timestamp,
          record.received_at,
          numeric(gps.lng, -180, 180),
          numeric(gps.lat, -90, 90),
          satellites,
          numeric(canBus.speed_kmh, 0),
          numeric(canBus.rpm, 0),
          numeric(canBus.odometer_km, 0),
          numeric(canBus.coolant_temp_c),
          numeric(canBus.fuel_pct, 0, 100),
          metrics.fuel_level_liters,
          Array.isArray(canBus.dtc_codes) ? canBus.dtc_codes.slice(0, 20) : [],
          numeric(sensors.trans_oil_temp_c),
          numeric(sensors.brake_vacuum_kpa),
          typeof sensors.brake_fluid_ok === 'boolean' ? sensors.brake_fluid_ok : null,
          numeric(sensors.hydraulic_bar, 0),
          metrics.tare_weight_kg,
          metrics.estimated_load_kg,
          metrics.gvw_kg,
          metrics.route_deviation_m,
          metrics.distance_to_destination_m,
          record.source,
          JSON.stringify(rawPayload || {})
        ]);
        return result.rows[0] ? Number(result.rows[0].telemetry_id) : null;
      });
      lastError = null;
    } catch (error) {
      noteDatabaseFailure(error);
    }
  }

  pushLimited(memory.telemetry, record);
  return telemetryId;
}

async function appendAlerts(alerts, telemetryId) {
  if (!Array.isArray(alerts) || alerts.length === 0) {
    return [];
  }

  if (mode === 'postgres') {
    try {
      await withClient(async (client) => {
        for (const alert of alerts) {
          const ids = await resolveEntityIds(client, alert.vin, alert.trip_code);
          const result = await client.query(`
            INSERT INTO fraud_alerts (
              vehicle_id, trip_id, telemetry_id, rule_code, severity, label,
              message_id, observed_value, threshold_value, details, status, detected_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
            RETURNING alert_id
          `, [
            ids.vehicleId,
            ids.tripId,
            telemetryId,
            alert.rule_code,
            alert.severity,
            alert.label || ALERT_LABELS[alert.rule_code] || alert.rule_code,
            alert.message_id,
            numeric(alert.observed_value),
            numeric(alert.threshold_value),
            JSON.stringify(alert.details || {}),
            alert.status || 'open',
            alert.detected_at
          ]);
          if (result.rows[0]) {
            alert.alert_id = Number(result.rows[0].alert_id);
          }
        }
      });
      lastError = null;
    } catch (error) {
      noteDatabaseFailure(error);
    }
  }

  for (const alert of alerts) {
    pushLimited(memory.alerts, alert);
  }
  return alerts;
}

function mapTelemetryRow(row) {
  const raw = row.raw_payload && typeof row.raw_payload === 'object' ? row.raw_payload : {};
  const lat = round(row.lat ?? raw.gps?.lat, 6);
  const lng = round(row.lng ?? raw.gps?.lng, 6);
  const gps = {
    lat,
    lng,
    satellites: row.satellite_count === null || row.satellite_count === undefined ? null : Number(row.satellite_count)
  };
  if (raw.gps && typeof raw.gps.heading_deg !== 'undefined') {
    gps.heading_deg = raw.gps.heading_deg;
  }
  if (raw.gps && typeof raw.gps.remaining_distance_m !== 'undefined') {
    gps.remaining_distance_m = raw.gps.remaining_distance_m;
  }

  const canBus = {
    speed_kmh: round(row.speed_kmh, 2),
    rpm: row.rpm === null || row.rpm === undefined ? null : Number(row.rpm),
    odometer_km: round(row.odometer_km, 2),
    coolant_temp_c: round(row.coolant_temp_c, 2),
    fuel_pct: round(row.fuel_pct, 2),
    dtc_codes: Array.isArray(row.dtc_codes) ? row.dtc_codes : []
  };
  if (raw.can_bus && typeof raw.can_bus.fuel_level_liters !== 'undefined') {
    canBus.fuel_level_liters = raw.can_bus.fuel_level_liters;
  }

  return {
    vin: row.vin,
    trip_code: row.trip_code || null,
    timestamp: new Date(row.recorded_at).toISOString(),
    received_at: row.received_at ? new Date(row.received_at).toISOString() : null,
    source: row.source || 'postgres',
    gps,
    can_bus: canBus,
    external_sensors: {
      trans_oil_temp_c: round(row.trans_oil_temp_c, 2),
      brake_vacuum_kpa: round(row.brake_vacuum_kpa, 2),
      brake_fluid_ok: row.brake_fluid_ok,
      hydraulic_bar: round(row.hydraulic_bar, 2)
    },
    metrics: {
      speed_kmh: round(row.speed_kmh, 2),
      rpm: row.rpm === null || row.rpm === undefined ? null : Number(row.rpm),
      fuel_pct: round(row.fuel_pct, 2),
      fuel_level_liters: round(row.fuel_level_liters, 2),
      hydraulic_bar: round(row.hydraulic_bar, 2),
      tare_weight_kg: round(row.tare_weight_kg, 2),
      estimated_load_kg: round(row.estimated_load_kg, 2),
      gvw_kg: round(row.gvw_kg, 2),
      route_deviation_m: round(row.route_deviation_m, 1),
      distance_to_destination_m: round(row.distance_to_destination_m, 1),
      is_stationary: Number(row.speed_kmh || 0) === 0 && Number(row.rpm || 0) === 0
    }
  };
}

async function listTelemetry(limit = 50) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
  if (mode !== 'postgres') {
    return memory.telemetry.slice(-safeLimit);
  }

  try {
    const result = await withClient(async (client) => client.query(`
      SELECT tl.*, v.vin, t.trip_code,
             ST_X(tl.position) AS lng, ST_Y(tl.position) AS lat
      FROM telemetry_logs tl
      JOIN vehicles v ON v.vehicle_id = tl.vehicle_id
      LEFT JOIN trips t ON t.trip_id = tl.trip_id
      ORDER BY tl.recorded_at DESC
      LIMIT $1
    `, [safeLimit]));
    lastError = null;
    return result.rows.reverse().map(mapTelemetryRow);
  } catch (error) {
    noteDatabaseFailure(error);
    return memory.telemetry.slice(-safeLimit);
  }
}

async function listAlerts(limit = 50) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
  if (mode !== 'postgres') {
    return memory.alerts.slice(-safeLimit);
  }

  try {
    const result = await withClient(async (client) => client.query(`
      SELECT fa.*, v.vin, t.trip_code
      FROM fraud_alerts fa
      JOIN vehicles v ON v.vehicle_id = fa.vehicle_id
      LEFT JOIN trips t ON t.trip_id = fa.trip_id
      ORDER BY fa.detected_at DESC
      LIMIT $1
    `, [safeLimit]));
    lastError = null;
    return result.rows.reverse().map((row) => ({
      alert_id: Number(row.alert_id),
      vin: row.vin,
      trip_code: row.trip_code || null,
      rule_code: row.rule_code,
      severity: row.severity,
      label: row.label || ALERT_LABELS[row.rule_code] || row.rule_code,
      message_id: row.message_id,
      observed_value: round(row.observed_value, 2),
      threshold_value: round(row.threshold_value, 2),
      details: row.details && typeof row.details === 'object' ? row.details : {},
      status: row.status,
      detected_at: new Date(row.detected_at).toISOString()
    }));
  } catch (error) {
    noteDatabaseFailure(error);
    return memory.alerts.slice(-safeLimit);
  }
}

async function saveRoute(route) {
  memory.route = route ? JSON.parse(JSON.stringify(route)) : null;
  if (mode !== 'postgres' || !memory.route) {
    return;
  }

  try {
    await withClient(async (client) => client.query(`
      INSERT INTO active_routes (
        route_key, origin, destination, coordinates, source, client_route_id, updated_at
      ) VALUES ('active', $1::jsonb, $2::jsonb, $3::jsonb, $4, $5, $6)
      ON CONFLICT (route_key) DO UPDATE SET
        origin = EXCLUDED.origin,
        destination = EXCLUDED.destination,
        coordinates = EXCLUDED.coordinates,
        source = EXCLUDED.source,
        client_route_id = EXCLUDED.client_route_id,
        updated_at = EXCLUDED.updated_at
    `, [
      JSON.stringify(memory.route.origin),
      JSON.stringify(memory.route.destination),
      JSON.stringify(memory.route.coordinates),
      memory.route.source || 'manual',
      memory.route.client_route_id || null,
      memory.route.updated_at || new Date().toISOString()
    ]));
    lastError = null;
  } catch (error) {
    noteDatabaseFailure(error);
  }
}

async function loadRoute() {
  if (mode !== 'postgres') {
    return memory.route ? JSON.parse(JSON.stringify(memory.route)) : null;
  }

  try {
    const result = await withClient(async (client) => client.query(`
      SELECT origin, destination, coordinates, source, client_route_id, updated_at
      FROM active_routes WHERE route_key = 'active' LIMIT 1
    `));
    lastError = null;
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      origin: row.origin,
      destination: row.destination,
      coordinates: row.coordinates,
      source: row.source,
      client_route_id: row.client_route_id,
      updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null
    };
  } catch (error) {
    noteDatabaseFailure(error);
    return memory.route ? JSON.parse(JSON.stringify(memory.route)) : null;
  }
}

function getStatus() {
  return {
    mode,
    connected: mode === 'postgres',
    error: lastError,
    memory_telemetry: memory.telemetry.length,
    memory_alerts: memory.alerts.length
  };
}

async function close() {
  if (!pool) {
    return;
  }
  await pool.end();
  pool = null;
}

module.exports = {
  init,
  getStatus,
  getMemory: () => memory,
  appendTelemetry,
  appendAlerts,
  listTelemetry,
  listAlerts,
  saveRoute,
  loadRoute,
  close
};
