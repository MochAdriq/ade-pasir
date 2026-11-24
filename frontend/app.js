'use strict';

const params = new URLSearchParams(window.location.search);
const WS_URL = params.get('ws') || 'ws://127.0.0.1:3000/ws';
const REST_BASE = params.get('api') || 'http://127.0.0.1:3000';

const GVW_LIMIT_KG = 5150;
const TARE_WEIGHT_KG = 2750;
const FUEL_TANK_LITERS = 70;
const KG_PER_HYDRAULIC_BAR = 150;

const DEFAULT_ORIGIN_LABEL = 'PT Ade Pasir · Cibolang Kaler, Cisaat';

const ORIGIN = {
  lng: 106.8763119,
  lat: -6.9055104,
  label: DEFAULT_ORIGIN_LABEL,
  search: 'Cibolang Kaler, Sukabumi'
};
const DESTINATION = {
  lng: 106.8780,
  lat: -6.3773,
  label: 'Proyek Cibubur',
  search: 'Cibubur, Jakarta Timur'
};
const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search';
const OSRM_ROUTE = 'https://router.project-osrm.org/route/v1/driving';
const DEFAULT_ROUTE_HELPER = 'Masukkan nama tempat, koordinat lat, lng, atau potongan tautan Maps; jika pencarian nama gagal, gunakan koordinat.';
const SHOPEE_TRUCK_BODY = [
  '<g class="truck-art" stroke-linejoin="round">',
  '<path d="M-20 13 H19" fill="none" stroke="#0b1114" stroke-opacity="0.25" stroke-width="2" stroke-linecap="round"/>',
  '<rect x="-22" y="-14" width="25" height="20" rx="3.5" fill="#ee4d2d" stroke="#8a2b18" stroke-width="1.4"/>',
  '<path d="M-18 -10 H-4" fill="none" stroke="#ffffff" stroke-opacity="0.5" stroke-width="1.6" stroke-linecap="round"/>',
  '<rect x="-17" y="-9" width="15" height="11" rx="1.6" fill="#fff4ef" stroke="#8a2b18" stroke-width="1"/>',
  '<path d="M-12 -9 V2 M-17 -3.5 H-2" fill="none" stroke="#ee4d2d" stroke-width="1.6"/>',
  '<path d="M3 -8 H12 L19 -1 V6 H3 Z" fill="#ff6b45" stroke="#8a2b18" stroke-width="1.4"/>',
  '<path d="M6 -5 H11 L15 -1 H6 Z" fill="#fff4ef" stroke="#8a2b18" stroke-width="0.9"/>',
  '<path d="M6 6 V-1 H16" fill="none" stroke="#8a2b18" stroke-width="1"/>',
  '<rect x="19" y="2" width="3.5" height="5" rx="1" fill="#ffd1c1" stroke="#8a2b18" stroke-width="1"/>',
  '<circle cx="-13" cy="8" r="4.6" fill="#2b2320" stroke="#fff4ef" stroke-width="1.4"/>',
  '<circle cx="-13" cy="8" r="1.7" fill="#ffb199"/>',
  '<circle cx="11" cy="8" r="4.6" fill="#2b2320" stroke="#fff4ef" stroke-width="1.4"/>',
  '<circle cx="11" cy="8" r="1.7" fill="#ffb199"/>',
  '</g>'
].join('');

const RULE_LABELS = {
  OVERSPEED: 'Kecepatan Berlebih',
  OVERLOAD: 'Kelebihan Muatan',
  ROUTE_DEVIATION: 'Penyimpangan Rute',
  ILLEGAL_DUMP: 'Pembuangan Ilegal',
  FUEL_THEFT: 'Indikasi Pencurian Solar',
  ENGINE_CRITICAL: 'Mesin Kritis'
};

const DTC_DICTIONARY = {
  P0101: {
    description: 'Sirkuit sensor MAF di luar kisaran atau kinerja tidak sesuai.',
    action: 'Periksa saluran udara dan konektor MAF, bersihkan elemen sensor, lalu uji ulang dengan scanner.'
  },
  P0102: {
    description: 'Sinyal sensor MAF terlalu rendah terhadap kondisi putaran mesin.',
    action: 'Periksa kabel dan konektor MAF, pastikan tidak ada kebocoran udara sebelum sensor, ganti sensor bila rusak.'
  },
  P0113: {
    description: 'Sinyal sensor suhu udara masuk terlalu tinggi.',
    action: 'Periksa konektor IAT dan suhu sekitar, uji resistansi sensor, ganti bila pembacaan tetap tinggi.'
  },
  P0122: {
    description: 'Sensor posisi throttle 1 memberikan sinyal terlalu rendah.',
    action: 'Periksa konektor dan rangkaian TPS, kalibrasi ulang posisi throttle, ganti sensor bila perlu.'
  },
  P0191: {
    description: 'Tekanan rel solar di luar kisaran yang diharapkan ECM.',
    action: 'Periksa pompa injeksi, regulator tekanan, dan filter solar; uji tekanan rel dengan alat khusus.'
  },
  P0193: {
    description: 'Sinyal sensor tekanan rel solar terlalu tinggi.',
    action: 'Periksa sensor tekanan rel dan rangkaiannya, pastikan regulator tidak macet, lakukan uji tekanan actual vs desired.'
  },
  P0201: {
    description: 'Gangguan sirkuit injektor silinder 1.',
    action: 'Periksa konektor dan hambatan injektor silinder 1, lakukan uji semprot dan ganti injektor bila rusak.'
  },
  P0202: {
    description: 'Gangguan sirkuit injektor silinder 2.',
    action: 'Periksa konektor dan hambatan injektor silinder 2, lakukan uji semprot dan ganti injektor bila rusak.'
  },
  P0299: {
    description: 'Tekanan boost turbo lebih rendah dari target (underboost).',
    action: 'Periksa selang charge air dan intercooler, periksa actuator wastegate, serta kondisi turbocharger.'
  },
  P0335: {
    description: 'Gangguan sirkuit sensor posisi crankshaft.',
    action: 'Periksa konektor, kabel, dan jarak sensor terhadap trigger wheel; ganti sensor bila sinyal tidak stabil.'
  },
  P0340: {
    description: 'Gangguan sirkuit sensor posisi camshaft.',
    action: 'Periksa rangkaian dan pemasangan sensor camshaft, pastikan sinkronisasi timing masih benar.'
  },
  P0401: {
    description: 'Aliran gas EGR tidak mencukupi.',
    action: 'Periksa katup EGR, selang vacuum, dan saluran EGR dari karbon; bersihkan atau ganti komponen yang macet.'
  },
  P0500: {
    description: 'Sensor kecepatan kendaraan tidak memberikan sinyal yang valid.',
    action: 'Periksa konektor sensor kecepatan pada transmisi M025S5 dan rangkaian kabel; ganti sensor bila perlu.'
  },
  P0562: {
    description: 'Tegangan sistem kelistrikan terlalu rendah.',
    action: 'Periksa alternator, regulator, terminal baterai, dan konsumsi arus; lakukan uji tegangan saat mesin hidup.'
  },
  P0606: {
    description: 'Gangguan internal prosesor modul kontrol mesin (ECM).',
    action: 'Lakukan uji diagnostik ECM, periksa tegangan suplai dan ground, lakukan flash atau ganti ECM sesuai prosedur pabrik.'
  }
};

