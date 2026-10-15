// Planejador inteligente: monta uma rotina semanal a partir de respostas e metas.
// Funciona 100% offline, com heurísticas de produtividade (blocos de foco no
// período de maior energia, distribuição equilibrada, folgas entre blocos).
import { toMin, toHHMM, uid, DAY_NAMES } from './store.js';

export const DEFAULT_ANSWERS = {
  wake: '07:00',
  sleep: '23:00',
  morningRoutine: true,
  hasWork: true,
  workDays: [1, 2, 3, 4, 5],
  workStart: '09:00',
  workEnd: '18:00',
  lunch: true,
  lunchStart: '12:00',
  energy: 'manha', // manha | tarde | noite
  studyHours: 6,
  studySession: 60,
  studyPeriod: 'auto', // auto | manha | tarde | noite
  studyDays: [1, 2, 3, 4, 5, 6],
  exerciseTimes: 3,
  exerciseDuration: 45,
  exercisePeriod: 'manha',
  family: 'media', // baixa | media | alta
  weeklyReview: true,
  dailyPlanning: true,
  restDay: 0, // dia mais leve (-1 = nenhum)
  goals: [], // { name, hours, category }
};

const BUFFER = 15; // minutos de folga entre blocos

function windows(a, day) {
  const wake = toMin(a.wake);
  let sleep = toMin(a.sleep);
  if (sleep <= wake) sleep += 1440;
  const start = wake + (a.morningRoutine ? 45 : 15);
  const end = Math.min(sleep - 30, 1439);
  const isWork = a.hasWork && a.workDays.includes(day);
  return {
    manha: [start, 12 * 60],
    tarde: [13 * 60, 18 * 60],
    noite: [isWork ? Math.max(18 * 60, toMin(a.workEnd) + 30) : 18 * 60, end],
    all: [start, end],
  };
}

function overlaps(busy, s, e) {
  return busy.some(([bs, be]) => s < be + BUFFER && e + BUFFER > bs);
}

function findSlot(busy, [ws, we], dur) {
  for (let s = Math.ceil(ws / 15) * 15; s + dur <= we; s += 15) {
    if (!overlaps(busy, s, s + dur)) return s;
  }
  return null;
}

function freeMinutes(busy, [ws, we]) {
  let used = 0;
  for (const [s, e] of busy) used += Math.max(0, Math.min(e, we) - Math.max(s, ws));
  return Math.max(0, we - ws - used);
}

/**
 * Gera rotinas a partir das respostas.
 * @param {object} a respostas do questionário
 * @param {(key:string, name:string, color:string)=>string} cat resolve/cria categoria e retorna id
 */
