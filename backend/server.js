'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');
const { WebSocket, WebSocketServer } = require('ws');
const mqtt = require('mqtt');
const storage = require('./storage');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MQTT_URL = process.env.MQTT_URL || 'mqtt://127.0.0.1:1883';
const MQTT_TOPIC = process.env.MQTT_TOPIC || 'fleet/fe71/+/telemetry';
const MQTT_DISABLED = process.env.MQTT_DISABLED === '1';
const MQTT_RECONNECT = process.env.MQTT_RECONNECT === '1';
const MAX_HISTORY = Number(process.env.MAX_HISTORY || 500);
const MAX_BODY_BYTES = 1_000_000;
const FUEL_TANK_LITERS_MAX = 200;
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const STATIC_ROUTES = new Map([
  ['/dashboard', { file: 'index.html', contentType: 'text/html; charset=utf-8' }],
  ['/dashboard/', { file: 'index.html', contentType: 'text/html; charset=utf-8' }],
  ['/app.js', { file: 'app.js', contentType: 'text/javascript; charset=utf-8' }],
  ['/styles.css', { file: 'styles.css', contentType: 'text/css; charset=utf-8' }],
  ['/dashboard/app.js', { file: 'app.js', contentType: 'text/javascript; charset=utf-8' }],
  ['/dashboard/styles.css', { file: 'styles.css', contentType: 'text/css; charset=utf-8' }]
]);

const VEHICLE = {
  trip_code: 'TRP-20261120-001',
  tare_weight_kg: 2750,
  gvw_max_kg: 5150,
  fuel_tank_capacity_liters: 70,
  kg_per_hydraulic_bar: 150
};

const ORIGIN = {
  lng: 106.8763119,
  lat: -6.9055104,
  label: 'PT Ade Pasir · Cibolang Kaler, Cisaat',
  search: 'Cibolang Kaler, Sukabumi'
};
const PLANNED_ROUTE = [
  { lng: ORIGIN.lng, lat: ORIGIN.lat },
  { lng: 106.8655, lat: -6.4471 },
  { lng: 106.8712, lat: -6.4124 },
  { lng: 106.8780, lat: -6.3773 }
];

const DESTINATION = { lng: 106.8780, lat: -6.3773, label: 'Proyek Cibubur', search: 'Cibubur, Jakarta Timur' };

let activeOrigin = { ...ORIGIN };
let activeDestination = { ...DESTINATION };
let activeRoute = PLANNED_ROUTE.map((point) => ({ ...point }));
let activeRouteSource = 'default';
let activeRouteClientId = null;
let activeRouteUpdatedAt = new Date().toISOString();

const THRESHOLDS = {
  overspeed_kmh: 65,
  overload_kg: VEHICLE.gvw_max_kg,
  route_deviation_m: 150,
  route_deviation_ms: 60_000,
  hydraulic_dump_min_bar: 18,
  hydraulic_spike_delta_bar: 4,
  hydraulic_drop_bar: 5,
  illegal_dump_load_drop_kg: 300,
  illegal_dump_min_destination_m: 200,
  fuel_theft_drop_liters: 3,
  fuel_window_ms: 300_000,
  coolant_max_c: 95,
  trans_oil_max_c: 110
};

const RULE_META = {
  OVERSPEED: {
    label: 'Kecepatan Berlebih',
    severity: 'warning',
    cooldown_ms: 60_000,
    message: (details) => `Kecepatan Berlebih: kendaraan melaju ${details.speed_kmh} km/jam, melebihi batas 65 km/jam.`
  },
  OVERLOAD: {
    label: 'Kelebihan Muatan',
    severity: 'critical',
    cooldown_ms: 60_000,
    message: (details) => `Kelebihan Muatan: berat total ${details.gvw_kg} kg melebihi batas 5150 kg.`
  },
  ROUTE_DEVIATION: {
    label: 'Penyimpangan Rute',
    severity: 'warning',
    cooldown_ms: 300_000,
    message: (details) => `Penyimpangan Rute: kendaraan berada ${details.route_deviation_m} meter dari rute selama ${details.duration_seconds} detik.`
  },
  ILLEGAL_DUMP: {
    label: 'Pembuangan Ilegal',
    severity: 'critical',
    cooldown_ms: 300_000,
    message: (details) => `Pembuangan Ilegal: muatan berkurang ${details.load_drop_kg} kg sebelum tujuan, jarak tersisa ${details.distance_to_destination_m} meter.`
  },
  FUEL_THEFT: {
    label: 'Indikasi Pencurian Solar',
    severity: 'critical',
    cooldown_ms: 300_000,
    message: (details) => `Indikasi Pencurian Solar: solar berkurang ${details.fuel_drop_liters} liter dalam 5 menit saat kendaraan diam.`
  },
  ENGINE_CRITICAL: {
    label: 'Mesin Kritis',
    severity: 'critical',
    cooldown_ms: 60_000,
    message: (details) => `Mesin Kritis: ${details.reason}. Segera lakukan pemeriksaan mekanik.`
  }
};