const MAP_WIDTH = 900;
const MAP_HEIGHT = 520;
const MAP_PADDING = 56;
let activeRoute = [];
let routeConfigured = false;
let activeRouteSource = null;
let activeRouteClientId = null;
let localRouteVersion = 0;
let activeRouteDistance = null;
let activeRouteGeometryLength = null;
let trafficSegments = [];
let trafficTick = 0;
let trafficTimer = null;
let routeRequestId = 0;
let suggestionTimer = null;
let lastGeocodeAt = 0;
let geocodeChain = Promise.resolve();
const suggestionTokens = { origin: 0, destination: 0 };
let MIN_LNG;
let MAX_LNG;
let MIN_LAT;
let MAX_LAT;

function getMapFocusPoints() {
  if (routeConfigured && activeRoute.length > 0) {
    return [...activeRoute, ...validTrailPoints()];
  }
  const trail = validTrailPoints();
  return trail.length > 0 ? trail : [ORIGIN];
}

function getMapFocusLatLngs() {
  return getMapFocusPoints().map((point) => [point.lat, point.lng]);
}

function updateProjectionBounds() {
  const points = getMapFocusPoints();
  MIN_LNG = Math.min(...points.map((point) => point.lng)) - 0.0012;
  MAX_LNG = Math.max(...points.map((point) => point.lng)) + 0.0012;
  MIN_LAT = Math.min(...points.map((point) => point.lat)) - 0.0020;
  MAX_LAT = Math.max(...points.map((point) => point.lat)) + 0.0020;
}

const el = {
  connectionBadge: document.getElementById('connectionBadge'),
  connectionText: document.getElementById('connectionText'),
  socketStatus: document.getElementById('socketStatus'),
  satelliteText: document.getElementById('satelliteText'),
  coordinateText: document.getElementById('coordinateText'),
  leafletMap: document.getElementById('leafletMap'),
  fallbackMap: document.getElementById('fallbackMap'),
  routeMap: document.getElementById('routeMap'),
  mapMode: document.getElementById('mapMode'),
  trafficStatus: document.getElementById('trafficStatus'),
  originInput: document.getElementById('originInput'),
  destinationInput: document.getElementById('destinationInput'),
  originSuggestions: document.getElementById('originSuggestions'),
  destinationSuggestions: document.getElementById('destinationSuggestions'),
  applyRouteButton: document.getElementById('applyRouteButton'),
  routeHelper: document.getElementById('routeHelper'),
  distanceToDestination: document.getElementById('distanceToDestination'),
  routeDeviation: document.getElementById('routeDeviation'),
  lastSeen: document.getElementById('lastSeen'),
  routeLayer: document.getElementById('routeLayer'),
  trailLayer: document.getElementById('trailLayer'),
  markerLayer: document.getElementById('markerLayer'),
  speedValue: document.getElementById('speedValue'),
  speedCategory: document.getElementById('speedCategory'),
  rpmValue: document.getElementById('rpmValue'),
  odometerValue: document.getElementById('odometerValue'),
  fuelValue: document.getElementById('fuelValue'),
  fuelBar: document.getElementById('fuelBar'),
  fuelLiters: document.getElementById('fuelLiters'),
  coolantValue: document.getElementById('coolantValue'),
  transOilValue: document.getElementById('transOilValue'),
  brakeVacuumValue: document.getElementById('brakeVacuumValue'),
  brakeFluidValue: document.getElementById('brakeFluidValue'),
  loadValue: document.getElementById('loadValue'),
  gvwValue: document.getElementById('gvwValue'),
  weightBar: document.getElementById('weightBar'),
  weightStatus: document.getElementById('weightStatus'),
  alertList: document.getElementById('alertList'),
  dtcList: document.getElementById('dtcList'),
  packetCount: document.getElementById('packetCount'),
  alertCount: document.getElementById('alertCount'),
  sourceLabel: document.getElementById('sourceLabel'),
  telemetryLog: document.getElementById('telemetryLog'),
  reconnectButton: document.getElementById('reconnectButton'),
  clearButton: document.getElementById('clearButton')
};

let socket = null;
let reconnectTimer = null;
let latestTelemetry = null;
let alerts = [];
let trail = [];
let logLines = [];
let packetCount = 0;
let alertCount = 0;
let mapMode = 'loading';
let followTruck = true;
let lastFollowedPoint = null;
let leafletMap = null;
let tileLoadCount = 0;
let tileErrorCount = 0;
let tileCheckTimer = null;
const leafletLayers = {
  route: null,
  traffic: [],
  trail: null,
  origin: null,
  destination: null,
  truck: null
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function numericCoordinate(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return toNumber(value);
}

function extractGps(record) {
  const candidates = [record?.gps, record?.position, record?.coords, record];
  for (const candidate of candidates) {
    const lat = numericCoordinate(candidate?.lat ?? candidate?.latitude);
    const lng = numericCoordinate(candidate?.lng ?? candidate?.lon ?? candidate?.longitude);
    if (lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }
  return null;
}

function numberOrZero(value) {
  return toNumber(value) ?? 0;
}

function formatValue(value, digits = 1) {
  const numeric = toNumber(value);
  if (numeric === null) {
    return '—';
  }
  return numeric.toLocaleString('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function formatDistance(meters) {
  const numeric = toNumber(meters);
  if (numeric === null) {
    return '—';
  }
  if (numeric >= 1000) {
    return `${formatValue(numeric / 1000, 2)} km`;
  }
  return `${formatValue(numeric, 0)} m`;
}

function formatTime(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleTimeString('id-ID', { hour12: false });
}

function parseCoordinateInput(text) {
  const cleaned = String(text || '').trim().replace(/\s+/g, ' ');
  const patterns = [
    /@(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i,
    /(?:^|[?&]q=)(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
    /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/
  ];
  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (!match) {
      continue;
    }
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return null;
    }
    const label = /^-?\d+(?:\.\d+)?\s*,/.test(cleaned) ? cleaned : formatCoordinate({ lat, lng });
    return { lat, lng, label };
  }
  return null;
}

function formatCoordinate(point) {
  return `${Number(point.lat).toFixed(7)}, ${Number(point.lng).toFixed(7)}`;
}

function haversineMeters(from, to) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(value)));
}

function segmentProjection(point, start, end) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
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
  const distance = Math.hypot(px - (ax + ratio * dx), py - (ay + ratio * dy));
  return { distance, ratio };
}

function distanceToSegmentMeters(point, start, end) {
  return segmentProjection(point, start, end).distance;
}

function distanceToRouteMeters(point, route) {
  let shortest = Infinity;
  for (let index = 0; index < route.length - 1; index += 1) {
    shortest = Math.min(shortest, distanceToSegmentMeters(point, route[index], route[index + 1]));
  }
  return shortest;
}

function routeGeometryLengthMeters(route) {
  let total = 0;
  for (let index = 0; index < route.length - 1; index += 1) {
    total += haversineMeters(route[index], route[index + 1]);
  }
  return total;
}

function remainingRouteDistanceMeters(point, route) {
  if (!route || route.length < 2) {
    return null;
  }
  let best = null;
  for (let index = 0; index < route.length - 1; index += 1) {
    const projection = segmentProjection(point, route[index], route[index + 1]);
    if (!best || projection.distance < best.distance) {
      best = { ...projection, index };
    }
  }
  if (!best) {
    return null;
  }
  let remaining = (1 - best.ratio) * haversineMeters(route[best.index], route[best.index + 1]);
  for (let index = best.index + 1; index < route.length - 1; index += 1) {
    remaining += haversineMeters(route[index], route[index + 1]);
  }
  if (activeRouteDistance !== null && activeRouteGeometryLength > 0) {
    return remaining * (activeRouteDistance / activeRouteGeometryLength);
  }
  return remaining;
}

