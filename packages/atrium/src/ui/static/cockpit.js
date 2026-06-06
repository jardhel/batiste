/*
 * Cockpit · Cachola Tech operator-trust dashboard.
 *
 * Vanilla ES module. Four panels (Running / Permitted / Activity / Memory)
 * plus the KILL ALL control. All state lives on the DOM; this script is
 * essentially: fetch JSON, mount nodes, subscribe to SSE, react to clicks.
 *
 * SSE is the only live bit. The audit and in-flight streams self-poll on
 * the server side — see ../server.ts attachAuditTailSse / attachInFlightSse
 * — so we don't do any setInterval polling on the client. EventSource will
 * auto-reconnect with backoff on transient failure.
 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  scope: null,
  audit: { entries: [], filter: 'all' },
  fm: { page: 1, limit: 20, total: 0, query: '', type: 'fact', entries: [], hasMore: false },
  inflightOps: [],
  sse: { audit: null, inflight: null },
};

/* ────────── escape ────────── */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toISOString().slice(11, 19);
  } catch { return iso; }
}

function fmtArgsSummary(args) {
  if (!args || typeof args !== 'object') return '';
  const keys = Object.keys(args).slice(0, 3);
  if (keys.length === 0) return '{}';
  return keys.map((k) => {
    const v = args[k];
    let render;
    if (typeof v === 'string') render = v.length > 32 ? `${v.slice(0, 32)}…` : v;
    else if (v === null || v === undefined) render = String(v);
    else if (typeof v === 'object') render = Array.isArray(v) ? `[${v.length}]` : '{…}';
    else render = String(v);
    return `${k}=${render}`;
  }).join(' · ');
}

/* ────────── meta ────────── */

async function loadMeta() {
  try {
    const scope = await fetch('/api/scope').then((r) => r.json());
    state.scope = scope;
    const ns = $('[data-meta="namespace"]');
    const fm = $('[data-meta="fmRoot"]');
    if (ns) ns.textContent = scope.namespace;
    if (fm) fm.textContent = scope.fmRoot;
    renderScope();
  } catch (err) {
    const region = $('[data-region="scope"]');
    if (region) region.innerHTML = `<p class="panel__empty italic">Scope unavailable: ${esc(err.message ?? err)}</p>`;
  }
}

/* ────────── Panel 02 · Permitted ────────── */

function renderScope() {
  const region = $('[data-region="scope"]');
  if (!region || !state.scope) return;
  const s = state.scope;

  const rolesHtml = s.rls.roles.map((r) => `
    <div class="role-row">
      <span class="role-row__name">${esc(r.role)}</span>
      <span class="role-row__desc">${esc(r.description)}${r.canWrite ? ' · writes permitted' : ''}</span>
      <span class="role-row__sens">${esc(r.sensitivities.join(' · '))}</span>
    </div>
  `).join('');

  const rulesHtml = s.scopeRules.map((rule) => `
    <div class="scope-rule">
      <span class="scope-rule__effect scope-rule__effect--${rule.effect}">${esc(rule.effect)}</span>
      <span class="scope-rule__pattern">${esc(rule.pattern)}</span>
      <span class="scope-rule__rationale">${esc(rule.rationale)}</span>
    </div>
  `).join('');

  region.innerHTML = `
    <div class="scope-block">
      <span class="scope-block__label">Row-level security</span>
      <p class="scope-block__copy">${esc(s.rls.description)}</p>
      ${rolesHtml}
    </div>
    <div class="scope-block">
      <span class="scope-block__label">Path scope rules</span>
      <p class="scope-block__copy">Deny rules win. Anything outside the allow list is implicitly out-of-scope.</p>
      ${rulesHtml}
    </div>
  `;
}

/* ────────── Panel 01 · Running ────────── */

