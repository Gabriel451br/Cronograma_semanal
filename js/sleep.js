// Calculadora de sono em ciclos de 90 minutos.
// Dormir (apagar as luzes) + tempo para adormecer + N ciclos = Acordar.
import { toMin, toHHMM } from './store.js';

export const CYCLE = 90;

const norm = (m) => ((m % 1440) + 1440) % 1440;

/** Calcula o horário que falta a partir da âncora escolhida. */
export function computeSleep({ anchor, bed, wake, cycles, latency }) {
  const sleepMin = cycles * CYCLE;
  if (anchor === 'bed') return { bed, wake: toHHMM(norm(toMin(bed) + latency + sleepMin)) };
  return { wake, bed: toHHMM(norm(toMin(wake) - sleepMin - latency)) };
}

/** Alternativas para 3–6 ciclos mantendo a âncora fixa. */
export function sleepOptions(s) {
  return [3, 4, 5, 6].map((c) => ({ cycles: c, hours: (c * CYCLE) / 60, ...computeSleep({ ...s, cycles: c }) }));
}

/** Deduz quantos ciclos cabem entre dormir e acordar. */
export function inferCycles(bed, wake, latency) {
  const span = norm(toMin(wake) - toMin(bed)) - latency;
  return Math.max(1, Math.min(8, Math.round(span / CYCLE)));
}

export function sleepQuality(cycles) {
  if (cycles >= 5) return { level: 'ok', text: 'Ótimo — 5 ciclos (7h30) é o ideal para a maioria dos adultos.' };
  if (cycles === 4) return { level: 'warn', text: '4 ciclos (6h) é o mínimo recomendado. Se possível, compense no fim de semana.' };
  return { level: 'bad', text: 'Menos de 4 ciclos causa privação de sono acumulada. Tente aumentar.' };
}

export const fmtHours = (h) => `${Math.floor(h)}h${h % 1 ? String(Math.round((h % 1) * 60)).padStart(2, '0') : ''}`;