function setRouteHelper(text, state = 'info') {
  el.routeHelper.textContent = text;
  el.routeHelper.dataset.state = state;
}

function speedCategory(speed) {
  if (speed <= 0) {
    return { label: 'Berhenti', level: 'stop' };
  }
  if (speed <= 20) {
    return { label: 'Lambat', level: 'slow' };
  }
  if (speed <= 65) {
    return { label: 'Normal', level: 'normal' };
  }
  return { label: 'Overspeed', level: 'overspeed' };
}

function deriveMetrics(record) {
  const canBus = record?.can_bus || {};
  const sensors = record?.external_sensors || {};
  const fuelPct = clamp(numberOrZero(canBus.fuel_pct), 0, 100);
  const hydraulicBar = Math.max(0, numberOrZero(sensors.hydraulic_bar));
  const loadKg = hydraulicBar * KG_PER_HYDRAULIC_BAR;

  return {
    speed_kmh: numberOrZero(canBus.speed_kmh),
    rpm: numberOrZero(canBus.rpm),
    fuel_pct: fuelPct,
    fuel_level_liters: (fuelPct / 100) * FUEL_TANK_LITERS,
    hydraulic_bar: hydraulicBar,
    estimated_load_kg: loadKg,
    gvw_kg: TARE_WEIGHT_KG + loadKg
  };
}

function getMetrics(record) {
  if (!record) {
    return deriveMetrics(null);
  }
  const fallback = deriveMetrics(record);
  const metrics = record.metrics && typeof record.metrics === 'object' ? record.metrics : {};
  return {
    speed_kmh: toNumber(metrics.speed_kmh) ?? fallback.speed_kmh,
    rpm: toNumber(metrics.rpm) ?? fallback.rpm,
    fuel_pct: toNumber(metrics.fuel_pct) ?? fallback.fuel_pct,
    fuel_level_liters: toNumber(metrics.fuel_level_liters) ?? fallback.fuel_level_liters,
    hydraulic_bar: toNumber(metrics.hydraulic_bar) ?? fallback.hydraulic_bar,
    estimated_load_kg: toNumber(metrics.estimated_load_kg) ?? fallback.estimated_load_kg,
    gvw_kg: toNumber(metrics.gvw_kg) ?? fallback.gvw_kg,
    route_deviation_m: toNumber(metrics.route_deviation_m),
    distance_to_destination_m: toNumber(metrics.distance_to_destination_m)
  };
}

function svgElement(tag, attributes = {}) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function project(point) {
  return {
    x: MAP_PADDING + ((point.lng - MIN_LNG) / (MAX_LNG - MIN_LNG)) * (MAP_WIDTH - 2 * MAP_PADDING),
    y: MAP_PADDING + ((MAX_LAT - point.lat) / (MAX_LAT - MIN_LAT)) * (MAP_HEIGHT - 2 * MAP_PADDING)
  };
}

function createMarker(point, className) {
  const position = project(point);
  const group = svgElement('g');
  group.appendChild(svgElement('circle', { cx: position.x, cy: position.y, r: 10, class: className }));
  group.appendChild(svgElement('circle', { cx: position.x, cy: position.y, r: 3, fill: className === 'destination-ring' ? '#f2a93b' : '#cfc6b4' }));
  return group;
}

function validTrailPoints() {
  return trail
    .filter((point) => toNumber(point?.lat) !== null && toNumber(point?.lng) !== null)
    .map((point) => ({ lat: Number(point.lat), lng: Number(point.lng) }));
}

function setMapMode(mode, text) {
  mapMode = mode;
  el.mapMode.dataset.mode = mode;
  el.mapMode.textContent = text;
}

function activateFallback(reason) {
  if (mapMode === 'grid') {
    return;
  }
  if (tileCheckTimer !== null) {
    clearTimeout(tileCheckTimer);
    tileCheckTimer = null;
  }
  if (leafletMap) {
    try {
      leafletMap.remove();
    } catch {
      leafletMap = null;
    }
    leafletMap = null;
  }
  el.leafletMap.hidden = true;
  el.fallbackMap.hidden = false;
  setMapMode('grid', 'Mode grid · peta dasar tidak tersedia');
  appendLog(`Peta beralih ke mode grid: ${reason}`);
  renderFallbackMap();
}

function initLeaflet() {
  const leaflet = window.L;
  if (!leaflet || typeof leaflet.map !== 'function') {
    activateFallback('Leaflet tidak dapat dimuat dari CDN.');
    return;
  }

  try {
    leafletMap = leaflet.map('leafletMap', {
      center: [(ORIGIN.lat + DESTINATION.lat) / 2, (ORIGIN.lng + DESTINATION.lng) / 2],
      zoom: 12,
      zoomControl: true,
      attributionControl: true
    });

    const tileLayer = leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    });

    tileLayer.on('tileload', () => {
      tileLoadCount += 1;
      if (tileLoadCount > 0 && tileErrorCount < 2 && mapMode === 'leaflet') {
        setMapMode('leaflet', 'Peta dasar: OpenStreetMap');
      }
    });

    tileLayer.on('tileerror', () => {
      tileErrorCount += 1;
      if (tileLoadCount === 0 && tileErrorCount >= 2) {
        activateFallback('tile OpenStreetMap gagal dimuat.');
      }
    });

    tileLayer.addTo(leafletMap);
    leafletMap.fitBounds(leaflet.latLngBounds(getMapFocusLatLngs()), { padding: [36, 36] });
    leafletMap.on('dragstart zoomstart', () => {
      followTruck = false;
    });

    leafletLayers.route = leaflet.polyline([], {
      color: '#3d8bff',
      weight: 5,
      opacity: 0.95,
      smoothFactor: 0
    });
    if (routeConfigured) {
      leafletLayers.route.setLatLngs(getRouteLatLngs()).addTo(leafletMap);
    }

    leafletLayers.trail = leaflet.polyline([], {
      color: '#4fc2b1',
      weight: 2,
      opacity: 0.85
    });
    if (routeConfigured) {
      leafletLayers.trail.addTo(leafletMap);
    }

    leafletLayers.origin = leaflet.circleMarker([ORIGIN.lat, ORIGIN.lng], {
      radius: 8,
      color: '#cfc6b4',
      weight: 2,
      fillColor: '#cfc6b4',
      fillOpacity: 0.18
    });
    if (routeConfigured) {
      leafletLayers.origin.addTo(leafletMap);
    }

    leafletLayers.destination = leaflet.circleMarker([DESTINATION.lat, DESTINATION.lng], {
      radius: 8,
      color: '#f2a93b',
      weight: 2,
      fillColor: '#f2a93b',
      fillOpacity: 0.2
    });
    if (routeConfigured) {
      leafletLayers.destination.addTo(leafletMap);
    }

    const truckIcon = leaflet.divIcon({
      className: 'truck-icon',
      html: truckIconHtml(),
      iconSize: [48, 38],
      iconAnchor: [24, 19]
    });
    leafletLayers.truck = leaflet.marker([ORIGIN.lat, ORIGIN.lng], {
      icon: truckIcon,
      opacity: 1,
      keyboard: false,
      zIndexOffset: 1000
    }).bindTooltip('Truk Canter FE 71 · titik awal', { direction: 'top', offset: [0, -18] }).addTo(leafletMap);

    setMapMode('leaflet', 'Peta dasar: OpenStreetMap');
    tileCheckTimer = setTimeout(() => {
      if (tileLoadCount === 0 && mapMode === 'leaflet') {
        activateFallback('tile OpenStreetMap tidak merespons.');
      }
    }, 6000);
  } catch (error) {
    activateFallback(`Leaflet gagal diinisialisasi: ${error.message}`);
  }
}