const telemetryHistory = storage.getMemory().telemetry;
const alertHistory = storage.getMemory().alerts;
const stateByVin = new Map();
let alertSequence = 0;
let wss = null;
let mqttStatus = MQTT_DISABLED ? 'disabled' : 'connecting';

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

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function numberOrZero(value) {
  return numberOrNull(value) ?? 0;
}

function numericOrNull(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bounded(value, min, max) {
  const parsed = numericOrNull(value);
  if (parsed === null || parsed < min || parsed > max) {
    return null;
  }
  return parsed;
}

function pickNumber(sources, keys) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') {
      continue;
    }
    for (const key of keys) {
      const value = numericOrNull(source[key]);
      if (value !== null) {
        return value;
      }
    }
  }
  return null;
}

function pickString(sources, keys, maxLength) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') {
      continue;
    }
    for (const key of keys) {
      if (typeof source[key] !== 'string') {
        continue;
      }
      const value = source[key].trim();
      if (value) {
        return value.slice(0, maxLength);
      }
    }
  }
  return null;
}

function normalizeDtcCodes(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const codes = value
    .filter((code) => typeof code === 'string')
    .map((code) => code.trim().toUpperCase())
    .filter((code) => /^[A-Z0-9]{5}$/.test(code));
  return [...new Set(codes)].slice(0, 20);
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function haversineMeters(from, to) {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function distanceToSegmentMeters(point, start, end) {
  const originLat = (start.lat + end.lat) / 2;
  const originLng = start.lng;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos(toRadians(originLat));
  const ax = 0;
  const ay = (start.lat - originLat) * metersPerDegLat;
  const bx = (end.lng - originLng) * metersPerDegLng;
  const by = (end.lat - originLat) * metersPerDegLat;
  const px = (point.lng - originLng) * metersPerDegLng;
  const py = (point.lat - originLat) * metersPerDegLat;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0, 1);
  return Math.hypot(px - (ax + ratio * dx), py - (ay + ratio * dy));
}

function distanceToRouteMeters(point, route) {
  let shortest = Infinity;
  for (let index = 0; index < route.length - 1; index += 1) {
    shortest = Math.min(shortest, distanceToSegmentMeters(point, route[index], route[index + 1]));
  }
  return shortest;
}

function normalizeRoutePoint(value, field) {
  if (Array.isArray(value)) {
    const lng = numberOrNull(Number(value[0]));
    const lat = numberOrNull(Number(value[1]));
    if (lng === null || lat === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw badRequest(`${field} harus berupa koordinat yang valid.`);
    }
    return { lng, lat };
  }
  if (!value || typeof value !== 'object') {
    throw badRequest(`${field} wajib diisi.`);
  }
  const lng = numberOrNull(Number(value.lng));
  const lat = numberOrNull(Number(value.lat));
  if (lng === null || lat === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw badRequest(`${field} harus berupa koordinat yang valid.`);
  }
  const point = { lng, lat };
  if (typeof value.label === 'string' && value.label.trim()) {
    point.label = value.label.trim().slice(0, 120);
  }
  if (typeof value.search === 'string' && value.search.trim()) {
    point.search = value.search.trim().slice(0, 160);
  }
  return point;
}

function normalizeRoutePayload(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest('Payload rute harus berupa objek JSON.');
  }
  const origin = normalizeRoutePoint(raw.origin, 'origin');
  const destination = normalizeRoutePoint(raw.destination, 'destination');
  if (!Array.isArray(raw.coordinates) || raw.coordinates.length < 2) {
    throw badRequest('coordinates harus berisi minimal dua titik.');
  }
  if (raw.coordinates.length > 5000) {
    throw badRequest('coordinates terlalu banyak.');
  }

  const coordinates = raw.coordinates.map((point, index) => normalizeRoutePoint(point, `coordinates[${index}]`));
  const source = typeof raw.source === 'string' && raw.source.trim() ? raw.source.trim().slice(0, 40) : 'manual';
  const clientRouteId = typeof raw.client_route_id === 'string' && raw.client_route_id.trim()
    ? raw.client_route_id.trim().slice(0, 80)
    : null;

  return { origin, destination, coordinates, source, clientRouteId };
}

