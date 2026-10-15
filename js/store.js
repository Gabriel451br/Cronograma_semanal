// Persistência local (localStorage) e utilitários de data.
const KEY = 'cronograma-semanal:v1';

export const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const DAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const pad = (n) => String(n).padStart(2, '0');
export const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromISODate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const toMin = (hhmm) => { if (!hhmm) return null; const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
export const toHHMM = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
export const todayISO = () => toISODate(new Date());

export const DEFAULT_CATEGORIES = [
  { id: 'trabalho', name: 'Trabalho', color: '#3f6fb5' },
  { id: 'estudo', name: 'Estudo', color: '#7a5bbf' },
  { id: 'familia', name: 'Família', color: '#d0784a' },
  { id: 'saude', name: 'Saúde', color: '#3d9970' },
  { id: 'pessoal', name: 'Pessoal', color: '#8a8a84' },
  { id: 'lazer', name: 'Lazer', color: '#c9a227' },
];

function defaults() {
  return {
    version: 1,
    categories: structuredClone(DEFAULT_CATEGORIES),
    // Compromissos fixos semanais
    routines: [],
    // Tarefas e compromissos pontuais
    tasks: [],
    // Conclusões de rotinas por data: { "routineId|YYYY-MM-DD": true }
    doneLog: {},
    // Lembretes já disparados: { "id|YYYY-MM-DD": timestamp }
    notified: {},
    settings: {
      theme: 'auto',
      weekStartsMonday: true,
      notifications: false,
      defaultNotify: 10,
      dayStart: '06:00',
      dayEnd: '23:00',
    },
    plannerAnswers: null,
    onboarded: false,
  };
}

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const data = JSON.parse(raw);
    const base = defaults();
    return { ...base, ...data, settings: { ...base.settings, ...(data.settings || {}) } };
  } catch {
    return defaults();
  }
}

export function getState() { return state; }

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* armazenamento indisponível */ }
  listeners.forEach((fn) => fn(state));
}

export function update(mutator) { mutator(state); save(); }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function replaceState(next) {
  const base = defaults();
  state = { ...base, ...next, settings: { ...base.settings, ...(next.settings || {}) } };
  save();
}
export function resetState() { state = defaults(); save(); }

export const catById = (id) => state.categories.find((c) => c.id === id) || { id: '', name: 'Sem categoria', color: '#999' };

/** Todos os itens (rotinas + tarefas) de uma data, ordenados por horário. */
export function itemsForDate(iso) {
  const dow = fromISODate(iso).getDay();
  const routines = state.routines
    .filter((r) => r.days.includes(dow) && !(r.skip || []).includes(iso))
    .map((r) => ({ ...r, kind: 'routine', date: iso, done: !!state.doneLog[`${r.id}|${iso}`] }));
  const tasks = state.tasks.filter((t) => t.date === iso).map((t) => ({ ...t, kind: 'task' }));
  return [...routines, ...tasks].sort((a, b) => {
    const am = toMin(a.start), bm = toMin(b.start);
    if (am == null && bm == null) return 0;
    if (am == null) return 1;
    if (bm == null) return -1;
    return am - bm;
  });
}

export function toggleDone(item) {
  update((s) => {
    if (item.kind === 'routine') {
      const k = `${item.id}|${item.date}`;
      if (s.doneLog[k]) delete s.doneLog[k]; else s.doneLog[k] = true;
    } else {
      const t = s.tasks.find((x) => x.id === item.id);
      if (t) t.done = !t.done;
    }
  });
}

export function weekStart(date, mondayFirst) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = d.getDay();
  const diff = mondayFirst ? (dow + 6) % 7 : dow;
  return addDays(d, -diff);
}

export function durationMin(item) {
  const s = toMin(item.start), e = toMin(item.end);
  if (s == null || e == null) return 0;
  return e >= s ? e - s : e + 1440 - s;
}