function initMap() {
  updateProjectionBounds();
  setMapMode('loading', 'Menyiapkan peta…');
  el.leafletMap.hidden = false;
  el.fallbackMap.hidden = true;
  initLeaflet();
}

function setLeafletTruckRotation(rotation) {
  const markerElement = leafletLayers.truck.getElement();
  if (markerElement) {
    const truckSymbol = markerElement.querySelector('.truck-svg');
    if (truckSymbol) {
      truckSymbol.style.transform = `rotate(${rotation.toFixed(1)}deg)`;
    }
  }
}

function focusLeafletTruck(point) {
  if (!followTruck || !leafletMap) {
    return;
  }
  if (lastFollowedPoint && lastFollowedPoint.lat === point.lat && lastFollowedPoint.lng === point.lng) {
    return;
  }
  lastFollowedPoint = { ...point };
  leafletMap.setView([point.lat, point.lng], leafletMap.getZoom(), { animate: false });
}

function renderLeafletMap() {
  if (!leafletMap || !leafletLayers.trail || !leafletLayers.truck) {
    return;
  }
  const points = validTrailPoints();
  leafletLayers.trail.setLatLngs(routeConfigured ? points.map((point) => [point.lat, point.lng]) : []);

  const current = points[points.length - 1];
  if (!current) {
    leafletLayers.truck
      .setLatLng([ORIGIN.lat, ORIGIN.lng])
      .setOpacity(1)
      .setTooltipContent('Truk Canter FE 71 · titik awal');
    setLeafletTruckRotation(0);
    return;
  }

  leafletLayers.truck
    .setLatLng([current.lat, current.lng])
    .setOpacity(1)
    .setTooltipContent(`Truk Canter FE 71 · ${formatCoordinate(current)}`);
  setLeafletTruckRotation(0);
  focusLeafletTruck(current);
}

function appendFallbackTruck(point, rotation, label, subLabel) {
  const position = project(point);
  const truck = svgElement('g', {
    transform: `translate(${position.x.toFixed(1)} ${position.y.toFixed(1)}) rotate(${rotation.toFixed(1)})`
  });
  truckBodyNodes().forEach((node) => truck.appendChild(document.importNode(node, true)));

  const anchor = point === ORIGIN || point === DESTINATION && point.lng > MIN_LNG + 0.01 ? -1 : 1;
  const textX = anchor * 24;
  const labelElement = svgElement('text', {
    x: textX,
    y: -6,
    class: 'marker-label',
    'text-anchor': anchor < 0 ? 'end' : 'start'
  });
  labelElement.textContent = label;
  const subElement = svgElement('text', {
    x: textX,
    y: 10,
    class: 'marker-sub',
    'text-anchor': anchor < 0 ? 'end' : 'start'
  });
  subElement.textContent = subLabel;
  truck.appendChild(labelElement);
  truck.appendChild(subElement);
  el.markerLayer.appendChild(truck);
}

function renderFallbackMap() {
  const validTrail = validTrailPoints();
  if (!routeConfigured) {
    el.routeLayer.replaceChildren();
    el.markerLayer.replaceChildren();
    el.trailLayer.replaceChildren();
    const current = validTrail[validTrail.length - 1];
    appendFallbackTruck(current ?? ORIGIN, 0, 'Truk Canter FE 71', current ? formatCoordinate(current) : 'Menunggu GPS');
    return;
  }

  const routePoints = activeRoute.map((point) => {
    const position = project(point);
    return `${position.x.toFixed(1)},${position.y.toFixed(1)}`;
  }).join(' ');

  const routeFragment = document.createDocumentFragment();
  routeFragment.appendChild(svgElement('polyline', { points: routePoints, class: 'route-line' }));
  for (const segment of trafficSegments) {
    if (segment.level === 'lancar') {
      continue;
    }
    const points = trafficSegmentPoints(segment.index, trafficSegments.length).map((point) => {
      const position = project(point);
      return `${position.x.toFixed(1)},${position.y.toFixed(1)}`;
    }).join(' ');
    routeFragment.appendChild(svgElement('polyline', {
      points,
      class: 'traffic-segment',
      stroke: segment.level === 'heavy' ? '#ef6a55' : '#f2a93b'
    }));
  }
  el.routeLayer.replaceChildren(routeFragment);
  el.markerLayer.replaceChildren(
    createMarker(ORIGIN, 'origin-ring'),
    createMarker(DESTINATION, 'destination-ring')
  );

  if (validTrail.length > 1) {
    const trailPoints = validTrail.map((point) => {
      const position = project(point);
      return `${position.x.toFixed(1)},${position.y.toFixed(1)}`;
    }).join(' ');
    el.trailLayer.replaceChildren(svgElement('polyline', { points: trailPoints, class: 'trail-line' }));
  } else {
    el.trailLayer.replaceChildren();
  }

  const current = validTrail[validTrail.length - 1];
  if (!current) {
    appendFallbackTruck(ORIGIN, 0, 'Truk Canter FE 71', 'Titik awal');
    return;
  }

  appendFallbackTruck(current, 0, 'Truk Canter FE 71', formatCoordinate(current));
}

function renderMap() {
  if (mapMode === 'grid') {
    renderFallbackMap();
  } else if (mapMode === 'leaflet') {
    renderLeafletMap();
  }
}

function truckIconHtml() {
  return `<svg class="truck-svg" viewBox="-24 -19 48 38" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Posisi truk Canter FE 71" title="Ikon truk bergaya Shopee">${SHOPEE_TRUCK_BODY}</svg>`;
}