function getRouteState() {
  return {
    origin: { ...activeOrigin },
    destination: { ...activeDestination },
    coordinates: activeRoute.map((point) => [point.lng, point.lat]),
    source: activeRouteSource,
    client_route_id: activeRouteClientId,
    updated_at: activeRouteUpdatedAt
  };
}

async function applyRoute(routePayload, options = {}) {
  activeOrigin = { ...routePayload.origin };
  activeDestination = { ...routePayload.destination };
  activeRoute = routePayload.coordinates.map((point) => ({ ...point }));
  activeRouteSource = routePayload.source;
  activeRouteClientId = routePayload.clientRouteId;
  activeRouteUpdatedAt = new Date().toISOString();
  for (const state of stateByVin.values()) {
    state.route_deviation_since_ms = null;
  }
  const routeState = getRouteState();
  if (options.persist !== false) {
    await storage.saveRoute(routeState);
  }
  broadcast({ type: 'route', data: routeState });
  return routeState;
}

function normalizePayload(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest('Payload harus berupa objek JSON.');
  }

  const vinSources = [raw];
  const vin = pickString(vinSources, ['vin', 'vehicle_id', 'device_id'], 32);
  if (!vin) {
    throw badRequest('Field vin wajib diisi.');
  }

  const timestampSources = [raw];
  let timestampValue = pickString(timestampSources, ['timestamp', 'ts', 'time'], 40);
  if (timestampValue === null) {
    const epoch = pickNumber(timestampSources, ['timestamp', 'ts', 'time']);
    if (epoch !== null) {
      timestampValue = new Date(epoch > 1e12 ? epoch : epoch * 1000).toISOString();
    }
  }
  if (timestampValue === null) {
    throw badRequest('Field timestamp wajib diisi.');
  }
  const parsedTimestamp = new Date(timestampValue);
  if (Number.isNaN(parsedTimestamp.getTime())) {
    throw badRequest('Field timestamp harus berupa ISO 8601 yang valid.');
  }
  if (parsedTimestamp.getTime() > Date.now() + 300_000) {
    throw badRequest('Field timestamp terlalu jauh di masa depan.');
  }

  const gpsSources = [raw.gps, raw.position, raw.coords, raw];
  const lat = bounded(pickNumber(gpsSources, ['lat', 'latitude']), -90, 90);
  const lng = bounded(pickNumber(gpsSources, ['lng', 'lon', 'longitude']), -180, 180);
  if (lat === null || lng === null) {
    throw badRequest('Field gps.lat dan gps.lng wajib berupa koordinat yang valid.');
  }

  const canSources = [raw.can_bus, raw.canBus, raw];
  const sensorSources = [raw.external_sensors, raw.sensors, raw];
  const gps = { lat, lng, satellites: bounded(pickNumber(gpsSources, ['satellites', 'satellite_count']), 0, 50) };
  const heading = bounded(pickNumber(gpsSources, ['heading_deg', 'heading']), 0, 359);
  if (heading !== null) {
    gps.heading_deg = heading;
  }
  const remainingDistance = bounded(pickNumber(gpsSources, ['remaining_distance_m']), 0, 10_000_000);
  if (remainingDistance !== null) {
    gps.remaining_distance_m = remainingDistance;
  }

  const fuelLevel = bounded(pickNumber(canSources, ['fuel_level_liters']), 0, FUEL_TANK_LITERS_MAX);
  const dtcRaw = canSources
    .map((source) => source && source.dtc_codes)
    .find((value) => Array.isArray(value));
  const canBus = {
    speed_kmh: bounded(pickNumber(canSources, ['speed_kmh', 'speed']), 0, 300),
    rpm: bounded(pickNumber(canSources, ['rpm']), 0, 10_000),
    odometer_km: bounded(pickNumber(canSources, ['odometer_km', 'odometer']), 0, 10_000_000),
    coolant_temp_c: bounded(pickNumber(canSources, ['coolant_temp_c', 'coolant_temp']), -40, 150),
    fuel_pct: bounded(pickNumber(canSources, ['fuel_pct', 'fuel_level_pct']), 0, 100),
    dtc_codes: normalizeDtcCodes(dtcRaw)
  };
  if (fuelLevel !== null) {
    canBus.fuel_level_liters = fuelLevel;
  }

  let brakeFluidOk = null;
  for (const source of sensorSources) {
    if (source && typeof source.brake_fluid_ok === 'boolean') {
      brakeFluidOk = source.brake_fluid_ok;
      break;
    }
  }

  return {
    vin,
    trip_code: pickString([raw], ['trip_code', 'tripCode'], 40) || VEHICLE.trip_code,
    timestamp: parsedTimestamp.toISOString(),
    gps,
    can_bus: canBus,
    external_sensors: {
      trans_oil_temp_c: bounded(pickNumber(sensorSources, ['trans_oil_temp_c', 'trans_temp_c']), -40, 200),
      brake_vacuum_kpa: bounded(pickNumber(sensorSources, ['brake_vacuum_kpa', 'brake_vacuum']), 0, 120),
      brake_fluid_ok: brakeFluidOk,
      hydraulic_bar: bounded(pickNumber(sensorSources, ['hydraulic_bar', 'hydraulic_pressure_bar']), 0, 80)
    }
  };
}

