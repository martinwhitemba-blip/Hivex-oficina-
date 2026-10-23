/** Reglas puras: permisos, fechas, métricas, alertas y puntos. Sin base de datos. */
import { translate, type Locale } from '../../../packages/i18n/src/index';

export type AppRole = 'propietario' | 'administrador' | 'empleado';

export function isRole(value: string): value is AppRole {
  return value === 'propietario' || value === 'administrador' || value === 'empleado';
}

export function roleLabel(role: string) {
  if (role === 'propietario') return 'Propietario';
  if (role === 'administrador') return 'Administrador';
  return 'Empleado';
}

export interface PersonRef {
  id: string;
  role: string;
  areaId: string | null;
}

export function canManageCompany(role: string) {
  return role === 'propietario';
}

export function canSeeMetrics(actor: PersonRef, target: PersonRef) {
  if (actor.role === 'propietario') return true;
  if (actor.id === target.id) return true;
  if (actor.role === 'administrador' && actor.areaId && actor.areaId === target.areaId) return true;
  return false;
}

export function canManagePerson(actor: PersonRef, target: PersonRef) {
  if (actor.id === target.id) return true;
  if (actor.role === 'propietario') return true;
  if (actor.role === 'administrador' && actor.areaId && actor.areaId === target.areaId && target.role === 'empleado') return true;
  return false;
}

export function isoDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function parseIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return value;
}