function truckBodyNodes() {
  const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${SHOPEE_TRUCK_BODY}</svg>`, 'image/svg+xml');
  return Array.from(doc.documentElement.childNodes);
}

function getRouteLatLngs() {
  return activeRoute.map((point) => [point.lat, point.lng]);
}

function buildTrafficSegments() {
  if (!routeConfigured || activeRoute.length < 2) {
    return [];
  }
  const count = Math.max(2, Math.min(12, activeRoute.length - 1));
  const levels = Array.from({ length: count }, () => 'lancar');
  const heavyStart = (trafficTick * 3 + 1) % count;
  levels[heavyStart] = 'heavy';
  levels[(heavyStart + 1) % count] = 'heavy';
  levels[(heavyStart + 2) % count] = 'moderate';
  levels[(heavyStart + 3) % count] = 'moderate';
  return levels.map((level, index) => ({ index, level }));
}

function trafficSegmentPoints(index, count) {
  const lastIndex = activeRoute.length - 1;
  const start = Math.floor((index * lastIndex) / count);
  const end = Math.floor(((index + 1) * lastIndex) / count);
  return activeRoute.slice(start, end + 1);
}

function updateTrafficStatus() {
  if (!routeConfigured) {
    el.trafficStatus.dataset.level = 'idle';
    el.trafficStatus.textContent = 'Menunggu rute';
    return;
  }
  const hasHeavy = trafficSegments.some((segment) => segment.level === 'heavy');
  const hasModerate = trafficSegments.some((segment) => segment.level === 'moderate');
  const level = hasHeavy ? 'heavy' : hasModerate ? 'moderate' : 'lancar';
  el.trafficStatus.dataset.level = level;
  el.trafficStatus.textContent = level === 'heavy'
    ? 'Lalu lintas: padat'
    : level === 'moderate'
      ? 'Lalu lintas: ramai'
      : 'Lalu lintas: lancar';
}

function renderTraffic() {
  trafficSegments = buildTrafficSegments();
  for (const layer of leafletLayers.traffic) {
    if (leafletMap) {
      leafletMap.removeLayer(layer);
    }
  }
  leafletLayers.traffic = [];

  if (mapMode === 'leaflet' && leafletMap && window.L) {
    for (const segment of trafficSegments) {
      if (segment.level === 'lancar') {
        continue;
      }
      const points = trafficSegmentPoints(segment.index, trafficSegments.length);
      const layer = window.L.polyline(points.map((point) => [point.lat, point.lng]), {
        color: segment.level === 'heavy' ? '#ef6a55' : '#f2a93b',
        weight: 6,
        opacity: 0.95,
        smoothFactor: 0
      }).addTo(leafletMap);
      leafletLayers.traffic.push(layer);
    }
  }

  if (mapMode === 'grid') {
    renderFallbackMap();
  }
  updateTrafficStatus();
}

function updateLeafletRouteLayers() {
  if (!leafletMap || mapMode !== 'leaflet' || !window.L) {
    return;
  }
  const layers = [leafletLayers.route, leafletLayers.trail, leafletLayers.origin, leafletLayers.destination].filter(Boolean);
  if (!routeConfigured) {
    layers.forEach((layer) => {
      if (leafletMap.hasLayer(layer)) {
        leafletMap.removeLayer(layer);
      }
    });
    return;
  }
  if (leafletLayers.route) {
    leafletLayers.route.setLatLngs(getRouteLatLngs());
  }
  if (leafletLayers.origin) {
    leafletLayers.origin.setLatLng([ORIGIN.lat, ORIGIN.lng]);
  }
  if (leafletLayers.destination) {
    leafletLayers.destination.setLatLng([DESTINATION.lat, DESTINATION.lng]);
  }
  layers.forEach((layer) => {
    if (!leafletMap.hasLayer(layer)) {
      layer.addTo(leafletMap);
    }
  });
}

async function syncActiveRouteToBackend() {
  try {
    const response = await fetch(`${REST_BASE}/api/v1/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: { lat: ORIGIN.lat, lng: ORIGIN.lng, label: ORIGIN.label, search: ORIGIN.search },
        destination: { lat: DESTINATION.lat, lng: DESTINATION.lng, label: DESTINATION.label, search: DESTINATION.search },
        coordinates: activeRoute.map((point) => [point.lng, point.lat]),
        source: activeRouteSource,
        client_route_id: activeRouteClientId
      })
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    appendLog('Rute aktif disinkronkan ke backend.');
  } catch (error) {
    appendLog(`Sinkronisasi rute ke backend gagal: ${error.message}`);
  }
}

function applyActiveRoute(data, options = {}) {
  const origin = data.origin || {};
  const destination = data.destination || {};
  const originLat = toNumber(origin.lat);
  const originLng = toNumber(origin.lng);
  const destinationLat = toNumber(destination.lat);
  const destinationLng = toNumber(destination.lng);
  if (originLat === null || originLng === null || destinationLat === null || destinationLng === null) {
    throw new Error('Titik awal atau titik tujuan tidak valid.');
  }

  const coordinates = (Array.isArray(data.coordinates) ? data.coordinates : [])
    .map((point) => {
      if (Array.isArray(point)) {
        return { lng: toNumber(point[0]), lat: toNumber(point[1]) };
      }
      return { lng: toNumber(point?.lng), lat: toNumber(point?.lat) };
    })
    .filter((point) => point.lng !== null && point.lat !== null);

  if (coordinates.length < 2) {
    throw new Error('Geometri rute tidak valid.');
  }

  routeConfigured = true;
  ORIGIN.lat = originLat;
  ORIGIN.lng = originLng;
  ORIGIN.label = typeof origin.label === 'string' && origin.label.trim() ? origin.label.trim() : formatCoordinate(ORIGIN);
  ORIGIN.search = typeof origin.search === 'string' && origin.search.trim() ? origin.search.trim() : formatCoordinate(ORIGIN);
  DESTINATION.lat = destinationLat;
  DESTINATION.lng = destinationLng;
  DESTINATION.label = typeof destination.label === 'string' && destination.label.trim() ? destination.label.trim() : formatCoordinate(DESTINATION);
  DESTINATION.search = typeof destination.search === 'string' && destination.search.trim() ? destination.search.trim() : formatCoordinate(DESTINATION);
  activeRoute = coordinates;
  activeRouteSource = typeof data.source === 'string' && data.source.trim() ? data.source.trim() : 'manual';
  activeRouteClientId = typeof data.client_route_id === 'string' && data.client_route_id.trim()
    ? data.client_route_id.trim()
    : null;
  activeRouteDistance = toNumber(data.distance);
  activeRouteGeometryLength = routeGeometryLengthMeters(activeRoute);
  trafficTick = 0;
  followTruck = true;

  el.originInput.value = ORIGIN.search;
  el.destinationInput.value = DESTINATION.search;
  hideSuggestions('origin');
  hideSuggestions('destination');
  updateProjectionBounds();
  updateLeafletRouteLayers();
  if (options.refit !== false && leafletMap && window.L) {
    leafletMap.fitBounds(window.L.latLngBounds(getRouteLatLngs()), { padding: [36, 36] });
  }
  renderTraffic();
  renderAll();
  if (options.sync !== false) {
    syncActiveRouteToBackend();
  }
}

function geocodeErrorDetail(error) {
  if (error?.name === 'AbortError') {
    return 'permintaan waktu habis';
  }
  return String(error?.message || error || 'kesalahan tidak diketahui')
    .replace(/^Nominatim\s*/i, '')
    .toLowerCase();
}

function buildGeocodeQuery(text) {
  const cleaned = String(text || '').trim().replace(/\s+/g, ' ');
  if (!cleaned || /\bindonesia\b/i.test(cleaned)) {
    return cleaned;
  }
  return `${cleaned}, Indonesia`;
}

function queueGeocode(query, externalSignal) {
  geocodeChain = geocodeChain.catch(() => {}).then(async () => {
    const waitMs = 1100 - (Date.now() - lastGeocodeAt);
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    lastGeocodeAt = Date.now();
    return geocodePlace(query, externalSignal);
  });
  return geocodeChain;
}

