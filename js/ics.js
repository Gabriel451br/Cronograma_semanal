// Exporta a agenda em formato .ics (Google Agenda, Apple Calendário, Outlook),
// com alarmes — útil para receber lembretes mesmo com o app fechado.
import { getState, toISODate, addDays, toMin, catById } from './store.js';

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const esc = (s = '') => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => '\\' + m);
const dt = (iso, hhmm) => `${iso.replace(/-/g, '')}T${hhmm.replace(':', '')}00`;
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

function alarm(lead) {
  if (lead == null || lead < 0) return [];
  return ['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Lembrete', `TRIGGER:-PT${lead}M`, 'END:VALARM'];
}

function endFor(start, end) {
  if (end) return end;
  const m = toMin(start) + 30;
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function buildICS() {
  const s = getState();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cronograma Semanal//PT-BR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Cronograma Semanal'];
  const today = new Date();

  for (const r of s.routines) {
    if (!r.start || !r.days.length) continue;
    // primeira ocorrência a partir de hoje
    let first = today;
    for (let i = 0; i < 7; i++) { const d = addDays(today, i); if (r.days.includes(d.getDay())) { first = d; break; } }
    const iso = toISODate(first);
    const end = endFor(r.start, r.end);
    const endIso = toMin(end) <= toMin(r.start) ? toISODate(addDays(first, 1)) : iso;
    lines.push('BEGIN:VEVENT', `UID:${r.id}@cronograma-semanal`, `DTSTAMP:${stamp()}`,
      `DTSTART:${dt(iso, r.start)}`, `DTEND:${dt(endIso, end)}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${r.days.map((d) => BYDAY[d]).join(',')}`,
      ...(r.skip || []).map((x) => `EXDATE:${dt(x, r.start)}`),
      `SUMMARY:${esc(r.title)}`, `CATEGORIES:${esc(catById(r.category).name)}`,
      ...(r.notes ? [`DESCRIPTION:${esc(r.notes)}`] : []),
      ...alarm(r.notify ?? s.settings.defaultNotify), 'END:VEVENT');
  }

  for (const t of s.tasks) {
    if (t.done) continue;
    lines.push('BEGIN:VEVENT', `UID:${t.id}@cronograma-semanal`, `DTSTAMP:${stamp()}`);
    if (t.start) {
      const end = endFor(t.start, t.end);
      const endIso = toMin(end) <= toMin(t.start) ? toISODate(addDays(new Date(t.date + 'T00:00'), 1)) : t.date;
      lines.push(`DTSTART:${dt(t.date, t.start)}`, `DTEND:${dt(endIso, end)}`, ...alarm(t.notify ?? s.settings.defaultNotify));
    } else {
      const next = toISODate(addDays(new Date(t.date + 'T00:00'), 1)).replace(/-/g, '');
      lines.push(`DTSTART;VALUE=DATE:${t.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${next}`);
    }
    lines.push(`SUMMARY:${esc(t.title)}`, `CATEGORIES:${esc(catById(t.category).name)}`,
      ...(t.notes ? [`DESCRIPTION:${esc(t.notes)}`] : []), 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
