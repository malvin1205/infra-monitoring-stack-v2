/**
 * InfraWatch — Server Monitor Dashboard
 * Multi-page navigation: Dashboard · Instances · Logs · History
 * ─────────────────────────────────────────────────────────────
 * Endpoints:
 *   GET /status      → { status, alerts, updated }
 *   GET /history     → [ { name, severity, instance, time, summary } ]
 *   GET /logs        → [ { time, event, name, severity, instance, summary } ]
 *   GET /instances   → { ok, targets: [ { instance, job, health, lastScrape, … } ] }
 *   GET /health      → { ok }
 *   POST /webhook    → (Alertmanager payload)
 */

/* ════════════════════════════════════════════════════════════════════════════
   ROUTER
   ════════════════════════════════════════════════════════════════════════════ */
class Router {
  constructor(pages) {
    this.pages = pages;   // { pageId: PageObject }
    this.current = null;
  }

  go(pageId) {
    if (this.current === pageId) return;
    this.current = pageId;

    // Swap visible page panels
    document.querySelectorAll('.page-content').forEach(el => {
      el.hidden = el.id !== `page-${pageId}`;
    });

    // Swap active nav (sidebar + mobile)
    document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(btn => {
      const active = btn.dataset.page === pageId;
      btn.classList.toggle('nav-item-active', active && btn.classList.contains('nav-item'));
      btn.classList.toggle('mobile-nav-active', active && btn.classList.contains('mobile-nav-item'));
      if (active) {
        btn.setAttribute('aria-current', 'page');
      } else {
        btn.removeAttribute('aria-current');
      }
    });

    // Update topbar title
    const titles = {
      dashboard: 'System Status',
      instances: 'Instances',
      logs: 'Alert Logs',
      history: 'Incident History',
    };
    const subs = {
      dashboard: 'System monitoring active',
      instances: 'Live scrape target status from Prometheus',
      logs: 'Real-time alert event stream',
      history: 'Full incident log',
    };
    document.getElementById('pageTitle').textContent = titles[pageId] || pageId;
    document.getElementById('subtitle').textContent = subs[pageId] || '';

    // Notify the page it was activated
    if (this.pages[pageId]?.onActivate) this.pages[pageId].onActivate();
  }
}


/* ════════════════════════════════════════════════════════════════════════════
   INSTANCES PAGE
   ════════════════════════════════════════════════════════════════════════════ */
class InstancesPage {
  constructor(monitor) {
    this.monitor = monitor;
    this.data = [];
    this.activeJob = 'all';
    this.searchQ = '';

    this.table = document.getElementById('instancesBody');
    this.countBadge = document.getElementById('instanceCount');
    this.metaEl = document.getElementById('instancesMeta');
    this.errorEl = document.getElementById('instancesError');
    this.errorMsg = document.getElementById('instancesErrorMsg');
    this.jobFilter = document.getElementById('instanceJobFilter');
    this.searchEl = document.getElementById('instanceSearch');

    this.statTotal = document.getElementById('instTotal');
    this.statUp = document.getElementById('instUp');
    this.statDown = document.getElementById('instDown');
    this.statUnknown = document.getElementById('instUnknown');
    this.navBadge = document.getElementById('instancesBadge');

    this.pollInterval = null;
    this.currentInterval = 2000;

    this._bindEvents();
  }