async function geocodePlace(query, externalSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  if (externalSignal) {
    externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  try {
    const url = `${NOMINATIM_SEARCH}?format=jsonv2&limit=5&addressdetails=1&accept-language=id&countrycodes=id&q=${encodeURIComponent(buildGeocodeQuery(query))}`;
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (response.status === 429) {
      throw new Error('kuota penemuan tempat habis');
    }
    if (response.status === 403) {
      throw new Error('layanan menolak permintaan');
    }
    if (response.status >= 500) {
      throw new Error('layanan sedang gangguan');
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const rows = await response.json();
    return rows
      .map((row) => {
        const lat = toNumber(row.lat);
        const lng = toNumber(row.lon ?? row.lng);
        const label = String(row.name || row.display_name || '').split(',')[0].trim();
        return { lat, lng, label: label || 'Lokasi', description: String(row.display_name || '') };
      })
      .filter((point) => point.lat !== null && point.lng !== null);
  } finally {
    clearTimeout(timeout);
  }
}

async function resolvePoint(text) {
  const coords = parseCoordinateInput(text);
  if (coords) {
    return { ...coords, description: 'Koordinat yang dimasukkan manual' };
  }
  const query = String(text || '').trim();
  if (!query) {
    throw new Error('Titik awal dan titik tujuan wajib diisi.');
  }
  let results;
  try {
    results = await queueGeocode(query);
  } catch (error) {
    throw new Error(
      `Pencarian nama tempat gagal (${geocodeErrorDetail(error)}). Masukkan koordinat lat, lng atau potongan tautan Maps.`
    );
  }
  if (results.length === 0) {
    throw new Error(`Tempat "${query}" tidak ditemukan. Masukkan koordinat lat, lng atau potongan tautan Maps.`);
  }
  return results[0];
}

async function fetchRouteGeometry(origin, destination) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const url = `${OSRM_ROUTE}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`;
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) {
      throw new Error('Layanan rute jalan sedang terganggu.');
    }
    const payload = await response.json();
    const route = Array.isArray(payload.routes) ? payload.routes[0] : null;
    const coordinates = route?.geometry?.type === 'LineString' && Array.isArray(route.geometry.coordinates)
      ? route.geometry.coordinates
        .map((point) => ({ lng: toNumber(point[0]), lat: toNumber(point[1]) }))
        .filter((point) => point.lng !== null && point.lat !== null)
      : [];
    if (!route || coordinates.length < 2) {
      throw new Error('Geometri jalan tidak tersedia.');
    }
    return { coordinates, distance: toNumber(route.distance), source: 'OSRM' };
  } catch (error) {
    const pesan = error?.name === 'AbortError'
      ? 'Layanan rute jalan tidak merespons tepat waktu; rute sementara memakai perkiraan garis lurus.'
      : 'Layanan rute jalan sedang tidak dapat dihubungi; rute sementara memakai perkiraan garis lurus.';
    appendLog(pesan);
    return {
      coordinates: [{ lat: origin.lat, lng: origin.lng }, { lat: destination.lat, lng: destination.lng }],
      distance: haversineMeters(origin, destination),
      source: 'fallback'
    };
  } finally {
    clearTimeout(timeout);
  }
}

function hideSuggestions(target) {
  const box = target === 'origin' ? el.originSuggestions : el.destinationSuggestions;
  box.hidden = true;
  box.replaceChildren();
}

function showSuggestionNotice(target, message) {
  const box = target === 'origin' ? el.originSuggestions : el.destinationSuggestions;
  const notice = document.createElement('div');
  notice.className = 'route-suggestion-info';
  notice.textContent = message;
  box.replaceChildren(notice);
  box.hidden = false;
}

function renderSuggestions(target, results) {
  const box = target === 'origin' ? el.originSuggestions : el.destinationSuggestions;
  const input = target === 'origin' ? el.originInput : el.destinationInput;
  box.replaceChildren();
  if (results.length === 0) {
    showSuggestionNotice(target, 'Tempat tidak ditemukan. Masukkan koordinat lat, lng atau potongan tautan Maps.');
    return;
  }
  for (const result of results.slice(0, 5)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'route-suggestion';
    button.textContent = result.label;
    const detail = document.createElement('small');
    detail.textContent = result.description || formatCoordinate(result);
    button.appendChild(detail);
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      input.value = formatCoordinate(result);
      hideSuggestions(target);
      setRouteHelper(`Titik ${target === 'origin' ? 'awal' : 'tujuan'} dipilih: ${result.label}`, 'ok');
    });
    box.appendChild(button);
  }
  box.hidden = results.length === 0;
}

async function loadSuggestions(target) {
  const input = target === 'origin' ? el.originInput : el.destinationInput;
  const query = input.value.trim();
  if (!query || parseCoordinateInput(query)) {
    hideSuggestions(target);
    return;
  }
  const token = ++suggestionTokens[target];
  try {
    const results = await queueGeocode(query);
    if (token === suggestionTokens[target]) {
      renderSuggestions(target, results);
    }
  } catch (error) {
    if (token === suggestionTokens[target]) {
      showSuggestionNotice(
        target,
        `Pencarian gagal (${geocodeErrorDetail(error)}). Masukkan koordinat lat, lng atau potongan tautan Maps.`
      );
    }
  }
}

function scheduleSuggestions(target) {
  clearTimeout(suggestionTimer);
  suggestionTimer = setTimeout(() => loadSuggestions(target), 320);
}

async function applyRouteFromInputs() {
  const requestId = ++routeRequestId;
  el.applyRouteButton.disabled = true;
  setRouteHelper('Mencari titik dan menyusun rute…');
  try {
    const originQuery = el.originInput.value.trim();
    const destinationQuery = el.destinationInput.value.trim();
    const origin = await resolvePoint(originQuery);
    const destination = await resolvePoint(destinationQuery);
    const geometry = await fetchRouteGeometry(origin, destination);
    if (requestId !== routeRequestId) {
      return;
    }
    const routeData = {
      ...geometry,
      origin: { ...origin, search: originQuery },
      destination: { ...destination, search: destinationQuery },
      client_route_id: `web-${++localRouteVersion}`
    };
    applyActiveRoute(routeData, { sync: false });
    await syncActiveRouteToBackend();
    if (requestId !== routeRequestId) {
      return;
    }
    applyActiveRoute(routeData, { sync: false, refit: false });
    const jarak = formatDistance(activeRouteDistance ?? haversineMeters(origin, destination));
    const sumberRute = activeRouteSource === 'OSRM' ? 'OSRM' : 'perkiraan garis lurus';
    setRouteHelper(`Rute aktif: ${ORIGIN.label} → ${DESTINATION.label} · ${jarak} · sumber ${sumberRute}.`, 'ok');
    appendLog(`Rute diterapkan: ${ORIGIN.label} → ${DESTINATION.label} (${sumberRute}, ${jarak}).`);
  } catch (error) {
    if (requestId === routeRequestId) {
      setRouteHelper(`Gagal menerapkan rute: ${error.message}`, 'error');
      appendLog(`Gagal menerapkan rute: ${error.message}`);
    }
  } finally {
    if (requestId === routeRequestId) {
      el.applyRouteButton.disabled = false;
    }
  }
}

