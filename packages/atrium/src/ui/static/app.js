/*
 * Cachola Tech · Firm Memory · Setup wizard — vanilla ES module.
 *
 * Single-file state machine: welcome → sources → run → done.
 * Talks to /api/* endpoints exposed by ../server.ts. SSE event names map
 * 1:1 to ProgressEvent / log / done as parsed by server.ts parseLogLine.
 *
 * No framework. DOM is mutated directly. The brain-constellation lights
 * up node-by-node as runnable sources complete; that and the hairline
 * progress bar are the only motion in the chrome.
 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  step: 'welcome',
  paths: null,
  sources: [],
  enabled: new Set(),
  runs: new Map(),
  totalRunnable: 0,
  totalDone: 0,
};

/* ────────── Constellation icon (per-source 6-node hex) ────────── */

const HEX_POSITIONS = [
  [0, -22], [19, -11], [19, 11], [0, 22], [-19, 11], [-19, -11],
];

function nodeIcon(litIndex) {
  const lit = ((litIndex % 6) + 6) % 6;
  const edges = HEX_POSITIONS.map((p, j) => {
    const next = HEX_POSITIONS[(j + 1) % 6];
    return `<line x1="${p[0]}" y1="${p[1]}" x2="${next[0]}" y2="${next[1]}"/>`;
  }).join('');
  const spokes = HEX_POSITIONS.map(
    (p) => `<line x1="${p[0]}" y1="${p[1]}" x2="0" y2="0"/>`
  ).join('');
  const nodes = HEX_POSITIONS.map(
    (p, j) => `<circle cx="${p[0]}" cy="${p[1]}" r="${j === lit ? 2.4 : 1.6}" fill="#1F2B3D" opacity="${j === lit ? 1 : 0.32}"/>`
  ).join('');
  return `
    <svg viewBox="-32 -32 64 64" xmlns="http://www.w3.org/2000/svg">
      <g stroke="#1F2B3D" stroke-width="0.6" stroke-linecap="round" fill="none">
        ${edges}
        ${spokes}
      </g>
      <g>${nodes}</g>
      <circle cx="0" cy="0" r="1.9" fill="#FAF6ED" stroke="#1F2B3D" stroke-width="0.6"/>
    </svg>
  `;
}

/* ────────── Run-page constellation (large, lights as sources finish) ────────── */

const LARGE_POSITIONS = [
  [0, -78], [68, -39], [68, 39], [0, 78], [-68, 39], [-68, -39],
];

function renderLargeConstellation(litCount) {
  const root = $('#constellation');
  if (!root) return;
  const cap = Math.max(0, Math.min(LARGE_POSITIONS.length, litCount));
  const edges = LARGE_POSITIONS.map((p, j) => {
    const next = LARGE_POSITIONS[(j + 1) % 6];
    return `<line x1="${p[0]}" y1="${p[1]}" x2="${next[0]}" y2="${next[1]}"/>`;
  }).join('');
  const spokes = LARGE_POSITIONS.map(
    (p) => `<line x1="${p[0]}" y1="${p[1]}" x2="0" y2="0"/>`
  ).join('');
  const nodes = LARGE_POSITIONS.map((p, j) => {
    const isLit = j < cap;
    return `<circle cx="${p[0]}" cy="${p[1]}" r="${isLit ? 6 : 4.4}" fill="#1F2B3D" opacity="${isLit ? 1 : 0.28}"/>`;
  }).join('');
  const hubLit = cap >= LARGE_POSITIONS.length;
  root.innerHTML = `
    <svg viewBox="-110 -110 220 220" xmlns="http://www.w3.org/2000/svg">
      <g stroke="#1F2B3D" stroke-width="1.0" stroke-linecap="round" fill="none">
        ${edges}
        ${spokes}
      </g>
      <g>${nodes}</g>
      <circle cx="0" cy="0" r="${hubLit ? 5.5 : 4.6}" fill="${hubLit ? '#1F2B3D' : '#FAF6ED'}" stroke="#1F2B3D" stroke-width="1.2"/>
    </svg>
  `;
}

/* ────────── State / step machine ────────── */

const STEP_LABELS = { welcome: '1 / 3', sources: '2 / 3', run: '3 / 3' };