  _bindEvents() {
    document.getElementById('refreshInstances')
      .addEventListener('click', () => this.load());

    this.searchEl.addEventListener('input', () => {
      this.searchQ = this.searchEl.value.toLowerCase();
      this._render();
    });

    this.jobFilter.addEventListener('click', e => {
      const btn = e.target.closest('[data-filter]');
      if (!btn) return;
      this.activeJob = btn.dataset.filter;
      this.jobFilter.querySelectorAll('.filter-btn').forEach(b =>
        b.classList.toggle('filter-btn-active', b.dataset.filter === this.activeJob)
      );
      this._render();
    });

    const intervalSelect = document.getElementById('scrapeIntervalSelect');
    if (intervalSelect) {
      intervalSelect.addEventListener('change', (e) => {
        this.currentInterval = parseInt(e.target.value, 10) || 2000;
        this.startPolling(this.currentInterval);
        this.load();
      });
    }

    // Modal & Target management
    const openBtn = document.getElementById('openAddTargetModalBtn');
    if (openBtn) openBtn.addEventListener('click', () => this._openModal());

    const closeBtn = document.getElementById('closeAddTargetModal');
    if (closeBtn) closeBtn.addEventListener('click', () => this._closeModal());

    const cancelBtn = document.getElementById('cancelAddTargetBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => this._closeModal());

    const form = document.getElementById('addTargetForm');
    if (form) form.addEventListener('submit', (e) => this._submitAddTarget(e));

    this.table.addEventListener('click', (e) => {
      const delBtn = e.target.closest('.delete-target-btn');
      if (delBtn) {
        const url = delBtn.dataset.url;
        if (url) this._deleteTarget(url);
      }
    });
  }

  onActivate() {
    this.load();
    this.startPolling(this.currentInterval);
  }

  onDeactivate() {
    this.stopPolling();
  }

  startPolling(ms) {
    this.stopPolling();
    this.pollInterval = setInterval(() => this.load(), ms);
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async load() {
    try {
      const res = await fetch('/instances');
      const data = await res.json();

      if (!data.ok) {
        this._showError(data.error || 'Cannot reach Prometheus');
        return;
      }
      this.errorEl.classList.add('hidden');
      this.data = data.targets || [];
      this._updateJobFilters();
      this._updateStats();
      this._updateNodeMetrics(data.nodeMetrics);
      this._render();
      this.metaEl.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    } catch (e) {
      this._showError(e.message);
    }
  }

  _updateNodeMetrics(nm) {
    if (!nm) return;
    const cpuVal = document.getElementById('nodeCpuVal');
    const cpuBar = document.getElementById('nodeCpuBar');
    const ramVal = document.getElementById('nodeRamVal');
    const ramBar = document.getElementById('nodeRamBar');
    const diskVal = document.getElementById('nodeDiskVal');
    const diskBar = document.getElementById('nodeDiskBar');
    const netVal = document.getElementById('nodeNetVal');
    const uptimeVal = document.getElementById('nodeUptimeVal');
    const loadVal = document.getElementById('nodeLoadVal');

    const setGauge = (valEl, barEl, val) => {
      if (!valEl || !barEl) return;
      const isValid = val !== null && val !== undefined && !isNaN(val);
      valEl.textContent = isValid ? `${val}%` : '—';
      const pct = Math.min(100, Math.max(0, val || 0));
      barEl.style.width = `${pct}%`;
      if (pct > 88) {
        barEl.style.background = 'var(--red)';
      } else if (pct > 75) {
        barEl.style.background = 'var(--amber)';
      } else {
        barEl.style.background = 'var(--green)';
      }
    };

    setGauge(cpuVal, cpuBar, nm.cpu);
    setGauge(ramVal, ramBar, nm.ram);
    setGauge(diskVal, diskBar, nm.disk);

    if (netVal) { netVal.textContent = `↓${nm.netIn || 0} KB/s · ↑${nm.netOut || 0} KB/s`; }
    if (uptimeVal) { uptimeVal.textContent = nm.uptime || '—'; }
    if (loadVal) { loadVal.textContent = nm.load !== undefined ? nm.load : '—'; }
  }

  _showError(msg) {
    this.errorEl.classList.remove('hidden');
    this.errorMsg.textContent = msg;
    this.table.innerHTML = `<tr><td colspan="5" class="table-empty">
      <div class="empty-state">
        <div class="es-icon"><svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <path d="M14 2C7.37 2 2 7.37 2 14s5.37 12 12 12 12-5.37 12-12S20.63 2 14 2z" stroke="currentColor" stroke-width="1.5"/>
          <path d="M14 8v6M14 17v1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg></div>
        <div class="es-text">Cannot load instances — ${this._esc(msg)}</div>
      </div>
    </td></tr>`;
  }

  _updateJobFilters() {
    const jobs = ['all', ...new Set(this.data.map(t => t.job))];
    this.jobFilter.innerHTML = jobs.map(j =>
      `<button class="filter-btn${j === this.activeJob ? ' filter-btn-active' : ''}" data-filter="${j}">${j === 'all' ? 'All' : j}</button>`
    ).join('');
  }

  _updateStats() {
    const up = this.data.filter(t => t.health === 'up').length;
    const down = this.data.filter(t => t.health === 'down').length;
    const unknown = this.data.length - up - down;

    this.statTotal.textContent = this.data.length;
    this.statUp.textContent = up;
    this.statDown.textContent = down;
    this.statUnknown.textContent = unknown;

    // Show badge on nav if any are down
    const downBadge = String(down);
    if (down > 0) {
      this.navBadge.textContent = downBadge;
      this.navBadge.style.display = '';
    } else {
      this.navBadge.style.display = 'none';
    }
    const mobileBadge = document.getElementById('mobileInstancesBadge');
    if (mobileBadge) {
      if (down > 0) {
        mobileBadge.textContent = downBadge;
        mobileBadge.hidden = false;
      } else {
        mobileBadge.hidden = true;
      }
    }
  }

  _render() {
    let rows = this.data;

    // Filter by job
    if (this.activeJob !== 'all') {
      rows = rows.filter(t => t.job === this.activeJob);
    }

    // Filter by search
    if (this.searchQ) {
      rows = rows.filter(t =>
        t.instance.toLowerCase().includes(this.searchQ) ||
        t.job.toLowerCase().includes(this.searchQ)
      );
    }

    this.countBadge.textContent = rows.length;

    if (rows.length === 0) {
      this.table.innerHTML = `<tr><td colspan="8" class="table-empty">
        <div class="empty-state">
          <div class="es-icon"><svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <path d="M14 2C7.37 2 2 7.37 2 14s5.37 12 12 12 12-5.37 12-12S20.63 2 14 2z" stroke="currentColor" stroke-width="1.5"/>
            <path d="M14 8v6M14 17v1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg></div>
          <div class="es-text">No web targets configured. Click "Add Web Target" to monitor a site.</div>
        </div>
      </td></tr>`;
      return;
    }

    this.table.innerHTML = rows.map((t, i) => {
      const h = t.health || 'unknown';
      const scrapeAt = t.lastScrape ? this._relTime(t.lastScrape) : '—';
      const latency = (t.responseTime !== null && t.responseTime !== undefined) ? `<span class="inst-latency">${t.responseTime} ms</span>` : '<span style="color:var(--text-3)">—</span>';
      const code = (t.statusCode !== null && t.statusCode !== undefined)
        ? `<span class="inst-code ${t.statusCode >= 200 && t.statusCode < 400 ? 'code-ok' : 'code-err'}">${t.statusCode}</span>`
        : '<span style="color:var(--text-3)">—</span>';

      const errHtml = t.lastError
        ? `<span class="inst-error-msg" title="${this._esc(t.lastError)}">${this._esc(t.lastError.slice(0, 40))}…</span>`
        : '<span style="color:var(--teal)">Normal</span>';

      return `
        <tr class="inst-row inst-row-${h}" style="animation-delay:${i * 0.03}s">
          <td><span class="inst-health inst-health-${h}">${h}</span></td>
          <td class="inst-instance" title="${this._esc(t.scrapeUrl)}">
            ${this._esc(t.instance)}
            ${t.scrapeUrl ? `<a class="inst-link" href="${this._esc(t.scrapeUrl)}" target="_blank" rel="noopener" title="Open target">↗</a>` : ''}
          </td>
          <td class="inst-job">${this._esc(t.job)}</td>
          <td>${latency}</td>
          <td>${code}</td>
          <td class="inst-scrape">${scrapeAt}</td>
          <td>${errHtml}</td>
          <td>
            <button class="delete-target-btn" data-url="${this._esc(t.instance)}" title="Delete target">&times;</button>
          </td>
        </tr>`;
    }).join('');
  }

  _openModal() {
    const modal = document.getElementById('addTargetModal');
    const input = document.getElementById('targetUrlInput');
    const err = document.getElementById('addTargetError');
    if (err) err.classList.add('hidden');
    if (input) input.value = '';
    if (modal) modal.classList.remove('hidden');
    if (input) setTimeout(() => input.focus(), 50);
  }

  _closeModal() {
    const modal = document.getElementById('addTargetModal');
    if (modal) modal.classList.add('hidden');
  }

  async _submitAddTarget(e) {
    e.preventDefault();
    const input = document.getElementById('targetUrlInput');
    const err = document.getElementById('addTargetError');
    const submitBtn = document.getElementById('submitAddTargetBtn');
    const url = input ? input.value.trim() : '';

    if (!url) return;

    if (err) err.classList.add('hidden');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const res = await fetch('/api/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url })
      });
      const data = await res.json();
      if (!data.ok) {
        if (err) {
          err.textContent = data.error || 'Failed to add target';
          err.classList.remove('hidden');
        }
        return;
      }
      this._closeModal();
      this.load();
    } catch (ex) {
      if (err) {
        err.textContent = ex.message || 'Error communicating with server';
        err.classList.remove('hidden');
      }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  async _deleteTarget(url) {
    if (!confirm(`Are you sure you want to remove target "${url}"?`)) return;
    try {
      const res = await fetch('/api/targets', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url })
      });
      const data = await res.json();
      if (data.ok) {
        this.load();
      } else {
        alert(data.error || 'Failed to delete target');
      }
    } catch (ex) {
      alert(ex.message || 'Error deleting target');
    }
  }

  _relTime(iso) {
    try {
      const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
      if (diff < 5) return 'Just now';
      if (diff < 60) return `${diff}s ago`;
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      return `${Math.floor(diff / 3600)}h ago`;
    } catch { return '—'; }
  }

  _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}