export function generatePlan(a, cat) {
  const busy = Array.from({ length: 7 }, () => []); // por dia: [inicio, fim] em minutos
  const blocks = []; // { title, category, day, start, end }
  const warnings = [];
  const C = {
    trabalho: cat('trabalho', 'Trabalho', '#3f6fb5'),
    estudo: cat('estudo', 'Estudo', '#7a5bbf'),
    familia: cat('familia', 'Família', '#d0784a'),
    saude: cat('saude', 'Saúde', '#3d9970'),
    pessoal: cat('pessoal', 'Pessoal', '#8a8a84'),
  };

  const place = (day, s, e, title, category, notify) => {
    busy[day].push([s, e]);
    blocks.push({ day, start: s, end: e, title, category, notify });
  };

  const wake = toMin(a.wake);

  // 1. Âncoras fixas
  for (let d = 0; d < 7; d++) {
    if (a.morningRoutine) busy[d].push([wake, wake + 30]);
    if (a.hasWork && a.workDays.includes(d)) {
      place(d, toMin(a.workStart), toMin(a.workEnd), 'Trabalho', C.trabalho, 10);
    }
    if (a.lunch) {
      const ls = toMin(a.lunchStart);
      // almoço fica "dentro" do trabalho como pausa; marcamos como ocupado
      busy[d].push([ls, ls + 60]);
    }
    if (a.dailyPlanning) {
      const s = wake + (a.morningRoutine ? 30 : 0);
      place(d, s, s + 10, 'Planejar o dia', C.pessoal, 0);
    }
  }
  // Agrupa rotina matinal / almoço como itens visíveis (mesmo horário em vários dias)
  const extraRoutines = [];
  if (a.morningRoutine) extraRoutines.push({ title: 'Rotina matinal', category: C.saude, days: [0, 1, 2, 3, 4, 5, 6], start: toHHMM(wake), end: toHHMM(wake + 30), notify: 0 });
  if (a.lunch) extraRoutines.push({ title: 'Almoço', category: C.pessoal, days: [0, 1, 2, 3, 4, 5, 6], start: a.lunchStart, end: toHHMM(toMin(a.lunchStart) + 60), notify: -1 });

  // 2. Revisão semanal (domingo à noite ou sábado se domingo indisponível)
  if (a.weeklyReview) {
    const w = windows(a, 0);
    const s = findSlot(busy[0], [Math.max(w.noite[0], 18 * 60), w.noite[1]], 30) ?? findSlot(busy[0], w.all, 30);
    if (s != null) place(0, s, s + 30, 'Revisão e planejamento da semana', C.pessoal, 10);
  }

  // 3. Distribuidor genérico de sessões
  const allocate = ({ title, category, sessions, dur, period, days, notify, maxPerDay = 1 }) => {
    let placed = 0;
    const counts = Array(7).fill(0);
    for (let i = 0; i < sessions; i++) {
      // ordena dias por: menos sessões já colocadas, depois mais tempo livre, evitando dia de descanso
      const order = [...days].sort((x, y) => {
        const px = (x === a.restDay ? 1 : 0), py = (y === a.restDay ? 1 : 0);
        if (counts[x] !== counts[y]) return counts[x] - counts[y];
        if (px !== py) return px - py;
        return freeMinutes(busy[y], windows(a, y).all) - freeMinutes(busy[x], windows(a, x).all);
      });
      let ok = false;
      for (const d of order) {
        if (counts[d] >= maxPerDay) continue;
        const w = windows(a, d);
        const prefs = period === 'auto' ? [a.energy, 'manha', 'tarde', 'noite'] : [period, 'manha', 'tarde', 'noite'];
        for (const p of [...new Set(prefs)]) {
          const s = findSlot(busy[d], w[p], dur);
          if (s != null) { place(d, s, s + dur, title, category, notify); counts[d]++; placed++; ok = true; break; }
        }
        if (ok) break;
      }
      if (!ok) break;
    }
    if (placed < sessions) warnings.push(`Só coube ${placed} de ${sessions} sessões de “${title}”. Ajuste horários ou reduza a meta.`);
    return placed;
  };

  // 4. Estudo — blocos de foco no período de maior energia
  if (a.studyHours > 0) {
    const dur = Number(a.studySession) || 60;
    const sessions = Math.ceil((a.studyHours * 60) / dur);
    const days = a.studyDays?.length ? a.studyDays : [1, 2, 3, 4, 5, 6];
    allocate({ title: 'Estudo (foco)', category: C.estudo, sessions, dur, period: a.studyPeriod, days, notify: 10, maxPerDay: Math.max(1, Math.ceil(sessions / days.length)) });
  }

  // 5. Exercício
  if (a.exerciseTimes > 0) {
    const days = spread(a.exerciseTimes);
    allocate({ title: 'Exercício', category: C.saude, sessions: a.exerciseTimes, dur: Number(a.exerciseDuration) || 45, period: a.exercisePeriod, days, notify: 15 });
  }

  // 6. Metas personalizadas
  for (const g of a.goals || []) {
    if (!g.name || !(g.hours > 0)) continue;
    const dur = g.hours * 60 >= 180 ? 60 : 45;
    const sessions = Math.ceil((g.hours * 60) / dur);
    const category = cat(g.category || 'pessoal');
    allocate({ title: g.name, category, sessions, dur, period: 'auto', days: [0, 1, 2, 3, 4, 5, 6], notify: 10, maxPerDay: Math.max(1, Math.ceil(sessions / 7)) });
  }

  // 7. Família — noites nos dias úteis + bloco maior no fim de semana
  const fam = { baixa: { n: 2, dur: 45, wk: 120 }, media: { n: 3, dur: 60, wk: 180 }, alta: { n: 5, dur: 90, wk: 240 } }[a.family];
  if (fam) {
    allocate({ title: 'Tempo em família', category: C.familia, sessions: fam.n, dur: fam.dur, period: 'noite', days: [1, 2, 3, 4, 5], notify: 10 });
    for (const d of [6, 0]) {
      const w = windows(a, d);
      const s = findSlot(busy[d], [13 * 60, w.all[1]], fam.wk) ?? findSlot(busy[d], w.all, fam.wk);
      if (s != null) place(d, s, s + fam.wk, 'Família / passeio', C.familia, 30);
    }
  }

  // Agrupa blocos idênticos (mesmo título e horário) em uma rotina com vários dias
  const map = new Map();
  for (const b of blocks) {
    const k = `${b.title}|${b.start}|${b.end}|${b.category}`;
    if (!map.has(k)) map.set(k, { title: b.title, category: b.category, start: toHHMM(b.start), end: toHHMM(b.end), days: [], notify: b.notify });
    map.get(k).days.push(b.day);
  }
  const routines = [...extraRoutines, ...map.values()].map((r) => ({ ...r, id: uid(), days: [...new Set(r.days)].sort(), source: 'planner', notes: '' }));

  return { routines, warnings, tips: buildTips(a, blocks, C) };
}

