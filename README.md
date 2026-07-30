# Infrastructure Monitoring Stack v2

Sistem monitoring infrastruktur enterprise berbasis Docker yang memantau kondisi server dan website secara **real-time** dengan pengujian alert ultra-responsif (**v2.0**).

Ketika terjadi gangguan—seperti CPU spike, RAM penuh, disk habis dalam 24 jam, atau website down—sistem akan mengevaluasi aturan dalam waktu **5 detik**, mengirim notifikasi ke Alertmanager dan **InfraWatch Console (Web App)**, serta mengaktifkan **alarm suara** dan **indikator visual**.

---

<img width="1917" height="902" alt="image" src="https://github.com/user-attachments/assets/5964b70d-3f60-426e-b583-1b4514878889" />
<img width="1917" height="896" alt="image" src="https://github.com/user-attachments/assets/8ac6f617-a9cf-4b19-8d34-b248685a4c5f" />
<img width="1917" height="892" alt="image" src="https://github.com/user-attachments/assets/eb3f91b8-c381-461e-83f4-39d78e533a9e" />
<img width="1917" height="897" alt="image" src="https://github.com/user-attachments/assets/266e6b4c-dcc2-4ef8-84b5-8f394ed8fcb6" />
<img width="1917" height="900" alt="image" src="https://github.com/user-attachments/assets/845c7df4-3088-4d96-b0bf-db35596b034d" />

---

• Stack ini adalah sistem “penjaga kesehatan” server dan website yang berjalan otomatis dalam Docker.

  Alur sederhananya:

  Server & Website
        ↓
  Pengumpul data
  (Node Exporter + Blackbox Exporter)
        ↓
  Prometheus: menyimpan dan mengecek kondisi
        ↓
  Alertmanager: memilah notifikasi
        ↓
  InfraWatch Console + Grafana
  (alarm, status, grafik)

  Komponen utamanya:

  - Docker Compose
    Ibarat “manajer gedung”. Menjalankan semua aplikasi monitoring sebagai container agar mudah dipasang, dijalankan, dan dipindahkan.

  - Node Exporter
    Bertugas mengambil kondisi server: penggunaan CPU, RAM, disk, jaringan, dan sebagainya. Ibarat sensor kesehatan pada mesin.

  - Blackbox Exporter
    Mengecek apakah website bisa diakses dan merespons dengan baik. Ibarat bot yang rutin membuka website untuk memastikan website tidak down.

  - Prometheus
    Pusat pengumpulan data. Prometheus mengambil data dari sensor setiap sekitar 2 detik, menyimpan riwayatnya, lalu mengevaluasi aturan alert. Contohnya:
    “CPU di atas 95%” atau “website tidak bisa diakses”.

  - Alertmanager
    Pengatur notifikasi. Saat Prometheus menemukan masalah, Alertmanager mengelompokkan alert dan mencegah notifikasi berlebihan. Misalnya, jika server
    benar-benar mati, alert CPU/RAM tidak perlu ikut membanjirkan dashboard.

  - InfraWatch Console (Python Flask)
    Dashboard utama buatan sendiri di localhost:5000. Menampilkan kondisi live, daftar website yang dipantau, riwayat insiden, serta alarm suara dan
    indikator merah saat ada masalah kritis. Website target juga bisa ditambah atau dihapus dari dashboard.

  - Grafana
    Menampilkan data dalam bentuk grafik dan dashboard yang lebih visual, misalnya tren CPU, RAM, disk, dan status website dari waktu ke waktu.

  - Nginx
    Contoh website/web server yang dipantau oleh sistem. Dalam implementasi nyata, ini bisa diganti atau ditambah dengan website produksi.

  Kalimat singkat untuk presentasi:

  > “Sistem ini bekerja seperti pusat keamanan digital. Sensor mengambil kondisi server dan website, Prometheus menganalisis data tersebut secara real-time,
  > Alertmanager menyaring peringatan, lalu Grafana dan InfraWatch menampilkan kondisi serta membunyikan alarm jika ada gangguan.”

  Nilai utamanya: masalah seperti website down, CPU terlalu tinggi, RAM penuh, atau disk hampir habis dapat dideteksi cepat—sekitar hitungan detik—sebelum
  berdampak lebih besar ke pengguna.

---

# Fitur Utama (v2 Enterprise Edition)

