import { parseYear, clampYear } from "./year.js";

const parts = (hash) => hash.replace(/^#/, "").split("&").filter(Boolean);
const decode = (s) => { try { return decodeURIComponent(s); } catch { return ""; } };
const find = (list, key) => list.find((p) => p.startsWith(key + "="))?.slice(key.length + 1) ?? null;

export function readState(hash) {
  const list = parts(hash);
  const y = find(list, "y");
  const year = y === null ? null : parseYear(decode(y));
  const f = find(list, "f");
  const d = find(list, "d"); // the detail level: 1 is More, 2 is Full; anything else is Simple
  const level = d === "1" || d === "2" ? Number(d) : 0;
  const th = find(list, "th"); // the theme of the level Full, for example "religion.islam"; with no theme, Full shows ship lanes and cables
  // view: the address carries a map position (MapLibre's map=), which a focus link must keep
  return { year: year === null ? null : clampYear(year), focus: (f && decode(f)) || null, view: find(list, "map") !== null,
    level, theme: (level === 2 && th && decode(th)) || null };
}

// Edits only y, f, d and th. Other parameters (MapLibre's map=z/lat/lng) pass through byte for byte.
export function writeState(hash, { year, focus, level, theme }) {
  const list = parts(hash).filter((p) => !["y=", "f=", "d=", "th="].some((k) => p.startsWith(k)));
  list.push("y=" + year);
  if (focus) list.push("f=" + encodeURIComponent(focus));
  if (level) list.push("d=" + level);
  if (level === 2 && theme) list.push("th=" + encodeURIComponent(theme));
  return "#" + list.join("&");
}