/* ════════════════════════════════════════════════════════════════════════════
   LOGS PAGE
   ════════════════════════════════════════════════════════════════════════════ */
class LogsPage {
  constructor(monitor) {
    this.monitor = monitor;
    this.data = [];
    this.filter = 'all';
    this.searchQ = '';
    this.isLive = true;
    this.interval = null;
    this.seenCount = 0;  // for NEW badge

    this.stream = document.getElementById('logStream');
    this.searchEl = document.getElementById('logSearch');
    this.navBadge = document.getElementById('logsBadge');

    this._bindEvents();
  }

  _bindEvents() {
    document.querySelectorAll('[data-log-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.filter = btn.dataset.logFilter;
        document.querySelectorAll('[data-log-filter]').forEach(b =>
          b.classList.toggle('filter-btn-active', b.dataset.logFilter === this.filter)
        );
        this._render();
      });
    });

    this.searchEl.addEventListener('input', () => {
      this.searchQ = this.searchEl.value.toLowerCase();
      this._render();
    });

    document.getElementById('logLiveToggle').addEventListener('change', e => {
      this.isLive = e.target.checked;
      if (this.isLive) this.load();
    });

    document.getElementById('clearLogs').addEventListener('click', () => {
      this.data = [];
      this._render();
    });
  }

  onActivate() {
    this.navBadge.style.display = 'none';
    this.load();
    this._startPolling();
  }

  onDeactivate() { this._stopPolling(); }

  _startPolling() {
    this._stopPolling();
    this.interval = setInterval(() => {
      if (this.isLive) this.load();
    }, 5000);
  }

  _stopPolling() {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  }

  async load() {
    try {
      const res = await fetch('/logs?limit=100');
      const logs = await res.json();

      const prevCount = this.data.length;
      this.data = logs;

      // Show NEW badge if on different page and new entries arrived
      if (prevCount > 0 && logs.length > prevCount) {
        const diff = logs.length - prevCount;
        this.navBadge.textContent = `+${diff}`;
        this.navBadge.style.display = '';
        const mobileBadge = document.getElementById('mobileLogsBadge');
        if (mobileBadge) {
          mobileBadge.textContent = `+${diff}`;
          mobileBadge.hidden = false;
        }
        // Hide after 4s
        setTimeout(() => {
          this.navBadge.style.display = 'none';
          if (mobileBadge) mobileBadge.hidden = true;
        }, 4000);
      }

      this._render();
    } catch (e) {
      console.error('[Logs] load failed:', e);
    }
  }

  _render() {
    let rows = this.data;

    if (this.filter !== 'all') {
      rows = rows.filter(r => r.event === this.filter);
    }
    if (this.searchQ) {
      rows = rows.filter(r =>
        (r.name || '').toLowerCase().includes(this.searchQ) ||
        (r.instance || '').toLowerCase().includes(this.searchQ) ||
        (r.summary || '').toLowerCase().includes(this.searchQ)
      );
    }

    if (rows.length === 0) {
      this.stream.innerHTML = `
        <div class="empty-state">
          <div class="es-icon" aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <path d="M4 26V8a2 2 0 012-2h20a2 2 0 012 2v18" stroke="currentColor" stroke-width="1.5"/>
              <path d="M2 26h28M10 13h12M10 18h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </div>
          <div class="es-text">No log entries yet — waiting for webhooks…</div>
        </div>`;
      return;
    }

    this.stream.innerHTML = rows.map((r, i) => {
      const ev = r.event || 'unknown';
      const sev = (r.severity || 'info').toLowerCase();
      return `
        <div class="log-entry log-entry-${ev}" style="animation-delay:${Math.min(i, 20) * 0.02}s">
          <span class="log-time">${this._fmt(r.time)}</span>
          <span class="log-event log-event-${ev}">${ev}</span>
          <span class="log-name">${this._esc(r.name || '—')}</span>
          <span class="log-inst">${this._esc(r.instance || '—')}</span>
          <span class="log-sev log-sev-${sev}">${sev}</span>
          <span class="log-msg">${this._esc(r.summary || '—')}</span>
        </div>`;
    }).join('');
  }

  _fmt(ts) {
    if (!ts) return '—';
    const d = new Date(ts * 1000);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  }

  _esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}


