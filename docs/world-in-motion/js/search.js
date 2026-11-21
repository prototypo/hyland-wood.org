// Pure search helpers: no DOM, so Node can test them.

export const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

const KIND_ORDER = { topic: 0, chain: 1, place: 2, polity: 3 }; // on the same tier, a school topic comes first

// 0 exact, 1 name prefix, 2 word prefix, 3 substring, or each word of the search is in the name ("ukraine war" finds
// "The war in Ukraine"; the word "the" is not needed: "the cold war" finds "Cold War"), 4 no match
function tier(name, q) {
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.includes(" " + q)) return 2;
  if (name.includes(q)) return 3;
  const words = q.split(/\s+/).filter((w) => w !== "the");
  return words.length && words.every((w) => name.includes(w)) ? 3 : 4;
}

const size = (e) => e.area ?? e.pop ?? 0; // on the same tier and kind: the larger polity, or the city with more people, first

// The cities and towns of today (site/data/cities.json, from Natural Earth), so that a child can find home. A row
// [name, where, longitude, latitude, people] becomes a place with a point. bbox is what the map shows after a pick.
const cent = (v) => Math.round(v * 100) / 100;
export const cityEntries = (rows) => rows.map(([name, where, lng, lat, pop]) => ({ id: `l:${name}, ${where}`, kind: "place", name, where,
  at: [lng, lat], bbox: [cent(lng - 5), Math.max(cent(lat - 3.5), -85), cent(lng + 5), Math.min(cent(lat + 3.5), 85)], pop }));

export function rankEntries(query, entries, limit = 8) {
  const q = fold(query);
  if (!q) return [];
  const hits = [];
  for (const e of entries) {
    const t = Math.min(...[e.name, ...(e.alt ?? [])].map((n) => tier(fold(n), q)));
    if (t < 4) hits.push({ e, t });
  }
  hits.sort((a, b) => a.t - b.t || KIND_ORDER[a.e.kind] - KIND_ORDER[b.e.kind] || size(b.e) - size(a.e));
  return hits.slice(0, limit).map((h) => h.e);
}

// The member covering the year, else the one nearest in time.
export function memberAt(chain, year) {
  const gap = (m) => Math.max(m.from - year, year - m.to, 0);
  return chain.members.reduce((best, m) => (gap(m) < gap(best) ? m : best));
}