function deriveMetrics(telemetry) {
  const fuelPct = clamp(numberOrZero(telemetry.can_bus.fuel_pct), 0, 100);
  const fuelLevelLiters = round((fuelPct / 100) * VEHICLE.fuel_tank_capacity_liters, 2);
  const hydraulicBar = Math.max(0, numberOrZero(telemetry.external_sensors.hydraulic_bar));
  const estimatedLoadKg = round(hydraulicBar * VEHICLE.kg_per_hydraulic_bar, 1);
  const gvwKg = round(VEHICLE.tare_weight_kg + estimatedLoadKg, 1);
  const speedKmh = numberOrZero(telemetry.can_bus.speed_kmh);
  const rpm = numberOrZero(telemetry.can_bus.rpm);

  return {
    speed_kmh: round(speedKmh, 2),
    rpm: Math.round(rpm),
    fuel_pct: round(fuelPct, 2),
    fuel_level_liters: fuelLevelLiters,
    hydraulic_bar: round(hydraulicBar, 2),
    tare_weight_kg: VEHICLE.tare_weight_kg,
    estimated_load_kg: estimatedLoadKg,
    gvw_kg: gvwKg,
    route_deviation_m: round(distanceToRouteMeters(telemetry.gps, activeRoute), 1),
    distance_to_destination_m: round(haversineMeters(telemetry.gps, activeDestination), 1),
    is_stationary: speedKmh === 0 && rpm === 0
  };
}

function getState(vin) {
  let state = stateByVin.get(vin);
  if (!state) {
    state = {
      route_deviation_since_ms: null,
      last_hydraulic_bar: null,
      dump: { armed: false, peak_bar: 0, load_at_peak_kg: 0 },
      fuel_samples: [],
      last_alert_at_ms: {}
    };
    stateByVin.set(vin, state);
  }
  return state;
}

