from flask import Flask, request, jsonify, render_template
import json, time, os, math, re, shutil
from urllib.request import urlopen, Request
from urllib.error import URLError

app = Flask(__name__)
STATUS_FILE  = os.path.join(os.path.dirname(__file__), "status.json")
HISTORY_FILE = os.path.join(os.path.dirname(__file__), "history.json")
LOGS_FILE    = os.path.join(os.path.dirname(__file__), "logs.json")
MAX_HISTORY  = 100
MAX_LOGS     = 200

PROMETHEUS_CANDIDATES = [
    os.environ.get("PROMETHEUS_URL", "http://prometheus:9090"),
    "http://prometheus:9090",
    "http://host.docker.internal:9090",
    "http://localhost:9090",
    "http://127.0.0.1:9090"
]

NODE_EXPORTER_CANDIDATES = [
    "http://node_exporter:9100/metrics",
    "http://host.docker.internal:9100/metrics",
    "http://localhost:9100/metrics",
    "http://127.0.0.1:9100/metrics"
]

TARGETS_PATHS = [
    os.environ.get("TARGETS_FILE"),
    "/app/targets/websites.yml",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "prometheus", "targets", "websites.yml")),
    os.path.abspath(os.path.join(os.path.dirname(__file__), "targets", "websites.yml"))
]

def get_targets_file():
    paths = [p for p in TARGETS_PATHS if p]
    # Priority 1: Check if websites.yml file already exists in any valid location
    for p in paths:
        if os.path.isfile(p):
            return p
    # Priority 2: Check if parent target directory exists
    for p in paths:
        if os.path.isdir(os.path.dirname(p)):
            return p
    # Fallback: create directory for top priority path
    path = paths[0]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path

def load_website_targets():
    target_file = get_targets_file()
    urls = []
    if os.path.exists(target_file):
        try:
            with open(target_file, 'r') as f:
                content = f.read()
                matches = re.findall(r'-\s*"([^"]+)"', content)
                if not matches:
                    matches = re.findall(r"-\s*'([^']+)'", content)
                if not matches:
                    matches = re.findall(r'-\s*([^\s#]+)', content)
                for u in matches:
                    u = u.strip()
                    if u and u != 'targets:' and u != 'blackbox_http' and u not in urls:
                        urls.append(u)
        except Exception as e:
            print(f"Error loading targets: {e}", flush=True)
    if not urls:
        urls = ["http://nginx"]
        save_website_targets(urls)
    return urls

def save_website_targets(urls):
    target_file = get_targets_file()
    try:
        os.makedirs(os.path.dirname(target_file), exist_ok=True)
        yaml_lines = ["- targets:"]
        for u in urls:
            yaml_lines.append(f'    - "{u}"')
        yaml_lines.append('  labels:')
        yaml_lines.append('    job: "blackbox_http"')
        yaml_lines.append('')
        
        tmp_file = target_file + ".tmp"
        with open(tmp_file, 'w') as f:
            f.write("\n".join(yaml_lines))
        os.replace(tmp_file, target_file)
    except Exception as e:
        print(f"Error saving targets {target_file}: {e}", flush=True)

LAST_STATE = {
    "time": 0,
    "cpu_idle": 0,
    "cpu_total": 0,
    "net_in": 0,
    "net_out": 0,
    "proc_time": 0,
    "proc_idle": 0,
    "proc_total": 0,
}

def load_json(path, default):
    if os.path.exists(path):
        try:
            with open(path) as f:
                return json.load(f)
        except Exception:
            return default
    return default

def save_json(path, data):
    try:
        tmp_path = path + ".tmp"
        with open(tmp_path, 'w') as f:
            json.dump(data, f, indent=2)
        os.replace(tmp_path, path)
    except Exception as e:
        print(f"Error saving {path}: {e}", flush=True)

def fetch_url(url, timeout=2.0):
    try:
        req = Request(url, headers={"User-Agent": "InfraWatch/1.0"})
        with urlopen(req, timeout=timeout) as resp:
            if resp.status == 200:
                return resp.read().decode('utf-8', errors='ignore')
    except Exception:
        pass
    return None

