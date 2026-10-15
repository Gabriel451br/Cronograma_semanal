import {
  getState, update, subscribe, replaceState, resetState, uid, catById, itemsForDate, toggleDone,
  toISODate, fromISODate, addDays, todayISO, toMin, toHHMM, weekStart, byTime, durationMin, fmtDur, DAY_NAMES, DAY_SHORT,
} from './store.js';
import { startNotifier, requestPermission, permission, supported, testNotification, recheck } from './notifications.js';
import { generatePlan, DEFAULT_ANSWERS } from './planner.js';
import { buildICS } from './ics.js';
import { computeSleep, sleepOptions, inferCycles, sleepQuality, fmtHours, CYCLE } from './sleep.js';
import { TEMPLATE_TEXT, TEMPLATE_NAME, parseRoutineText, routineToText, periodOf, daysLabel } from './routine-text.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ui = {
  view: 'home',
  date: todayISO(),
  agendaMode: 'day',
  weekAnchor: new Date(),
  monthAnchor: new Date(),
  routineDay: new Date().getDay(),
  plannerStep: 0,
  answers: null,
  plan: null,
};

const TITLES = { home: 'Início', routine: 'Rotina', agenda: 'Agenda', settings: 'Ajustes', planner: 'Assistente' };
const NOTIFY_OPTS = [[-1, 'Sem lembrete'], [0, 'Na hora'], [5, '5 min antes'], [10, '10 min antes'], [15, '15 min antes'], [30, '30 min antes'], [60, '1 hora antes'], [120, '2 horas antes']];
const PERIODS = [['manha', 'Manhã'], ['tarde', 'Tarde'], ['noite', 'Noite']];
const dayOrder = () => (getState().settings.weekStartsMonday ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6]);
const nowMinutes = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
const bullets = (notes) => {
  const lines = (notes || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length ? `<ul class="bnotes">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '';
};

/* ---------- Infra ---------- */
function toast(msg, ms = 3500) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

function applyTheme() {
  const t = getState().settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function setView(v) {
  ui.view = v;
  const tab = v === 'planner' ? 'routine' : v;
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === tab));
  $('#view-title').textContent = TITLES[v];
  $('#fab').classList.toggle('hidden', v === 'planner' || v === 'settings');
  render();
  window.scrollTo({ top: 0 });
}

function renderNotifyBadge() {
  const b = $('#btn-notify-status');
  const on = getState().settings.notifications && permission() === 'granted';
  b.innerHTML = on ? '🔔 <span class="small">Ativo</span>' : '🔕 <span class="small">Ativar</span>';
  b.title = on ? 'Lembretes ativos' : 'Ativar lembretes';
}

function render() {
  applyTheme();
  renderNotifyBadge();
  const view = $('#view');
  const r = { home: renderHome, routine: renderRoutine, agenda: renderAgenda, planner: renderPlanner, settings: renderSettings }[ui.view];
  view.innerHTML = r();
}

/* ---------- Sono ---------- */
/** Mantém os blocos "Acordar" e "Dormir" da rotina sincronizados com a calculadora. */
function syncSleep(st) {
  const sl = st.sleep;
  if (!sl.enabled) return;
  Object.assign(sl, computeSleep(sl));
  const defs = {
    wake: { title: 'Acordar', notes: 'Despertar imediato, sem usar o botão "soneca".', time: sl.wake, notify: 0 },
    bed: { title: 'Apagar das luzes e dormir', notes: '', time: sl.bed, notify: 30 },
  };
  for (const [sys, d] of Object.entries(defs)) {
    let r = st.routines.find((x) => x.system === sys);
    if (!r) {
      r = { id: uid(), system: sys, title: d.title, notes: d.notes, category: st.categories.some((c) => c.id === 'saude') ? 'saude' : st.categories[0].id, notify: d.notify, skip: [], end: '', source: 'sleep' };
      st.routines.push(r);
    }
    r.start = d.time;
    r.end = '';
    r.days = [...sl.days].sort();
  }
}

function sleepSummary() {
  const sl = getState().sleep;
  if (!sl.enabled) return '';
  return `🌙 ${sl.bed} → ⏰ ${sl.wake} · ${sl.cycles} ciclos (${fmtHours((sl.cycles * CYCLE) / 60)})`;
}

function openSleepModal() {
  const s = getState();
  const d = structuredClone(s.sleep);
  if (!d.enabled) d.enabled = true;
  const dlg = $('#modal');

  const draw = () => {
    const res = computeSleep(d);
    const q = sleepQuality(d.cycles);
    const opts = sleepOptions(d);
    const fixed = d.anchor === 'wake' ? 'wake' : 'bed';
    dlg.innerHTML = `
    <div class="mbody">
      <div class="mhead"><h2>🌙 Sono em ciclos de 90 min</h2><button type="button" class="btn ghost sm" data-close>✕</button></div>
      <p class="small muted" style="margin:0">Escolha o horário que você quer fixar e quantos ciclos de sono. O outro horário é calculado automaticamente e sua rotina é ajustada.</p>
      <div class="field"><span class="flabel">Eu quero fixar</span>
        <div class="seg" data-sl="anchor"><button type="button" data-v="wake" class="${fixed === 'wake' ? 'on' : ''}">⏰ Hora de acordar</button><button type="button" data-v="bed" class="${fixed === 'bed' ? 'on' : ''}">🌙 Hora de dormir</button></div>
      </div>
      <div class="grid2">
        <label class="field"><span>${fixed === 'wake' ? 'Acordar às' : 'Dormir (apagar as luzes) às'}</span><input type="time" id="sl-time" value="${fixed === 'wake' ? d.wake : d.bed}"></label>
        <label class="field"><span>Tempo para adormecer (min)</span><input type="number" id="sl-lat" min="0" max="60" step="5" value="${d.latency}"></label>
      </div>
      <div class="field"><span class="flabel">Ciclos de sono</span>
        <div class="seg" data-sl="cycles">${[3, 4, 5, 6].map((c) => `<button type="button" data-v="${c}" class="${d.cycles === c ? 'on' : ''}">${c} · ${fmtHours((c * CYCLE) / 60)}</button>`).join('')}</div>
      </div>
      <div class="sleep-result">
        <div><span class="small muted">Dormir</span><b>${res.bed}</b></div>
        <div class="arrow">→ ${d.latency ? `${d.latency} min + ` : ''}${d.cycles} × 90 min →</div>
        <div><span class="small muted">Acordar</span><b>${res.wake}</b></div>
      </div>
      <div class="note ${q.level}">${esc(q.text)}</div>
      <details class="small"><summary>Outras opções mantendo ${fixed === 'wake' ? 'o despertar às ' + d.wake : 'o horário de dormir às ' + d.bed}</summary>
        <div class="opt-list">${opts.map((o) => `<button type="button" class="btn sm ${o.cycles === d.cycles ? 'primary' : ''}" data-sl-cycles="${o.cycles}">${o.cycles} ciclos (${fmtHours(o.hours)}): ${fixed === 'wake' ? 'dormir ' + o.bed : 'acordar ' + o.wake}</button>`).join('')}</div>
      </details>
      <div class="field"><span class="flabel">Aplicar nos dias</span>
        <div class="days" id="sl-days">${dayOrder().map((x) => `<button type="button" data-d="${x}" class="${d.days.includes(x) ? 'on' : ''}">${DAY_SHORT[x]}</button>`).join('')}</div>
      </div>
      <label class="switch"><span>Ajuste automático na rotina<br><span class="small muted">Cria/atualiza os blocos “Acordar” e “Dormir”.</span></span><input type="checkbox" id="sl-enabled" ${s.sleep.enabled || d.enabled ? 'checked' : ''}></label>
      <div class="mfoot"><span></span><div class="row"><button type="button" class="btn" data-close>Cancelar</button><button type="button" class="btn primary" data-sl-save>Salvar</button></div></div>
    </div>`;
  };

  const readInputs = () => {
    const t = $('#sl-time', dlg)?.value;
    if (t) { if (d.anchor === 'wake') d.wake = t; else d.bed = t; }
    const lat = Number($('#sl-lat', dlg)?.value);
    if (!Number.isNaN(lat)) d.latency = Math.max(0, Math.min(120, lat));
    d.enabled = $('#sl-enabled', dlg)?.checked ?? d.enabled;
    Object.assign(d, computeSleep(d));
  };

  draw();
  dlg.onsubmit = null;
  dlg.oninput = (e) => { if (e.target.id === 'sl-time' || e.target.id === 'sl-lat') { readInputs(); const pos = e.target.id; draw(); const el = $('#' + pos, dlg); el?.focus(); } };
  dlg.onclick = (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) { dlg.close(); return; }
    const sb = e.target.closest('[data-sl] [data-v]');
    if (sb) {
      readInputs();
      const k = sb.parentElement.dataset.sl;
      d[k] = k === 'cycles' ? Number(sb.dataset.v) : sb.dataset.v;
      Object.assign(d, computeSleep(d));
      draw();
      return;
    }
    const oc = e.target.closest('[data-sl-cycles]');
    if (oc) { readInputs(); d.cycles = Number(oc.dataset.slCycles); Object.assign(d, computeSleep(d)); draw(); return; }
    const db = e.target.closest('#sl-days [data-d]');
    if (db) { const x = Number(db.dataset.d); d.days = d.days.includes(x) ? d.days.filter((y) => y !== x) : [...d.days, x]; db.classList.toggle('on'); return; }
    if (e.target.closest('[data-sl-save]')) {
      readInputs();
      update((st) => {
        st.sleep = d;
        if (d.enabled) syncSleep(st);
        else st.routines.forEach((r) => { if (r.system) delete r.system; });
      });
      dlg.close();
      toast(d.enabled ? `Sono ajustado: dormir ${d.bed}, acordar ${d.wake}` : 'Ajuste automático desligado');
      recheck();
    }
  };
  dlg.showModal();
}

/* ---------- Componentes ---------- */
function catOptions(selected) {
  return getState().categories.map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}

function blockHTML(it, { checks = false, nowMin = null, showDays = false } = {}) {
  const c = catById(it.category);
  const s = toMin(it.start), e = toMin(it.end);
  const isNow = nowMin != null && s != null && e != null && nowMin >= s && nowMin < e && !it.done;
  const dur = durationMin(it);
  const sl = getState().sleep;
  const meta = [
    `<span class="tag"><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</span>`,
    dur ? `<span>${fmtDur(dur)}</span>` : '',
    it.kind === 'task' ? '<span class="pill">📌 Agenda</span>' : '',
    it.location ? `<span>📍 ${esc(it.location)}</span>` : '',
    it.system === 'bed' && sl.enabled ? `<span>🌙 ${sl.cycles} ciclos · ${fmtHours((sl.cycles * CYCLE) / 60)} de sono</span>` : '',
    it.system === 'wake' && sl.enabled ? '<span>⏰ calculado pelo sono</span>' : '',
    showDays && it.days ? `<span>↻ ${daysLabel(it.days)}</span>` : '',
    isNow ? '<span class="now-tag">● agora</span>' : '',
  ].filter(Boolean).join('');
  return `
  <div class="block ${it.done ? 'done' : ''} ${isNow ? 'now' : ''}" style="--c:${c.color}">
    <div class="bt">${it.start ? `<b>${it.start}</b>${it.end ? `<span>${it.end}</span>` : ''}` : '<b>—</b>'}</div>
    <div class="bb" data-edit="${it.kind}:${it.id}" data-date="${it.date || ''}">
      <div class="btitle">${esc(it.title)}${it.badge ? ` <span class="badge">${esc(it.badge)}</span>` : ''}</div>
      <div class="bmeta">${meta}</div>
      ${bullets(it.notes)}
    </div>
    ${checks ? `<button class="check ${it.done ? 'on' : ''}" data-toggle="${it.kind}:${it.id}:${it.date}" aria-label="Concluir">✓</button>` : ''}
  </div>`;
}

/** Linha do tempo agrupada pelos períodos do dia (estilo da rotina). */
function timelineHTML(items, opts = {}) {
  const periods = [...getState().periods].sort((a, b) => toMin(a.start) - toMin(b.start));
  const timed = items.filter((i) => i.start);
  const untimed = items.filter((i) => !i.start);
  const groups = new Map();
  for (const it of timed) {
    const p = periodOf(periods, it.start) || { id: '_', emoji: '•', name: 'Dia', subtitle: '' };
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p).push(it);
  }
  let html = [...groups.entries()].map(([p, list]) => `
    <section class="period">
      <div class="period-h"><span class="pe">${esc(p.emoji)}</span><div><b>${esc(p.name)}</b>${p.subtitle ? `<span class="psub">: ${esc(p.subtitle)}</span>` : ''}</div></div>
      <div class="blocks">${list.map((i) => blockHTML(i, opts)).join('')}</div>
    </section>`).join('');
  if (untimed.length) {
    html += `<section class="period"><div class="period-h"><span class="pe">📝</span><div><b>Tarefas do dia</b><span class="psub">: sem horário</span></div></div>
      <div class="blocks">${untimed.map((i) => blockHTML(i, opts)).join('')}</div></section>`;
  }
  return html;
}

function barsHTML(byCat, free) {
  const entries = Object.entries(byCat).filter(([, m]) => m > 0).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '<div class="small muted">Sem blocos com horário.</div>';
  const max = Math.max(...entries.map((e) => e[1]), free || 0, 1);
  return `<div class="bars">
    ${entries.map(([id, m]) => { const c = catById(id); return `<div class="barrow"><span class="tag"><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</span><div class="track"><span style="width:${(m / max) * 100}%;background:${c.color}"></span></div><span class="v">${fmtDur(m)}</span></div>`; }).join('')}
    ${free != null ? `<div class="barrow"><span class="muted">Livre</span><div class="track"><span style="width:${(free / max) * 100}%;background:var(--border)"></span></div><span class="v">${fmtDur(free)}</span></div>` : ''}
  </div>`;
}

/* ---------- Início (dashboard) ---------- */
function isSleeping(nowMin) {
  const sl = getState().sleep;
  if (!sl.enabled) return false;
  const b = toMin(sl.bed), w = toMin(sl.wake);
  return b < w ? nowMin >= b && nowMin < w : nowMin >= b || nowMin < w;
}

function renderHome() {
  const s = getState();
  const iso = todayISO();
  const now = new Date();
  const nowMin = nowMinutes();
  const items = itemsForDate(iso);
  const timed = items.filter((i) => i.start);
  const current = [...timed].reverse().find((i) => i.end && toMin(i.start) <= nowMin && nowMin < toMin(i.end) + (toMin(i.end) < toMin(i.start) ? 1440 : 0));
  const next = timed.find((i) => toMin(i.start) > nowMin);
  const done = items.filter((i) => i.done).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  const greet = nowMin < 720 ? 'Bom dia' : nowMin < 1080 ? 'Boa tarde' : 'Boa noite';
  const periods = s.periods;

  let nowCard;
  if (current) {
    const c = catById(current.category);
    const st = toMin(current.start), en = toMin(current.end);
    const total = Math.max(1, en - st);
    const p = periodOf(periods, current.start);
    const left = en - nowMin;
    nowCard = `
    <div class="now-card" style="--c:${c.color}">
      <div class="now-label">● Agora${p ? ` · ${esc(p.emoji)} ${esc(p.name)}` : ''}</div>
      <h2>${esc(current.title)}${current.badge ? ` <span class="badge">${esc(current.badge)}</span>` : ''}</h2>
      <div class="small muted">${current.start}–${current.end} · faltam ${fmtDur(left)}</div>
      <div class="progress"><span style="width:${Math.min(100, ((nowMin - st) / total) * 100)}%;background:${c.color}"></span></div>
      ${bullets(current.notes)}
      ${next ? `<div class="next">A seguir: <b>${next.start}</b> ${esc(next.title)}</div>` : ''}
    </div>`;
  } else if (isSleeping(nowMin)) {
    nowCard = `<div class="now-card" style="--c:#5b6ea8"><div class="now-label">🌙 Hora de descansar</div><h2>Durma bem</h2><div class="small muted">Despertar às ${s.sleep.wake} · ${s.sleep.cycles} ciclos de sono</div></div>`;
  } else {
    nowCard = `<div class="now-card" style="--c:var(--accent)"><div class="now-label">○ Tempo livre</div>
      <h2>${next ? `Livre até ${next.start}` : items.length ? 'Dia encerrado' : 'Nada planejado'}</h2>
      ${next ? `<div class="next">A seguir: <b>${next.start}</b> ${esc(next.title)}</div>` : items.length ? '' : '<div class="small muted">Monte sua rotina na aba <b>Rotina</b> ou use o modelo pronto.</div>'}</div>`;
  }

  // Sono
  let sleepCard = '';
  if (s.sleep.enabled) {
    let toBed = toMin(s.sleep.bed) - nowMin;
    if (toBed < 0) toBed += 1440;
    sleepCard = `<button class="card sleep-card" data-sleep>
      <div><span class="small muted">Dormir em</span><b>${fmtDur(toBed)}</b></div>
      <div class="small">${sleepSummary()}</div></button>`;
  } else {
    sleepCard = `<button class="card sleep-card" data-sleep><div><span class="small muted">Sono</span><b>Calcular ciclos</b></div><div class="small muted">Defina dormir/acordar em ciclos de 90 min →</div></button>`;
  }

  // Semana
  const ws = weekStart(now, s.settings.weekStartsMonday);
  const byCat = {};
  const strip = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(ws, i);
    const di = toISODate(d);
    const its = itemsForDate(di);
    its.forEach((x) => { if (!x.system) byCat[x.category] = (byCat[x.category] || 0) + durationMin(x); });
    const dn = its.filter((x) => x.done).length;
    const p = its.length ? Math.round((dn / its.length) * 100) : 0;
    const tasks = its.filter((x) => x.kind === 'task').length;
    return `<button class="wd ${di === iso ? 'today' : ''} ${di < iso ? 'past' : ''}" data-goto="${di}">
      <span>${DAY_SHORT[d.getDay()]}</span><b>${d.getDate()}</b>
      <i class="ring" style="--p:${p}"></i><small>${di <= iso ? p + '%' : its.length + ' itens'}</small>${tasks ? `<em>📌${tasks}</em>` : ''}</button>`;
  }).join('');

  return `
  <div class="hello"><h2>${greet}!</h2><span class="muted" style="text-transform:capitalize">${now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>
  <div class="dash">
    <div class="stack">
      ${nowCard}
      <div class="grid2 kpis">
        <div class="card kpi"><span class="small muted">Hoje</span><b>${done}/${items.length}</b><div class="progress"><span style="width:${pct}%"></span></div></div>
        ${sleepCard}
      </div>
      <div class="section-title"><h2>Seu dia</h2><button class="btn ghost sm" data-goto="${iso}">Abrir na agenda →</button></div>
      <div class="timeline">${items.length ? timelineHTML(items, { checks: true, nowMin }) : '<div class="empty">Sua rotina de hoje está vazia. Vá em <b>Rotina</b> para criar blocos ou importar o modelo.</div>'}</div>
    </div>
    <div class="stack">
      <div class="section-title"><h2>Semana</h2><button class="btn ghost sm" data-agenda-week>Ver semana →</button></div>
      <div class="wstrip">${strip}</div>
      <div class="section-title"><h2>Horas na semana</h2></div>
      <div class="card">${barsHTML(byCat, null)}</div>
    </div>
  </div>`;
}

/* ---------- Rotina ---------- */
function renderRoutine() {
  const s = getState();
  const dow = ui.routineDay;
  const list = s.routines
    .filter((r) => r.days.includes(dow))
    .map((r) => ({ ...r, kind: 'routine' }))
    .sort(byTime);
  const total = list.reduce((m, r) => m + durationMin(r), 0);

  return `
  <div class="days daytabs">${dayOrder().map((d) => `<button type="button" data-rday="${d}" class="${d === dow ? 'on' : ''}">${DAY_SHORT[d]}</button>`).join('')}</div>
  <div class="routine-head">
    <div><h2>Rotina de ${DAY_NAMES[dow]}</h2><span class="small muted">${list.length} blocos · ${fmtDur(total)} planejados</span></div>
  </div>
  <button class="card sleep-card wide" data-sleep>
    <div><span class="small muted">Sono (ciclos de 90 min)</span><b>${s.sleep.enabled ? `${s.sleep.bed} → ${s.sleep.wake}` : 'Configurar'}</b></div>
    <div class="small ${s.sleep.enabled ? '' : 'muted'}">${s.sleep.enabled ? `${s.sleep.cycles} ciclos · ${fmtHours((s.sleep.cycles * CYCLE) / 60)} · ajuste automático ativo` : 'Escolha dormir ou acordar e o app calcula o outro horário'}</div>
  </button>
  <div class="toolbar">
    <button class="btn primary sm" data-new-block>+ Bloco</button>
    <button class="btn sm" data-import>⇩ Importar texto / modelo</button>
    <button class="btn sm" data-copy-day>⧉ Copiar dia para…</button>
    <button class="btn sm" data-export-text>⇧ Exportar texto</button>
    <button class="btn sm" data-open-planner>✦ Assistente</button>
  </div>
  <div class="timeline">
    ${list.length ? timelineHTML(list, { showDays: true }) : `<div class="empty">Nenhum bloco em ${DAY_NAMES[dow]}.<br><br><button class="btn primary" data-import-template>Usar o modelo “${esc(TEMPLATE_NAME)}”</button></div>`}
  </div>
  ${list.length ? `<div class="row wrap" style="margin-top:12px"><button class="btn sm danger" data-clear-day>Limpar ${DAY_NAMES[dow]}</button></div>` : ''}`;
}

function openImportModal(prefill = '') {
  const s = getState();
  const dlg = $('#modal');
  let days = [1, 2, 3, 4, 5];
  let text = prefill;
  const draw = () => {
    const parsed = text.trim() ? parseRoutineText(text) : { blocks: [], periods: [] };
    dlg.innerHTML = `
    <div class="mbody">
      <div class="mhead"><h2>Importar rotina</h2><button type="button" class="btn ghost sm" data-close>✕</button></div>
      <p class="small muted" style="margin:0">Cole sua rotina em texto. Linhas com horário viram blocos (<code>06:15 às 07:30 – Estudo</code>), linhas com • abaixo viram detalhes e títulos com emoji viram períodos.</p>
      <button type="button" class="btn sm" data-fill-template>Usar modelo: ${esc(TEMPLATE_NAME)}</button>
      <textarea id="imp-text" rows="10" placeholder="🌅 Período da Manhã: Foco&#10;• 05:30 – Acordar&#10;• 06:15 às 07:30 – Estudo&#10;	• Leitura de PDF">${esc(text)}</textarea>
      <div class="small ${parsed.blocks.length ? '' : 'muted'}">${parsed.blocks.length ? `✓ ${parsed.blocks.length} blocos e ${parsed.periods.length} períodos reconhecidos${parsed.blocks.some((b) => b.system) ? ' · horários de sono detectados' : ''}` : 'Nenhum bloco reconhecido ainda.'}</div>
      <div class="field"><span class="flabel">Aplicar nos dias</span>
        <div class="days" id="imp-days">${dayOrder().map((x) => `<button type="button" data-d="${x}" class="${days.includes(x) ? 'on' : ''}">${DAY_SHORT[x]}</button>`).join('')}</div></div>
      <label class="switch"><span>Substituir os blocos existentes nesses dias</span><input type="checkbox" id="imp-replace" checked></label>
      <label class="switch"><span>Usar os períodos do texto como seções</span><input type="checkbox" id="imp-periods" ${parsed.periods.length ? 'checked' : ''}></label>
      <div class="mfoot"><span></span><div class="row"><button type="button" class="btn" data-close>Cancelar</button><button type="button" class="btn primary" data-do-import ${parsed.blocks.length ? '' : 'disabled'}>Importar</button></div></div>
    </div>`;
  };
  draw();
  dlg.onsubmit = null;
  dlg.oninput = (e) => {
    if (e.target.id !== 'imp-text') return;
    text = e.target.value;
    const pos = e.target.selectionStart;
    draw();
    const ta = $('#imp-text', dlg); ta.focus(); ta.setSelectionRange(pos, pos);
  };
  dlg.onclick = (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) { dlg.close(); return; }
    if (e.target.closest('[data-fill-template]')) { text = TEMPLATE_TEXT; draw(); return; }
    const db = e.target.closest('#imp-days [data-d]');
    if (db) { const x = Number(db.dataset.d); days = days.includes(x) ? days.filter((y) => y !== x) : [...days, x]; db.classList.toggle('on'); return; }
    if (e.target.closest('[data-do-import]')) {
      if (!days.length) { toast('Escolha ao menos um dia'); return; }
      const replace = $('#imp-replace', dlg).checked;
      const usePeriods = $('#imp-periods', dlg).checked;
      const { blocks, periods } = parseRoutineText(text);
      update((st) => importBlocks(st, blocks, periods, days, { replace, usePeriods }));
      dlg.close();
      ui.routineDay = days.includes(ui.routineDay) ? ui.routineDay : days[0];
      toast(`Rotina importada em ${daysLabel(days)} ✓`);
      recheck();
    }
  };
  dlg.showModal();
}

function importBlocks(st, blocks, periods, days, { replace, usePeriods }) {
  const catId = (k) => (st.categories.some((c) => c.id === k) ? k : st.categories[0].id);
  if (replace) {
    st.routines = st.routines
      .map((r) => (r.system ? r : { ...r, days: r.days.filter((d) => !days.includes(d)) }))
      .filter((r) => r.days.length);
  }
  if (usePeriods && periods.length) st.periods = periods.map((p) => ({ ...p, id: uid() }));

  const wake = blocks.find((b) => b.system === 'wake');
  const bed = blocks.find((b) => b.system === 'bed');
  for (const b of blocks) {
    if (b.system && ((b.system === 'wake' && bed) || (b.system === 'bed' && wake))) continue; // sono tratado abaixo
    st.routines.push({ id: uid(), title: b.title, badge: b.badge, start: b.start, end: b.end, notes: b.notes, category: catId(b.category), days: [...days].sort(), notify: null, skip: [], source: 'import' });
  }
  if (wake && bed) {
    const sl = st.sleep;
    const latency = sl.latency ?? 15;
    const prevDays = sl.enabled ? sl.days : [];
    Object.assign(sl, { enabled: true, anchor: 'wake', wake: wake.start, bed: bed.start, latency, cycles: inferCycles(bed.start, wake.start, latency), days: [...new Set([...prevDays, ...days])].sort() });
    syncSleep(st);
    // Ajusta o horário exato de dormir informado (o cálculo arredonda para ciclos inteiros)
    const w = st.routines.find((r) => r.system === 'wake');
    const bd = st.routines.find((r) => r.system === 'bed');
    if (w) { w.title = wake.title; w.notes = wake.notes; w.category = catId('saude'); }
    if (bd) { bd.title = bed.title; bd.notes = bed.notes; bd.category = catId('saude'); }
  }
}

function openCopyDayModal() {
  const from = ui.routineDay;
  let days = [];
  const dlg = $('#modal');
  dlg.innerHTML = `
    <div class="mbody">
      <div class="mhead"><h2>Copiar ${DAY_NAMES[from]} para…</h2><button type="button" class="btn ghost sm" data-close>✕</button></div>
      <div class="days" id="cp-days">${dayOrder().filter((x) => x !== from).map((x) => `<button type="button" data-d="${x}">${DAY_SHORT[x]}</button>`).join('')}</div>
      <label class="switch"><span>Substituir o que já existe nos dias escolhidos</span><input type="checkbox" id="cp-replace" checked></label>
      <div class="mfoot"><span></span><div class="row"><button type="button" class="btn" data-close>Cancelar</button><button type="button" class="btn primary" data-do-copy>Copiar</button></div></div>
    </div>`;
  dlg.onsubmit = null;
  dlg.oninput = null;
  dlg.onclick = (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) { dlg.close(); return; }
    const db = e.target.closest('#cp-days [data-d]');
    if (db) { const x = Number(db.dataset.d); days = days.includes(x) ? days.filter((y) => y !== x) : [...days, x]; db.classList.toggle('on'); return; }
    if (e.target.closest('[data-do-copy]')) {
      if (!days.length) { toast('Escolha ao menos um dia'); return; }
      const replace = $('#cp-replace', dlg).checked;
      update((st) => {
        if (replace) {
          st.routines = st.routines
            .map((r) => (r.system || r.days.includes(from) ? r : { ...r, days: r.days.filter((d) => !days.includes(d)) }))
            .filter((r) => r.days.length);
        }
        st.routines.forEach((r) => { if (!r.system && r.days.includes(from)) r.days = [...new Set([...r.days, ...days])].sort(); });
      });
      dlg.close();
      toast(`Copiado para ${daysLabel(days)}`);
    }
  };
  dlg.showModal();
}

function openExportTextModal() {
  const s = getState();
  const dow = ui.routineDay;
  const list = s.routines.filter((r) => r.days.includes(dow)).sort(byTime);
  const text = routineToText(list, s.periods, `Rotina de ${DAY_NAMES[dow]}`);
  const dlg = $('#modal');
  dlg.innerHTML = `
    <div class="mbody">
      <div class="mhead"><h2>Rotina em texto</h2><button type="button" class="btn ghost sm" data-close>✕</button></div>
      <textarea rows="14" readonly id="exp-text">${esc(text)}</textarea>
      <div class="mfoot"><span class="small muted">Compartilhe ou guarde como modelo.</span><button type="button" class="btn primary" data-copy-text>Copiar</button></div>
    </div>`;
  dlg.onsubmit = null;
  dlg.oninput = null;
  dlg.onclick = async (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) { dlg.close(); return; }
    if (e.target.closest('[data-copy-text]')) {
      try { await navigator.clipboard.writeText(text); toast('Texto copiado'); } catch { $('#exp-text', dlg).select(); toast('Selecione e copie o texto'); }
    }
  };
  dlg.showModal();
}

/* ---------- Agenda ---------- */
function renderAgenda() {
  const mode = ui.agendaMode;
  const tabs = `<div class="seg agenda-tabs">${[['day', 'Dia'], ['week', 'Semana'], ['month', 'Mês']].map(([v, l]) => `<button type="button" data-amode="${v}" class="${mode === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  return tabs + (mode === 'day' ? renderDay() : mode === 'week' ? renderWeek() : renderMonth());
}

function renderDay() {
  const iso = ui.date;
  const d = fromISODate(iso);
  const isToday = iso === todayISO();
  const nowMin = isToday ? nowMinutes() : null;
  const items = itemsForDate(iso);
  const tasks = items.filter((i) => i.kind === 'task');
  const done = items.filter((i) => i.done).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  const label = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return `
  <div class="daynav">
    <button class="round" data-day="-1" aria-label="Dia anterior">‹</button>
    <div class="label"><strong>${esc(label)}</strong>${isToday ? '<span class="small muted">Hoje</span>' : '<button class="btn ghost sm" data-day="0">Voltar para hoje</button>'}</div>
    <button class="round" data-day="1" aria-label="Próximo dia">›</button>
  </div>
  <form class="quickadd" id="quickadd" autocomplete="off">
    <input type="text" name="q" placeholder="Compromisso rápido… (ex: 14:30 dentista)" aria-label="Adicionar compromisso rápido">
    <button class="btn primary">Adicionar</button>
  </form>
  <div class="row spread small muted" style="margin:10px 2px">
    <span>${tasks.length} compromisso(s) · ${items.length - tasks.length} bloco(s) de rotina</span><span>${done}/${items.length} · ${pct}%</span>
  </div>
  <div class="progress"><span style="width:${pct}%"></span></div>
  <div class="timeline" style="margin-top:12px">${items.length ? timelineHTML(items, { checks: true, nowMin }) : '<div class="empty">Dia livre. Toque em <b>+</b> para adicionar um compromisso detalhado.</div>'}</div>`;
}

function renderWeek() {
  const s = getState();
  const start = weekStart(ui.weekAnchor, s.settings.weekStartsMonday);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const tISO = todayISO();
  const byCat = {};
  let total = 0, done = 0;
  const cols = days.map((d) => {
    const iso = toISODate(d);
    const items = itemsForDate(iso);
    items.forEach((i) => { if (!i.system) byCat[i.category] = (byCat[i.category] || 0) + durationMin(i); total++; if (i.done) done++; });
    return `<div class="wday ${iso === tISO ? 'today' : ''}">
      <div class="wday-h" data-goto="${iso}"><strong>${DAY_SHORT[d.getDay()]}</strong><span>${d.getDate()}/${d.getMonth() + 1}</span></div>
      ${items.map((i) => { const c = catById(i.category); return `<div class="chip ${i.done ? 'done' : ''} ${i.kind === 'task' ? 'task' : ''}" style="border-color:${c.color}" data-edit="${i.kind}:${i.id}" data-date="${iso}">${i.start ? `<span class="t">${i.start}${i.end ? '–' + i.end : ''}</span>` : ''}${i.kind === 'task' ? '📌 ' : ''}${esc(i.title)}</div>`; }).join('') || '<span class="small muted">—</span>'}
    </div>`;
  }).join('');
  const end = days[6];
  const range = `${start.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}`;
  return `
  <div class="week-head">
    <button class="round" data-week="-1" aria-label="Semana anterior">‹</button>
    <div style="text-align:center"><strong>${range}</strong><br><button class="btn ghost sm" data-week="0">Semana atual</button></div>
    <button class="round" data-week="1" aria-label="Próxima semana">›</button>
  </div>
  <div class="week-grid">${cols}</div>
  <div class="section-title"><h2>Horas planejadas por área</h2><span class="small muted">${done}/${total} concluídos</span></div>
  <div class="card">${barsHTML(byCat, null)}</div>`;
}

function renderMonth() {
  const s = getState();
  const a = ui.monthAnchor;
  const first = new Date(a.getFullYear(), a.getMonth(), 1);
  const start = weekStart(first, s.settings.weekStartsMonday);
  const tISO = todayISO();
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const byDate = {};
  for (const t of s.tasks) (byDate[t.date] ||= []).push(t);
  const label = first.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return `
  <div class="week-head">
    <button class="round" data-month="-1" aria-label="Mês anterior">‹</button>
    <div style="text-align:center"><strong style="text-transform:capitalize">${label}</strong><br><button class="btn ghost sm" data-month="0">Mês atual</button></div>
    <button class="round" data-month="1" aria-label="Próximo mês">›</button>
  </div>
  <div class="month">
    ${dayOrder().map((d) => `<div class="mh">${DAY_SHORT[d]}</div>`).join('')}
    ${cells.map((d) => {
      const iso = toISODate(d);
      const list = (byDate[iso] || []).sort((x, y) => (toMin(x.start) ?? 9999) - (toMin(y.start) ?? 9999));
      return `<button class="mc ${d.getMonth() !== first.getMonth() ? 'out' : ''} ${iso === tISO ? 'today' : ''}" data-goto="${iso}">
        <span class="n">${d.getDate()}</span>
        ${list.slice(0, 3).map((t) => `<span class="ev ${t.done ? 'done' : ''}" style="--c:${catById(t.category).color}">${t.start ? t.start + ' ' : ''}${esc(t.title)}</span>`).join('')}
        ${list.length > 3 ? `<span class="more">+${list.length - 3}</span>` : ''}
      </button>`;
    }).join('')}
  </div>
  <p class="small muted" style="text-align:center">O mês mostra os compromissos da agenda (📌). A rotina fixa aparece nas visões Dia e Semana.</p>`;
}

/** Interpreta "14:30 dentista", "dentista 14h", "9h-10h reunião" */
function parseQuick(text) {
  let title = text.trim();
  let start = '', end = '';
  const range = title.match(/\b(\d{1,2})(?:[:h](\d{2})?)?\s*(?:-|–|às|a)\s*(\d{1,2})(?:[:h](\d{2})?)?\b/i);
  const single = title.match(/\b(\d{1,2})(?::(\d{2})|h(\d{2})?)\b/i);
  const hm = (h, m) => (Number(h) < 24 && Number(m || 0) < 60 ? `${String(h).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}` : '');
  if (range && (range[0].includes(':') || /h/i.test(range[0]))) {
    start = hm(range[1], range[2]); end = hm(range[3], range[4]);
    title = title.replace(range[0], '');
  } else if (single) {
    start = hm(single[1], single[2] || single[3]);
    title = title.replace(single[0], '');
  }
  title = title.replace(/(^|\s)(às|as)\s*$/i, '').replace(/\s{2,}/g, ' ').replace(/^\s*[-–,:]\s*|\s*[-–,:]\s*$/g, '').trim() || text.trim();
  return { title, start, end };
}


/* ---------- Modal de item ---------- */
function openItemModal({ kind = 'task', id = null, date = ui.date, preset = {} } = {}) {
  const s = getState();
  const src = id ? (kind === 'routine' ? s.routines : s.tasks).find((x) => x.id === id) : null;
  const it = src ? { ...src } : { title: '', badge: '', location: '', category: s.categories[0]?.id, start: '', end: '', notes: '', notify: null, days: [date ? fromISODate(date).getDay() : ui.routineDay], date: date || todayISO(), ...preset };
  let type = src ? kind : (preset.kind || 'task');
  const dlg = $('#modal');
  const sleepLocked = src?.system && s.sleep.enabled;

  const draw = () => {
    dlg.innerHTML = `
    <form method="dialog" id="item-form">
      <div class="mhead"><h2>${src ? 'Editar' : 'Novo'} ${type === 'routine' ? 'bloco da rotina' : 'compromisso'}</h2><button type="button" class="btn ghost sm" data-close>✕</button></div>
      ${src ? '' : `<div class="seg" role="tablist">
        <button type="button" data-type="task" class="${type === 'task' ? 'on' : ''}">📌 Compromisso (agenda)</button>
        <button type="button" data-type="routine" class="${type === 'routine' ? 'on' : ''}">↻ Bloco fixo (rotina)</button>
      </div>`}
      <label class="field"><span>Título</span><input type="text" name="title" required value="${esc(it.title)}" placeholder="${type === 'routine' ? 'Ex: Bloco de Estudos 1' : 'Ex: Consulta no dentista'}"></label>
      <div class="grid2">
        <label class="field"><span>Categoria</span><select name="category">${catOptions(it.category)}</select></label>
        ${type === 'task'
          ? `<label class="field"><span>Data</span><input type="date" name="date" value="${it.date || date || todayISO()}" required></label>`
          : `<label class="field"><span>Etiqueta (opcional)</span><input type="text" name="badge" value="${esc(it.badge || '')}" placeholder="Ex: 1h líquida"></label>`}
      </div>
      ${type === 'routine' ? `<div class="field"><span class="flabel">Dias da semana</span>
        <div class="days" id="days">${dayOrder().map((d) => `<button type="button" data-d="${d}" class="${it.days.includes(d) ? 'on' : ''}" ${sleepLocked ? 'disabled' : ''}>${DAY_SHORT[d]}</button>`).join('')}</div></div>` : ''}
      ${sleepLocked ? `<div class="note warn">⏰ Horário calculado pela calculadora de sono. <button type="button" class="btn sm" data-open-sleep>Ajustar sono</button></div>` : ''}
      <div class="grid3">
        <label class="field"><span>Início</span><input type="time" name="start" value="${it.start || ''}" ${type === 'routine' ? 'required' : ''} ${sleepLocked ? 'disabled' : ''}></label>
        <label class="field"><span>Fim</span><input type="time" name="end" value="${it.end || ''}" ${sleepLocked ? 'disabled' : ''}></label>
        <label class="field"><span>Lembrete</span><select name="notify">
          <option value="">Padrão (${s.settings.defaultNotify < 0 ? 'nenhum' : s.settings.defaultNotify + ' min'})</option>
          ${NOTIFY_OPTS.map(([v, l]) => `<option value="${v}" ${it.notify === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>
      </div>
      ${type === 'task' ? `<label class="field"><span>Local (opcional)</span><input type="text" name="location" value="${esc(it.location || '')}" placeholder="Ex: Clínica Centro, sala 3"></label>` : ''}
      <label class="field"><span>Detalhes — um por linha</span><textarea name="notes" rows="4" placeholder="Ex: Foco em teoria / leitura de PDF&#10;Celular no silencioso">${esc(it.notes || '')}</textarea></label>
      <div class="mfoot">
        <div class="row wrap">
          ${src ? '<button type="button" class="btn danger" data-del>Excluir</button>' : ''}
          ${src && type === 'routine' && date ? `<button type="button" class="btn" data-skip>Pular só em ${fromISODate(date).toLocaleDateString('pt-BR', { day: 'numeric', month: 'numeric' })}</button>` : ''}
          ${src && type === 'task' ? '<button type="button" class="btn" data-dup>Duplicar</button>' : ''}
        </div>
        <div class="row"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Salvar</button></div>
      </div>
    </form>`;
  };
  draw();

  dlg.oninput = null;
  dlg.onclick = (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) { dlg.close(); return; }
    if (e.target.closest('[data-open-sleep]')) { dlg.close(); openSleepModal(); return; }
    const tb = e.target.closest('[data-type]');
    if (tb) { readForm(); type = tb.dataset.type; draw(); return; }
    const db = e.target.closest('#days [data-d]');
    if (db) {
      const d = Number(db.dataset.d);
      it.days = it.days.includes(d) ? it.days.filter((x) => x !== d) : [...it.days, d];
      db.classList.toggle('on');
      return;
    }
    if (e.target.closest('[data-del]')) {
      if (!confirm(type === 'routine' ? 'Excluir este bloco de todos os dias da semana?' : 'Excluir este compromisso?')) return;
      update((st) => {
        if (type === 'routine') st.routines = st.routines.filter((r) => r.id !== id);
        else st.tasks = st.tasks.filter((t) => t.id !== id);
        if (src.system) st.sleep.enabled = false;
      });
      dlg.close();
      toast('Excluído');
      return;
    }
    if (e.target.closest('[data-skip]')) {
      update((st) => { const r = st.routines.find((x) => x.id === id); r.skip = [...new Set([...(r.skip || []), date])]; });
      dlg.close();
      toast('Ocultado apenas neste dia');
      return;
    }
    if (e.target.closest('[data-dup]')) {
      readForm();
      update((st) => { st.tasks.push({ ...structuredClone(src), ...pick(it), id: uid(), done: false, date: toISODate(addDays(fromISODate(it.date), 1)) }); });
      dlg.close();
      toast('Duplicado para o dia seguinte');
    }
  };

  const pick = (o) => ({ title: o.title.trim(), category: o.category, start: o.start, end: o.end, notes: o.notes, notify: o.notify });

  function readForm() {
    const f = $('#item-form');
    if (!f) return;
    const fd = new FormData(f);
    it.title = fd.get('title');
    it.category = fd.get('category');
    if (!sleepLocked) { it.start = fd.get('start') ?? it.start; it.end = fd.get('end') ?? it.end; }
    it.notes = fd.get('notes');
    it.notify = fd.get('notify') === '' ? null : Number(fd.get('notify'));
    if (fd.has('date')) it.date = fd.get('date');
    if (fd.has('badge')) it.badge = fd.get('badge').trim();
    if (fd.has('location')) it.location = fd.get('location').trim();
  }

  dlg.onsubmit = (e) => {
    e.preventDefault();
    readForm();
    if (!it.title.trim()) return;
    if (type === 'routine' && !it.days.length) { toast('Escolha ao menos um dia da semana'); return; }
    update((st) => {
      if (type === 'routine') {
        const data = { ...pick(it), badge: it.badge || '', days: [...it.days].sort() };
        if (src) Object.assign(st.routines.find((r) => r.id === id), data);
        else st.routines.push({ id: uid(), source: 'manual', skip: [], ...data });
      } else {
        const data = { ...pick(it), date: it.date, location: it.location || '' };
        if (src) Object.assign(st.tasks.find((t) => t.id === id), data);
        else st.tasks.push({ id: uid(), done: false, ...data });
      }
    });
    dlg.close();
    toast(src ? 'Alterações salvas' : 'Adicionado');
    recheck();
  };

  dlg.showModal();
  setTimeout(() => $('input[name=title]', dlg)?.focus(), 30);
}

/* ---------- Planejador ---------- */
function plannerAnswers() {
  if (!ui.answers) {
    const s = getState();
    ui.answers = structuredClone({ ...DEFAULT_ANSWERS, ...(s.plannerAnswers || {}) });
    if (s.sleep.enabled) { ui.answers.wake = s.sleep.wake; ui.answers.sleep = s.sleep.bed; }
  }
  return ui.answers;
}

function seg(name, value, opts) {
  return `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${String(value) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
function dayPick(name, values) {
  const order = getState().settings.weekStartsMonday ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
  return `<div class="days" data-dayset="${name}">${order.map((d) => `<button type="button" data-d="${d}" class="${values.includes(d) ? 'on' : ''}">${DAY_SHORT[d]}</button>`).join('')}</div>`;
}

const STEPS = ['Rotina básica', 'Trabalho', 'Estudo e saúde', 'Família e metas', 'Resultado'];

function renderPlanner() {
  const a = plannerAnswers();
  const st = ui.plannerStep;
  const s = getState();
  let body = '';

  if (st === 0) {
    body = `
      <h2>Como é o seu dia?</h2>
      <p class="muted small">Dica: para uma rotina no seu próprio estilo, use <b>Importar texto / modelo</b> na aba Rotina. Aqui, responda algumas perguntas e o planejador monta uma rotina semanal equilibrada. Tudo pode ser editado depois.</p>
      <div class="grid2">
        <label class="field"><span>Que horas você acorda?</span><input type="time" data-a="wake" value="${a.wake}"></label>
        <label class="field"><span>Que horas vai dormir?</span><input type="time" data-a="sleep" value="${a.sleep}"></label>
      </div>
      <div class="field"><span class="small muted" style="font-weight:500">Em que período você tem mais energia e foco?</span>${seg('energy', a.energy, PERIODS)}</div>
      <label class="switch"><span>Incluir rotina matinal (30 min)</span><input type="checkbox" data-a="morningRoutine" ${a.morningRoutine ? 'checked' : ''}></label>
      <label class="switch"><span>Incluir 10 min para planejar o dia</span><input type="checkbox" data-a="dailyPlanning" ${a.dailyPlanning ? 'checked' : ''}></label>
      <label class="switch"><span>Reservar horário de almoço</span><input type="checkbox" data-a="lunch" ${a.lunch ? 'checked' : ''}></label>
      ${a.lunch ? `<label class="field"><span>Início do almoço</span><input type="time" data-a="lunchStart" value="${a.lunchStart}"></label>` : ''}`;
  } else if (st === 1) {
    body = `
      <h2>Trabalho</h2>
      <label class="switch"><span>Tenho horário fixo de trabalho</span><input type="checkbox" data-a="hasWork" ${a.hasWork ? 'checked' : ''}></label>
      ${a.hasWork ? `
        <div class="field"><span class="small muted" style="font-weight:500">Dias de trabalho</span>${dayPick('workDays', a.workDays)}</div>
        <div class="grid2">
          <label class="field"><span>Entrada</span><input type="time" data-a="workStart" value="${a.workStart}"></label>
          <label class="field"><span>Saída</span><input type="time" data-a="workEnd" value="${a.workEnd}"></label>
        </div>` : '<p class="muted small">Sem problema — o planejador vai usar seus horários livres de forma flexível.</p>'}
      <div class="field"><span class="small muted" style="font-weight:500">Dia mais leve para descanso</span>${seg('restDay', a.restDay, [[-1, 'Nenhum'], ...[0, 6, 1, 2, 3, 4, 5].map((d) => [d, DAY_SHORT[d]])])}</div>
      <label class="switch"><span>Revisão semanal no domingo (30 min)</span><input type="checkbox" data-a="weeklyReview" ${a.weeklyReview ? 'checked' : ''}></label>`;
  } else if (st === 2) {
    body = `
      <h2>Estudo e saúde</h2>
      <div class="grid2">
        <label class="field"><span>Horas de estudo por semana</span><input type="number" min="0" max="60" step="1" data-a="studyHours" data-num value="${a.studyHours}"></label>
        <label class="field"><span>Duração de cada sessão</span><select data-a="studySession" data-num>${[[25, '25 min'], [45, '45 min'], [60, '1 hora'], [90, '1h30'], [120, '2 horas']].map(([v, l]) => `<option value="${v}" ${a.studySession == v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <div class="field"><span class="small muted" style="font-weight:500">Período preferido para estudar</span>${seg('studyPeriod', a.studyPeriod, [['auto', 'Automático'], ...PERIODS])}</div>
      <div class="field"><span class="small muted" style="font-weight:500">Dias disponíveis para estudo</span>${dayPick('studyDays', a.studyDays)}</div>
      <hr style="border:0;border-top:1px solid var(--border);width:100%">
      <div class="grid2">
        <label class="field"><span>Exercício: vezes por semana</span><input type="number" min="0" max="7" data-a="exerciseTimes" data-num value="${a.exerciseTimes}"></label>
        <label class="field"><span>Duração (min)</span><input type="number" min="10" max="180" step="5" data-a="exerciseDuration" data-num value="${a.exerciseDuration}"></label>
      </div>
      <div class="field"><span class="small muted" style="font-weight:500">Período para exercício</span>${seg('exercisePeriod', a.exercisePeriod, PERIODS)}</div>`;
  } else if (st === 3) {
    body = `
      <h2>Família e metas pessoais</h2>
      <div class="field"><span class="small muted" style="font-weight:500">Quanto tempo de qualidade com a família você quer garantir?</span>${seg('family', a.family, [['baixa', 'Um pouco'], ['media', 'Equilibrado'], ['alta', 'Prioridade']])}</div>
      <div class="field"><span class="small muted" style="font-weight:500">Outras metas semanais (ex: leitura, projeto pessoal, idioma, meditação)</span></div>
      <div class="stack" id="goals">
        ${a.goals.map((g, i) => `<div class="goal-row" data-goal="${i}">
          <label class="field"><span>Meta</span><input type="text" data-g="name" value="${esc(g.name)}" placeholder="Ex: Leitura"></label>
          <label class="field"><span>Horas/sem</span><input type="number" min="0" max="40" step="0.5" data-g="hours" value="${g.hours}"></label>
          <label class="field"><span>Categoria</span><select data-g="category">${catOptions(g.category)}</select></label>
          <button type="button" class="btn ghost sm" data-delgoal="${i}" aria-label="Remover meta">✕</button>
        </div>`).join('')}
      </div>
      <button type="button" class="btn" data-addgoal>+ Adicionar meta</button>`;
  } else {
    const plan = ui.plan;
    const byCat = {};
    for (const r of plan.routines) byCat[r.category] = (byCat[r.category] || 0) + durationMin(r) * r.days.length;
    const order = s.settings.weekStartsMonday ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
    const existing = s.routines.filter((r) => r.source === 'planner').length;
    body = `
      <h2>Sua rotina sugerida</h2>
      <p class="muted small">${plan.routines.length} compromissos fixos gerados. Revise e aplique — depois você pode editar qualquer item na aba Semana.</p>
      ${plan.warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join('')}
      <div class="card">${barsHTML(byCat, null)}</div>
      <div class="week-grid">
        ${order.map((d) => {
          const list = plan.routines.filter((r) => r.days.includes(d)).sort((x, y) => toMin(x.start) - toMin(y.start));
          return `<div class="wday"><div class="wday-h"><strong>${DAY_SHORT[d]}</strong></div>${list.map((r) => { const c = catById(r.category); return `<div class="chip" style="border-color:${c.color};cursor:default"><span class="t">${r.start}–${r.end}</span>${esc(r.title)}</div>`; }).join('')}</div>`;
        }).join('')}
      </div>
      <div class="card"><h3 style="margin-bottom:8px">Dicas para sua semana</h3><ul class="tips">${plan.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
      ${existing ? `<label class="switch card"><span>Substituir a rotina gerada anteriormente (${existing} itens). Seus itens criados manualmente são mantidos.</span><input type="checkbox" id="replace-old" checked></label>` : ''}`;
  }

  return `
  <div class="steps">${STEPS.map((_, i) => `<span class="${i <= st ? 'on' : ''}"></span>`).join('')}</div>
  <div class="card stack" id="planner">
    <div class="small muted">Passo ${st + 1} de ${STEPS.length} · ${STEPS[st]}</div>
    ${body}
    <div class="mfoot">
      ${st > 0 ? '<button class="btn" data-pstep="-1">Voltar</button>' : '<span></span>'}
      ${st < 3 ? '<button class="btn primary" data-pstep="1">Continuar</button>'
        : st === 3 ? '<button class="btn primary" data-pstep="1">✦ Gerar rotina</button>'
        : '<button class="btn primary" data-apply>Aplicar à minha agenda</button>'}
    </div>
  </div>`;
}

function ensureCategory(key, name, color) {
  const s = getState();
  if (s.categories.some((c) => c.id === key)) return key;
  if (!name) return s.categories[0]?.id || key;
  const byName = s.categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (byName) return byName.id;
  s.categories.push({ id: key, name, color });
  return key;
}

function bindPlanner(e) {
  const a = plannerAnswers();
  const segBtn = e.target.closest('[data-seg] [data-v]');
  if (segBtn) {
    const name = segBtn.parentElement.dataset.seg;
    const v = segBtn.dataset.v;
    a[name] = /^-?\d+$/.test(v) ? Number(v) : v;
    render();
    return true;
  }
  const dayBtn = e.target.closest('[data-dayset] [data-d]');
  if (dayBtn) {
    const name = dayBtn.parentElement.dataset.dayset;
    const d = Number(dayBtn.dataset.d);
    a[name] = a[name].includes(d) ? a[name].filter((x) => x !== d) : [...a[name], d];
    dayBtn.classList.toggle('on');
    return true;
  }
  if (e.target.closest('[data-addgoal]')) { a.goals.push({ name: '', hours: 2, category: 'pessoal' }); render(); return true; }
  const dg = e.target.closest('[data-delgoal]');
  if (dg) { a.goals.splice(Number(dg.dataset.delgoal), 1); render(); return true; }
  const step = e.target.closest('[data-pstep]');
  if (step) {
    const dir = Number(step.dataset.pstep);
    if (dir > 0 && ui.plannerStep === 3) {
      update((s) => { s.plannerAnswers = structuredClone(a); });
      ui.plan = generatePlan(a, ensureCategory);
      update(() => {}); // persiste categorias criadas pelo planejador
    }
    ui.plannerStep = Math.max(0, Math.min(4, ui.plannerStep + dir));
    render();
    window.scrollTo({ top: 0 });
    return true;
  }
  if (e.target.closest('[data-apply]')) {
    const replace = $('#replace-old')?.checked ?? true;
    update((s) => {
      if (replace) s.routines = s.routines.filter((r) => r.source !== 'planner');
      s.routines.push(...ui.plan.routines);
      s.onboarded = true;
    });
    toast('Rotina aplicada! Edite qualquer item tocando nele.');
    ui.plannerStep = 0;
    ui.plan = null;
    setView('routine');
    return true;
  }
  return false;
}

function onPlannerInput(e) {
  const a = plannerAnswers();
  const el = e.target;
  if (el.dataset.a) {
    const k = el.dataset.a;
    if (el.type === 'checkbox') { a[k] = el.checked; render(); }
    else a[k] = el.dataset.num !== undefined ? Number(el.value) : el.value;
  }
  const row = el.closest('[data-goal]');
  if (row && el.dataset.g) {
    const g = a.goals[Number(row.dataset.goal)];
    g[el.dataset.g] = el.dataset.g === 'hours' ? Number(el.value) : el.value;
  }
}


/* ---------- Ajustes ---------- */
function renderSettings() {
  const s = getState();
  const perm = permission();
  const permText = { granted: 'Permitidas', denied: 'Bloqueadas no navegador', default: 'Ainda não permitidas', unsupported: 'Não suportadas neste navegador' }[perm];
  const periods = [...s.periods].sort((a, b) => toMin(a.start) - toMin(b.start));
  return `
  <div class="stack">
    <div class="section-title"><h2>Notificações</h2></div>
    <div class="card stack">
      <div class="switch"><span>Lembretes dos blocos e compromissos<br><span class="small muted">Status: ${permText}</span></span>
        <input type="checkbox" id="set-notify" ${s.settings.notifications && perm === 'granted' ? 'checked' : ''} ${perm === 'unsupported' ? 'disabled' : ''}></div>
      <label class="field"><span>Lembrete padrão</span><select id="set-default-notify">${NOTIFY_OPTS.map(([v, l]) => `<option value="${v}" ${s.settings.defaultNotify === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="row wrap"><button class="btn sm" id="test-notify">Testar notificação</button><button class="btn sm" id="export-ics">Exportar para Google Agenda / Calendário (.ics)</button></div>
      <p class="small muted" style="margin:0">No iPhone: abra o site no Safari → Compartilhar → “Adicionar à Tela de Início” e abra pelo ícone para permitir notificações. Os lembretes funcionam com o app aberto ou em segundo plano; para alertas garantidos com o app fechado, exporte o .ics para o calendário do celular.${perm === 'denied' ? ' <b>As notificações estão bloqueadas: libere nas configurações do navegador.</b>' : ''}</p>
    </div>

    <div class="section-title"><h2>Sono</h2></div>
    <button class="card sleep-card wide" data-sleep>
      <div><span class="small muted">Ciclos de 90 min</span><b>${s.sleep.enabled ? `${s.sleep.bed} → ${s.sleep.wake}` : 'Desativado'}</b></div>
      <div class="small muted">${s.sleep.enabled ? `${s.sleep.cycles} ciclos · ${s.sleep.latency} min para adormecer · ${daysLabel(s.sleep.days)}` : 'Toque para configurar'}</div>
    </button>

    <div class="section-title"><h2>Períodos do dia</h2><span class="small muted">seções da rotina</span></div>
    <div class="card stack" id="periods">
      ${periods.map((p) => `<div class="period-row" data-per="${p.id}">
        <input type="text" value="${esc(p.emoji)}" data-pf="emoji" aria-label="Emoji" maxlength="4">
        <input type="text" value="${esc(p.name)}" data-pf="name" aria-label="Nome" placeholder="Nome">
        <input type="time" value="${p.start}" data-pf="start" aria-label="Começa às">
        <button class="btn ghost sm" data-perdel aria-label="Excluir período">✕</button>
        <input type="text" value="${esc(p.subtitle)}" data-pf="subtitle" class="sub" placeholder="Subtítulo (ex: Conexão e Foco Renovado)" aria-label="Subtítulo">
      </div>`).join('')}
      <button class="btn sm" id="add-period">+ Novo período</button>
    </div>

    <div class="section-title"><h2>Categorias</h2></div>
    <div class="card stack" id="cats">
      ${s.categories.map((c) => `<div class="cat-row" data-cat="${c.id}">
        <input type="color" value="${c.color}" data-catcolor aria-label="Cor">
        <input type="text" value="${esc(c.name)}" data-catname aria-label="Nome">
        <button class="btn ghost sm" data-catdel aria-label="Excluir categoria">✕</button>
      </div>`).join('')}
      <button class="btn sm" id="add-cat">+ Nova categoria</button>
    </div>

    <div class="section-title"><h2>Preferências</h2></div>
    <div class="card stack">
      <div class="field"><span class="flabel">Tema</span>${seg('theme', s.settings.theme, [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']])}</div>
      <div class="field"><span class="flabel">Semana começa em</span>${seg('weekStartsMonday', s.settings.weekStartsMonday ? 1 : 0, [[1, 'Segunda'], [0, 'Domingo']])}</div>
    </div>

    <div class="section-title"><h2>Dados</h2></div>
    <div class="card stack">
      <p class="small muted" style="margin:0">Seus dados ficam salvos apenas neste dispositivo. Faça backup para levar a outro aparelho.</p>
      <div class="row wrap">
        <button class="btn sm" id="export-json">Exportar backup</button>
        <label class="btn sm">Importar backup<input type="file" accept="application/json,.json" id="import-json" hidden></label>
        <button class="btn sm" id="clear-done">Limpar compromissos concluídos</button>
        <button class="btn sm danger" id="reset">Apagar tudo</button>
      </div>
    </div>
    <p class="small muted" style="text-align:center">Cronograma Semanal · funciona offline</p>
  </div>`;
}

function bindSettings(e) {
  const s = getState();
  const segBtn = e.target.closest('[data-seg] [data-v]');
  if (segBtn) {
    const name = segBtn.parentElement.dataset.seg;
    const v = segBtn.dataset.v;
    update((st) => { st.settings[name] = name === 'weekStartsMonday' ? v === '1' : v; });
    return true;
  }
  if (e.target.id === 'test-notify') {
    if (permission() !== 'granted') requestPermission().then((p) => { if (p === 'granted') testNotification(); else toast('Permissão não concedida'); });
    else testNotification();
    return true;
  }
  if (e.target.id === 'export-ics') { download('cronograma-semanal.ics', buildICS(), 'text/calendar'); toast('Arquivo .ics gerado — abra-o para importar no calendário'); return true; }
  if (e.target.id === 'export-json') { download(`cronograma-backup-${todayISO()}.json`, JSON.stringify(s, null, 2), 'application/json'); return true; }
  if (e.target.id === 'add-cat') { update((st) => { st.categories.push({ id: uid(), name: 'Nova categoria', color: '#6b8fa3' }); }); return true; }
  if (e.target.id === 'add-period') { update((st) => { st.periods.push({ id: uid(), emoji: '⭐', name: 'Novo período', subtitle: '', start: '12:00' }); }); return true; }
  const pd = e.target.closest('[data-perdel]');
  if (pd) {
    if (s.periods.length <= 1) { toast('Mantenha ao menos um período'); return true; }
    update((st) => { st.periods = st.periods.filter((p) => p.id !== pd.closest('[data-per]').dataset.per); });
    return true;
  }
  if (e.target.id === 'clear-done') {
    const n = s.tasks.filter((t) => t.done).length;
    if (n && confirm(`Remover ${n} compromisso(s) concluído(s)?`)) update((st) => { st.tasks = st.tasks.filter((t) => !t.done); });
    else if (!n) toast('Nenhum compromisso concluído');
    return true;
  }
  if (e.target.id === 'reset') {
    if (confirm('Apagar todos os dados deste dispositivo? Esta ação não pode ser desfeita.')) { resetState(); toast('Dados apagados'); }
    return true;
  }
  const del = e.target.closest('[data-catdel]');
  if (del) {
    const id = del.closest('[data-cat]').dataset.cat;
    if (s.categories.length <= 1) { toast('Mantenha ao menos uma categoria'); return true; }
    const used = s.routines.some((r) => r.category === id) || s.tasks.some((t) => t.category === id);
    if (used && !confirm('Há itens nesta categoria. Eles serão movidos para a primeira categoria. Continuar?')) return true;
    update((st) => {
      st.categories = st.categories.filter((c) => c.id !== id);
      const fallback = st.categories[0].id;
      st.routines.forEach((r) => { if (r.category === id) r.category = fallback; });
      st.tasks.forEach((t) => { if (t.category === id) t.category = fallback; });
    });
    return true;
  }
  return false;
}

/* ---------- Eventos globais ---------- */
function bind() {
  $$('.tabbar button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#fab').addEventListener('click', () => {
    if (ui.view === 'routine') openItemModal({ preset: { kind: 'routine', days: [ui.routineDay] }, date: null });
    else openItemModal({ date: ui.view === 'agenda' ? ui.date : todayISO() });
  });
  $('#btn-notify-status').addEventListener('click', async () => {
    if (!supported()) { toast('Este navegador não suporta notificações. No iPhone, adicione o app à Tela de Início.'); return; }
    const s = getState();
    if (s.settings.notifications && permission() === 'granted') { setView('settings'); return; }
    const p = await requestPermission();
    toast(p === 'granted' ? 'Lembretes ativados 🔔' : 'Permissão negada — libere nas configurações do navegador');
    render();
  });

  const view = $('#view');
  view.addEventListener('click', (e) => {
    if (ui.view === 'planner' && bindPlanner(e)) return;
    if (ui.view === 'settings' && bindSettings(e)) return;
    const t = e.target;

    if (t.closest('[data-sleep]')) { openSleepModal(); return; }
    const tg = t.closest('[data-toggle]');
    if (tg) { const [kind, id, date] = tg.dataset.toggle.split(':'); toggleDone({ kind, id, date }); return; }
    const ed = t.closest('[data-edit]');
    if (ed) {
      const [kind, id] = ed.dataset.edit.split(':');
      openItemModal({ kind, id, date: ed.dataset.date || (ui.view === 'routine' ? null : ui.date) });
      return;
    }
    const rd = t.closest('[data-rday]');
    if (rd) { ui.routineDay = Number(rd.dataset.rday); render(); return; }
    if (t.closest('[data-new-block]')) { openItemModal({ preset: { kind: 'routine', days: [ui.routineDay] }, date: null }); return; }
    if (t.closest('[data-import]')) { openImportModal(); return; }
    if (t.closest('[data-import-template]')) { openImportModal(TEMPLATE_TEXT); return; }
    if (t.closest('[data-copy-day]')) { openCopyDayModal(); return; }
    if (t.closest('[data-export-text]')) { openExportTextModal(); return; }
    if (t.closest('[data-open-planner]')) { setView('planner'); return; }
    if (t.closest('[data-clear-day]')) {
      const d = ui.routineDay;
      if (confirm(`Remover todos os blocos de ${DAY_NAMES[d]}? (O sono não é afetado.)`)) {
        update((st) => { st.routines = st.routines.map((r) => (r.system ? r : { ...r, days: r.days.filter((x) => x !== d) })).filter((r) => r.days.length); });
      }
      return;
    }
    const am = t.closest('[data-amode]');
    if (am) { ui.agendaMode = am.dataset.amode; render(); return; }
    if (t.closest('[data-agenda-week]')) { ui.agendaMode = 'week'; ui.weekAnchor = new Date(); setView('agenda'); return; }
    const dn = t.closest('[data-day]');
    if (dn) { const n = Number(dn.dataset.day); ui.date = n === 0 ? todayISO() : toISODate(addDays(fromISODate(ui.date), n)); render(); return; }
    const wk = t.closest('[data-week]');
    if (wk) { const n = Number(wk.dataset.week); ui.weekAnchor = n === 0 ? new Date() : addDays(ui.weekAnchor, n * 7); render(); return; }
    const mo = t.closest('[data-month]');
    if (mo) {
      const n = Number(mo.dataset.month);
      const a = ui.monthAnchor;
      ui.monthAnchor = n === 0 ? new Date() : new Date(a.getFullYear(), a.getMonth() + n, 1);
      render();
      return;
    }
    const go = t.closest('[data-goto]');
    if (go) { ui.date = go.dataset.goto; ui.agendaMode = 'day'; setView('agenda'); }
  });

  view.addEventListener('submit', (e) => {
    if (e.target.id !== 'quickadd') return;
    e.preventDefault();
    const q = new FormData(e.target).get('q').trim();
    if (!q) return;
    const { title, start, end } = parseQuick(q);
    update((s) => { s.tasks.push({ id: uid(), title, start, end, date: ui.date, category: s.categories.find((c) => c.id === 'pessoal')?.id || s.categories[0].id, done: false, notes: '', location: '', notify: null }); });
    toast(start ? `Adicionado às ${start}` : 'Compromisso adicionado');
    recheck();
    $('#quickadd input')?.focus();
  });

  view.addEventListener('input', (e) => { if (ui.view === 'planner') onPlannerInput(e); });
  view.addEventListener('change', (e) => {
    if (ui.view === 'planner') { onPlannerInput(e); return; }
    if (ui.view !== 'settings') return;
    const el = e.target;
    if (el.id === 'set-notify') {
      if (el.checked) requestPermission().then((p) => { if (p !== 'granted') toast('Permissão não concedida pelo navegador'); render(); });
      else update((s) => { s.settings.notifications = false; });
    } else if (el.id === 'set-default-notify') update((s) => { s.settings.defaultNotify = Number(el.value); });
    else if (el.id === 'import-json') {
      const file = el.files[0];
      if (!file) return;
      file.text().then((txt) => {
        try {
          const data = JSON.parse(txt);
          if (!Array.isArray(data.routines) || !Array.isArray(data.tasks)) throw new Error('formato');
          if (confirm('Substituir os dados atuais pelo backup?')) { replaceState(data); toast('Backup importado'); }
        } catch { toast('Arquivo de backup inválido'); }
      });
    } else if (el.matches('[data-catname], [data-catcolor]')) {
      const id = el.closest('[data-cat]').dataset.cat;
      update((s) => {
        const c = s.categories.find((x) => x.id === id);
        if (el.matches('[data-catname]')) c.name = el.value.trim() || c.name; else c.color = el.value;
      });
    } else if (el.matches('[data-pf]')) {
      const id = el.closest('[data-per]').dataset.per;
      update((s) => {
        const p = s.periods.find((x) => x.id === id);
        const v = el.value.trim();
        if (el.dataset.pf === 'name' && !v) return;
        if (el.dataset.pf === 'start' && !v) return;
        p[el.dataset.pf] = v;
      });
    }
  });

  subscribe(() => render());

  // Atualiza o painel ("agora") e a virada do dia a cada minuto
  let lastDay = todayISO();
  setInterval(() => {
    const t = todayISO();
    if (t !== lastDay) { if (ui.date === lastDay) ui.date = t; lastDay = t; }
    if ((ui.view === 'home' || (ui.view === 'agenda' && ui.agendaMode === 'day')) && !$('#modal').open) render();
  }, 60000);
}

/* ---------- Inicialização ---------- */
bind();
setView('home');
startNotifier((msg) => toast(msg, 8000));

setTimeout(() => {
  if (!getState().routines.length && !getState().tasks.length) toast('Bem-vindo! Vá em “Rotina” para importar o modelo pronto ou criar seus blocos ✦', 6000);
}, 800);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// Atalho via URL: ?add=1 abre o formulário (usado pelo atalho do app instalado)
if (new URLSearchParams(location.search).has('add')) openItemModal();
