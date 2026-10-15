// Importa/exporta rotinas em texto no formato:
//   🌅 Período da Manhã: Conexão e Foco Renovado
//   • 05:30 às 06:15 – Tempo com a Família (Manhã)
//       • detalhe…
import { toMin, toHHMM, DAY_SHORT } from './store.js';

export const TEMPLATE_NAME = 'Foco, Família e Trabalho';

export const TEMPLATE_TEXT = `🌅 Período da Manhã: Conexão e Foco Renovado

• 05:30 – Acordar
	• Despertar imediato, sem usar o botão "soneca".
• 05:30 às 06:15 – Tempo com a Família (Manhã)
	• Tomar café com a esposa, ajudar nas primeiras demandas da sua filha e começar o dia juntos, fortalecendo o vínculo familiar.
• 06:15 às 07:30 – Bloco de Estudos 1 (1h15 brutos ➔ 1h líquida)
	• Foco em Teoria / Leitura de PDF. Aproveite o silêncio da casa e a mente descansada para absorver o conteúdo mais denso.
• 07:30 às 08:00 – Deslocamento
	• Trajeto até o trabalho.

🏢 Período da Tarde: Trabalho e Consistência

• 08:00 às 18:00 – Expediente de Trabalho
	• Foco nas demandas profissionais e intervalo de almoço.
• 18:00 às 18:15 – Transição
	• Deslocamento para a academia.

🏋️ Período da Noite: Alta Performance e Paternidade

• 18:15 às 19:15 – Bloco de Treino
	• Treino rápido, focado e de intensidade (ótimo para descarregar o estresse do expediente).
• 19:15 às 20:30 – Bloco de Estudos 2 (1h15 brutos ➔ 1h líquida)
	• Foco em Resolução de Questões. Como a mente está mais cansada do dia de trabalho, a atividade dinâmica de resolver exercícios mantém você alerta.
• 20:30 às 21:00 – Jantar em Família
	• Momento de sentar à mesa com sua esposa e filha para compartilhar a refeição.
• 21:00 às 21:45 – Ritual de Sono da Filha
	• Dar o mamá/banho, acalmar a casa, ler uma história e colocá-la para dormir com calma.

🔌 Período da Noite: Desconexão e Higiene do Sono

• 21:45 às 23:15 – Tempo com a Esposa & Desconexão (1h30 Sem Telas)
	• Regra de Ouro: Celulares, computadores e TVs ficam totalmente desligados.
	• Use esse tempo de qualidade para conversar com sua esposa, organizar os materiais de estudo e roupas do dia seguinte, e relaxar a mente (leitura de livro físico é ideal aqui).
• 23:15 – Apagar das Luzes e Dormir
	• Início exato dos seus 4 ciclos de sono (6 horas líquidas).`;

const ITEM_RE = /^\s*(?:[•·\-*–]\s*)?(\d{1,2})\s*[:h]\s*(\d{2})\s*(?:(?:às|as|a|até|-|–|—)\s*(\d{1,2})\s*[:h]\s*(\d{2}))?\s*(?:[–—\-:|]\s*)?(.+)$/i;
const BULLET_RE = /^\s*[•·\-*◦▪]\s*/;
const hm = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

/** Sugere categoria pelo conteúdo do bloco. */
export function guessCategory(text) {
  const t = text.toLowerCase();
  if (/famíl|famil|esposa|marido|filh|jantar|almoço em|pais|crian/.test(t)) return 'familia';
  if (/acordar|dormir|sono|luzes|treino|academia|exerc|corrida|medita|saúde|saude/.test(t)) return 'saude';
  if (/estud|quest|leitura|aula|curso|revis|pdf|prova|concurso/.test(t)) return 'estudo';
  if (/expediente|trabalho|reuni|serviço|escritório/.test(t)) return 'trabalho';
  if (/lazer|série|filme|passeio|hobby/.test(t)) return 'lazer';
  return 'pessoal';
}

/**
 * Converte o texto em { periods, blocks }.
 * blocks: { title, badge, start, end, notes, category, system }
 */
export function parseRoutineText(text) {
  const periods = [];
  const blocks = [];
  let last = null;
  let pendingPeriod = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;

    const m = line.match(ITEM_RE);
    if (m && Number(m[1]) < 24 && Number(m[2]) < 60) {
      let title = m[5].trim();
      let badge = '';
      const paren = title.match(/\s*\(([^()]*\d[^()]*)\)\s*$/); // ex: (1h15 brutos ➔ 1h líquida)
      if (paren) { badge = paren[1].trim(); title = title.slice(0, paren.index).trim(); }
      const start = hm(m[1], m[2]);
      const end = m[3] != null ? hm(m[3], m[4]) : '';
      let system;
      if (!end && /^acordar|despertar/i.test(title)) system = 'wake';
      else if (!end && /dormir|apagar/i.test(title)) system = 'bed';
      last = { title, badge, start, end, notes: '', category: guessCategory(`${title} ${badge}`), system };
      blocks.push(last);
      if (pendingPeriod) { pendingPeriod.start = start; periods.push(pendingPeriod); pendingPeriod = null; }
      continue;
    }

    if (BULLET_RE.test(line) || /^\s/.test(raw)) {
      // detalhe do último bloco
      if (last) {
        const d = line.replace(BULLET_RE, '').trim();
        last.notes = last.notes ? `${last.notes}\n${d}` : d;
        if (/^acordar|despertar/i.test(last.title) || last.system) last.category = 'saude';
      }
      continue;
    }

    // Cabeçalho de período: "🌅 Período da Manhã: Conexão e Foco Renovado"
    const em = line.match(/^\s*([^\p{L}\p{N}]*)(.*)$/u);
    const emoji = (em[1] || '').trim();
    const [name, ...rest] = em[2].split(':');
    pendingPeriod = { emoji: emoji || '•', name: name.trim(), subtitle: rest.join(':').trim(), start: '00:00' };
    last = null;
  }
  if (periods.length) periods[0].start = '00:00';
  return { periods, blocks };
}

/** Gera texto no mesmo formato a partir dos itens de um dia. */
export function routineToText(items, periods, dayLabel) {
  const out = [];
  if (dayLabel) out.push(`📅 ${dayLabel}`, '');
  let current = null;
  for (const it of items) {
    const p = periodOf(periods, it.start);
    if (p && p !== current) {
      current = p;
      out.push('', `${p.emoji} ${p.name}${p.subtitle ? ': ' + p.subtitle : ''}`, '');
    }
    const time = it.end ? `${it.start} às ${it.end}` : it.start;
    out.push(`• ${time} – ${it.title}${it.badge ? ` (${it.badge})` : ''}`);
    for (const n of (it.notes || '').split('\n').filter(Boolean)) out.push(`\t• ${n}`);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Período ao qual um horário pertence (último cujo início ≤ horário). */
export function periodOf(periods, start) {
  if (!periods?.length) return null;
  const sorted = [...periods].sort((a, b) => toMin(a.start) - toMin(b.start));
  const m = toMin(start || '00:00');
  let found = sorted[0];
  for (const p of sorted) if (toMin(p.start) <= m) found = p;
  return found;
}

export const daysLabel = (days) => {
  const d = [...days].sort();
  if (d.length === 7) return 'Todos os dias';
  if (d.join() === '1,2,3,4,5') return 'Seg a Sex';
  if (d.join() === '0,6') return 'Fim de semana';
  return d.map((x) => DAY_SHORT[x]).join(', ');
};

export { toHHMM };
