// The timeline goes to MAX_YEAR, so that a school topic of today has its years. The map data ends in DATA_YEAR: for a
// later year the page shows the map of DATA_YEAR, and the timeline says so. tools/build_data.py has the same two years
// (TIMELINE_LAST, LAST_YEAR); a test compares them.
export const MIN_YEAR = -3400, MAX_YEAR = 2026, DATA_YEAR = 2024, POS_MAX = 10000;
export const mapYear = (y) => Math.min(y, DATA_YEAR);

// Year index: 1 BCE (-1) -> 0 and 1 CE -> 1, so the two are adjacent and there is no year 0.
const toIdx = (y) => (y < 0 ? y + 1 : y);
const fromIdx = (i) => (i <= 0 ? i - 1 : i);

const PARSE = /^(?:(BCE|BC|CE|AD)\s*|(-))?(\d+)(?:\s*(BCE|BC|CE|AD))?$/i;

export function parseYear(text) {
  const m = PARSE.exec(text.trim());
  if (!m) return null;
  const [, pre, sign, digits, post] = m;
  if ((pre || sign) && post) return null;
  const n = parseInt(digits, 10);
  if (n === 0) return null;
  const era = (pre || post || "").toUpperCase();
  return sign || era === "BCE" || era === "BC" ? -n : n;
}

export const clampYear = (y) => (y === 0 ? -1 : Math.min(MAX_YEAR, Math.max(MIN_YEAR, y)));

export const formatYear = (y) => (y < 0 ? `${-y} BCE` : `${y} CE`);

// The years of a thing as text: "1763 CE – 1783 CE", or one year said once.
export const formatSpan = (from, to) => (from === to ? formatYear(from) : `${formatYear(from)} – ${formatYear(to)}`);

export const stepYear = (y, delta) => clampYear(fromIdx(toIdx(y) + delta));

export const WHOLE_SCALE = [[0, -3400], [1000, -1000], [2500, 1], [4500, 1000],
  [6000, 1500], [7500, 1800], [8500, 1900], [10000, MAX_YEAR]];

export const lifeScale = (from, to) => [[0, from], [POS_MAX, to]];

function interp(v, scale, xs, ys) {
  let i = 1;
  while (i < scale.length - 1 && v > xs(scale[i])) i++;
  const [x0, x1, y0, y1] = [xs(scale[i - 1]), xs(scale[i]), ys(scale[i - 1]), ys(scale[i])];
  return x1 === x0 ? y0 : y0 + ((v - x0) / (x1 - x0)) * (y1 - y0);
}

export const posToYear = (pos, scale) =>
  fromIdx(Math.round(interp(pos, scale, (p) => p[0], (p) => toIdx(p[1]))));

export const yearToPos = (y, scale) =>
  Math.round(interp(toIdx(y), scale, (p) => toIdx(p[1]), (p) => p[0]));