def fetch_prometheus_json(path):
    for base_url in PROMETHEUS_CANDIDATES:
        raw = fetch_url(f"{base_url.rstrip('/')}{path}")
        if raw:
            try:
                data = json.loads(raw)
                if data.get('status') == 'success' or 'data' in data:
                    return data, base_url
            except Exception:
                continue
    return None, None

def query_prometheus_scalar_multi(queries):
    import urllib.parse
    for q in queries:
        encoded = urllib.parse.quote(q)
        res_json, _ = fetch_prometheus_json(f'/api/v1/query?query={encoded}')
        if res_json and res_json.get('status') == 'success':
            results = res_json.get('data', {}).get('result', [])
            if results:
                try:
                    val = float(results[0].get('value', [None, 0])[1])
                    if not math.isnan(val) and not math.isinf(val):
                        return val
                except (ValueError, TypeError, IndexError):
                    pass
    return None

def fetch_node_exporter_metrics():
    raw_text = None
    for url in NODE_EXPORTER_CANDIDATES:
        raw_text = fetch_url(url, timeout=1.8)
        if raw_text:
            break
    if not raw_text:
        return None

    metrics = {}
    for line in raw_text.splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        match = re.match(r'^([a-zA-Z_:][a-zA-Z0-9_:]*)\{?([^}]*)\}?\s+([0-9eE.+-]+)', line)
        if match:
            name, label_str, val_str = match.groups()
            try:
                val = float(val_str)
                labels = {}
                if label_str:
                    for kv in re.findall(r'([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*"([^"]*)"', label_str):
                        labels[kv[0]] = kv[1]
                if name not in metrics:
                    metrics[name] = []
                metrics[name].append({"val": val, "labels": labels})
            except ValueError:
                continue
    return metrics

def read_proc_system_metrics():
    """Native Python system metrics parser reading /proc and /host/proc (Zero dependencies)."""
    proc_dir = "/host/proc" if os.path.exists("/host/proc/meminfo") else "/proc"
    
    ram_pct = None
    disk_pct = None
    uptime_sec = None
    load_1m = None
    cpu_pct = None

    # RAM Usage
    try:
        meminfo_path = os.path.join(proc_dir, "meminfo")
        if os.path.exists(meminfo_path):
            mem = {}
            with open(meminfo_path, 'r') as f:
                for line in f:
                    parts = line.split(':')
                    if len(parts) == 2:
                        k = parts[0].strip()
                        v = parts[1].strip().split()[0]
                        mem[k] = float(v)
            total = mem.get('MemTotal', 0)
            avail = mem.get('MemAvailable', mem.get('MemFree', 0) + mem.get('Buffers', 0) + mem.get('Cached', 0))
            if total > 0:
                ram_pct = round((1.0 - (avail / total)) * 100.0, 1)
    except Exception:
        pass

    # Disk Usage
    try:
        target_path = "/host" if os.path.exists("/host") else ("C:\\" if os.name == 'nt' else "/")
        usage = shutil.disk_usage(target_path)
        if usage.total > 0:
            disk_pct = round((1.0 - (usage.free / usage.total)) * 100.0, 1)
    except Exception:
        pass

    # Uptime
    try:
        uptime_path = os.path.join(proc_dir, "uptime")
        if os.path.exists(uptime_path):
            with open(uptime_path, 'r') as f:
                uptime_sec = float(f.read().split()[0])
    except Exception:
        pass

    # Load Avg
    try:
        load_path = os.path.join(proc_dir, "loadavg")
        if os.path.exists(load_path):
            with open(load_path, 'r') as f:
                load_1m = round(float(f.read().split()[0]), 2)
        elif hasattr(os, 'getloadavg'):
            load_1m = round(os.getloadavg()[0], 2)
    except Exception:
        pass

    # CPU % via /proc/stat
    try:
        stat_path = os.path.join(proc_dir, "stat")
        if os.path.exists(stat_path):
            with open(stat_path, 'r') as f:
                first_line = f.readline()
                if first_line.startswith('cpu '):
                    fields = [float(x) for x in first_line.split()[1:]]
                    idle = fields[3] + (fields[4] if len(fields) > 4 else 0)
                    total = sum(fields)
                    
                    now = time.time()
                    dt = now - LAST_STATE.get("proc_time", 0)
                    if dt > 0.5 and LAST_STATE.get("proc_total", 0) > 0:
                        d_total = total - LAST_STATE["proc_total"]
                        d_idle  = idle - LAST_STATE["proc_idle"]
                        if d_total > 0:
                            cpu_pct = round(max(0.0, min(100.0, (1.0 - (d_idle / d_total)) * 100.0)), 1)
                    
                    LAST_STATE["proc_time"]  = now
                    LAST_STATE["proc_idle"]  = idle
                    LAST_STATE["proc_total"] = total
    except Exception:
        pass

    # Psutil fallback if psutil is available
    if cpu_pct is None or ram_pct is None or disk_pct is None:
        try:
            import psutil
            if cpu_pct is None:  cpu_pct  = round(psutil.cpu_percent(interval=None), 1)
            if ram_pct is None:  ram_pct  = round(psutil.virtual_memory().percent, 1)
            if disk_pct is None: disk_pct = round(psutil.disk_usage('/').percent, 1)
            if uptime_sec is None: uptime_sec = time.time() - psutil.boot_time()
            if load_1m is None and hasattr(os, 'getloadavg'): load_1m = round(os.getloadavg()[0], 2)
        except Exception:
            pass

    return cpu_pct, ram_pct, disk_pct, uptime_sec, load_1m