function setStep(step) {
  state.step = step;
  $$('.step').forEach((el) => {
    if (el.dataset.step === step) el.removeAttribute('hidden');
    else el.setAttribute('hidden', '');
  });
  const label = $('.ledger__progress');
  if (label) label.textContent = `Step ${STEP_LABELS[step] || '—'}`;
  if (step === 'run') renderLargeConstellation(0);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ────────── Initial fetches ────────── */

async function init() {
  try {
    const [pathsRes, sourcesRes] = await Promise.all([
      fetch('/api/paths').then((r) => r.json()),
      fetch('/api/sources').then((r) => r.json()),
    ]);
    state.paths = pathsRes;
    state.sources = sourcesRes.sources || [];
    renderPaths();
    renderSources();
    setStep('welcome');
  } catch (err) {
    document.body.innerHTML = `
      <main style="padding:64px;font-family:'EB Garamond',serif;font-style:italic;color:#1F2B3D">
        <p>Setup server unreachable. Restart with <code>batiste-fm install</code>.</p>
        <p style="font-size:13px;color:#5A6472;margin-top:12px">${escapeHtml(String(err))}</p>
      </main>
    `;
  }
}

function renderPaths() {
  const root = $('.paths');
  if (!root || !state.paths) return;
  const rows = [
    ['FM root', state.paths.fmRoot],
    ['Audit ledger', state.paths.auditDbPath],
    ['Checkpoints', state.paths.checkpointPath],
    ['Namespace', state.paths.namespace],
  ];
  root.innerHTML = rows.map(
    ([k, v]) => `
      <div class="paths__row">
        <span class="paths__key">${escapeHtml(k)}</span>
        <span class="paths__value">${escapeHtml(v)}</span>
      </div>
    `
  ).join('');
}

function renderSources() {
  const root = $('.sources');
  if (!root) return;
  state.enabled.clear();
  root.innerHTML = state.sources.map((s, i) => {
    const isStub = s.status === 'stub';
    const checked = !isStub && s.defaultOn;
    if (checked) state.enabled.add(s.id);
    return `
      <div class="source" data-source="${s.id}" ${isStub ? 'data-stub="1"' : ''}>
        <div class="source__node">${nodeIcon(i)}</div>
        <div class="source__body">
          <h3 class="source__label italic">${escapeHtml(s.label)}</h3>
          <p class="source__desc">${escapeHtml(s.description)}</p>
        </div>
        <div class="source__toggle">
          ${
            isStub
              ? '<span class="badge">v1.4</span>'
              : `<button class="toggle" role="checkbox" aria-checked="${checked}" data-source="${s.id}" aria-label="${escapeHtml(s.label)}"></button>`
          }
        </div>
      </div>
    `;
  }).join('');

  $$('.toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.source;
      const isOn = btn.getAttribute('aria-checked') === 'true';
      btn.setAttribute('aria-checked', String(!isOn));
      if (!isOn) state.enabled.add(id);
      else state.enabled.delete(id);
    });
  });
}

/* ────────── Run cards ────────── */

function renderRunCards() {
  const root = $('.run-cards');
  if (!root) return;
  const enabled = state.sources.filter(
    (s) => state.enabled.has(s.id) && s.status === 'available'
  );
  state.totalRunnable = enabled.length;
  state.totalDone = 0;
  root.innerHTML = enabled.map((s) => `
    <div class="run-card" data-source="${s.id}">
      <div class="run-card__header">
        <h3 class="run-card__title italic">${escapeHtml(s.label)}</h3>
        <span class="caps run-card__status" data-source="${s.id}" data-status="queued">queued</span>
      </div>
      <div class="progress"><div class="progress__fill" data-source="${s.id}"></div></div>
      <div class="counters">
        <span><span class="counters__num" data-counter="imported" data-source="${s.id}">0</span>imported</span>
        <span><span class="counters__num" data-counter="skipped" data-source="${s.id}">0</span>skipped</span>
        <span><span class="counters__num" data-counter="redactions" data-source="${s.id}">0</span>redacted</span>
      </div>
      <div class="log" data-source="${s.id}"></div>
    </div>
  `).join('');
  return enabled;
}