function renderInstruments() {
  const metrics = getMetrics(latestTelemetry);
  const canBus = latestTelemetry?.can_bus || {};
  const sensors = latestTelemetry?.external_sensors || {};
  const satellites = numericCoordinate(latestTelemetry?.gps?.satellites ?? latestTelemetry?.satellites);
  const category = speedCategory(metrics.speed_kmh);
  const coolant = toNumber(canBus.coolant_temp_c);
  const transOil = toNumber(sensors.trans_oil_temp_c);
  const brakeVacuum = toNumber(sensors.brake_vacuum_kpa);

  el.speedValue.textContent = formatValue(metrics.speed_kmh, 0);
  el.speedCategory.textContent = category.label;
  el.speedCategory.dataset.level = category.level;
  el.rpmValue.textContent = formatValue(metrics.rpm, 0);
  el.odometerValue.textContent = formatValue(canBus.odometer_km, 1);
  el.fuelValue.textContent = formatValue(metrics.fuel_pct, 1);
  el.fuelLiters.textContent = formatValue(metrics.fuel_level_liters, 1);
  el.fuelBar.style.width = `${clamp(metrics.fuel_pct, 0, 100)}%`;
  el.coolantValue.textContent = coolant === null ? '—' : `${formatValue(coolant, 1)} °C`;
  el.coolantValue.dataset.state = coolant === null ? 'unknown' : coolant > 95 ? 'critical' : coolant > 85 ? 'warning' : 'normal';
  el.transOilValue.textContent = transOil === null ? '—' : `${formatValue(transOil, 1)} °C`;
  el.transOilValue.dataset.state = transOil === null ? 'unknown' : transOil > 110 ? 'critical' : transOil > 100 ? 'warning' : 'normal';
  el.brakeVacuumValue.textContent = formatValue(brakeVacuum, 1);

  const brakeFluidOk = sensors.brake_fluid_ok;
  el.brakeFluidValue.textContent = brakeFluidOk === true ? 'Normal' : brakeFluidOk === false ? 'Perlu periksa' : '—';
  el.brakeFluidValue.dataset.state = brakeFluidOk === true ? 'good' : brakeFluidOk === false ? 'critical' : 'unknown';

  el.satelliteText.textContent = satellites === null ? 'GPS belum tersedia' : `${satellites} satelit GPS`;
  el.lastSeen.textContent = latestTelemetry?.timestamp ? formatTime(latestTelemetry.timestamp) : '—';

  const currentPoint = extractGps(latestTelemetry);
  const localDistance = routeConfigured && currentPoint ? remainingRouteDistanceMeters(currentPoint, activeRoute) : null;
  const localDeviation = routeConfigured && currentPoint ? distanceToRouteMeters(currentPoint, activeRoute) : null;
  el.distanceToDestination.textContent = localDistance !== null
    ? formatDistance(localDistance)
    : routeConfigured && activeRouteDistance !== null
      ? formatDistance(activeRouteDistance)
      : '—';
  el.routeDeviation.textContent = localDeviation === null ? '—' : formatDistance(localDeviation);
  el.coordinateText.textContent = currentPoint
    ? `${currentPoint.lat.toFixed(5)}, ${currentPoint.lng.toFixed(5)}`
    : 'Koordinat belum tersedia';
}

function renderAlerts() {
  el.alertList.replaceChildren();
  const sorted = [...alerts]
    .sort((a, b) => new Date(b.detected_at) - new Date(a.detected_at) || numberOrZero(b.alert_id) - numberOrZero(a.alert_id))
    .slice(0, 12);

  if (sorted.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Belum ada notifikasi. Sistem memantau enam aturan anti-fraud.';
    el.alertList.appendChild(empty);
    return;
  }

  for (const alert of sorted) {
    const item = document.createElement('div');
    item.className = 'alert-item';
    item.dataset.severity = alert.severity || 'warning';

    const head = document.createElement('div');
    head.className = 'alert-item-head';
    const code = document.createElement('span');
    code.className = 'alert-code';
    code.textContent = alert.rule_code || 'ATRUAN';
    const time = document.createElement('span');
    time.className = 'alert-time';
    time.textContent = formatTime(alert.detected_at);
    head.appendChild(code);
    head.appendChild(time);

    const message = document.createElement('p');
    message.className = 'alert-message';
    message.textContent = alert.message_id || 'Notifikasi diterima.';

    const label = document.createElement('span');
    label.className = 'alert-label';
    label.textContent = alert.label || RULE_LABELS[alert.rule_code] || 'Peringatan sistem';

    item.appendChild(head);
    item.appendChild(message);
    item.appendChild(label);
    el.alertList.appendChild(item);
  }
}

function renderDtc() {
  el.dtcList.replaceChildren();
  const codes = Array.isArray(latestTelemetry?.can_bus?.dtc_codes) ? latestTelemetry.can_bus.dtc_codes : [];
  const uniqueCodes = [...new Set(codes.filter((code) => typeof code === 'string'))];

  if (uniqueCodes.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Tidak ada kode DTC aktif.';
    el.dtcList.appendChild(empty);
    return;
  }

  for (const code of uniqueCodes) {
    const entry = DTC_DICTIONARY[code];
    const item = document.createElement('div');
    item.className = 'dtc-item';

    const codeElement = document.createElement('span');
    codeElement.className = 'dtc-code';
    codeElement.textContent = code;
    item.appendChild(codeElement);

    const description = document.createElement('p');
    description.textContent = entry ? entry.description : 'Kode belum terdaftar dalam kamus DTC Euro 4 untuk mesin 4V21-2AT4.';
    item.appendChild(description);

    if (entry) {
      const action = document.createElement('p');
      action.className = 'dtc-action';
      action.textContent = `Rekomendasi: ${entry.action}`;
      item.appendChild(action);
    }

    el.dtcList.appendChild(item);
  }
}

function renderPayload() {
  const metrics = getMetrics(latestTelemetry);
  const overload = metrics.gvw_kg > GVW_LIMIT_KG;

  el.loadValue.textContent = formatValue(metrics.estimated_load_kg, 0);
  el.gvwValue.textContent = `${formatValue(metrics.gvw_kg, 0)} kg`;
  el.weightBar.style.width = `${clamp((metrics.gvw_kg / GVW_LIMIT_KG) * 100, 0, 100)}%`;
  el.weightBar.dataset.state = overload ? 'critical' : 'normal';
  el.weightStatus.textContent = overload ? 'Melebihi batas GVW' : 'Dalam batas aman';
  el.weightStatus.dataset.state = overload ? 'critical' : 'normal';

  renderAlerts();
  renderDtc();
}

function renderLog() {
  el.telemetryLog.replaceChildren();
  if (logLines.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Menunggu data telemetri dari simulator atau perangkat IoT.';
    el.telemetryLog.appendChild(empty);
    return;
  }
  for (const line of logLines.slice(-18)) {
    const element = document.createElement('p');
    element.className = 'log-line';
    element.textContent = line;
    el.telemetryLog.appendChild(element);
  }
}

function renderControl() {
  el.packetCount.textContent = String(packetCount);
  el.alertCount.textContent = String(alertCount);
  el.sourceLabel.textContent = latestTelemetry?.source || '—';
  renderLog();
}

function renderAll() {
  renderMap();
  renderInstruments();
  renderPayload();
  renderControl();
}

function appendLog(text) {
  const time = new Date().toLocaleTimeString('id-ID', { hour12: false });
  logLines.push(`[${time}] ${text}`);
  if (logLines.length > 60) {
    logLines.shift();
  }
  renderLog();
}

function setConnection(state, text) {
  el.connectionBadge.dataset.state = state;
  el.connectionText.textContent = text;
  el.socketStatus.textContent = text;
}