export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isWeekend(iso: string) {
  const day = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** Jornadas laborables anteriores a `today`, de la más reciente a la más antigua. */
export function lastWorkdays(n: number, today: string) {
  const out: string[] = [];
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  while (out.length < n) {
    const iso = d.toISOString().slice(0, 10);
    if (!isWeekend(iso)) out.push(iso);
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

export function workdaysBetween(from: string, to: string) {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end) {
    const iso = d.toISOString().slice(0, 10);
    if (!isWeekend(iso)) out.push(iso);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export interface MetricValue { key: string; value: number }
export interface ReportRow { membershipId: string; date: string; values: MetricValue[] }

export function aggregateKpi(reports: ReportRow[], key: string) {
  let total = 0;
  const byMember = new Map<string, number>();
  const byDate = new Map<string, number>();
  for (const report of reports) {
    const value = report.values.find((v) => v.key === key)?.value ?? 0;
    if (!value) continue;
    total += value;
    byMember.set(report.membershipId, (byMember.get(report.membershipId) ?? 0) + value);
    byDate.set(report.date, (byDate.get(report.date) ?? 0) + value);
  }
  return { total, byMember, byDate };
}

export interface KpiRef {
  areaId: string;
  key: string;
  label: string;
  targetDaily: number | null;
  higherIsBetter: boolean;
}

export interface Alert {
  level: 'aviso' | 'critico';
  text: string;
}

export function buildAlerts(input: {
  today: string;
  people: { id: string; name: string; areaId: string | null }[];
  kpis: KpiRef[];
  reports: ReportRow[];
  locale?: Locale;
}): Alert[] {
  const locale = input.locale || 'es';
  const alerts: Alert[] = [];
  const byPerson = new Map<string, ReportRow[]>();
  for (const report of input.reports) {
    const list = byPerson.get(report.membershipId) ?? [];
    list.push(report);
    byPerson.set(report.membershipId, list);
  }
  const areasWithKpis = new Set(input.kpis.map((k) => k.areaId));

  for (const person of input.people) {
    if (!person.areaId || !areasWithKpis.has(person.areaId)) continue;
    const reports = byPerson.get(person.id) ?? [];
    const dates = new Set(reports.map((r) => r.date));
    let missed = 0;
    for (const day of lastWorkdays(10, input.today)) {
      if (dates.has(day)) break;
      missed += 1;
    }
    if (missed >= 3) {
      alerts.push({
        level: 'critico',
        text: translate(locale, 'alerts.missed', { name: person.name, count: missed }),
      });
    }

    const areaKpis = input.kpis.filter((k) => k.areaId === person.areaId);
    const hasCitas = areaKpis.some((k) => k.key === 'citas');
    const hasAusencias = areaKpis.some((k) => k.key === 'citas_no_presentadas');
    if (hasCitas && hasAusencias) {
      const citas = aggregateKpi(reports, 'citas').total;
      const ausentes = aggregateKpi(reports, 'citas_no_presentadas').total;
      if (citas >= 5 && ausentes / citas >= 0.5) {
        const pct = Math.round((ausentes / citas) * 100);
        alerts.push({
          level: 'critico',
          text: translate(locale, 'alerts.noshow', { name: person.name, pct, missed: Math.round(ausentes), total: Math.round(citas) }),
        });
      }
    }

    const recentDays = lastWorkdays(7, input.today);
    const recent = reports.filter((r) => recentDays.includes(r.date));
    if (recent.length < 3) continue;
    for (const kpi of areaKpis) {
      if (kpi.targetDaily == null || kpi.key === 'citas_no_presentadas') continue;
      const sum = aggregateKpi(recent, kpi.key).total;
      const days = recent.length;
      if (kpi.higherIsBetter) {
        const target = kpi.targetDaily * days;
        if (sum < target * 0.8) {
          alerts.push({
            level: 'aviso',
            text: translate(locale, 'alerts.below', { name: person.name, kpi: kpi.label, sum: Math.round(sum), target: Math.round(target), days }),
          });
        }
      } else {
        const avg = sum / days;
        if (avg > kpi.targetDaily * 1.2) {
          alerts.push({
            level: 'aviso',
            text: translate(locale, 'alerts.above', { name: person.name, kpi: kpi.label, avg: Math.round(avg), target: Math.round(kpi.targetDaily) }),
          });
        }
      }
    }
  }
  return alerts;
}

export function scoreOf(input: { workdays: number; reportDays: number; targetPct: number; tasksDone: number; tasksTotal: number }) {
  const reportRate = input.workdays > 0 ? Math.min(1, input.reportDays / input.workdays) : 0;
  const targetRate = Math.max(0, Math.min(1, input.targetPct));
  const taskRate = input.tasksTotal > 0 ? Math.min(1, input.tasksDone / input.tasksTotal) : 1;
  return Math.round(100 * (0.4 * reportRate + 0.4 * targetRate + 0.2 * taskRate));
}

export interface BadgeAward { code: string; label: string }

export function pointsForReport(input: {
  values: Record<string, number>;
  kpis: { key: string; targetDaily: number | null; higherIsBetter: boolean }[];
  isFirstReport: boolean;
  streak: number;
}) {
  let points = 10;
  const badges: BadgeAward[] = [];
  if (input.isFirstReport) badges.push({ code: 'primera_jornada', label: 'Primera jornada' });
  const targeted = input.kpis.filter((k) => k.targetDaily != null && k.key !== 'citas_no_presentadas');
  const met = targeted.every((k) => {
    const value = input.values[k.key] ?? 0;
    return k.higherIsBetter ? value >= (k.targetDaily as number) : value <= (k.targetDaily as number);
  });
  if (targeted.length && met) {
    points += 25;
    badges.push({ code: 'objetivo_cumplido', label: 'Objetivo cumplido' });
  }
  if (input.streak >= 5) badges.push({ code: 'racha_5', label: 'Racha de 5 jornadas' });
  return { points, badges };
}

export function streakEnding(dates: string[], end: string) {
  const set = new Set(dates);
  let count = 0;
  const cursor = new Date(`${end}T12:00:00Z`);
  for (let guard = 0; guard < 80; guard += 1) {
    const iso = cursor.toISOString().slice(0, 10);
    if (!isWeekend(iso)) {
      if (!set.has(iso)) break;
      count += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return count;
}

export function slugify(name: string) {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'empresa';
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

export function randomCode(length = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { cur += '"'; i += 1; }
        else quoted = false;
      } else cur += char;
    } else if (char === '"') quoted = true;
    else if (char === ',' || char === ';') { row.push(cur); cur = ''; }
    else if (char === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (char !== '\r') cur += char;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).filter((r) => r.some((cell) => cell.trim())).map((r) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => { record[header] = (r[index] ?? '').trim(); });
    return record;
  });
}

export function pickField(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    if (row[key]) return row[key];
  }
  return '';
}