function evaluateRules(telemetry, metrics) {
  const state = getState(telemetry.vin);
  const eventMs = Date.parse(telemetry.timestamp);
  const alerts = [];
  const dtcCodes = telemetry.can_bus.dtc_codes;
  const coolantTempC = numberOrZero(telemetry.can_bus.coolant_temp_c);
  const transOilTempC = numberOrZero(telemetry.external_sensors.trans_oil_temp_c);

  function emit(ruleCode, observedValue, thresholdValue, details) {
    const meta = RULE_META[ruleCode];
    const lastAlertAt = state.last_alert_at_ms[ruleCode] ?? -Infinity;
    if (eventMs - lastAlertAt < meta.cooldown_ms) {
      return;
    }
    state.last_alert_at_ms[ruleCode] = eventMs;
    alerts.push({
      alert_id: ++alertSequence,
      vin: telemetry.vin,
      trip_code: telemetry.trip_code,
      rule_code: ruleCode,
      severity: meta.severity,
      label: meta.label,
      message_id: meta.message(details),
      observed_value: round(observedValue, 2),
      threshold_value: thresholdValue,
      details,
      status: 'open',
      detected_at: telemetry.timestamp
    });
  }

  if (metrics.speed_kmh > THRESHOLDS.overspeed_kmh) {
    emit('OVERSPEED', metrics.speed_kmh, THRESHOLDS.overspeed_kmh, {
      speed_kmh: metrics.speed_kmh
    });
  }

  if (metrics.gvw_kg > THRESHOLDS.overload_kg) {
    emit('OVERLOAD', metrics.gvw_kg, THRESHOLDS.overload_kg, {
      tare_weight_kg: metrics.tare_weight_kg,
      estimated_load_kg: metrics.estimated_load_kg,
      gvw_kg: metrics.gvw_kg
    });
  }

  if (metrics.route_deviation_m > THRESHOLDS.route_deviation_m) {
    if (state.route_deviation_since_ms === null) {
      state.route_deviation_since_ms = eventMs;
    }
    const deviationMs = eventMs - state.route_deviation_since_ms;
    if (deviationMs > THRESHOLDS.route_deviation_ms) {
      emit('ROUTE_DEVIATION', metrics.route_deviation_m, THRESHOLDS.route_deviation_m, {
        route_deviation_m: metrics.route_deviation_m,
        duration_seconds: round(deviationMs / 1000, 1)
      });
    }
  } else {
    state.route_deviation_since_ms = null;
  }

  const previousHydraulicBar = state.last_hydraulic_bar;
  const hydraulicDelta = previousHydraulicBar === null ? 0 : metrics.hydraulic_bar - previousHydraulicBar;
  const dump = state.dump;

  if (
    metrics.hydraulic_bar >= THRESHOLDS.hydraulic_dump_min_bar &&
    hydraulicDelta >= THRESHOLDS.hydraulic_spike_delta_bar
  ) {
    dump.armed = true;
    dump.peak_bar = metrics.hydraulic_bar;
    dump.load_at_peak_kg = metrics.estimated_load_kg;
  } else if (dump.armed && metrics.hydraulic_bar > dump.peak_bar) {
    dump.peak_bar = metrics.hydraulic_bar;
    dump.load_at_peak_kg = metrics.estimated_load_kg;
  }

  if (dump.armed && dump.peak_bar - metrics.hydraulic_bar >= THRESHOLDS.hydraulic_drop_bar) {
    const loadDropKg = round(dump.load_at_peak_kg - metrics.estimated_load_kg, 1);
    if (
      loadDropKg > THRESHOLDS.illegal_dump_load_drop_kg &&
      metrics.distance_to_destination_m > THRESHOLDS.illegal_dump_min_destination_m
    ) {
      emit('ILLEGAL_DUMP', loadDropKg, THRESHOLDS.illegal_dump_load_drop_kg, {
        peak_hydraulic_bar: dump.peak_bar,
        current_hydraulic_bar: metrics.hydraulic_bar,
        load_drop_kg: loadDropKg,
        distance_to_destination_m: metrics.distance_to_destination_m
      });
    }
    dump.armed = false;
  }
  state.last_hydraulic_bar = metrics.hydraulic_bar;

  const currentFuelSample = {
    timestamp_ms: eventMs,
    fuel_level_liters: metrics.fuel_level_liters,
    is_stationary: metrics.is_stationary
  };
  state.fuel_samples.push(currentFuelSample);
  state.fuel_samples = state.fuel_samples.filter(
    (sample) => eventMs - sample.timestamp_ms <= THRESHOLDS.fuel_window_ms
  );

  if (metrics.is_stationary) {
    const previousStationarySamples = state.fuel_samples.filter(
      (sample) => sample.is_stationary && sample !== currentFuelSample
    );
    if (previousStationarySamples.length >= 1) {
      const minimumLiters = Math.min(...previousStationarySamples.map((sample) => sample.fuel_level_liters));
      const fuelDropLiters = round(minimumLiters - metrics.fuel_level_liters, 2);
      if (fuelDropLiters > THRESHOLDS.fuel_theft_drop_liters) {
        emit('FUEL_THEFT', fuelDropLiters, THRESHOLDS.fuel_theft_drop_liters, {
          fuel_drop_liters: fuelDropLiters,
          window_seconds: THRESHOLDS.fuel_window_ms / 1000,
          speed_kmh: metrics.speed_kmh,
          rpm: metrics.rpm
        });
      }
    }
  }

  const isEngineCritical =
    coolantTempC > THRESHOLDS.coolant_max_c ||
    transOilTempC > THRESHOLDS.trans_oil_max_c ||
    dtcCodes.length > 0;

  if (isEngineCritical) {
    const reasons = [];
    if (coolantTempC > THRESHOLDS.coolant_max_c) {
      reasons.push(`suhu coolant ${round(coolantTempC, 1)} °C`);
    }
    if (transOilTempC > THRESHOLDS.trans_oil_max_c) {
      reasons.push(`suhu oli transmisi ${round(transOilTempC, 1)} °C`);
    }
    if (dtcCodes.length > 0) {
      reasons.push(`kode DTC ${dtcCodes.join(', ')}`);
    }
    emit('ENGINE_CRITICAL', dtcCodes.length > 0 ? dtcCodes.length : Math.max(coolantTempC, transOilTempC), 0, {
      coolant_temp_c: round(coolantTempC, 1),
      trans_oil_temp_c: round(transOilTempC, 1),
      dtc_codes: dtcCodes,
      reason: reasons.join(', ')
    });
  }

  return alerts;
}