function spread(n) {
  const patterns = { 1: [3], 2: [2, 5], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6] };
  return patterns[Math.min(6, Math.max(1, n))] || [0, 1, 2, 3, 4, 5, 6];
}

function buildTips(a, blocks, C) {
  const tips = [];
  const total = (cat) => blocks.filter((b) => b.category === cat).reduce((s, b) => s + (b.end - b.start), 0) / 60;
  const wake = toMin(a.wake);
  let sleep = toMin(a.sleep);
  if (sleep <= wake) sleep += 1440;
  const sleepHours = (1440 - (sleep - wake)) / 60;
  if (sleepHours < 7) tips.push(`Você está planejando ~${sleepHours.toFixed(1)}h de sono. O recomendado para adultos é 7–9h — considere ajustar.`);
  const energyName = { manha: 'manhã', tarde: 'tarde', noite: 'noite' }[a.energy];
  tips.push(`Blocos de estudo foram priorizados na ${energyName}, seu período de maior energia. Proteja esse horário de interrupções (celular no silencioso).`);
  if (a.studySession >= 90) tips.push('Sessões longas: faça uma pausa de 10 min a cada 45–50 min para manter o foco.');
  else tips.push('Use a técnica Pomodoro (25 min foco + 5 min pausa) dentro de cada bloco de estudo.');
  if (total(C.trabalho) > 45) tips.push(`Carga de trabalho alta (${total(C.trabalho).toFixed(0)}h/semana). Garanta pausas e evite estudo pesado logo após o expediente.`);
  if (a.restDay >= 0) tips.push(`${DAY_NAMES[a.restDay]} ficou mais leve para descanso e recuperação.`);
  if (a.weeklyReview) tips.push('Na revisão semanal: veja o que foi concluído, reagende o que ficou pendente e defina as 3 prioridades da próxima semana.');
  tips.push('Deixe espaços livres: imprevistos acontecem. Uma agenda 100% cheia costuma falhar.');
  return tips;
}