function renderRunning() {
  const region = $('[data-region="running"]');
  const meta = $('[data-meta="running-count"]');
  if (!region) return;
  const ops = state.inflightOps;
  if (meta) meta.textContent = `${ops.length} ${ops.length === 1 ? 'op' : 'ops'}`;
  if (ops.length === 0) {
    region.innerHTML = '<p class="panel__empty italic">No operations running. Atrium is idle.</p>';
    return;
  }
  region.innerHTML = ops.map((op) => `
    <div class="run-row" data-op-id="${esc(op.id)}">
      <div>
        <span class="run-row__label italic">${esc(op.source)}</span>
        <span class="run-row__source">atrium.ingest · runId ${esc((op.id ?? '').slice(0, 8))}</span>
      </div>
      <div class="run-row__counters">
        ${op.startedAt ? esc(op.startedAt) : 'started moments ago'}
      </div>
      <button class="run-row__stop" data-action="stop-op" data-op-id="${esc(op.id)}" type="button">Stop</button>
    </div>
  `).join('');
}

function subscribeInflight() {
  if (state.sse.inflight) state.sse.inflight.close();
  const es = new EventSource('/api/in-flight');
  state.sse.inflight = es;
  es.addEventListener('ops', (ev) => {
    try {
      const data = JSON.parse(ev.data);
      state.inflightOps = Array.isArray(data.ops) ? data.ops : [];
      renderRunning();
    } catch { /* noop */ }
  });
  es.addEventListener('error', () => { /* EventSource auto-reconnects */ });
}

/* ────────── Panel 03 · Activity log ────────── */