/* ════════════════════════════════════════════════════════════════════════════
   HISTORY PAGE
   ════════════════════════════════════════════════════════════════════════════ */
class HistoryPage {
  constructor(monitor) {
    this.monitor = monitor;
    this.data = [];
    this.filter = 'all';
    this.searchQ = '';

    this.tableEl = document.getElementById('historyFullTable');
    this.badge = document.getElementById('historyBadge');
    this.metaEl = document.getElementById('historyMeta');
    this.navBadge = document.getElementById('historyNavBadge');
    this.searchEl = document.getElementById('historySearch');

    this.statTotal = document.getElementById('histTotal');
    this.statMonth = document.getElementById('histThisMonth');
    this.statCritical = document.getElementById('histCritical');
    this.statWarning = document.getElementById('histWarning');

    this._bindEvents();
  }

  _bindEvents() {
    document.querySelectorAll('[data-hist-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.filter = btn.dataset.histFilter;
        document.querySelectorAll('[data-hist-filter]').forEach(b =>
          b.classList.toggle('filter-btn-active', b.dataset.histFilter === this.filter)
        );
        this._render();
      });
    });

    this.searchEl.addEventListener('input', () => {
      this.searchQ = this.searchEl.value.toLowerCase();
      this._render();
    });

    document.getElementById('exportHistory').addEventListener('click', () => this._exportCSV());
  }

  onActivate() { this.load(); }

  async load() {
    try {
      const res = await fetch('/history');
      const data = await res.json();
      this.data = data;
      this._updateStats();
      this._render();
      this.metaEl.textContent = `${data.length} incident${data.length !== 1 ? 's' : ''} total`;
      // Nav badge
      if (data.length > 0) {
        this.navBadge.textContent = data.length;
        this.navBadge.style.display = '';
      } else {
        this.navBadge.style.display = 'none';
      }
    } catch (e) {
      console.error('[History] load failed:', e);
    }
  }

  _updateStats() {
    const now = new Date();
    const month = this.data.filter(i => {
      const d = new Date(i.time * 1000);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
    const crit = this.data.filter(i => (i.severity || '').toLowerCase() === 'critical').length;
    const warn = this.data.filter(i => (i.severity || '').toLowerCase() === 'warning').length;

    this.statTotal.textContent = this.data.length;
    this.statMonth.textContent = month;
    this.statCritical.textContent = crit;
    this.statWarning.textContent = warn;
  }

  _render() {
    let rows = this.data;

    if (this.filter !== 'all') {
      rows = rows.filter(r => (r.severity || '').toLowerCase() === this.filter);
    }
    if (this.searchQ) {
      rows = rows.filter(r =>
        (r.name || '').toLowerCase().includes(this.searchQ) ||
        (r.instance || '').toLowerCase().includes(this.searchQ) ||
        (r.summary || '').toLowerCase().includes(this.searchQ)
      );
    }

    this.badge.textContent = rows.length;

    if (rows.length === 0) {
      this.tableEl.innerHTML = `
        <div class="empty-state">
          <div class="es-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <path d="M6 22V8a2 2 0 012-2h12a2 2 0 012 2v14" stroke="currentColor" stroke-width="1.5"/>
              <path d="M3 22h22M10 11h8M10 15h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </div>
          <div class="es-text">No incidents match your filter</div>
        </div>`;
      return;
    }

    this.tableEl.innerHTML = rows.map((inc, i) => {
      const sev = (inc.severity || 'critical').toLowerCase();
      return `
        <div class="history-row history-row-full" style="animation-delay:${Math.min(i, 30) * 0.025}s">
          <div class="history-time">${this._fmt(inc.time)}</div>
          <div class="history-name">${this._esc(inc.name || 'Unknown')}</div>
          <div class="history-instance">${this._esc(inc.instance || '—')}</div>
          <div><span class="history-sev ${sev}">${sev}</span></div>
          <div class="history-col-summary">${this._esc(inc.summary || '—')}</div>
        </div>`;
    }).join('');
  }

  _fmt(ts) {
    if (!ts) return '—';
    const d = new Date(ts * 1000);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    return `${hh}:${mm} · ${dd}/${mo}`;
  }

  _exportCSV() {
    const header = 'Time,Alert,Instance,Severity,Summary\n';
    const rows = this.data.map(r =>
      [this._fmt(r.time), r.name, r.instance, r.severity, r.summary]
        .map(v => `"${String(v || '').replace(/"/g, '""')}"`)
        .join(',')
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `infrawatch-history-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  _esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}


/* ════════════════════════════════════════════════════════════════════════════
   MAIN MONITOR (Dashboard + coordination)
   ════════════════════════════════════════════════════════════════════════════ */
class ServerMonitor {
  constructor() {
    this.isMuted = false;
    this.isInitialized = false;
    this.statusCheckInterval = null;
    this.historyCheckInterval = null;

    // ── DOM refs ──────────────────────────────────
    this.overlay = document.getElementById('initOverlay');
    this.dashboard = document.getElementById('dashboard');
    this.initBtn = document.getElementById('initBtn');

    this.heroCard = document.getElementById('heroCard');
    this.beaconRing = document.getElementById('beaconRing');
    this.beaconCore = document.getElementById('beaconCore');
    this.statusText = document.getElementById('statusText');
    this.heroDesc = document.getElementById('heroDesc');
    this.statusMeta = document.getElementById('statusMeta');

    this.alertCount = document.getElementById('alertCount');
    this.uptimeDays = document.getElementById('uptimeDays');
    this.incidentCount = document.getElementById('incidentCount');
    this.alertBar = document.getElementById('alertBar');
    this.incidentBar = document.getElementById('incidentBar');
    this.uptimeBar = document.getElementById('uptimeBar');

    this.alertsList = document.getElementById('alertsList');
    this.alertBadge = document.getElementById('alertBadge');

    this.historyTable = document.getElementById('historyTable');
    this.historyCount = document.getElementById('historyCount');

    this.soundToggle = document.getElementById('soundToggle');
    this.soundLabel = document.getElementById('soundLabel');
    this.testBtn = document.getElementById('testBtn');
    this.audioWarning = document.getElementById('audioWarning');
    this.alarmAudio = document.getElementById('alarmAudio');

    this.netIndicator = document.getElementById('netIndicator');
    this.healthIndicator = document.getElementById('healthIndicator');
    this.subtitle = document.getElementById('subtitle');

    // ── Sub-pages ─────────────────────────────────
    this.instancesPage = new InstancesPage(this);
    this.logsPage = new LogsPage(this);
    this.historyPage = new HistoryPage(this);

    // ── Router ────────────────────────────────────
    this.router = new Router({
      dashboard: this,
      instances: this.instancesPage,
      logs: this.logsPage,
      history: this.historyPage,
    });

    this._bindEvents();
  }

  /* ── Event binding ─────────────────────────────── */
  _bindEvents() {
    this.initBtn.addEventListener('click', () => this.initialize());
    this.soundToggle.addEventListener('change', (e) => this.toggleSound(e.target.checked));
    this.testBtn.addEventListener('click', () => this.testAlarm());
    this.audioWarning.addEventListener('click', () => this.unlockAudio());

    // Nav buttons (sidebar + mobile)
    document.querySelectorAll('.nav-item[data-page], .mobile-nav-item[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pageId = btn.dataset.page;
        // Deactivate previous sub-page polling
        const prev = this.router.current;
        if (prev && prev !== 'dashboard') {
          const prevPage = this[`${prev}Page`];
          if (prevPage?.onDeactivate) prevPage.onDeactivate();
        }
        this.router.go(pageId);
      });
    });
  }

  /* ── Boot ──────────────────────────────────────── */
  initialize() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    this.overlay.setAttribute('aria-hidden', 'true');
    this.overlay.style.display = 'none';
    this.dashboard.removeAttribute('hidden');

    const mobileNav = document.querySelector('.mobile-nav');
    if (mobileNav) mobileNav.removeAttribute('hidden');

    this.unlockAudio();
    this.router.go('dashboard');

    this.checkStatus();
    this.loadHistory();
    this.statusCheckInterval = setInterval(() => this.checkStatus(), 2000);
    this.historyCheckInterval = setInterval(() => this.loadHistory(), 8000);
  }

  /* ── onActivate (dashboard page) ───────────────── */
  onActivate() { /* already polling */ }

  /* ── Time helpers ──────────────────────────────── */
  formatTimeAgo(ts) {
    const diff = Math.max(0, Math.floor(Date.now() / 1000) - ts);
    if (diff < 5) return 'Just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  formatTime(ts) {
    const d = new Date(ts * 1000);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    return `${hh}:${mm} · ${dd}/${mo}`;
  }

  /* ── Status fetch ──────────────────────────────── */
  async checkStatus() {
    try {
      const res = await fetch('/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      this._setNetIndicator(true);
      const alerts = data.alerts || [];
      const statusState = data.status || 'NORMAL'; // 'CRITICAL', 'WARNING', 'NORMAL'

      this._setHealthIndicator(statusState);
      this._updateHero(statusState, alerts);
      this._updateMetricAlerts(alerts.length);

      const ago = this.formatTimeAgo(data.updated || Math.floor(Date.now() / 1000));
      this.statusMeta.textContent = `Updated ${ago}`;
    } catch (err) {
      console.error('[InfraWatch] Status check failed:', err);
      this._setNetIndicator(false);
      this.statusText.textContent = 'ERROR';
      this.heroDesc.textContent = 'Failed to reach server';
    }
  }

  /* ── Hero section update ───────────────────────── */
  _updateHero(statusState, alerts) {
    const isCritical = statusState === 'CRITICAL';
    const isWarning  = statusState === 'WARNING';
    const label      = isCritical ? 'CRITICAL' : (isWarning ? 'WARNING' : 'NORMAL');

    this.statusText.textContent = label;
    this.statusText.classList.toggle('critical', isCritical);
    this.statusText.classList.toggle('warning', isWarning);

    this.heroCard.classList.toggle('critical', isCritical);
    this.heroCard.classList.toggle('warning', isWarning);

    this.beaconCore.classList.toggle('critical', isCritical);
    this.beaconCore.classList.toggle('warning', isWarning);

    this.beaconRing.classList.toggle('critical', isCritical);
    this.beaconRing.classList.toggle('warning', isWarning);

    this.heroDesc.textContent = isCritical
      ? `${alerts.length} active critical alert${alerts.length !== 1 ? 's' : ''} — immediate attention required`
      : (isWarning
          ? `${alerts.length} warning alert${alerts.length !== 1 ? 's' : ''} — investigation recommended`
          : 'All systems operational');

    this._renderAlerts(alerts);
    this.alertCount.textContent = String(alerts.length).padStart(2, '0');
    this.alertBadge.textContent = alerts.length;
    this.alertBadge.classList.toggle('badge-hidden', alerts.length === 0);

    // Sound control: Sound alarm on Critical alerts
    if (isCritical && !this.isMuted) {
      this.playAlarm();
    } else {
      this.stopAlarm();
    }
  }

  /* ── Alert rendering ───────────────────────────── */
  _renderAlerts(alerts) {
    if (alerts.length === 0) {
      this.alertsList.innerHTML = `
        <div class="empty-state">
          <div class="es-icon" aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="13" stroke="currentColor" stroke-width="1.5"/>
              <path d="M11 16l4 4 6-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="es-text">No active alerts — everything is quiet</div>
        </div>`;
      return;
    }

    this.alertsList.innerHTML = alerts.map((a) => {
      const name = this._esc(a.name || 'Unknown Alert');
      const inst = this._esc(a.instance || '');
      const summary = this._esc(a.summary || '');
      const sev = (a.severity || 'critical').toLowerCase();
      const timeStr = a.time ? `Triggered ${this.formatTimeAgo(a.time)}` : '';

      return `
        <div class="alert-item">
          <div class="alert-icon" aria-hidden="true">▲</div>
          <div class="alert-content">
            <div class="alert-title">${name}${inst ? ` · <span style="font-weight:400;color:var(--text-2)">${inst}</span>` : ''}</div>
            ${summary ? `<div class="alert-desc">${summary}</div>` : ''}
            <div class="alert-meta">
              ${timeStr ? `<span class="alert-time">${timeStr}</span>` : ''}
              <span class="alert-sev ${sev}">${sev}</span>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  /* ── History fetch (for dashboard mini-panel) ── */
  async loadHistory() {
    try {
      const res = await fetch('/history');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const incidents = await res.json();

      const uptimeDays = this._calcUptimeDays(incidents);
      if (uptimeDays !== null) {
        this.uptimeDays.textContent = String(uptimeDays).padStart(3, '0');
        if (this.uptimeBar) {
          this.uptimeBar.style.width = `${Math.min(100, (uptimeDays / 30) * 100)}%`;
        }
      } else {
        this.uptimeDays.textContent = '—';
        if (this.uptimeBar) this.uptimeBar.style.width = '0%';
      }

      const monthCount = this._countMonthIncidents(incidents);
      this.incidentCount.textContent = String(monthCount).padStart(2, '0');

      if (this.incidentBar) {
        this.incidentBar.style.width = `${Math.min(100, (monthCount / 20) * 100)}%`;
      }

      this.historyCount.textContent = incidents.length;
      this._renderMiniHistory(incidents);

      // Also feed history page with fresh data without re-fetching
      this.historyPage.data = incidents;
      this.historyPage._updateStats();
      if (this.router.current === 'history') this.historyPage._render();

      // Update history nav badge
      const nb = document.getElementById('historyNavBadge');
      if (incidents.length > 0) {
        nb.textContent = incidents.length;
        nb.style.display = '';
      }
    } catch (err) {
      console.error('[InfraWatch] History load failed:', err);
    }
  }

  /* ── Mini history (dashboard) ─────────────────── */
  _renderMiniHistory(incidents) {
    if (incidents.length === 0) {
      this.historyTable.innerHTML = `
        <div class="empty-state">
          <div class="es-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <path d="M6 22V8a2 2 0 012-2h12a2 2 0 012 2v14" stroke="currentColor" stroke-width="1.5"/>
              <path d="M3 22h22M10 11h8M10 15h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </div>
          <div class="es-text">No incidents recorded yet</div>
        </div>`;
      return;
    }

    this.historyTable.innerHTML = incidents.slice(0, 10).map((inc) => {
      const sev = (inc.severity || 'critical').toLowerCase();
      return `
        <div class="history-row">
          <div class="history-time">${this.formatTime(inc.time)}</div>
          <div class="history-name">${this._esc(inc.name || 'Unknown')}</div>
          <div class="history-instance">${this._esc(inc.instance || '—')}</div>
          <div><span class="history-sev ${sev}">${sev}</span></div>
        </div>`;
    }).join('');
  }

  /* ── Metric helpers ────────────────────────────── */
  _updateMetricAlerts(count) {
    if (this.alertBar) {
      this.alertBar.style.width = `${Math.min(100, (count / 10) * 100)}%`;
    }
  }

  _calcUptimeDays(incidents) {
    if (!incidents || incidents.length === 0) return null;
    const newest = incidents[0];
    if (!newest?.time) return null;
    return Math.floor((Date.now() / 1000 - newest.time) / 86400);
  }

  _countMonthIncidents(incidents) {
    if (!incidents) return 0;
    const now = new Date();
    return incidents.filter((i) => {
      const d = new Date(i.time * 1000);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
  }

  /* ── Indicators ────────────────────────────────── */
  _setNetIndicator(ok) {
    this.netIndicator.classList.toggle('success', ok);
    this.netIndicator.classList.toggle('error', !ok);
    this.netIndicator.setAttribute('aria-label', `Network: ${ok ? 'connected' : 'disconnected'}`);
  }

  _setHealthIndicator(statusState) {
    const isNormal = statusState === 'NORMAL' || statusState === true;
    const isWarning = statusState === 'WARNING';
    this.healthIndicator.classList.toggle('success', isNormal);
    this.healthIndicator.classList.toggle('warning', isWarning);
    this.healthIndicator.classList.toggle('error', !isNormal && !isWarning);
    this.healthIndicator.setAttribute('aria-label', `Health: ${statusState}`);
  }

  /* ── Sound control ─────────────────────────────── */
  /* ── Sound control & Web Audio Synth Fallback ────────────────────────────────── */
  _getAudioContext() {
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.audioCtx = new AudioCtx();
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => { });
    }
    return this.audioCtx;
  }

  _startSynthBeep() {
    this._stopSynthBeep();
    try {
      const ctx = this._getAudioContext();
      if (!ctx) return;

      this.synthOsc = ctx.createOscillator();
      this.synthGain = ctx.createGain();

      this.synthOsc.type = 'sawtooth';
      this.synthOsc.frequency.setValueAtTime(880, ctx.currentTime); // A5
      this.synthOsc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.4);

      this.synthGain.gain.setValueAtTime(0.15, ctx.currentTime);

      this.synthOsc.connect(this.synthGain);
      this.synthGain.connect(ctx.destination);

      this.synthOsc.start();

      // Loop modulating frequency for alarm effect
      this.synthTimer = setInterval(() => {
        if (!this.synthOsc || !this.audioCtx) return;
        try {
          const now = this.audioCtx.currentTime;
          this.synthOsc.frequency.setValueAtTime(880, now);
          this.synthOsc.frequency.exponentialRampToValueAtTime(440, now + 0.3);
        } catch (e) { }
      }, 450);
    } catch (e) {
      console.warn('[Audio] Web Audio synth fallback failed:', e);
    }
  }

  _stopSynthBeep() {
    if (this.synthTimer) {
      clearInterval(this.synthTimer);
      this.synthTimer = null;
    }
    if (this.synthOsc) {
      try {
        this.synthOsc.stop();
        this.synthOsc.disconnect();
      } catch (e) { }
      this.synthOsc = null;
    }
  }

  toggleSound(enabled) {
    this.isMuted = !enabled;
    this.soundLabel.textContent = enabled ? 'Sound on' : 'Sound off';

    if (this.isMuted) {
      this.stopAlarm();
    } else {
      // If system is critical when unmuted, start alarm
      if (this.statusText.textContent === 'CRITICAL') {
        this.playAlarm();
      }
    }
  }

  unlockAudio() {
    this._getAudioContext();
    this.alarmAudio.muted = true;
    const p = this.alarmAudio.play();
    if (p !== undefined) {
      p.then(() => {
        this.alarmAudio.pause();
        this.alarmAudio.currentTime = 0;
        this.alarmAudio.muted = false;
        this.audioWarning.classList.add('hidden');
      }).catch(() => {
        this.audioWarning.classList.remove('hidden');
      });
    }
  }

  playAlarm() {
    if (this.isMuted || this.isPlayingAlarm) return;
    this.isPlayingAlarm = true;
    this._getAudioContext();

    this.alarmAudio.loop = true;
    this.alarmAudio.muted = false;
    const p = this.alarmAudio.play();
    if (p !== undefined) {
      p.then(() => {
        this.audioWarning.classList.add('hidden');
      }).catch(() => {
        // Fallback to Web Audio Synth if HTML5 Audio is blocked/fails
        this._startSynthBeep();
      });
    }
  }

  stopAlarm() {
    this.isPlayingAlarm = false;
    this.alarmAudio.pause();
    this.alarmAudio.currentTime = 0;
    this._stopSynthBeep();
    this.audioWarning.classList.add('hidden');
  }

  testAlarm() {
    // If user clicked test alarm while sound is off, auto turn sound on
    if (this.isMuted) {
      this.soundToggle.checked = true;
      this.toggleSound(true);
    }

    this.unlockAudio();
    this.alarmAudio.muted = false;
    this.alarmAudio.loop = false;
    this.alarmAudio.currentTime = 0;

    const p = this.alarmAudio.play();
    if (p !== undefined) {
      p.then(() => {
        this.audioWarning.classList.add('hidden');
      }).catch(() => {
        // Use Web Audio Synth for test beep
        this._startSynthBeep();
        setTimeout(() => this._stopSynthBeep(), 1500);
      });
    }
  }

  /* ── Escape HTML ───────────────────────────────── */
  _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ── Cleanup ───────────────────────────────────── */
  destroy() {
    clearInterval(this.statusCheckInterval);
    clearInterval(this.historyCheckInterval);
    this.logsPage.onDeactivate();
  }
}

// ── Bootstrap ────────────────────────────────────────
const _boot = () => { window.monitor = new ServerMonitor(); };

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _boot);
} else {
  _boot();
}

window.addEventListener('beforeunload', () => window.monitor?.destroy());