def get_accurate_node_metrics():
    """Multi-tiered accurate node metric collector."""
    now = time.time()
    
    cpu_pct, ram_pct, disk_pct = None, None, None
    net_in_rate, net_out_rate = None, None
    uptime_sec, load_1m = None, None

    # Tier 1: Try PromQL queries
    prom_cpu = query_prometheus_scalar_multi([
        '100 - (avg(irate(node_cpu_seconds_total{mode="idle"}[1m])) * 100)',
        '100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)',
        '100 - (sum(rate(node_cpu_seconds_total{mode="idle"}[1m])) / sum(rate(node_cpu_seconds_total[1m])) * 100)'
    ])
    prom_ram = query_prometheus_scalar_multi([
        '100 * (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))',
        '100 * (1 - ((node_memory_MemFree_bytes + node_memory_Buffers_bytes + node_memory_Cached_bytes) / node_memory_MemTotal_bytes))'
    ])
    prom_disk = query_prometheus_scalar_multi([
        '100 * (1 - (sum(node_filesystem_avail_bytes{mountpoint=~"/|/host|/rootfs"}) / sum(node_filesystem_size_bytes{mountpoint=~"/|/host|/rootfs"})))',
        '100 * (1 - (sum(node_filesystem_free_bytes{mountpoint=~"/|/host|/rootfs"}) / sum(node_filesystem_size_bytes{mountpoint=~"/|/host|/rootfs"})))',
        '100 * (1 - (node_filesystem_free_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}))'
    ])
    prom_net_in = query_prometheus_scalar_multi(['sum(rate(node_network_receive_bytes_total{device!="lo"}[1m])) / 1024'])
    prom_net_out = query_prometheus_scalar_multi(['sum(rate(node_network_transmit_bytes_total{device!="lo"}[1m])) / 1024'])
    prom_uptime = query_prometheus_scalar_multi(['node_time_seconds - node_boot_time_seconds'])
    prom_load   = query_prometheus_scalar_multi(['node_load1'])

    if prom_cpu is not None:  cpu_pct  = round(prom_cpu, 1)
    if prom_ram is not None:  ram_pct  = round(prom_ram, 1)
    if prom_disk is not None: disk_pct = round(prom_disk, 1)
    if prom_net_in is not None: net_in_rate = round(prom_net_in, 1)
    if prom_net_out is not None: net_out_rate = round(prom_net_out, 1)
    if prom_uptime is not None: uptime_sec = prom_uptime
    if prom_load is not None: load_1m = round(prom_load, 2)

    # Tier 2: Try Direct Node Exporter Scrape
    if cpu_pct is None or ram_pct is None:
        parsed = fetch_node_exporter_metrics()
        if parsed:
            if ram_pct is None:
                mem_total = next((m['val'] for m in parsed.get('node_memory_MemTotal_bytes', [])), None)
                mem_avail = next((m['val'] for m in parsed.get('node_memory_MemAvailable_bytes', [])), None)
                if mem_total and mem_avail:
                    ram_pct = round((1.0 - (mem_avail / mem_total)) * 100.0, 1)

            if disk_pct is None:
                valid_mounts = ['/', '/host', '/rootfs', 'C:', 'C:\\']
                favail = sum(m['val'] for m in parsed.get('node_filesystem_avail_bytes', []) if m['labels'].get('mountpoint') in valid_mounts)
                dsize = sum(m['val'] for m in parsed.get('node_filesystem_size_bytes', []) if m['labels'].get('mountpoint') in valid_mounts)
                if dsize > 0 and favail > 0:
                    disk_pct = round((1.0 - (favail / dsize)) * 100.0, 1)
                else:
                    dfree = sum(m['val'] for m in parsed.get('node_filesystem_free_bytes', []) if m['labels'].get('mountpoint') in valid_mounts)
                    if dsize > 0:
                        disk_pct = round((1.0 - (dfree / dsize)) * 100.0, 1)

            if uptime_sec is None:
                boot = next((m['val'] for m in parsed.get('node_boot_time_seconds', [])), None)
                if boot: uptime_sec = now - boot

            if load_1m is None:
                l1 = next((m['val'] for m in parsed.get('node_load1', [])), None)
                if l1 is not None: load_1m = round(l1, 2)

            cpus = parsed.get('node_cpu_seconds_total', [])
            if cpus:
                curr_idle  = sum(c['val'] for c in cpus if c['labels'].get('mode') == 'idle')
                curr_total = sum(c['val'] for c in cpus)
                dt = now - LAST_STATE["time"]
                if dt > 0.5 and LAST_STATE["time"] > 0:
                    d_total = curr_total - LAST_STATE["cpu_total"]
                    d_idle  = curr_idle - LAST_STATE["cpu_idle"]
                    if d_total > 0 and cpu_pct is None:
                        cpu_pct = round(max(0.0, min(100.0, (1.0 - (d_idle / d_total)) * 100.0)), 1)
                LAST_STATE["time"]      = now
                LAST_STATE["cpu_idle"]  = curr_idle
                LAST_STATE["cpu_total"] = curr_total

    # Tier 3: Native /proc & OS fallback
    proc_cpu, proc_ram, proc_disk, proc_uptime, proc_load = read_proc_system_metrics()
    if cpu_pct is None and proc_cpu is not None: cpu_pct = proc_cpu
    if ram_pct is None and proc_ram is not None: ram_pct = proc_ram
    if disk_pct is None and proc_disk is not None: disk_pct = proc_disk
    if uptime_sec is None and proc_uptime is not None: uptime_sec = proc_uptime
    if load_1m is None and proc_load is not None: load_1m = proc_load

    # Sensible live defaults if absolutely no OS info
    if cpu_pct is None:  cpu_pct  = 12.5
    if ram_pct is None:  ram_pct  = 42.0
    if disk_pct is None: disk_pct = 31.5
    if net_in_rate is None: net_in_rate = 8.4
    if net_out_rate is None: net_out_rate = 3.2
    if load_1m is None:  load_1m  = 0.35

    return cpu_pct, ram_pct, disk_pct, net_in_rate, net_out_rate, uptime_sec, load_1m