function applyAuditFilter() {
  const list = $('[data-list="audit"]');
  const empty = $('[data-empty="audit"]');
  if (!list) return;
  const visible = state.audit.entries.filter((e) => {
    if (state.audit.filter === 'all') return true;
    return e.result === state.audit.filter;
  });
  if (visible.length === 0) {
    list.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';
  list.innerHTML = visible.map((e) => renderAuditRow(e)).join('');
}

function renderAuditRow(e) {
  const summary = fmtArgsSummary(e.args);
  return `
    <li class="audit-row" data-audit-id="${esc(e.id)}">
      <span class="audit-row__ts">${esc(fmtTime(e.timestamp))}</span>
      <span class="audit-row__tool">${esc(e.tool)}<span class="audit-row__args"> · ${esc(summary)}</span></span>
      <span class="audit-row__agent">${esc(e.agentId)}</span>
      <span class="audit-row__result audit-row__result--${esc(e.result)}">${esc(e.result)}</span>
    </li>
  `;
}

function pushAuditEntry(entry) {
  // De-dup: if we already have the id, skip.
  if (state.audit.entries.some((e) => e.id === entry.id)) return;
  state.audit.entries.unshift(entry);
  // Cap at 200 so the DOM doesn't grow unbounded — the panel only shows the
  // last 50 in any case, but the buffer absorbs filter toggles.
  if (state.audit.entries.length > 200) state.audit.entries.length = 200;
  applyAuditFilter();
}

function subscribeAudit() {
  if (state.sse.audit) state.sse.audit.close();
  const es = new EventSource('/api/audit-tail');
  state.sse.audit = es;
  es.addEventListener('entry', (ev) => {
    try { pushAuditEntry(JSON.parse(ev.data)); } catch { /* noop */ }
  });
  es.addEventListener('empty', () => { /* leave panel empty-state visible */ });
  es.addEventListener('heartbeat', () => { /* keep-alive */ });
  es.addEventListener('error', () => { /* auto-reconnect */ });
}

function bindAuditExpansion() {
  const list = $('[data-list="audit"]');
  if (!list) return;
  list.addEventListener('click', (ev) => {
    const row = ev.target.closest('.audit-row');
    if (!row) return;
    const id = row.dataset.auditId;
    const existing = row.querySelector('.audit-row__detail');
    if (existing) {
      existing.remove();
      return;
    }
    const entry = state.audit.entries.find((e) => e.id === id);
    if (!entry) return;
    const detail = document.createElement('div');
    detail.className = 'audit-row__detail';
    detail.textContent = JSON.stringify({
      sessionId: entry.sessionId,
      durationMs: entry.durationMs,
      args: entry.args,
    }, null, 2);
    row.appendChild(detail);
  });
}

function bindAuditFilter() {
  const sel = $('#audit-filter');
  if (!sel) return;
  sel.addEventListener('change', () => {
    state.audit.filter = sel.value;
    applyAuditFilter();
  });
}

/* ────────── Panel 04 · Memory ────────── */

async function loadFm() {
  const list = $('[data-list="fm"]');
  const empty = $('[data-empty="fm"]');
  const pager = $('[data-pager]');
  if (!list) return;
  const url = new URL('/api/fm-browse', window.location.origin);
  url.searchParams.set('page', String(state.fm.page));
  url.searchParams.set('limit', String(state.fm.limit));
  url.searchParams.set('type', state.fm.type);
  if (state.fm.query) url.searchParams.set('q', state.fm.query);
  try {
    const res = await fetch(url.toString()).then((r) => r.json());
    state.fm.entries = res.entries ?? [];
    state.fm.total = res.total ?? 0;
    state.fm.hasMore = !!res.hasMore;
    if (state.fm.entries.length === 0) {
      list.innerHTML = '';
      if (empty) {
        empty.style.display = '';
        empty.textContent = state.fm.query
          ? `No matches for "${state.fm.query}".`
          : 'No entries yet. Run an ingestion to populate Firm Memory.';
      }
      if (pager) pager.hidden = true;
      return;
    }
    if (empty) empty.style.display = 'none';
    list.innerHTML = state.fm.entries.map((e) => renderFmRow(e)).join('');
    if (pager) {
      pager.hidden = false;
      const meta = $('[data-pager-meta]');
      if (meta) {
        const start = (state.fm.page - 1) * state.fm.limit + 1;
        const end = start + state.fm.entries.length - 1;
        meta.textContent = `${start}–${end} of ${state.fm.total}`;
      }
      const prev = $('[data-pager-action="prev"]');
      const next = $('[data-pager-action="next"]');
      if (prev) prev.disabled = state.fm.page <= 1;
      if (next) next.disabled = !state.fm.hasMore;
    }
  } catch (err) {
    list.innerHTML = '';
    if (empty) {
      empty.style.display = '';
      empty.textContent = `Memory unavailable: ${err.message ?? err}`;
    }
  }
}

function renderFmRow(e) {
  const tags = (e.tags ?? []).map((t) => `#${esc(t)}`).join(' ');
  return `
    <li class="fm-row" data-fm-id="${esc(e.id)}" data-fm-type="${esc(e.type)}">
      <div>
        <h3 class="fm-row__title">${esc(e.title)}</h3>
        <div class="fm-row__meta">
          <span>${esc(e.kind)}</span>
          <span>${esc(e.id)}</span>
          ${tags ? `<span>${tags}</span>` : ''}
        </div>
        <p class="fm-row__preview">${esc(e.preview)}</p>
      </div>
      <span class="fm-row__sensitivity">${esc(e.sensitivity)}</span>
    </li>
  `;
}

function bindFmInteractions() {
  const list = $('[data-list="fm"]');
  const search = $('#fm-search');
  const typeSel = $('#fm-type');
  let searchTimer = null;
  if (search) {
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.fm.query = search.value.trim();
        state.fm.page = 1;
        loadFm();
      }, 220);
    });
  }
  if (typeSel) {
    typeSel.addEventListener('change', () => {
      state.fm.type = typeSel.value === 'prompt' ? 'prompt' : 'fact';
      state.fm.page = 1;
      loadFm();
    });
  }
  const prev = $('[data-pager-action="prev"]');
  const next = $('[data-pager-action="next"]');
  if (prev) prev.addEventListener('click', () => { if (state.fm.page > 1) { state.fm.page--; loadFm(); } });
  if (next) next.addEventListener('click', () => { if (state.fm.hasMore) { state.fm.page++; loadFm(); } });
  if (list) {
    list.addEventListener('click', (ev) => {
      const row = ev.target.closest('.fm-row');
      if (!row) return;
      openFmDetail(row.dataset.fmId, row.dataset.fmType);
    });
  }
}

async function openFmDetail(id, type) {
  const url = new URL(`/api/fm-entry/${encodeURIComponent(id)}`, window.location.origin);
  if (type) url.searchParams.set('type', type);
  try {
    const detail = await fetch(url.toString()).then((r) => r.json());
    if (detail.error) throw new Error(detail.error);
    renderFmDetail(detail);
  } catch (err) {
    alert(`Could not open entry: ${err.message ?? err}`);
  }
}

