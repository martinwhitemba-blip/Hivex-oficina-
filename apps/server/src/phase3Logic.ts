/** Reglas puras de la Fase 3. No tocan la base ni la red. */

export const NOTICE_PER_MINUTE = 40;
export const CAFE_DAILY_REWARDS = 6;
export const CAFE_POINTS = 5;
export const REPORT_WIDGETS = ['abiertas', 'hechas', 'vencidas', 'personas', 'misiones', 'areas'] as const;
export type ReportWidget = (typeof REPORT_WIDGETS)[number];

export function overNoticeCap(recent: number) {
  return recent >= NOTICE_PER_MINUTE;
}

export type WebhookUrlIssue = 'forma' | 'https' | 'privada';

export function webhookUrlProblem(raw: string, allowInsecureHttp: boolean): WebhookUrlIssue | null {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return 'forma'; }
  if (url.username || url.password) return 'forma';
  const https = url.protocol === 'https:';
  const httpOk = allowInsecureHttp && url.protocol === 'http:';
  if (!https && !httpOk) return 'https';
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === 'metadata.google.internal' || host === '0.0.0.0') return 'privada';
  if (isPrivateHost(host)) return 'privada';
  return null;
}

function isPrivateHost(host: string) {
  if (host.includes(':')) {
    const bare = host.split('%')[0];
    return bare === '::1' || bare === '::' || bare.startsWith('::ffff:') || bare.startsWith('fe80:') || bare.startsWith('fc') || bare.startsWith('fd');
  }
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function seasonOf(day: string): { code: string; name: string; multiplier: number } {
  const month = Number(day.slice(5, 7));
  if (month === 10) return { code: 'octubre_dorado', name: 'Octubre dorado', multiplier: 2 };
  if (month === 12) return { code: 'cierre', name: 'Cierre de año', multiplier: 2 };
  return { code: 'ordinaria', name: 'Temporada ordinaria', multiplier: 1 };
}

export function cafeAward(game: 'taza' | 'memoria', input: { elapsedMs?: number; moves?: number }, multiplier: number) {
  const factor = multiplier > 0 ? multiplier : 1;
  if (game === 'taza') {
    const ms = input.elapsedMs ?? -1;
    return ms >= 120 && ms <= 2500 ? CAFE_POINTS * factor : 0;
  }
  const moves = input.moves ?? 99;
  return moves >= 4 && moves <= 16 ? CAFE_POINTS * factor : 0;
}

export interface AssistantFacts {
  companyName: string;
  openTasks: number;
  overdue: number;
  missionPct: number | null;
  busiest: { name: string; minutes: number } | null;
}

export function basicAnswer(facts: AssistantFacts, question: string) {
  const lines = [
    `En ${facts.companyName} quedan ${facts.openTasks} tareas abiertas. Atrasos: ${facts.overdue}.`,
  ];
  if (facts.busiest && facts.busiest.minutes > 0) {
    lines.push(`${facts.busiest.name} es quien más carga lleva: ${facts.busiest.minutes} minutos abiertos.`);
  }
  if (facts.missionPct != null) lines.push(`Las misiones de esta semana van al ${facts.missionPct} %.`);
  const q = question.toLowerCase();
  if (q.includes('atras') || q.includes('venc')) {
    lines.push(facts.overdue > 0 ? 'Yo empezaría por las atrasadas.' : 'Ahora mismo no hay atrasos.');
  }
  lines.push('Modo básico: estos números son solo de tu empresa y no pasa por un modelo externo.');
  return lines.join(' ');
}

export function cleanWidgets(input: string[]): ReportWidget[] {
  const out: ReportWidget[] = [];
  for (const item of input) {
    if ((REPORT_WIDGETS as readonly string[]).includes(item) && !out.includes(item as ReportWidget)) out.push(item as ReportWidget);
  }
  return out.slice(0, 6);
}

function pdfLiteral(text: string) {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) || 63;
    const byte = code >= 32 && code <= 255 && code !== 127 ? code : 63;
    if (byte === 40 || byte === 41 || byte === 92) out += `\\${String.fromCharCode(byte)}`;
    else out += String.fromCharCode(byte);
  }
  return out;
}

/** PDF de una página, fondo negro y título dorado. Sin librerías nativas. */
export function buildReportPdf(title: string, lines: string[]) {
  const body = lines.slice(0, 36).map((line) => `T* (${pdfLiteral(line.slice(0, 110))}) Tj`).join('\n');
  const stream = [
    '0 0 0 rg',
    '0 0 595 842 re f',
    '0.96 0.77 0.09 rg',
    'BT /F1 18 Tf 48 790 Td',
    `(${pdfLiteral(title.slice(0, 80))}) Tj`,
    'ET',
    '1 1 1 rg',
    'BT /F1 11 Tf 48 760 Td 16 TL',
    body || 'T* ( ) Tj',
    'ET',
  ].join('\n');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Count 1 /Kids [4 0 R] >>\nendobj\n',
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n',
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += object;
  }
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}