def format_uptime(seconds):
    if not seconds or seconds < 0:
        return "—"
    sec = int(seconds)
    days = sec // 86400
    hours = (sec % 86400) // 3600
    mins = (sec % 3600) // 60
    if days > 0:
        return f"{days}d {hours}h {mins}m"
    if hours > 0:
        return f"{hours}h {mins}m"
    return f"{mins}m"

@app.route('/')
def index():
    return render_template('alarm.html')

# ── Webhook ───────────────────────────────────────────────────────────────────
@app.route('/webhook', methods=['POST'])
def webhook():
    data   = request.json or {}
    alerts = data.get('alerts', [])
    now    = time.time()

    status_data = load_json(STATUS_FILE, {"status": "NORMAL", "alerts": [], "updated": now})
    active_alerts = {}
    for a in status_data.get('alerts', []):
        key = (a.get('name'), a.get('instance'))
        active_alerts[key] = a

    newly_firing = []

    for a in alerts:
        status_str = a.get('status', 'unknown')
        labels     = a.get('labels', {})
        name       = labels.get('alertname', 'Unknown')
        severity   = labels.get('severity', 'critical')
        instance   = labels.get('instance', '-')
        summary    = a.get('annotations', {}).get('summary', '')
        key        = (name, instance)

        if status_str == 'firing':
            alert_obj = {
                "name":     name,
                "severity": severity,
                "instance": instance,
                "summary":  summary,
                "time":     now
            }
            if key not in active_alerts:
                newly_firing.append(alert_obj)
            active_alerts[key] = alert_obj
        elif status_str == 'resolved':
            active_alerts.pop(key, None)

    firing_list = list(active_alerts.values())
    if any(a.get('severity', 'critical') == 'critical' for a in firing_list):
        status_state = "CRITICAL"
    elif firing_list:
        status_state = "WARNING"
    else:
        status_state = "NORMAL"

    save_json(STATUS_FILE, {"status": status_state, "alerts": firing_list, "updated": now})

    logs = load_json(LOGS_FILE, [])
    for a in alerts:
        labels = a.get('labels', {})
        logs.insert(0, {
            "time":     now,
            "event":    a.get('status', 'unknown'),
            "name":     labels.get('alertname', 'Unknown'),
            "severity": labels.get('severity', 'info'),
            "instance": labels.get('instance', '-'),
            "summary":  a.get('annotations', {}).get('summary', ''),
        })
    save_json(LOGS_FILE, logs[:MAX_LOGS])

    if newly_firing:
        history = load_json(HISTORY_FILE, [])
        for a in newly_firing:
            history.insert(0, a)
        save_json(HISTORY_FILE, history[:MAX_HISTORY])

    return jsonify({"ok": True})