function broadcast(message) {
  if (!wss) {
    return;
  }
  const serialized = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(serialized);
    }
  }
}

async function processTelemetry(rawPayload, source = 'http') {
  const telemetry = normalizePayload(rawPayload);
  const metrics = deriveMetrics(telemetry);
  const alerts = evaluateRules(telemetry, metrics);
  const record = {
    vin: telemetry.vin,
    trip_code: telemetry.trip_code,
    timestamp: telemetry.timestamp,
    received_at: new Date().toISOString(),
    source,
    gps: telemetry.gps,
    can_bus: telemetry.can_bus,
    external_sensors: telemetry.external_sensors,
    metrics
  };

  const telemetryId = await storage.appendTelemetry(record, metrics, rawPayload);
  await storage.appendAlerts(alerts, telemetryId);

  broadcast({ type: 'telemetry', data: record });
  for (const alert of alerts) {
    broadcast({ type: 'alert', data: alert });
  }

  return { telemetry: record, alerts };
}

function getStatus() {
  return {
    service: 'pt-ade-pasir-backend',
    mqtt_status: mqttStatus,
    mqtt_topic: MQTT_TOPIC,
    websocket_clients: wss ? wss.clients.size : 0,
    telemetry_count: telemetryHistory.length,
    alert_count: alertHistory.length,
    database: storage.getStatus()
  };
}

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*'
  });
  response.end(payload);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let data = '';
    let tooLarge = false;
    request.on('data', (chunk) => {
      if (tooLarge) {
        return;
      }
      data += chunk;
      if (data.length > MAX_BODY_BYTES) {
        tooLarge = true;
      }
    });
    request.on('end', () => {
      if (tooLarge) {
        reject(badRequest('Payload terlalu besar.'));
        return;
      }
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(badRequest('Body harus berupa JSON yang valid.'));
      }
    });
    request.on('error', reject);
  });
}

function parseLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 50;
  }
  return Math.min(Math.floor(parsed), 200);
}

