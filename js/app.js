import {
  getState, update, subscribe, replaceState, resetState, uid, catById, itemsForDate, toggleDone,
  toISODate, fromISODate, addDays, todayISO, toMin, weekStart, durationMin, DAY_NAMES, DAY_SHORT,
} from './store.js';
import { startNotifier, requestPermission, permission, supported, testNotification, recheck } from './notifications.js';
import { generatePlan, DEFAULT_ANSWERS } from './planner.js';
import { buildICS } from './ics.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ui = {
  view: 'today',
  date: todayISO(),
  weekAnchor: new Date(),
  plannerStep: 0,
  answers: null,
  plan: null,
};

const TITLES = { today: 'Hoje', week: 'Semana', planner: 'Planejar', settings: 'Ajustes' };
const NOTIFY_OPTS = [[-1, 'Sem lembrete'], [0, 'Na hora'], [5, '5 min antes'], [10, '10 min antes'], [15, '15 min antes'], [30, '30 min antes'], [60, '1 hora antes'], [120, '2 horas antes']];
const PERIODS = [['manha', 'Manhã'], ['tarde', 'Tarde'], ['noite', 'Noite']];

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
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
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
  if (ui.view === 'today') view.innerHTML = renderToday();
  else if (ui.view === 'week') view.innerHTML = renderWeek();
  else if (ui.view === 'planner') view.innerHTML = renderPlanner();
  else view.innerHTML = renderSettings();
}

/* ---------- Componentes ---------- */
function catOptions(selected) {
  return getState().categories.map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}

function itemRow(it, nowMin) {
  const c = catById(it.category);
  const s = toMin(it.start), e = toMin(it.end);
  const isNow = nowMin != null && s != null && nowMin >= s && nowMin < (e ?? s + 30) && !it.done;
  const notify = it.notify ?? getState().settings.defaultNotify;
  return `
  <div class="item ${it.done ? 'done' : ''} ${isNow ? 'now' : ''}">
    <span class="bar" style="background:${c.color}"></span>
    <div class="time">${it.start ? `<b>${it.start}</b>${it.end || ''}` : '<b>—</b>'}</div>
    <div class="body" data-edit="${it.kind}:${it.id}">
      <div class="title">${esc(it.title)}</div>
      <div class="meta">
        <span class="tag"><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</span>
        ${it.kind === 'routine' ? '<span>↻ fixo</span>' : ''}
        ${it.start && notify >= 0 ? `<span>🔔 ${notify === 0 ? 'na hora' : notify + ' min'}</span>` : ''}
        ${isNow ? '<span style="color:var(--accent)">● agora</span>' : ''}
      </div>
      ${it.notes ? `<div class="small muted">${esc(it.notes)}</div>` : ''}
    </div>
    <button class="check ${it.done ? 'on' : ''}" data-toggle="${it.kind}:${it.id}:${it.date}" aria-label="Concluir">✓</button>
  </div>`;
}

