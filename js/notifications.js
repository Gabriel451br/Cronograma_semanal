// Lembretes: verifica periodicamente os itens do dia e dispara notificações
// do sistema (via Service Worker quando disponível) e um aviso dentro do app.
import { getState, update, itemsForDate, toMin, toISODate, addDays, catById } from './store.js';

let timer = null;
let precise = null;
let onInApp = () => {};

export const supported = () => 'Notification' in window;
export const permission = () => (supported() ? Notification.permission : 'unsupported');

export async function requestPermission() {
  if (!supported()) return 'unsupported';
  const p = await Notification.requestPermission();
  update((s) => { s.settings.notifications = p === 'granted'; });
  return p;
}

async function show(title, body, tag) {
  const opts = { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', renotify: true, vibrate: [120, 60, 120] };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) { await reg.showNotification(title, opts); return; }
  } catch { /* fallback abaixo */ }
  try { new Notification(title, opts); } catch { /* sem suporte */ }
}

export function testNotification() {
  show('Cronograma Semanal', 'As notificações estão funcionando ✓', 'test');
}

function dueList(now) {
  const s = getState();
  const out = [];
  // Considera hoje e amanhã (lembretes de itens logo após a meia-noite)
  for (const iso of [toISODate(now), toISODate(addDays(now, 1))]) {
    for (const it of itemsForDate(iso)) {
      if (it.done || it.start == null || it.start === '') continue;
      const lead = it.notify ?? s.settings.defaultNotify;
      if (lead == null || lead < 0) continue;
      const [y, m, d] = iso.split('-').map(Number);
      const startMin = toMin(it.start);
      const at = new Date(y, m - 1, d, Math.floor(startMin / 60), startMin % 60).getTime() - lead * 60000;
      out.push({ it, iso, at, lead, key: `${it.id}|${iso}` });
    }
  }
  return out;
}

function check() {
  const s = getState();
  const now = new Date();
  const t = now.getTime();
  const fired = [];
  let next = Infinity;
  for (const d of dueList(now)) {
    if (s.notified[d.key]) continue;
    if (t >= d.at && t - d.at < 15 * 60000) fired.push(d);
    else if (d.at > t) next = Math.min(next, d.at);
  }
  if (fired.length) {
    update((st) => {
      fired.forEach((d) => { st.notified[d.key] = t; });
      // limpa registros antigos (> 3 dias)
      for (const [k, v] of Object.entries(st.notified)) if (t - v > 3 * 86400000) delete st.notified[k];
    });
    for (const d of fired) {
      const when = d.lead === 0 ? 'Agora' : `Em ${d.lead} min`;
      const body = `${when} · ${d.it.start}${d.it.end ? '–' + d.it.end : ''} · ${catById(d.it.category).name}`;
      if (s.settings.notifications && permission() === 'granted') show(d.it.title, body, d.key);
      onInApp(`🔔 ${d.it.title} — ${body}`);
    }
  }
  // agenda verificação precisa para o próximo lembrete (se estiver próximo)
  clearTimeout(precise);
  if (next !== Infinity && next - t < 2 ** 31 - 1) precise = setTimeout(check, Math.max(500, next - t + 200));
}

export function startNotifier(inAppHandler) {
  onInApp = inAppHandler || onInApp;
  clearInterval(timer);
  timer = setInterval(check, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  check();
}

export const recheck = () => check();
