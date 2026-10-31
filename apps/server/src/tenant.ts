import { HttpError } from './http';

/** Filtro único por empresa. Las lecturas y escrituras de un inquilino pasan por aquí. */
export function companyScope(companyId: string) {
  return { companyId };
}

export function sameCompany<T extends { companyId: string }>(companyId: string, row: T | null, message = 'No encontrado') {
  if (!row || row.companyId !== companyId) throw new HttpError(404, message);
  return row;
}

export function pageArgs(query: { take?: string; cursor?: string }, fallback: number) {
  const take = Math.min(200, Math.max(1, Number(query.take) || fallback));
  const paged = query.take != null && query.take !== '' || Boolean(query.cursor);
  return { take, cursor: query.cursor || '', paged };
}