/* ---------- Hoje ---------- */
function renderToday() {
  const iso = ui.date;
  const d = fromISODate(iso);
  const isToday = iso === todayISO();
  const now = new Date();
  const nowMin = isToday ? now.getHours() * 60 + now.getMinutes() : null;
  const items = itemsForDate(iso);
  const timed = items.filter((i) => i.start);
  const untimed = items.filter((i) => !i.start);
  const done = items.filter((i) => i.done).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  const label = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const next = isToday ? timed.find((i) => !i.done && toMin(i.start) >= nowMin) : null;

  // Carga do dia por categoria
  const byCat = {};
  for (const i of timed) byCat[i.category] = (byCat[i.category] || 0) + durationMin(i);
  const free = Math.max(0, (toMin(getState().settings.dayEnd) - toMin(getState().settings.dayStart)) - Object.values(byCat).reduce((a, b) => a + b, 0));

  return `
  <div class="daynav">
    <button class="round" data-day="-1" aria-label="Dia anterior">‹</button>
    <div class="label">
      <strong>${esc(label)}</strong>
      ${isToday ? '<span class="small muted">Hoje</span>' : '<button class="btn ghost sm" data-day="0">Voltar para hoje</button>'}
    </div>
    <button class="round" data-day="1" aria-label="Próximo dia">›</button>
  </div>

  <div class="today-layout">
    <div class="stack">
      <form class="quickadd" id="quickadd" autocomplete="off">
        <input type="text" name="q" placeholder="Adicionar tarefa… (ex: 14:30 dentista)" aria-label="Adicionar tarefa rápida">
        <button class="btn primary">Adicionar</button>
      </form>

      ${items.length ? `
      <div class="card stack" style="gap:8px">
        <div class="row spread"><span class="small muted">${done} de ${items.length} concluídos</span><span class="small"><b>${pct}%</b></span></div>
        <div class="progress"><span style="width:${pct}%"></span></div>
      </div>` : ''}

      <div class="section-title"><h2>Agenda</h2><span class="small muted">${timed.length} itens</span></div>
      <div class="items">
        ${timed.length ? timed.map((i) => itemRow(i, nowMin)).join('') : '<div class="empty">Nada com horário. Toque em <b>+</b> para adicionar ou use o <b>Planejar</b> para montar sua rotina.</div>'}
      </div>

      <div class="section-title"><h2>Tarefas do dia</h2><span class="small muted">sem horário</span></div>
      <div class="items">
        ${untimed.length ? untimed.map((i) => itemRow(i, null)).join('') : '<div class="empty small">Sem tarefas soltas para este dia.</div>'}
      </div>
    </div>

    <div class="stack">
      ${next ? `
      <div class="section-title"><h2>Próximo</h2></div>
      <div class="card"><div class="small muted">às ${next.start}</div><div style="font-weight:600;font-size:1.05rem">${esc(next.title)}</div></div>` : ''}
      <div class="section-title"><h2>Distribuição do dia</h2></div>
      <div class="card">${barsHTML(byCat, free)}</div>
    </div>
  </div>`;
}