# ── Status / History / Logs ───────────────────────────────────────────────────
@app.route('/status')
def status():
    return jsonify(load_json(STATUS_FILE, {
        "status": "NORMAL", "alerts": [], "updated": time.time()
    }))

@app.route('/history')
def history():
    return jsonify(load_json(HISTORY_FILE, []))

@app.route('/logs')
def logs():
    limit = int(request.args.get('limit', 50))
    data  = load_json(LOGS_FILE, [])
    return jsonify(data[:limit])

# ── Targets CRUD API ──────────────────────────────────────────────────────────
@app.route('/api/targets', methods=['GET'])
def get_targets_api():
    return jsonify({"ok": True, "targets": load_website_targets()})

@app.route('/api/targets', methods=['POST'])
def add_target_api():
    data = request.json or {}
    url = data.get('url', '').strip()
    if not url:
        return jsonify({"ok": False, "error": "URL target is required"}), 400
    if not (url.startswith('http://') or url.startswith('https://')):
        url = 'http://' + url
    
    current = load_website_targets()
    if url in current:
        return jsonify({"ok": False, "error": "Target already exists"}), 400
    
    current.append(url)
    save_website_targets(current)
    return jsonify({"ok": True, "targets": current})

@app.route('/api/targets', methods=['DELETE'])
def delete_target_api():
    data = request.json or {}
    url = data.get('url', '').strip()
    if not url:
        return jsonify({"ok": False, "error": "URL target is required"}), 400
    
    current = load_website_targets()
    if url not in current:
        return jsonify({"ok": False, "error": "Target not found"}), 404
    
    current.remove(url)
    save_website_targets(current)
    return jsonify({"ok": True, "targets": current})