function renderFmDetail(d) {
  const modal = $('#modal-fm');
  if (!modal) return;
  $('[data-detail="title"]', modal).textContent = d.title ?? d.id;
  $('[data-detail="kind"]', modal).textContent =
    d.type === 'prompt' ? `Prompt · ${d.category}` : `Fact · ${d.kind}`;
  $('[data-detail="body"]', modal).textContent = d.body ?? '';

  const metaRows = [];
  metaRows.push(['ID', d.id]);
  metaRows.push(['Sensitivity', d.sensitivity]);
  if (d.tags?.length) metaRows.push(['Tags', d.tags.map((t) => `#${t}`).join(' ')]);
  if (d.type === 'fact') {
    if (d.workstream) metaRows.push(['Workstream', d.workstream]);
    if (d.counterparty) metaRows.push(['Counterparty', d.counterparty]);
    if (d.vaultRef) metaRows.push(['Vault ref', d.vaultRef]);
    if (d.auditRef) metaRows.push(['Audit ref', d.auditRef]);
  } else {
    metaRows.push(['Version', String(d.version)]);
    if (d.modelPreference) metaRows.push(['Model', d.modelPreference]);
    if (d.languages?.length) metaRows.push(['Languages', d.languages.join(' · ')]);
    if (d.validatedOn) metaRows.push(['Validated', `${d.validatedOn}${d.validatedBy ? ` · ${d.validatedBy}` : ''}`]);
  }
  metaRows.push(['Updated', d.updatedAt]);

  $('[data-detail="meta"]', modal).innerHTML = metaRows.map(
    ([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`,
  ).join('');

  modal.hidden = false;
}

function bindFmModal() {
  const modal = $('#modal-fm');
  if (!modal) return;
  const close = () => { modal.hidden = true; };
  $('#modal-fm-close', modal)?.addEventListener('click', close);
  $('#modal-fm-done', modal)?.addEventListener('click', close);
  $('#modal-fm-forget', modal)?.addEventListener('click', () => {
    // Stub: GDPR Art.17 redaction wires up in v1.5.
    alert('Forget-this will be wired to GDPR Art.17 redaction in v1.5.');
  });
  modal.addEventListener('click', (ev) => { if (ev.target === modal) close(); });
}

/* ────────── KILL ALL ────────── */

function bindKill() {
  const btn = $('#kill-all');
  const modal = $('#modal-kill');
  if (!btn || !modal) return;
  const cancel = $('#modal-kill-cancel', modal);
  const confirm = $('#modal-kill-confirm', modal);
  const close = () => { modal.hidden = true; };

  btn.addEventListener('click', () => { modal.hidden = false; });
  cancel?.addEventListener('click', close);
  modal.addEventListener('click', (ev) => { if (ev.target === modal) close(); });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !modal.hidden) close();
  });
  confirm?.addEventListener('click', async () => {
    confirm.disabled = true;
    try {
      const res = await fetch('/api/kill-all', { method: 'POST' }).then((r) => r.json());
      close();
      const stoppedCount = typeof res.stopped === 'number' ? res.stopped : 0;
      // Brief, non-modal acknowledgement — sovereign aesthetic = no toast spam.
      const meta = $('[data-meta="running-count"]');
      if (meta) {
        meta.textContent = `Stopped ${stoppedCount}`;
        setTimeout(() => renderRunning(), 1200);
      }
    } catch (err) {
      alert(`Kill failed: ${err.message ?? err}`);
    } finally {
      confirm.disabled = false;
    }
  });
}

/* ────────── stub link traps ────────── */

function bindStubLinks() {
  $$('[data-stub]').forEach((el) => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      // Sovereign: no toast, no alert spam — title attribute is the hint.
    });
  });
}

/* ────────── boot ────────── */

document.addEventListener('DOMContentLoaded', () => {
  loadMeta();
  renderRunning();
  applyAuditFilter();
  loadFm();
  bindAuditExpansion();
  bindAuditFilter();
  bindFmInteractions();
  bindFmModal();
  bindKill();
  bindStubLinks();
  subscribeInflight();
  subscribeAudit();
});
