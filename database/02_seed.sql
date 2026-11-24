INSERT INTO vehicles (
    vin,
    vehicle_code,
    model_name,
    model_year,
    emission_standard,
    drivetrain,
    engine_code,
    transmission_code,
    fuel_tank_capacity_liters,
    tare_weight_kg,
    chassis_cabin_weight_kg,
    gvw_max_kg,
    is_active
) VALUES (
    'MMBF71E3VRK123456',
    'FUSO-FE71-001',
    'Mitsubishi Fuso Canter FE 71',
    2022,
    'Euro 4',
    '4x2',
    '4V21-2AT4',
    'M025S5',
    70,
    2750,
    2025,
    5150,
    true
)
ON CONFLICT (vin) DO NOTHING;

INSERT INTO dtc_dictionary (dtc_code, system_name, severity, description_id, recommended_action_id, applies_to_engine_code, is_active) VALUES
    ('P0101', 'Intake Air / MAF', 'warning', 'Sirkuit sensor MAF di luar kisaran atau kinerja tidak sesuai.', 'Periksa saluran udara dan konektor MAF, bersihkan elemen sensor, lalu uji ulang dengan scanner.', '4V21-2AT4', true),
    ('P0102', 'Intake Air / MAF', 'warning', 'Sinyal sensor MAF terlalu rendah terhadap kondisi putaran mesin.', 'Periksa kabel dan konektor MAF, pastikan tidak ada kebocoran udara sebelum sensor, ganti sensor bila rusak.', '4V21-2AT4', true),
    ('P0113', 'Intake Air Temperature', 'warning', 'Sinyal sensor suhu udara masuk terlalu tinggi.', 'Periksa konektor IAT dan suhu sekitar, uji resistansi sensor, ganti bila pembacaan tetap tinggi.', '4V21-2AT4', true),
    ('P0122', 'Throttle Position', 'warning', 'Sensor posisi throttle 1 memberikan sinyal terlalu rendah.', 'Periksa konektor dan rangkaian TPS, kalibrasi ulang posisi throttle, ganti sensor bila perlu.', '4V21-2AT4', true),
    ('P0191', 'Fuel Rail Pressure', 'critical', 'Tekanan rel solar di luar kisaran yang diharapkan ECM.', 'Periksa pompa injeksi, regulator tekanan, dan filter solar; uji tekanan rel dengan alat khusus.', '4V21-2AT4', true),
    ('P0193', 'Fuel Rail Pressure', 'critical', 'Sinyal sensor tekanan rel solar terlalu tinggi.', 'Periksa sensor tekanan rel dan rangkaiannya, pastikan regulator tidak macet, lakukan uji tekanan actual vs desired.', '4V21-2AT4', true),
    ('P0201', 'Fuel Injector Cylinder 1', 'critical', 'Gangguan sirkuit injektor silinder 1.', 'Periksa konektor dan hambatan injektor silinder 1, lakukan uji semprot dan ganti injektor bila rusak.', '4V21-2AT4', true),
    ('P0202', 'Fuel Injector Cylinder 2', 'critical', 'Gangguan sirkuit injektor silinder 2.', 'Periksa konektor dan hambatan injektor silinder 2, lakukan uji semprot dan ganti injektor bila rusak.', '4V21-2AT4', true),
    ('P0299', 'Turbocharger', 'warning', 'Tekanan boost turbo lebih rendah dari target (underboost).', 'Periksa selang charge air dan intercooler, periksa actuator wastegate, serta kondisi turbocharger.', '4V21-2AT4', true),
    ('P0335', 'Crankshaft Position Sensor', 'critical', 'Gangguan sirkuit sensor posisi crankshaft.', 'Periksa konektor, kabel, dan jarak sensor terhadap trigger wheel; ganti sensor bila sinyal tidak stabil.', '4V21-2AT4', true),
    ('P0340', 'Camshaft Position Sensor', 'critical', 'Gangguan sirkuit sensor posisi camshaft.', 'Periksa rangkaian dan pemasangan sensor camshaft, pastikan sinkronisasi timing masih benar.', '4V21-2AT4', true),
    ('P0401', 'EGR System', 'warning', 'Aliran gas EGR tidak mencukupi.', 'Periksa katup EGR, selang vacuum, dan saluran EGR dari karbon; bersihkan atau ganti komponen yang macet.', '4V21-2AT4', true),
    ('P0500', 'Vehicle Speed Sensor', 'warning', 'Sensor kecepatan kendaraan tidak memberikan sinyal yang valid.', 'Periksa konektor sensor kecepatan pada transmisi M025S5 dan rangkaian kabel; ganti sensor bila perlu.', '4V21-2AT4', true),
    ('P0562', 'Charging System', 'warning', 'Tegangan sistem kelistrikan terlalu rendah.', 'Periksa alternator, regulator, terminal baterai, dan konsumsi arus; lakukan uji tegangan saat mesin hidup.', '4V21-2AT4', true),
    ('P0606', 'Engine Control Module', 'critical', 'Gangguan internal prosesor modul kontrol mesin (ECM).', 'Lakukan uji diagnostik ECM, periksa tegangan suplai dan ground, lakukan flash atau ganti ECM sesuai prosedur pabrik.', '4V21-2AT4', true)
ON CONFLICT (dtc_code) DO NOTHING;

INSERT INTO trips (
    trip_code,
    vehicle_id,
    origin_name,
    destination_name,
    origin_location,
    destination_location,
    planned_route,
    planned_route_distance_km,
    estimated_load_kg,
    planned_start_at,
    planned_end_at,
    actual_start_at,
    status
) VALUES (
    'TRP-20261120-001',
    (SELECT vehicle_id FROM vehicles WHERE vin = 'MMBF71E3VRK123456'),
    'PT Ade Pasir - Cibolang Kaler, Cisaat, Kabupaten Sukabumi',
    'Lokasi Proyek PT Ade Pasir - Cibubur, Jakarta Timur',
    ST_SetSRID(ST_MakePoint(106.8763119, -6.9055104), 4326),
    ST_SetSRID(ST_MakePoint(106.8780, -6.3773), 4326),
    ST_SetSRID(ST_GeomFromText('LINESTRING(106.8763119 -6.9055104, 106.8655 -6.4471, 106.8712 -6.4124, 106.8780 -6.3773)'), 4326),
    58.9,
    2100,
    '2026-11-20 01:00:00+00',
    '2026-11-20 03:30:00+00',
    '2026-11-20 01:05:00+00',
    'in_progress'
)
ON CONFLICT (trip_code) DO NOTHING;

INSERT INTO active_routes (
    route_key,
    origin,
    destination,
    coordinates,
    source,
    client_route_id
) VALUES (
    'active',
    '{"lng":106.8763119,"lat":-6.9055104,"label":"PT Ade Pasir · Cibolang Kaler, Cisaat","search":"Cibolang Kaler, Sukabumi"}'::jsonb,
    '{"lng":106.8780,"lat":-6.3773,"label":"Proyek Cibubur","search":"Cibubur, Jakarta Timur"}'::jsonb,
    '[[106.8763119,-6.9055104],[106.8655,-6.4471],[106.8712,-6.4124],[106.8780,-6.3773]]'::jsonb,
    'manual',
    'web-seed'
)
ON CONFLICT (route_key) DO NOTHING;
