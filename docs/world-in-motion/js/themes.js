import { formatSpan, formatYear } from "./year.js";

// The maps of one theme, for the detail level Full: a theme colours the shapes of the map by a number. Pure helpers:
// no DOM and no map, so Node can test them. The data is site/data/themes.json; tools/religion.py says how it is made.
//
// A theme of the kind "share": for one group (a religion), the share of the people of each shape, in percent.
//   groups: [[key, name], ...]   members: { shape: [[from, to, year of the count, share of group 0, 1, ...], ...] }
//   A share is null when the data does not count that group for the shape: the map then shows "no data", not 0.

// A theme of the kind "class": each shape has one class in a year (slavery: there was slavery, or a law had ended it).
//   classes: [[key, name], ...]   entries: [[name, year of the law or null, note, source, from, to, not exact], ...]
//   members: { shape: [[from, to, class, [numbers of the entries of the shape]], ...] }
// Two colours that people who do not see all colours can tell apart.
export const CLASS_COLORS = ["#eb6834", "#2a78d6"];

// One colour, from light to dark: a larger share is darker. The lightest step is "almost none". These five steps
// are from one blue ramp; "no data" is a grey with no blue in it.
export const STEPS = [1, 10, 30, 60]; // the lower ends of the classes 1 to 4, in percent
export const COLORS = ["#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#0d366b"];
export const NO_DATA = "#d3d1cb";

export const classOf = (pct) => (pct === null ? -1 : STEPS.filter((s) => pct >= s).length);
export const classLabels = () => COLORS.map((_, i) => (i === 0 ? `under ${STEPS[0]}%` : i === STEPS.length ? `${STEPS[i - 1]}% and more`
  : `${STEPS[i - 1]} to ${STEPS[i] - 1}%`));

// The span of a shape that holds the year: [from, to, year of the count, shares...], or null.
export const spanAt = (theme, pid, year) => theme.members[pid]?.find(([from, to]) => from <= year && year <= to) ?? null;

// The shapes of each class in a year, for one group of a share map: [[shapes of class 0], [shapes of class 1], ...].
// A shape with no data in the year is in no class.
function byClass(theme, key, year) {
  const share = theme.kind === "share", g = share ? theme.groups.findIndex(([k]) => k === key) : 0;
  const out = (share ? COLORS : CLASS_COLORS).map(() => []);
  if (g >= 0) for (const pid of Object.keys(theme.members)) {
    const span = spanAt(theme, pid, year);
    const c = !span ? -1 : share ? classOf(span[3 + g] ?? null) : span[2];
    if (c >= 0) out[c].push(pid);
  }
  return out;
}

// The fill colour of the map for one group in one year, as a MapLibre expression on the property "pid".
export function fillExpression(theme, key, year) {
  const colors = theme.kind === "share" ? COLORS : CLASS_COLORS;
  const cases = byClass(theme, key, year).flatMap((pids, c) => (pids.length ? [pids, colors[c]] : []));
  return cases.length ? ["match", ["get", "pid"], ...cases, NO_DATA] : NO_DATA;
}

// The shapes that have data in a year: they are the foreground of the map. All the others are grey.
export const dataPids = (theme, key, year) => byClass(theme, key, year).flat();

// The first year that has data for the theme (for one group of a share map), or null: a pick of the show goes there.
export function firstYear(theme, key) {
  const g = theme.kind === "share" ? theme.groups.findIndex(([k]) => k === key) : 0;
  const years = g < 0 ? [] : Object.values(theme.members).flat().filter((span) => theme.kind !== "share" || span[3 + g] != null).map(([from]) => from);
  return years.length ? Math.min(...years) : null;
}

// The largest groups of a shape in a year: [[name, percent], ...], or null if the shape has no count then. A group
// with branches (theme.parents: branch -> group) shows its branches where the data counts them, and what is left of
// the group under the name in theme.rest; else it shows the group as a whole.
export function topGroups(theme, pid, year, n = 3) {
  const span = spanAt(theme, pid, year);
  if (!span) return null;
  const share = Object.fromEntries(theme.groups.map(([k], i) => [k, span[3 + i]]));
  const name = Object.fromEntries(theme.groups);
  const parents = theme.parents ?? {};
  const out = [];
  for (const [key] of theme.groups) {
    if (parents[key]) continue; // a branch: its group lists it
    const branches = Object.keys(parents).filter((b) => parents[b] === key && share[b] !== null);
    if (!branches.length) { out.push([name[key], share[key]]); continue; }
    for (const b of branches) out.push([name[b], share[b]]);
    out.push([theme.rest?.[key] ?? name[key], share[key] - branches.reduce((sum, b) => sum + share[b], 0)]);
  }
  return out.filter(([, pct]) => pct >= 1).sort((a, b) => b[1] - a[1]).slice(0, n);
}

// Which count the map shows in a year. The data has a count for every fifth year; the last one holds to today.
export function countLine(theme, year) {
  if (year < theme.from) return `No count before ${theme.from}.`;
  const counts = [...new Set(Object.values(theme.members).flatMap((spans) => spans.map((s) => s[2])))].sort((a, b) => a - b);
  const count = counts.filter((c) => c <= year).pop() ?? counts[0];
  const step = counts.length > 1 ? counts[1] - counts[0] : 1;
  return count === counts[counts.length - 1] && year >= count + step ? `Count of ${count}: there is no newer count.` : `Count of ${count}.`;
}

// A theme can draw shapes of its own on top of the map (theme.shapes, GeoJSON; each has a name in "pid"): the home
// country of an empire, where the map data has one shape for the empire and its colonies. -> the ones with a count
// in the year.
export const shapesShown = (theme, year) => (theme.shapes?.features ?? []).map((f) => f.properties.pid).filter((pid) => spanAt(theme, pid, year));

// The legend of a theme: [[colour, text], ...], with "no data" last.
export const legend = (theme) => [...(theme.kind === "share" ? classLabels().map((text, i) => [COLORS[i], text])
  : theme.classes.map(([, name], i) => [CLASS_COLORS[i], name])), [NO_DATA, "no data"]];

// The line of a class theme in the popup of a shape: its class in the year, and the entries behind it. null: no entry.
// An entry: [name, year of the law or null, note, source, from or null, to or null, 1 if the years are not exact].
export function entriesLine(theme, pid, year) {
  const span = spanAt(theme, pid, year);
  if (!span) return null;
  const what = span[2] === 0 ? "there was slavery in at least a part of this area" : "a law had ended slavery in the lands of this area that the list has";
  const item = ([name, ended, , , from, to, approx]) => (ended !== null ? `${name}, ended by law in ${ended}`
    : from !== null && to !== null ? `${name}, ${approx ? "about " : ""}${formatSpan(from, to)}` : name);
  const order = (e) => e[1] ?? e[4] ?? Infinity; // by year; an entry with no year of its own is last
  const items = span[3].map((i) => theme.entries[i]).sort((a, b) => order(a) - order(b)).map(item).join("; ");
  return `${theme.name}, ${formatYear(year)}: ${what}. From the list: ${items}.`;
}
