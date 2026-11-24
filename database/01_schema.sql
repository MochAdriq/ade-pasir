CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS vehicles (
    vehicle_id BIGSERIAL PRIMARY KEY,
    vin VARCHAR(32) NOT NULL UNIQUE,
    vehicle_code VARCHAR(32) NOT NULL UNIQUE,
    model_name VARCHAR(80) NOT NULL,
    model_year SMALLINT NOT NULL,
    emission_standard VARCHAR(16) NOT NULL,
    drivetrain VARCHAR(8) NOT NULL,
    engine_code VARCHAR(32) NOT NULL,
    transmission_code VARCHAR(32) NOT NULL,
    fuel_tank_capacity_liters NUMERIC(5,2) NOT NULL DEFAULT 70,
    tare_weight_kg NUMERIC(7,2) NOT NULL DEFAULT 2750,
    chassis_cabin_weight_kg NUMERIC(7,2) NOT NULL DEFAULT 2025,
    gvw_max_kg NUMERIC(7,2) NOT NULL DEFAULT 5150,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT vehicles_vin_format CHECK (vin ~ '^[A-Za-z0-9_-]{3,32}$'),
    CONSTRAINT vehicles_model_year_range CHECK (model_year BETWEEN 1990 AND 2100),
    CONSTRAINT vehicles_fuel_capacity_positive CHECK (fuel_tank_capacity_liters > 0),
    CONSTRAINT vehicles_weight_positive CHECK (tare_weight_kg > 0 AND gvw_max_kg > tare_weight_kg)
);

CREATE TABLE IF NOT EXISTS maintenance_logs (
    log_id BIGSERIAL PRIMARY KEY,
    vehicle_id BIGINT NOT NULL REFERENCES vehicles(vehicle_id) ON DELETE RESTRICT,
    service_date TIMESTAMPTZ NOT NULL,
    odometer_km NUMERIC(10,2) NOT NULL,
    service_type VARCHAR(24) NOT NULL,
    description_id TEXT NOT NULL,
    parts_replaced TEXT,
    cost_idr NUMERIC(14,2),
    technician_name VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT maintenance_logs_service_type CHECK (service_type IN ('routine', 'repair', 'inspection')),
    CONSTRAINT maintenance_logs_odometer_nonnegative CHECK (odometer_km >= 0)
);

CREATE TABLE IF NOT EXISTS dtc_dictionary (
    dtc_code VARCHAR(8) PRIMARY KEY,
    system_name VARCHAR(60) NOT NULL,
    severity VARCHAR(16) NOT NULL,
    description_id TEXT NOT NULL,
    recommended_action_id TEXT NOT NULL,
    applies_to_engine_code VARCHAR(32),
    is_active BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT dtc_dictionary_severity CHECK (severity IN ('info', 'warning', 'critical'))
);

CREATE TABLE IF NOT EXISTS trips (
    trip_id BIGSERIAL PRIMARY KEY,
    trip_code VARCHAR(40) NOT NULL UNIQUE,
    vehicle_id BIGINT NOT NULL REFERENCES vehicles(vehicle_id) ON DELETE RESTRICT,
    origin_name VARCHAR(120) NOT NULL,
    destination_name VARCHAR(120) NOT NULL,
    origin_location GEOMETRY(Point, 4326) NOT NULL,
    destination_location GEOMETRY(Point, 4326) NOT NULL,
    planned_route GEOMETRY(LineString, 4326) NOT NULL,
    planned_route_distance_km NUMERIC(8,2),
    estimated_load_kg NUMERIC(7,2) NOT NULL DEFAULT 0,
    planned_start_at TIMESTAMPTZ NOT NULL,
    planned_end_at TIMESTAMPTZ NOT NULL,
    actual_start_at TIMESTAMPTZ,
    actual_end_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'planned',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT trips_status CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled')),
    CONSTRAINT trips_load_nonnegative CHECK (estimated_load_kg >= 0),
    CONSTRAINT trips_time_order CHECK (planned_end_at > planned_start_at)
);

CREATE TABLE IF NOT EXISTS telemetry_logs (
    telemetry_id BIGSERIAL PRIMARY KEY,
    vehicle_id BIGINT NOT NULL REFERENCES vehicles(vehicle_id) ON DELETE RESTRICT,
    trip_id BIGINT REFERENCES trips(trip_id) ON DELETE SET NULL,
    recorded_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    position GEOMETRY(Point, 4326),
    satellite_count SMALLINT,
    speed_kmh NUMERIC(6,2),
    rpm INTEGER,
    odometer_km NUMERIC(10,2),
    coolant_temp_c NUMERIC(5,2),
    fuel_pct NUMERIC(5,2),
    fuel_level_liters NUMERIC(6,2),
    dtc_codes TEXT[] NOT NULL DEFAULT '{}',
    trans_oil_temp_c NUMERIC(5,2),
    brake_vacuum_kpa NUMERIC(6,2),
    brake_fluid_ok BOOLEAN,
    hydraulic_bar NUMERIC(6,2),
    tare_weight_kg NUMERIC(7,2),
    estimated_load_kg NUMERIC(7,2),
    gvw_kg NUMERIC(7,2),
    raw_payload JSONB,
    CONSTRAINT telemetry_logs_satellite_range CHECK (satellite_count BETWEEN 0 AND 50),
    CONSTRAINT telemetry_logs_speed_nonnegative CHECK (speed_kmh >= 0),
    CONSTRAINT telemetry_logs_rpm_nonnegative CHECK (rpm >= 0),
    CONSTRAINT telemetry_logs_fuel_pct_range CHECK (fuel_pct BETWEEN 0 AND 100),
    CONSTRAINT telemetry_logs_weight_nonnegative CHECK (estimated_load_kg >= 0)
);