- **⚡ Ultra-Responsive Alerting**: Evaluasi rule interval dipercepat dari 30s ke **5s**, serta window rate dipercepat ke `[1m]` dan `irate()`. Deteksi gangguan terjadi dalam **10–30 detik** (sebelumnya 5–7 menit).
- **🚨 Multi-Tier Severity (Warning vs Critical)**:
  - **CPU**: `CPUUsageWarning` (>80%), `HighCPU` (>95%), `CPUSaturationLoadHigh` (Load/Core > 2.0).
  - **RAM**: `MemoryUsageWarning` (>80%), `HighMemoryUsage` (>92%), `SwapUsageHigh` (>80%).
  - **Disk**: `DiskSpaceWarning` (<15%), `DiskSpaceLow` (<5%), `DiskFillPredictive24h` (deteksi prediktif disk habis dalam 24 jam), `DiskInodeExhaustion`.
  - **Network & IO**: `DiskIOBusy`, `NetworkReceiveHigh`, `NetworkErrors`.
  - **Target Down**: `NodeExporterDown` (15s) & `PrometheusTargetDown` (15s).
- **🛡️ Alertmanager Inhibition Rules**: Otomatis menekan (suppress) alert resource turunan ketika `NodeExporterDown` aktif untuk mencegah alert storm.
- **🖥️ InfraWatch Web Console (`http://localhost:5000`)**: Dashboard interaktif berbasis Flask untuk monitoring live metrics, manajemen target web dinamis (Add/Remove target via UI), log kejadian, serta ekspor CSV incident history.

---

# Daftar Isi

