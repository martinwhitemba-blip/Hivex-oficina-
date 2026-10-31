/** Resuelve @menciones contra personas de UNA empresa. Ids de fuera se descartan. */

export interface MentionMember {
  id: string;
  name: string;
}

const LETTER = /[0-9a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]/;

export function resolveMentions(body: string, members: MentionMember[], explicit: string[] = []) {
  const byId = new Map(members.filter((member) => member.id && member.name.trim()).map((member) => [member.id, member]));
  const ids = new Set<string>();
  for (const id of explicit) {
    if (byId.has(id)) ids.add(id);
  }
  const sorted = [...byId.values()].sort((a, b) => b.name.length - a.name.length);
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== '@') continue;
    const rest = body.slice(i + 1);
    let hit: string | null = null;
    const lower = rest.toLowerCase();
    for (const member of sorted) {
      const needle = member.name.toLowerCase();
      if (!needle || !lower.startsWith(needle)) continue;
      const after = rest[needle.length];
      if (after && LETTER.test(after)) continue;
      hit = member.id;
      break;
    }
    if (hit) {
      ids.add(hit);
      continue;
    }
    const token = rest.split(/\s/)[0] || '';
    if (byId.has(token)) ids.add(token);
  }
  return [...ids];
}