async function handleRequest(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  try {
    if (request.method === 'GET' && STATIC_ROUTES.has(url.pathname)) {
      const route = STATIC_ROUTES.get(url.pathname);
      try {
        const content = await fs.readFile(path.join(FRONTEND_DIR, route.file));
        response.writeHead(200, {
          'Content-Type': route.contentType,
          'Cache-Control': 'no-store'
        });
        response.end(content);
      } catch {
        sendJson(response, 404, { error: 'File frontend tidak ditemukan.' });
      }
      return;
    }

    if (request.method === 'GET' && url.pathname === '/') {
      sendJson(response, 200, {
        name: 'PT Ade Pasir Telematics Backend',
        endpoints: ['/api/v1/health', '/api/v1/telemetry', '/api/v1/alerts', '/api/v1/route', '/ws'],
        status: getStatus()
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/v1/health') {
      sendJson(response, 200, { status: 'ok', ...getStatus() });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/v1/telemetry') {
      const limit = parseLimit(url.searchParams.get('limit'));
      const data = await storage.listTelemetry(limit);
      sendJson(response, 200, { count: data.length, data });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/v1/alerts') {
      const limit = parseLimit(url.searchParams.get('limit'));
      const data = await storage.listAlerts(limit);
      sendJson(response, 200, { count: data.length, data });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/v1/route') {
      sendJson(response, 200, getRouteState());
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/v1/route') {
      const payload = await readJsonBody(request);
      const route = await applyRoute(normalizeRoutePayload(payload));
      sendJson(response, 200, { status: 'ok', route });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/v1/telemetry') {
      const payload = await readJsonBody(request);
      const result = await processTelemetry(payload, 'http');
      sendJson(response, 200, { status: 'ok', ...result });
      return;
    }

    sendJson(response, 404, { error: 'Endpoint tidak ditemukan.' });
  } catch (error) {
    sendJson(response, error.status || 500, { error: error.message || 'Kesalahan internal server.' });
  }
}

function startMqttSubscriber() {
  if (MQTT_DISABLED) {
    mqttStatus = 'disabled';
    return null;
  }

  const client = mqtt.connect(MQTT_URL, {
    connectTimeout: 3_000,
    reconnectPeriod: MQTT_RECONNECT ? 1_000 : 0,
    clean: true
  });
  mqttStatus = 'connecting';

  client.on('connect', () => {
    mqttStatus = 'connected';
    client.subscribe(MQTT_TOPIC, { qos: 0 }, (error) => {
      if (error) {
        console.error(`Gagal berlangganan MQTT ${MQTT_TOPIC}: ${error.message}`);
      } else {
        console.log(`MQTT tersambung: ${MQTT_URL} -> ${MQTT_TOPIC}`);
      }
    });
  });

  client.on('message', async (topic, buffer) => {
    try {
      const payload = JSON.parse(buffer.toString('utf8'));
      await processTelemetry(payload, 'mqtt');
    } catch (error) {
      console.warn(`Payload MQTT tidak valid pada ${topic}: ${error.message}`);
    }
  });

  client.on('error', (error) => {
    mqttStatus = 'offline';
    console.warn(`MQTT tidak tersedia (${MQTT_URL}): ${error.message} — mode HTTP/WebSocket tetap aktif.`);
    if (!MQTT_RECONNECT) {
      client.end(true);
    }
  });

  client.on('close', () => {
    if (mqttStatus !== 'disabled') {
      mqttStatus = 'offline';
    }
  });

  return client;
}

async function startServer() {
  await storage.init();

  const savedRoute = await storage.loadRoute();
  if (savedRoute) {
    try {
      await applyRoute(normalizeRoutePayload(savedRoute), { persist: false });
    } catch (error) {
      console.warn(`Rute tersimpan tidak dapat dimuat: ${error.message}`);
    }
  }

  const server = http.createServer(handleRequest);
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit('connection', client, request);
    });
  });

  wss.on('connection', async (client) => {
    try {
      const [telemetry, alerts] = await Promise.all([
        storage.listTelemetry(50),
        storage.listAlerts(50)
      ]);
      client.send(JSON.stringify({
        type: 'snapshot',
        data: {
          telemetry,
          alerts,
          route: getRouteState(),
          status: getStatus()
        }
      }));
    } catch (error) {
      console.warn(`Gagal mengirim snapshot WebSocket: ${error.message}`);
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`Backend PT Ade Pasir berjalan di http://${HOST}:${PORT} (WebSocket: ws://${HOST}:${PORT}/ws)`);
  });

  const mqttClient = startMqttSubscriber();
  return { server, wss, mqttClient, storage };
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(`Gagal memulai backend: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  startServer,
  processTelemetry,
  evaluateRules,
  deriveMetrics,
  normalizePayload,
  normalizeRoutePayload,
  getRouteState,
  applyRoute,
  getStatus,
  storage,
  history: { telemetry: telemetryHistory, alerts: alertHistory }
};