async function startRuns() {
  setStep('run');
  const enabled = renderRunCards();
  if (!enabled || enabled.length === 0) {
    showBanner();
    return;
  }
  // Sequential: shared embedder, parallel runs would thrash the model.
  for (const source of enabled) {
    await startRun(source);
  }
}

function startRun(source) {
  return new Promise((resolve) => {
    const id = source.id;
    setStatus(id, 'running');
    fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: id }),
    })
      .then((r) => r.json())
      .then(({ runId, error }) => {
        if (error) {
          setStatus(id, 'failed');
          pushLog(id, `error: ${error}`);
          resolve();
          return;
        }
        const es = new EventSource(`/api/events?runId=${encodeURIComponent(runId)}`);
        state.runs.set(id, { runId, es, logs: [] });

        es.addEventListener('log', (ev) => {
          try { pushLog(id, JSON.parse(ev.data)); } catch { pushLog(id, ev.data); }
        });
        es.addEventListener('progress', (ev) => {
          try { applyProgress(id, JSON.parse(ev.data)); } catch { /* noop */ }
        });
        es.addEventListener('done', (ev) => {
          let exitCode = 0;
          try { exitCode = JSON.parse(ev.data).exitCode ?? 0; } catch { /* noop */ }
          es.close();
          setStatus(id, exitCode === 0 ? 'complete' : 'failed');
          if (exitCode === 0) setProgress(id, 1);
          state.totalDone++;
          renderLargeConstellation(state.totalDone);
          if (state.totalDone >= state.totalRunnable) showBanner();
          resolve();
        });
        es.addEventListener('error', () => {
          es.close();
          setStatus(id, 'failed');
          state.totalDone++;
          if (state.totalDone >= state.totalRunnable) showBanner();
          resolve();
        });
      })
      .catch((err) => {
        setStatus(id, 'failed');
        pushLog(id, `request failed: ${err && err.message ? err.message : err}`);
        state.totalDone++;
        if (state.totalDone >= state.totalRunnable) showBanner();
        resolve();
      });
  });
}

function applyProgress(id, p) {
  if (typeof p.pct === 'number') setProgress(id, p.pct);
  if (typeof p.imported === 'number') setCounter(id, 'imported', p.imported);
  if (typeof p.skipped === 'number') setCounter(id, 'skipped', p.skipped);
  if (typeof p.redactions === 'number') setCounter(id, 'redactions', p.redactions);
}

function setStatus(id, status) {
  const el = document.querySelector(`.run-card__status[data-source="${id}"]`);
  if (!el) return;
  el.textContent = status;
  el.setAttribute('data-status', status);
}

function setProgress(id, pct) {
  const el = document.querySelector(`.progress__fill[data-source="${id}"]`);
  if (!el) return;
  const clamped = Math.max(0, Math.min(1, pct));
  el.style.width = `${(clamped * 100).toFixed(1)}%`;
}

function setCounter(id, key, val) {
  const el = document.querySelector(`.counters__num[data-counter="${key}"][data-source="${id}"]`);
  if (el) el.textContent = String(val);
}

function pushLog(id, line) {
  const run = state.runs.get(id) || { logs: [] };
  if (!state.runs.has(id)) state.runs.set(id, run);
  run.logs.push(String(line));
  while (run.logs.length > 5) run.logs.shift();
  const el = document.querySelector(`.log[data-source="${id}"]`);
  if (el) {
    el.innerHTML = run.logs.map((l) => `<div class="log__line">${escapeHtml(l)}</div>`).join('');
  }
}

function showBanner() {
  const banner = $('#banner');
  if (banner) banner.removeAttribute('hidden');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

/* ────────── Wire DOM ────────── */

document.addEventListener('DOMContentLoaded', () => {
  init();
  $('#begin')?.addEventListener('click', () => setStep('sources'));
  $('#cancel')?.addEventListener('click', () => setStep('welcome'));
  $('#run')?.addEventListener('click', () => {
    if (state.enabled.size === 0) return;
    startRuns();
  });
  $('#again')?.addEventListener('click', () => {
    state.runs.forEach((r) => { try { r.es.close(); } catch { /* noop */ } });
    state.runs.clear();
    state.totalDone = 0;
    state.totalRunnable = 0;
    const banner = $('#banner');
    if (banner) banner.setAttribute('hidden', '');
    setStep('sources');
  });
});