ALTER TABLE telemetry_logs
    ADD COLUMN IF NOT EXISTS source VARCHAR(16),
    ADD COLUMN IF NOT EXISTS route_deviation_m NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS distance_to_destination_m NUMERIC(10,2);

CREATE TABLE IF NOT EXISTS fraud_alerts (
    alert_id BIGSERIAL PRIMARY KEY,
    vehicle_id BIGINT NOT NULL REFERENCES vehicles(vehicle_id) ON DELETE RESTRICT,
    trip_id BIGINT REFERENCES trips(trip_id) ON DELETE SET NULL,
    telemetry_id BIGINT REFERENCES telemetry_logs(telemetry_id) ON DELETE SET NULL,
    rule_code VARCHAR(24) NOT NULL,
    severity VARCHAR(16) NOT NULL,
    message_id TEXT NOT NULL,
    observed_value NUMERIC(12,2),
    threshold_value NUMERIC(12,2),
    details JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    detected_at TIMESTAMPTZ NOT NULL,
    acknowledged_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    CONSTRAINT fraud_alerts_rule_code CHECK (rule_code IN (
        'OVERSPEED',
        'OVERLOAD',
        'ROUTE_DEVIATION',
        'ILLEGAL_DUMP',
        'FUEL_THEFT',
        'ENGINE_CRITICAL'
    )),
    CONSTRAINT fraud_alerts_severity CHECK (severity IN ('info', 'warning', 'critical')),
    CONSTRAINT fraud_alerts_status CHECK (status IN ('open', 'acknowledged', 'resolved', 'false_positive'))
);

ALTER TABLE fraud_alerts
    ADD COLUMN IF NOT EXISTS label VARCHAR(80),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS active_routes (
    route_key VARCHAR(40) PRIMARY KEY,
    origin JSONB NOT NULL,
    destination JSONB NOT NULL,
    coordinates JSONB NOT NULL,
    source VARCHAR(40) NOT NULL DEFAULT 'manual',
    client_route_id VARCHAR(80),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicles_vin ON vehicles (vin);
CREATE INDEX IF NOT EXISTS idx_maintenance_vehicle_date ON maintenance_logs (vehicle_id, service_date DESC);
CREATE INDEX IF NOT EXISTS idx_dtc_dictionary_active ON dtc_dictionary (is_active, dtc_code);

CREATE INDEX IF NOT EXISTS idx_trips_vehicle ON trips (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_trips_planned_route_gix ON trips USING GIST (planned_route);
CREATE INDEX IF NOT EXISTS idx_trips_origin_gix ON trips USING GIST (origin_location);
CREATE INDEX IF NOT EXISTS idx_trips_destination_gix ON trips USING GIST (destination_location);
CREATE INDEX IF NOT EXISTS idx_trips_status ON trips (status, planned_start_at DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_vehicle_recorded_at ON telemetry_logs (vehicle_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_recorded_at ON telemetry_logs (recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_trip_recorded_at ON telemetry_logs (trip_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_position_gix ON telemetry_logs USING GIST (position);
CREATE INDEX IF NOT EXISTS idx_telemetry_dtc_codes_gin ON telemetry_logs USING GIN (dtc_codes);
CREATE INDEX IF NOT EXISTS idx_telemetry_raw_payload_gin ON telemetry_logs USING GIN (raw_payload jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_telemetry_source_recorded_at ON telemetry_logs (source, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_fraud_alerts_vehicle_detected_at ON fraud_alerts (vehicle_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_rule_detected_at ON fraud_alerts (rule_code, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_trip ON fraud_alerts (trip_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_status ON fraud_alerts (status, detected_at DESC);

CREATE OR REPLACE VIEW ml_telemetry_features AS
SELECT
    tl.telemetry_id,
    tl.vehicle_id,
    tl.trip_id,
    tl.recorded_at,
    tl.speed_kmh,
    tl.rpm,
    tl.odometer_km,
    tl.coolant_temp_c,
    tl.fuel_pct,
    tl.fuel_level_liters,
    tl.dtc_codes,
    cardinality(tl.dtc_codes) AS dtc_count,
    tl.trans_oil_temp_c,
    tl.brake_vacuum_kpa,
    tl.brake_fluid_ok,
    tl.hydraulic_bar,
    tl.tare_weight_kg,
    tl.estimated_load_kg,
    tl.gvw_kg,
    v.gvw_max_kg,
    CASE WHEN tl.speed_kmh = 0 AND tl.rpm = 0 THEN true ELSE false END AS is_stationary,
    CASE WHEN tl.speed_kmh > 65 THEN true ELSE false END AS is_overspeed,
    CASE WHEN (tl.tare_weight_kg + tl.estimated_load_kg) > v.gvw_max_kg THEN true ELSE false END AS is_overload,
    CASE WHEN tl.coolant_temp_c > 95 OR tl.trans_oil_temp_c > 110 OR cardinality(tl.dtc_codes) > 0 THEN true ELSE false END AS is_engine_critical,
    CASE WHEN t.trip_id IS NULL THEN NULL
         ELSE ST_Distance(tl.position::geography, t.planned_route::geography)
    END AS route_deviation_m,
    CASE WHEN t.trip_id IS NULL THEN NULL
         ELSE ST_Distance(tl.position::geography, t.destination_location::geography)
    END AS distance_to_destination_m
FROM telemetry_logs tl
JOIN vehicles v ON v.vehicle_id = tl.vehicle_id
LEFT JOIN trips t ON t.trip_id = tl.trip_id;