function barsHTML(byCat, free) {
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '<div class="small muted">Sem blocos com horário.</div>';
  const max = Math.max(...entries.map((e) => e[1]), free || 0, 1);
  const fmt = (m) => `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`;
  return `<div class="bars">
    ${entries.map(([id, m]) => { const c = catById(id); return `<div class="barrow"><span class="tag"><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</span><div class="track"><span style="width:${(m / max) * 100}%;background:${c.color}"></span></div><span class="v">${fmt(m)}</span></div>`; }).join('')}
    ${free != null ? `<div class="barrow"><span class="muted">Livre</span><div class="track"><span style="width:${(free / max) * 100}%;background:var(--border)"></span></div><span class="v">${fmt(free)}</span></div>` : ''}
  </div>`;
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

/* ---------- Semana ---------- */
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
    items.forEach((i) => { byCat[i.category] = (byCat[i.category] || 0) + durationMin(i); total++; if (i.done) done++; });
    return `<div class="wday ${iso === tISO ? 'today' : ''}">
      <div class="wday-h" data-goto="${iso}"><strong>${DAY_SHORT[d.getDay()]}</strong><span>${d.getDate()}/${d.getMonth() + 1}</span></div>
      ${items.map((i) => { const c = catById(i.category); return `<div class="chip ${i.done ? 'done' : ''}" style="border-color:${c.color}" data-edit="${i.kind}:${i.id}" data-date="${iso}">${i.start ? `<span class="t">${i.start}${i.end ? '–' + i.end : ''}</span>` : ''}${esc(i.title)}</div>`; }).join('') || '<span class="small muted">—</span>'}
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

/* ---------- Modal de item ---------- */
function openItemModal({ kind = 'task', id = null, date = ui.date, preset = {} } = {}) {
  const s = getState();
  const src = id ? (kind === 'routine' ? s.routines : s.tasks).find((x) => x.id === id) : null;
  const it = src ? { ...src } : { title: '', category: s.categories[0]?.id, start: '', end: '', notes: '', notify: null, days: [fromISODate(date).getDay()], date, ...preset };
  let type = src ? kind : (preset.kind || 'task');
  const dlg = $('#modal');
  const order = s.settings.weekStartsMonday ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];

  const draw = () => {
    dlg.innerHTML = `
    <form method="dialog" id="item-form">
      <div class="mhead"><h2>${src ? 'Editar' : 'Novo'} ${type === 'routine' ? 'compromisso fixo' : 'item'}</h2><button type="button" class="btn ghost sm" data-close>✕</button></div>
      ${src ? '' : `<div class="seg" role="tablist">
        <button type="button" data-type="task" class="${type === 'task' ? 'on' : ''}">Tarefa / compromisso</button>
        <button type="button" data-type="routine" class="${type === 'routine' ? 'on' : ''}">Fixo semanal</button>
      </div>`}
      <label class="field"><span>Título</span><input type="text" name="title" required value="${esc(it.title)}" placeholder="${type === 'routine' ? 'Ex: Academia, Aula de inglês' : 'Ex: Ligar para o banco'}"></label>
      <div class="grid2">
        <label class="field"><span>Categoria</span><select name="category">${catOptions(it.category)}</select></label>
        ${type === 'task' ? `<label class="field"><span>Data</span><input type="date" name="date" value="${it.date || date}" required></label>` : '<div></div>'}
      </div>
      ${type === 'routine' ? `<div class="field"><span class="small muted" style="font-weight:500">Dias da semana</span>
        <div class="days" id="days">${order.map((d) => `<button type="button" data-d="${d}" class="${it.days.includes(d) ? 'on' : ''}">${DAY_SHORT[d]}</button>`).join('')}</div></div>` : ''}
      <div class="grid3">
        <label class="field"><span>Início</span><input type="time" name="start" value="${it.start || ''}" ${type === 'routine' ? 'required' : ''}></label>
        <label class="field"><span>Fim</span><input type="time" name="end" value="${it.end || ''}"></label>
        <label class="field"><span>Lembrete</span><select name="notify">
          <option value="">Padrão (${s.settings.defaultNotify < 0 ? 'nenhum' : s.settings.defaultNotify + ' min'})</option>
          ${NOTIFY_OPTS.map(([v, l]) => `<option value="${v}" ${it.notify === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>
      </div>
      <label class="field"><span>Notas</span><textarea name="notes" placeholder="Opcional">${esc(it.notes || '')}</textarea></label>
      <div class="mfoot">
        <div class="row">
          ${src ? '<button type="button" class="btn danger" data-del>Excluir</button>' : ''}
          ${src && type === 'routine' ? `<button type="button" class="btn" data-skip>Pular em ${fromISODate(date).toLocaleDateString('pt-BR', { day: 'numeric', month: 'numeric' })}</button>` : ''}
        </div>
        <div class="row"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Salvar</button></div>
      </div>
    </form>`;
  };
  draw();

  dlg.onclick = (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) { dlg.close(); return; }
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
      if (!confirm(type === 'routine' ? 'Excluir este compromisso fixo de todas as semanas?' : 'Excluir este item?')) return;
      update((st) => {
        if (type === 'routine') st.routines = st.routines.filter((r) => r.id !== id);
        else st.tasks = st.tasks.filter((t) => t.id !== id);
      });
      dlg.close();
      toast('Item excluído');
      return;
    }
    if (e.target.closest('[data-skip]')) {
      update((st) => { const r = st.routines.find((x) => x.id === id); r.skip = [...new Set([...(r.skip || []), date])]; });
      dlg.close();
      toast('Ocultado apenas neste dia');
    }
  };

  function readForm() {
    const f = $('#item-form');
    if (!f) return;
    const fd = new FormData(f);
    it.title = fd.get('title');
    it.category = fd.get('category');
    it.start = fd.get('start');
    it.end = fd.get('end');
    it.notes = fd.get('notes');
    it.notify = fd.get('notify') === '' ? null : Number(fd.get('notify'));
    if (fd.get('date')) it.date = fd.get('date');
  }

  dlg.onsubmit = (e) => {
    e.preventDefault();
    readForm();
    if (!it.title.trim()) return;
    if (type === 'routine' && !it.days.length) { toast('Escolha ao menos um dia da semana'); return; }
    update((st) => {
      if (type === 'routine') {
        const data = { title: it.title.trim(), category: it.category, start: it.start, end: it.end, notes: it.notes, notify: it.notify, days: [...it.days].sort() };
        if (src) Object.assign(st.routines.find((r) => r.id === id), data);
        else st.routines.push({ id: uid(), source: 'manual', skip: [], ...data });
      } else {
        const data = { title: it.title.trim(), category: it.category, start: it.start, end: it.end, notes: it.notes, notify: it.notify, date: it.date };
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
  if (!ui.answers) ui.answers = structuredClone({ ...DEFAULT_ANSWERS, ...(getState().plannerAnswers || {}) });
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
      <p class="muted small">Responda algumas perguntas e o planejador monta uma rotina semanal equilibrada. Tudo pode ser editado depois.</p>
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
    setView('week');
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
  return `
  <div class="stack">
    <div class="section-title"><h2>Notificações</h2></div>
    <div class="card stack">
      <div class="switch"><span>Lembretes de compromissos<br><span class="small muted">Status: ${permText}</span></span>
        <input type="checkbox" id="set-notify" ${s.settings.notifications && perm === 'granted' ? 'checked' : ''} ${perm === 'unsupported' ? 'disabled' : ''}></div>
      <label class="field"><span>Lembrete padrão</span><select id="set-default-notify">${NOTIFY_OPTS.map(([v, l]) => `<option value="${v}" ${s.settings.defaultNotify === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="row wrap"><button class="btn sm" id="test-notify">Testar notificação</button><button class="btn sm" id="export-ics">Exportar para Google Agenda / Calendário (.ics)</button></div>
      <p class="small muted" style="margin:0">Dica: instale o app na tela inicial (menu do navegador → “Adicionar à tela inicial”). Os lembretes funcionam enquanto o app estiver aberto ou em segundo plano. Para alertas garantidos com o app fechado, exporte o .ics e importe no calendário do celular.${perm === 'denied' ? ' <b>As notificações estão bloqueadas: libere nas configurações do site no navegador.</b>' : ''}</p>
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
      <div class="field"><span class="small muted" style="font-weight:500">Tema</span>${seg('theme', s.settings.theme, [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']])}</div>
      <div class="field"><span class="small muted" style="font-weight:500">Semana começa em</span>${seg('weekStartsMonday', s.settings.weekStartsMonday ? 1 : 0, [[1, 'Segunda'], [0, 'Domingo']])}</div>
      <div class="grid2">
        <label class="field"><span>Dia ativo começa</span><input type="time" id="set-daystart" value="${s.settings.dayStart}"></label>
        <label class="field"><span>Dia ativo termina</span><input type="time" id="set-dayend" value="${s.settings.dayEnd}"></label>
      </div>
    </div>

    <div class="section-title"><h2>Compromissos fixos</h2><span class="small muted">${s.routines.length}</span></div>
    <div class="card stack">
      ${s.routines.length ? `<div class="items">${[...s.routines].sort((x, y) => (toMin(x.start) ?? 0) - (toMin(y.start) ?? 0)).map((r) => { const c = catById(r.category); return `<div class="item"><span class="bar" style="background:${c.color}"></span><div class="body" data-edit="routine:${r.id}"><div class="title">${esc(r.title)}</div><div class="meta"><span>${r.start || ''}${r.end ? '–' + r.end : ''}</span><span>${r.days.map((d) => DAY_SHORT[d]).join(', ')}</span>${r.source === 'planner' ? '<span>✦ planejador</span>' : ''}</div></div></div>`; }).join('')}</div>` : '<span class="small muted">Nenhum ainda.</span>'}
      <button class="btn sm" id="add-routine">+ Novo compromisso fixo</button>
    </div>

    <div class="section-title"><h2>Dados</h2></div>
    <div class="card stack">
      <p class="small muted" style="margin:0">Seus dados ficam salvos apenas neste dispositivo. Faça backup para levar a outro aparelho.</p>
      <div class="row wrap">
        <button class="btn sm" id="export-json">Exportar backup</button>
        <label class="btn sm">Importar backup<input type="file" accept="application/json,.json" id="import-json" hidden></label>
        <button class="btn sm" id="clear-done">Limpar tarefas concluídas</button>
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
  if (e.target.id === 'add-routine') { openItemModal({ preset: { kind: 'routine' } }); return true; }
  if (e.target.id === 'clear-done') {
    const n = s.tasks.filter((t) => t.done).length;
    if (n && confirm(`Remover ${n} tarefa(s) concluída(s)?`)) update((st) => { st.tasks = st.tasks.filter((t) => !t.done); });
    else if (!n) toast('Nenhuma tarefa concluída');
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
  $('#fab').addEventListener('click', () => openItemModal({ date: ui.view === 'today' ? ui.date : todayISO() }));
  $('#btn-notify-status').addEventListener('click', async () => {
    if (!supported()) { toast('Este navegador não suporta notificações'); return; }
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

    const tg = e.target.closest('[data-toggle]');
    if (tg) {
      const [kind, id, date] = tg.dataset.toggle.split(':');
      toggleDone({ kind, id, date });
      return;
    }
    const ed = e.target.closest('[data-edit]');
    if (ed) {
      const [kind, id] = ed.dataset.edit.split(':');
      openItemModal({ kind, id, date: ed.dataset.date || ui.date });
      return;
    }
    const dn = e.target.closest('[data-day]');
    if (dn) {
      const n = Number(dn.dataset.day);
      ui.date = n === 0 ? todayISO() : toISODate(addDays(fromISODate(ui.date), n));
      render();
      return;
    }
    const wk = e.target.closest('[data-week]');
    if (wk) {
      const n = Number(wk.dataset.week);
      ui.weekAnchor = n === 0 ? new Date() : addDays(ui.weekAnchor, n * 7);
      render();
      return;
    }
    const go = e.target.closest('[data-goto]');
    if (go) { ui.date = go.dataset.goto; setView('today'); }
  });

  view.addEventListener('submit', (e) => {
    if (e.target.id !== 'quickadd') return;
    e.preventDefault();
    const q = new FormData(e.target).get('q').trim();
    if (!q) return;
    const { title, start, end } = parseQuick(q);
    update((s) => { s.tasks.push({ id: uid(), title, start, end, date: ui.date, category: s.categories.find((c) => c.id === 'pessoal')?.id || s.categories[0].id, done: false, notes: '', notify: null }); });
    toast(start ? `Adicionado às ${start}` : 'Tarefa adicionada');
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
    else if (el.id === 'set-daystart') update((s) => { s.settings.dayStart = el.value; });
    else if (el.id === 'set-dayend') update((s) => { s.settings.dayEnd = el.value; });
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
    }
  });

  subscribe(() => render());

  // Atualiza o "agora" e a virada do dia a cada minuto
  let lastDay = todayISO();
  setInterval(() => {
    const t = todayISO();
    if (t !== lastDay) { if (ui.date === lastDay) ui.date = t; lastDay = t; }
    if (ui.view === 'today' && !$('#modal').open) render();
  }, 60000);
}

/* ---------- Inicialização ---------- */
bind();
render();
startNotifier((msg) => toast(msg, 8000));

if (!getState().onboarded && !getState().routines.length && !getState().tasks.length) {
  setTimeout(() => toast('Bem-vindo! Use “Planejar” para montar sua rotina em poucos passos ✦', 6000), 600);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// Atalho via URL: ?add=1 abre o formulário (usado pelo atalho do app instalado)
if (new URLSearchParams(location.search).has('add')) openItemModal();