- [Tech Stack](#tech-stack)
- [Persyaratan](#persyaratan)
- [Instalasi Docker](#instalasi-docker)
- [Clone Repository](#clone-repository)
- [Menjalankan Project](#menjalankan-project)
- [Akses Layanan](#akses-layanan)
- [Login Default](#login-default)
- [Import Dashboard Grafana](#import-dashboard-grafana)
- [Pengujian Monitoring](#pengujian-monitoring)
- [Maintenance](#maintenance)
- [Changelog v2](#changelog-v2)
- [Troubleshooting](#troubleshooting)

---

# Tech Stack

| Komponen | Versi | Deskripsi |
| --- | --- | --- |
| Docker Compose | v2 | Orchestration container |
| InfraWatch Console | v2.0 | Dashboard monitoring & alarm receiver (Python/Flask) |
| Prometheus | v2.54.1 | Time-series metrics collection & rule engine (5s evaluation) |
| Alertmanager | v0.27.0 | Routing, grouping & alert inhibition engine |
| Grafana | v11.1.0 | Dashboard visualisasi infrastruktur |
| Node Exporter | v1.8.2 | Host hardware metric collector |
| Blackbox Exporter | v0.25.0 | Dynamic HTTP/HTTPS & DNS availability probe |
| Nginx | Stable | Web server yang dimonitor |

---

# Persyaratan

Sistem operasi yang didukung:

- Ubuntu 22.04+
- Debian 12+
- WSL2 (Ubuntu)
- Linux Server

Pastikan perangkat memiliki:

- Git
- Docker Engine
- Docker Compose v2
- Koneksi internet

---

# Instalasi Docker

## 1. Update package

```bash
sudo apt update && sudo apt upgrade -y
```

---

## 2. Install Docker

Cara paling mudah menggunakan script resmi Docker.

```bash
curl -fsSL https://get.docker.com | sh
```

---

## 3. Tambahkan user ke grup Docker

Agar tidak perlu menggunakan `sudo` setiap menjalankan Docker.

```bash
sudo usermod -aG docker $USER
newgrp docker
```

Verifikasi instalasi.

```bash
docker --version
docker compose version
```

Jika kedua perintah menampilkan versi, maka Docker berhasil terpasang.

---

# Clone Repository

Clone repository.

```bash
git clone https://github.com/malvin1205/infra-monitoring-stack-v2.git
```

Masuk ke folder project (nama folder bebas, misalnya `infra-monitoring-stack` atau `infra-monitoring-stack-v2`):

```bash
cd infra-monitoring-stack-v2
```

---

# Menjalankan Project

Jalankan seluruh service.

```bash
docker compose up -d
```

Pastikan semua container berjalan.

```bash
docker compose ps
```

Output yang normal akan menampilkan nama container berikut (selalu konsisten terlepas dari nama folder utama):

- `alarm` (InfraWatch Console)
- `grafana`
- `prometheus`
- `alertmanager`
- `nginx`
- `node_exporter`
- `blackbox_exporter`

Apabila ada container yang berstatus **Exited**, cek log menggunakan:

```bash
docker compose logs
```

---

# Akses Layanan

| Layanan | URL | Deskripsi |
| --- | --- | --- |
| **InfraWatch Web Console** | http://localhost:5000 | Dashboard utama, alarm suara, live log, & manajemen web target |
| **Grafana** | http://localhost:3000 | Visualisasi grafik metrics & dashboard |
| **Prometheus** | http://localhost:9090 | Query metrics & status firing alert rules |
| **Alertmanager** | http://localhost:9093 | Status routing & alert inhibition |
| **Website (Nginx)** | http://localhost:8080 | Sample website yang dimonitor oleh Blackbox |
| **Node Exporter** | http://localhost:9100/metrics | Raw host metrics endpoint |
| **Blackbox Exporter** | http://localhost:9115 | Probe status endpoint |

---

# Login Default

| Field | Nilai |
| --- | --- |
| Username | `admin` |
| Password | `admin` |

> **Catatan:** Demi keamanan, segera ubah username dan password default apabila project digunakan selain untuk kebutuhan lokal.

---

# Import Dashboard Grafana

Masuk ke Grafana (`http://localhost:3000`):

```
Dashboards → Import
```

Import dashboard berikut:

| Dashboard | ID |
| --- | --- |
| Node Exporter Full | `1860` |
| Blackbox Exporter | `7587` |

---

# Pengujian Monitoring

## 1. Simulasi Website Down (Respon 10 Detik)

Hentikan container Nginx.

```bash
docker stop nginx
```

Tunggu ~10 detik. Alert **WebsiteDown** (Critical) akan langsung muncul di Alertmanager, Grafana, dan InfraWatch Web Console (`http://localhost:5000`) beserta suara alarm & beacon merah.

Untuk menghidupkan kembali:

```bash
docker start nginx
```

---

## 2. Simulasi CPU Tinggi (Respon 15-30 Detik)

Install stress-ng terlebih dahulu.

```bash
sudo apt install stress-ng -y
```

Kemudian jalankan stress test.

```bash
stress-ng --cpu 4 --timeout 60
```

Dalam 15-30 detik, alert **CPUUsageWarning** (>80%) atau **HighCPU** (>95%) akan memicu notifikasi di sistem monitoring.

---

## 3. Mengembalikan Kondisi Normal

```bash
docker compose restart
```

---

# Maintenance

Melihat status container.

```bash
docker compose ps
```

Melihat log secara real-time.

```bash
docker compose logs -f
```

Restart seluruh service.

```bash
docker compose restart
```

Menghentikan seluruh service.

```bash
docker compose down
```

Menghapus seluruh container beserta volume.

> **Perhatian:** Data Grafana dan Prometheus akan ikut terhapus.

```bash
docker compose down -v
```

---

# Changelog v2

### v2.0 Enterprise Release
- ⚡ **Enterprise Ultra-Responsive Alerting**: Pengurangan latensi evaluasi dari 30s ke 5s dan pengoperasian rate window `[1m]` & `irate()`. Deteksi insiden terjadi dalam 10-30 detik.
- 🚨 **Multi-Tier Severity Rules**: Penambahan tingkat keparahan Warning vs Critical untuk CPU, Memory, Swap, Disk Space, Disk Inode, Disk I/O, & Network.
- 🔮 **Predictive Disk Exhaustion**: Penambahan rule `DiskFillPredictive24h` (`predict_linear`) untuk mendeteksi disk habis dalam 24 jam secara presisi.
- 🛡️ **Alert Inhibition Engine**: Konfigurasi `inhibit_rules` di Alertmanager untuk otomatis menghentikan alert turunan jika host offline.
- 🖥️ **InfraWatch Web Console**: Peluncuran dashboard Flask v2 dengan visualisasi status multi-tier (`CRITICAL`, `WARNING`, `NORMAL`), dynamic target CRUD API, live log stream, & CSV export.

---

# Troubleshooting

## Prometheus gagal membaca file rules (`permission denied`)

```bash
sudo find . -type f \( -name "*.yml" -o -name "*.yaml" -o -name "*.conf" \) -exec chmod 644 {} \;
sudo find . -type d -exec chmod 755 {} \;
sudo chown -R $USER:$USER .
docker compose restart
```

---

## promtool tidak ditemukan

Karena Prometheus berjalan di dalam container Docker, jalankan:

```bash
docker exec -it prometheus promtool check rules /etc/prometheus/rules/resource.yml
```

Jangan menjalankan `promtool` langsung dari host.

---

## Docker Permission Denied

Jika muncul error:

```text
permission denied while trying to connect to the Docker daemon socket
```

Tambahkan user ke grup Docker.

```bash
sudo usermod -aG docker $USER
newgrp docker
```

---

## Container Tidak Berjalan

Cek status container.

```bash
docker compose ps
```

Lihat log container.

```bash
docker compose logs
```

Atau lihat log container tertentu.

```bash
docker compose logs prometheus
docker compose logs grafana
docker compose logs alertmanager
```

---