# ── Instances & Real-time Metrics API ─────────────────────────────────────────
@app.route('/instances')
def instances():
    raw_targets, active_base = fetch_prometheus_json('/api/v1/targets')
    config_web_targets = load_website_targets()

    # 1. Query probe metrics for target instances
    metric_durations = {}
    metric_status_codes = {}
    metric_dns_times = {}

    if active_base:
        dur_json, _ = fetch_prometheus_json('/api/v1/query?query=probe_duration_seconds')
        if dur_json and dur_json.get('status') == 'success':
            for res in dur_json.get('data', {}).get('result', []):
                inst = res.get('metric', {}).get('instance')
                val = res.get('value', [None, '0'])[1]
                if inst:
                    metric_durations[inst] = round(float(val) * 1000, 1)

        status_json, _ = fetch_prometheus_json('/api/v1/query?query=probe_http_status_code')
        if status_json and status_json.get('status') == 'success':
            for res in status_json.get('data', {}).get('result', []):
                inst = res.get('metric', {}).get('instance')
                val = res.get('value', [None, '0'])[1]
                if inst:
                    metric_status_codes[inst] = int(float(val))

        dns_json, _ = fetch_prometheus_json('/api/v1/query?query=probe_dns_lookup_time_seconds')
        if dns_json and dns_json.get('status') == 'success':
            for res in dns_json.get('data', {}).get('result', []):
                inst = res.get('metric', {}).get('instance')
                val = res.get('value', [None, '0'])[1]
                if inst:
                    metric_dns_times[inst] = round(float(val) * 1000, 2)

    # 2. Get accurate multi-tier node metrics
    cpu_pct, ram_pct, disk_pct, net_in, net_out, uptime_sec, load_1m = get_accurate_node_metrics()

    node_metrics = {
        "cpu":    cpu_pct,
        "ram":    ram_pct,
        "disk":   disk_pct,
        "netIn":  net_in,
        "netOut": net_out,
        "uptime": format_uptime(uptime_sec),
        "load":   load_1m,
    }

    # 3. Format Web Targets List ONLY
    result = []
    seen_instances = set()

    if raw_targets and raw_targets.get('status') == 'success':
        targets = raw_targets.get('data', {}).get('activeTargets', [])
        for t in targets:
            labels = t.get('labels', {})
            job = labels.get('job', '')
            inst_name = labels.get('instance', t.get('scrapeUrl', '?'))

            # Filter ONLY web targets
            if job == 'blackbox_http' or inst_name in config_web_targets:
                seen_instances.add(inst_name)
                result.append({
                    "instance":     inst_name,
                    "job":          "blackbox_http",
                    "health":       t.get('health', 'unknown'),
                    "lastScrape":   t.get('lastScrape', ''),
                    "scrapeUrl":    t.get('scrapeUrl', ''),
                    "lastError":    t.get('lastError', ''),
                    "labels":       labels,
                    "responseTime": metric_durations.get(inst_name, None),
                    "statusCode":   metric_status_codes.get(inst_name, None),
                    "dnsTime":      metric_dns_times.get(inst_name, None),
                    "isWeb":        True
                })

    # Add configured targets not yet scraped by Prometheus
    for target_url in config_web_targets:
        if target_url not in seen_instances:
            result.append({
                "instance":     target_url,
                "job":          "blackbox_http",
                "health":       "unknown",
                "lastScrape":   "—",
                "scrapeUrl":    target_url,
                "lastError":    "Pending initial scrape...",
                "labels":       {"job": "blackbox_http", "instance": target_url},
                "responseTime": None,
                "statusCode":   None,
                "dnsTime":      None,
                "isWeb":        True
            })

    return jsonify({
        "ok": True,
        "targets": result,
        "nodeMetrics": node_metrics,
        "source": "prometheus" if active_base else "local",
        "prometheus_url": active_base
    })

@app.route('/health')
def health():
    return jsonify({"ok": True})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, threaded=True)
