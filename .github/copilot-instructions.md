# Pedoman Teknis Proyek — PT Ade Pasir

Sistem telematika dan anti-fraud armada untuk **PT Ade Pasir**. Gunakan bahasa Indonesia untuk label antarmuka dan pesan notifikasi, serta bahasa Inggris untuk nama tabel, kolom, variabel, dan endpoint API.

## 1. Spesifikasi Kendaraan Target

- **Model:** Mitsubishi Fuso Canter FE 71
- **Tahun:** 2022 | **Emisi:** Euro 4 | **Konfigurasi:** 4x2
- **Mesin:** 4V21-2AT4
- **Transmisi:** Manual M025S5
- **Kapasitas tangki solar:** 70 liter
- **Tare awal:** 2750 kg (berat sasis & kabin: 2025 kg)
- **Batas GVW maksimum:** 5150 kg

## 2. Arsitektur Sistem

```
[IoT Device] --MQTT--> [Backend] --WebSocket--> [Frontend]
                          |
                     PostgreSQL + PostGIS
                          |
                     Rule Engine
```

- **Perangkat IoT:** ESP32-S3 + SIM7600E + CAN Bus OBD-II + sensor eksternal (suhu oli transmisi, tekanan vakum rem, tekanan hidrolik bak dump).
- **Protokol:** payload JSON dikirim setiap **3 detik** via MQTT ke topik `fleet/fe71/{vin}/telemetry`.
- **Backend:** memproses telemetri, menyimpan ke PostgreSQL + PostGIS, menjalankan Rule Engine, dan meny broadcast pembaruan real-time ke Frontend via WebSocket.
- **Frontend:** dashboard pemantauan armada dan notifikasi anti-fraud.
- **Simulator:** menghasilkan payload telemetri sintetis untuk pengujian, termasuk skenario pelanggaran.

## 3. Format JSON Telemetri

```json
{
  "vin": "MMBF71xxxxxxx",
  "timestamp": "2026-11-20T02:05:00Z",
  "gps": {
    "lat": -6.2088,
    "lng": 106.8456,
    "satellites": 12
  },
  "can_bus": {
    "speed_kmh": 0,
    "rpm": 0,
    "odometer_km": 12450.6,
    "coolant_temp_c": 87,
    "fuel_pct": 72.5,
    "dtc_codes": []
  },
  "external_sensors": {
    "trans_oil_temp_c": 78,
    "brake_vacuum_kpa": 65,
    "brake_fluid_ok": true,
    "hydraulic_bar": 0
  }
}
```

| Field | Tipe | Keterangan |
| --- | --- | --- |
| `vin` | string | Nomor identifikasi kendaraan unik |
| `timestamp` | ISO 8601 | Waktu pembacaan perangkat (UTC) |
| `gps.lat`, `gps.lng` | number | Koordinat WGS84 |
| `gps.satellites` | integer | Jumlah satelit GPS yang terkunci |
| `can_bus.speed_kmh` | number | Kecepatan kendaraan (km/jam) |
| `can_bus.rpm` | integer | Putaran mesin |
| `can_bus.odometer_km` | number | Odometer kumulatif (km) |
| `can_bus.coolant_temp_c` | number | Suhu coolant mesin (°C) |
| `can_bus.fuel_pct` | number | Level solar persentase (basis 70 liter) |
| `can_bus.dtc_codes` | string[] | Kode diagnostik CAN Bus |
| `external_sensors.trans_oil_temp_c` | number | Suhu oli transmisi (°C) |
| `external_sensors.brake_vacuum_kpa` | number | Tekanan vakum rem (kPa) |
| `external_sensors.brake_fluid_ok` | boolean | Status cairan rem |
| `external_sensors.hydraulic_bar` | number | Tekanan hidrolik bak dump (bar) |

## 4. Aturan Deteksi & Kesehatan Kendaraan

| Kode | Nama Notifikasi | Kondisi Pemicu |
| --- | --- | --- |
| `OVERSPEED` | Kecepatan Berlebih | `speed_kmh > 65` km/jam |
| `OVERLOAD` | Kelebihan Muatan | `(tare_weight_kg + estimated_load_kg) > 5150` kg |
| `ROUTE_DEVIATION` | Penyimpangan Rute | Jarak posisi aktual > 150 meter dari `planned_route` selama > 60 detik |
| `ILLEGAL_DUMP` | Pembuangan Ilegal | Tekanan hidrolik melonjak lalu turun, disertai penurunan estimasi muatan > 300 kg, saat jarak ke titik tujuan masih > 200 meter |
| `FUEL_THEFT` | Indikasi Pencurian Solar | Kendaraan diam (`speed_kmh == 0` dan `rpm == 0`) tetapi volume solar turun > 3 liter (basis 70 liter) dalam rentang 5 menit |
| `ENGINE_CRITICAL` | Mesin Kritis | `coolant_temp_c > 95` **atau** `trans_oil_temp_c > 110` **atau** `dtc_codes` tidak kosong |

Catatan implementasi:

- `estimated_load_kg` dihitung dari `GVW - tare_weight_kg`; `tare_weight_kg` awal = 2750 kg.
- Konversi volume solar: `fuel_liters = fuel_pct / 100 * 70`.
- `ROUTE_DEVIATION` dan `FUEL_THEFT` memerlukan evaluasi berbasis jendela waktu; simpan state pada Rule Engine, bukan pada payload tunggal.
- `ILLEGAL_DUMP` memerlukan deteksi pola tekanan hidrolik (naik → turun) dan korelasi dengan perubahan estimasi muatan serta jarak ke titik tujuan.
- Setiap pelanggaran menghasilkan notifikasi berbahasa Indonesia dan dicatat sebagai event di database.

## 5. Konvensi Penamaan

- **Bahasa Indonesia:** label antarmuka, pesan notifikasi, teks laporan.
- **Bahasa Inggris:** nama tabel, kolom, variabel, fungsi, topik MQTT, dan endpoint API (contoh: `/api/v1/telemetry`, `/api/v1/alerts`, `vehicle_events`, `fuel_level_liters`).
- Gunakan `snake_case` untuk kolom/variabel, `UPPER_SNAKE_CASE` untuk konstanta dan kode aturan, serta ISO 8601 UTC untuk seluruh timestamp.