function handleRoute(data) {
  if (!data || !Array.isArray(data.coordinates) || data.coordinates.length < 2) {
    return;
  }
  const wasConfigured = routeConfigured;
  if (wasConfigured && activeRouteClientId && data.client_route_id && data.client_route_id !== activeRouteClientId) {
    // Izinkan sinkronisasi rute dari klien/tab lain atau dari database
    activeRouteClientId = data.client_route_id;
  }
  try {
    applyActiveRoute(data, { sync: false, refit: !wasConfigured });
    const jarak = formatDistance(activeRouteDistance ?? activeRouteGeometryLength);
    setRouteHelper(`Rute aktif: ${ORIGIN.label} → ${DESTINATION.label} · ${jarak}.`, 'ok');
    if (!wasConfigured && data.coordinates.length <= 4 && data.source !== 'OSRM') {
      upgradeInitialRouteWithOsrm();
    }
  } catch {
    appendLog('Rute dari server tidak dapat diterapkan.');
  }
}

let initialOsrmUpgraded = false;
async function upgradeInitialRouteWithOsrm() {
  if (initialOsrmUpgraded) {
    return;
  }
  initialOsrmUpgraded = true;
  try {
    const geometry = await fetchRouteGeometry(ORIGIN, DESTINATION);
    if (geometry.source === 'OSRM' && geometry.coordinates.length > 4) {
      applyActiveRoute({
        ...geometry,
        origin: { ...ORIGIN },
        destination: { ...DESTINATION },
        client_route_id: activeRouteClientId || 'web-init-osrm'
      }, { sync: true, refit: true });
      const jarak = formatDistance(activeRouteDistance ?? activeRouteGeometryLength);
      setRouteHelper(`Rute aktif: ${ORIGIN.label} → ${DESTINATION.label} · ${jarak} · sumber OSRM.`, 'ok');
    }
  } catch {
    // Tetap gunakan rute dari database jika OSRM gagal
  }
}

function handleSnapshot(data) {
  if (data?.route) {
    handleRoute(data.route);
  }
  const records = Array.isArray(data?.telemetry) ? data.telemetry : [];
  const snapshotAlerts = Array.isArray(data?.alerts) ? data.alerts : [];

  if (records.length > 0) {
    latestTelemetry = records[records.length - 1];
    trail = records
      .map(extractGps)
      .filter(Boolean)
      .slice(-80);
    packetCount = Math.max(packetCount, records.length);
  }

  alerts = snapshotAlerts.slice();
  alertCount = Math.max(alertCount, snapshotAlerts.length);
  updateProjectionBounds();
  renderAll();
  appendLog(`Snapshot WebSocket diterima: ${records.length} paket, ${snapshotAlerts.length} notifikasi.`);
}

function handleTelemetry(record) {
  if (!record || typeof record !== 'object') {
    return;
  }
  latestTelemetry = record;
  const currentPoint = extractGps(record);
  if (currentPoint) {
    trail.push(currentPoint);
    if (trail.length > 80) {
      trail.shift();
    }
    updateProjectionBounds();
  }
  packetCount += 1;
  const metrics = getMetrics(record);
  appendLog(
    `speed=${formatValue(metrics.speed_kmh, 0)} km/jam | solar=${formatValue(metrics.fuel_pct, 1)}% ` +
      `| muatan=${formatValue(metrics.estimated_load_kg, 0)} kg | sumber=${record.source || '—'}`
  );
  renderMap();
  renderInstruments();
  renderPayload();
  renderControl();
}

function handleAlert(alert) {
  if (!alert || typeof alert !== 'object') {
    return;
  }
  if (!alerts.some((item) => item.alert_id === alert.alert_id)) {
    alerts.unshift(alert);
    alerts = alerts.slice(0, 40);
    alertCount += 1;
    appendLog(`Notifikasi ${alert.rule_code}: ${alert.message_id || 'peringatan diterima'}`);
  }
  renderAlerts();
  renderControl();
}

function scheduleReconnect() {
  if (reconnectTimer !== null) {
    return;
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, 3000);
}

function connectWebSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  setConnection('connecting', 'Menghubungkan');
  socket = new WebSocket(WS_URL);

  socket.addEventListener('open', () => {
    setConnection('online', 'Terhubung');
    appendLog(`WebSocket terhubung ke ${WS_URL}.`);
  });

  socket.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'snapshot') {
        handleSnapshot(message.data);
      } else if (message.type === 'telemetry') {
        handleTelemetry(message.data);
      } else if (message.type === 'alert') {
        handleAlert(message.data);
      } else if (message.type === 'route') {
        handleRoute(message.data);
      }
    } catch {
      appendLog('Pesan WebSocket tidak dapat dibaca.');
    }
  });

  socket.addEventListener('close', () => {
    setConnection('offline', 'Terputus');
    appendLog('WebSocket terputus. Mencoba hubungkan ulang dalam 3 detik.');
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    setConnection('offline', 'Terputus');
  });
}

async function loadInitialFromRest() {
  try {
    const [telemetryResponse, alertResponse, routeResponse] = await Promise.all([
      fetch(`${REST_BASE}/api/v1/telemetry?limit=50`, { cache: 'no-store' }),
      fetch(`${REST_BASE}/api/v1/alerts?limit=50`, { cache: 'no-store' }),
      fetch(`${REST_BASE}/api/v1/route`, { cache: 'no-store' }).catch(() => null)
    ]);

    if (routeResponse && routeResponse.ok) {
      const routePayload = await routeResponse.json().catch(() => null);
      if (routePayload) {
        handleRoute(routePayload);
      }
    }

    if (!telemetryResponse.ok || !alertResponse.ok) {
      throw new Error('REST tidak tersedia');
    }

    const telemetryPayload = await telemetryResponse.json();
    const alertPayload = await alertResponse.json();
    const records = Array.isArray(telemetryPayload.data) ? telemetryPayload.data : [];
    const receivedAlerts = Array.isArray(alertPayload.data) ? alertPayload.data : [];

    if (records.length > 0) {
      latestTelemetry = records[records.length - 1];
      trail = records
        .map((record) => record?.gps)
        .filter((gps) => toNumber(gps?.lat) !== null && toNumber(gps?.lng) !== null)
        .slice(-80);
      packetCount = records.length;
    }
    alerts = receivedAlerts.slice();
    alertCount = receivedAlerts.length;
    updateProjectionBounds();
    renderAll();
    appendLog(`Data awal REST dimuat: ${records.length} paket, ${receivedAlerts.length} notifikasi.`);
  } catch {
    appendLog('REST tidak tersedia. Dashboard siap menerima data melalui WebSocket.');
  }
}

el.reconnectButton.addEventListener('click', () => {
  if (socket) {
    socket.close();
  } else {
    connectWebSocket();
  }
});

el.clearButton.addEventListener('click', () => {
  logLines = [];
  renderLog();
});

el.originInput.addEventListener('input', () => {
  hideSuggestions('origin');
  scheduleSuggestions('origin');
});
el.destinationInput.addEventListener('input', () => {
  hideSuggestions('destination');
  scheduleSuggestions('destination');
});
el.originInput.addEventListener('blur', () => setTimeout(() => hideSuggestions('origin'), 150));
el.destinationInput.addEventListener('blur', () => setTimeout(() => hideSuggestions('destination'), 150));
el.applyRouteButton.addEventListener('click', applyRouteFromInputs);

initMap();
renderTraffic();
trafficTimer = setInterval(() => {
  trafficTick += 1;
  renderTraffic();
}, 10_000);
renderAll();
loadInitialFromRest().finally(connectWebSocket);
