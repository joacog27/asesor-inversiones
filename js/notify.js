// =====================================================================
// AVISOS: notificaciones, alertas de precio, recordatorio mensual, .ics
//
// Importante: sin servidor (para que sea gratis), las alertas y el
// recordatorio se revisan mientras la app está abierta. Para un aviso
// garantizado aunque la app esté cerrada, el recordatorio mensual se puede
// agregar al calendario del celular (archivo .ics).
// =====================================================================

// ---------------- Funciones puras (testeables) ----------------

/** ¿Se cumple la alerta? q = { price, pct } */
export function alertTriggered(alert, q) {
  if (!alert?.active || !q || !(q.price > 0)) return false;
  const v = Number(alert.value);
  if (alert.type === 'above') return q.price >= v;
  if (alert.type === 'below') return q.price <= v;
  if (alert.type === 'move') return q.pct != null && Math.abs(q.pct) >= v;
  return false;
}

export function alertText(alert, q, fmtPrice = (x) => String(x)) {
  if (alert.type === 'above') return `${alert.symbol} subió a ${fmtPrice(q.price)} (tu alerta: más de ${fmtPrice(alert.value)})`;
  if (alert.type === 'below') return `${alert.symbol} bajó a ${fmtPrice(q.price)} (tu alerta: menos de ${fmtPrice(alert.value)})`;
  return `${alert.symbol} se movió ${q.pct > 0 ? '+' : ''}${q.pct.toFixed(1)}% hoy (tu alerta: ±${alert.value}%)`;
}

/** ¿Corresponde recordar el aporte? (una vez por mes, desde el día elegido, si no compró este mes) */
export function reminderDue({ settings, transactions, seen }, today = new Date()) {
  if (!settings?.reminderOn) return false;
  const ym = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  if (seen?.remindedMonth === ym) return false;
  if (today.getDate() < Number(settings.reminderDay || 1)) return false;
  return !transactions.some((t) => t.side === 'buy' && t.date.startsWith(ym));
}

/** Archivo de calendario con un evento mensual que se repite. */
export function buildICS({ day = 5, title = 'Invertir mi aporte del mes', description = '', url = '', start = new Date() }) {
  const d = Math.min(28, Math.max(1, Number(day)));
  let first = new Date(start.getFullYear(), start.getMonth(), d, 10, 0, 0);
  if (first < start) first = new Date(start.getFullYear(), start.getMonth() + 1, d, 10, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  const dt = (x) => `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}T${pad(x.getHours())}${pad(x.getMinutes())}00`;
  const end = new Date(first.getTime() + 30 * 60000);
  const escTxt = (s) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => `\\${m}`);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mi Asesor de Inversiones//ES', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:aporte-mensual-${d}@mi-asesor`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${dt(first)}`,
    `DTEND:${dt(end)}`,
    `RRULE:FREQ=MONTHLY;BYMONTHDAY=${d}`,
    `SUMMARY:${escTxt(title)}`,
    `DESCRIPTION:${escTxt(description)}`,
    ...(url ? [`URL:${url}`] : []),
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escTxt(title)}`, 'TRIGGER:-PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

// ---------------- Navegador ----------------

export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}
export function notificationPermission() {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}
export async function requestNotifications() {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  try { return await Notification.requestPermission(); } catch { return 'denied'; }
}

/** Muestra una notificación del sistema (si hay permiso). Devuelve true si se mostró. */
export async function showNotification(title, body, tag) {
  if (notificationPermission() !== 'granted') return false;
  const opts = { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: './#/asesor' } };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) { await reg.showNotification(title, opts); return true; }
  } catch { /* sigue */ }
  try { new Notification(title, opts); return true; } catch { return false; }
}

export function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
