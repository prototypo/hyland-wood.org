import { clampYear, formatSpan, formatYear, lifeScale, mapYear, DATA_YEAR, MIN_YEAR, WHOLE_SCALE } from "./year.js";
import * as S from "./mapstyle.js";
import { createTimeline } from "./timeline.js";
import { readState, writeState } from "./urlstate.js";
import { memberAt, cityEntries } from "./search.js";
import { createSearchBox } from "./searchbox.js";
import { cableContent, laneContent, pickFeature, popupContent, topicContent, waterContent, pinContent } from "./popup.js";
import { COUNTRIES, guessCountry, topicLists, eventsOf, firstYear as itemFirstYear } from "./topics.js";
import { countLine, dataPids, entriesLine, fillExpression, firstYear as themeFirstYear, legend, shapesShown, spanAt, topGroups } from "./themes.js";

const DATA = new URL("data/", location.href).href;
const LOAD_FAILED = "The map data did not load. Check the connection and reload.";
const NO_WEBGL = "This browser cannot draw the map.";
const PREVIEW = "PREVIEW — unapproved entries. Do not publish.";

export const state = { map: null, bands: [], lanes: [], loaded: [], year: DATA_YEAR, focus: null, level: 0, theme: null, timeline: null }; // lanes: the [from, to] years with ship lanes
let mapLoaded, idle = false, ready = false; // before ready, setYearAll only remembers the year
let popup = null, popupYear = null;
let topicPopup = null; // the box of the school topic that is on: it stays open when the year changes
let focusEntry = null, focusPids = null, box = null; // state.focus holds the entry id; these hold what it means

// Keep the address bar in step with the year (and focus), at most once per 250 ms.
let writeTimer = null;
function saveToHash() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    history.replaceState(null, "", writeState(location.hash, state));
  }, 250);
}

// A data error does not block the map: the panel lets clicks through except its own button, and clears
// as soon as a tile loads again. Only the no-WebGL panel (no retry) stays.
export function showError(message, retry) {
  const el = document.getElementById("error");
  el.textContent = message;
  el.classList.toggle("soft", !!retry);
  if (retry) {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "err-retry", textContent: "Try again" });
    b.addEventListener("click", () => { hideError(); retry(); });
    el.append(b);
  }
  el.hidden = false;
}
const hideError = () => { failed.clear(); document.getElementById("error").hidden = true; };
// Failed requests, as "source" (no tile is known) or "source/tile". The panel clears when none is left: a tile
// failure goes when that same tile loads, a source failure when any tile of the source loads, and all failures
// of a source go when the source is removed.
const failed = new Set();
const failKey = (e) => e.sourceId + (e.tile?.tileID ? "/" + e.tile.tileID.key : "");
function forget(...keys) {
  const before = failed.size;
  for (const k of keys) failed.delete(k);
  if (before && !failed.size) hideError();
}
const forgetSource = (id) => forget(...[...failed].filter((k) => k === id || k.startsWith(id + "/")));

// PMTiles remembers a failed archive header; a new Protocol forgets it.
function useFreshProtocol() {
  maplibregl.removeProtocol("pmtiles");
  maplibregl.addProtocol("pmtiles", new pmtiles.Protocol().tile);
}

// Drop every band and base tile and ask again (a failed tile is not retried by itself until the map moves).
function reloadData() {
  const { map } = state;
  useFreshProtocol();
  if (!state.bands.length) return begin();
  for (const i of state.loaded) S.removeBand(map, i);
  state.loaded = [];
  drawing = redraw = false;
  for (const id of ["base", "nature"]) { const s = map.getSource(id); s?.setUrl(s.url); }
  map.getSource("waters").setData(DATA + "waters.geojson");
  map.getSource("cables")?.setData(DATA + "cables.geojson");
  map.getSource("lanes")?.setData(DATA + "lanes.geojson");
  setYearAll(state.year);
}

// Fetch the band list, then (once the map style has loaded) draw. Run again by "Try again" if the list failed.
async function begin() {
  try {
    const res = await fetch(DATA + "bands.json");
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json();
    state.bands = data.bands;
    state.lanes = data.lanes ?? [];
    if (data.preview) document.body.append(Object.assign(document.createElement("p"), { id: "preview", textContent: PREVIEW }));
  } catch {
    return showError(LOAD_FAILED, reloadData);
  }
  await mapLoaded;
  ready = true;
  setLevel(state.level);
  setYearAll(state.year);
  state.map.once("idle", () => { idle = true; setYearAll(state.year); loadEvents(); }); // the events load when the first map is drawn, not before
}

// state.year is the year of the timeline. The map layers get mapYear(state.year): the map data ends before the timeline does.
export function setYearAll(year) {
  const { map, bands } = state;
  queued = null; // this year wins over one still waiting for the next frame
  state.year = clampYear(year);
  const asked = state.year;
  if (focusEntry) state.year = Math.min(focusEntry.to, Math.max(focusEntry.from, state.year)); // a life scale cannot place years outside it
  if (state.year !== year) state.timeline?.setYear(state.year);
  if (focusEntry?.kind === "chain" && !focusEntry.members.some((m) => m.from <= state.year && state.year <= m.to))
    state.timeline?.say(`The data has no ${focusEntry.name} in this year`); // a chain can have long spans with no member
  if (state.year !== asked) state.timeline?.say(`${focusEntry.name}: ${formatYear(focusEntry.from)} – ${formatYear(focusEntry.to)} only`);
  saveToHash();
  showLaneKey();
  if (popup && popup !== topicPopup && popupYear !== state.year) {
    const inside = popup.getElement()?.contains(document.activeElement);
    popup.remove();
    if (inside) map.getCanvas().focus();
  }
  if (!ready) return;
  const cur = S.bandIndexFor(mapYear(state.year), bands);
  want = (idle ? [cur - 1, cur, cur + 1] : [cur]).filter((i) => i >= 0 && i < bands.length);
  for (const i of want) if (!state.loaded.includes(i)) {
    S.addBand(map, i, bands[i], DATA);
    S.setYear(map, mapYear(state.year), [i], -1); // a new band waits, drawing nothing, until showYear gives it the year
    state.loaded.push(i);
  }
  const on = themeOn(), fill = themeFill();
  const item = itemPids();
  S.setFocus(map, item, state.loaded);
  S.setFill(map, fill, state.loaded, item);
  S.setThemeShapes(map, on ? on.t.shapes ?? null : null, on ? shapesShown(on.t, mapYear(state.year)) : [], fill);
  showThemeKey();
  showYear();
}

// Draw the year. A new filter makes MapLibre lay out the band's tiles again, so only one change runs at a time and
// the latest year wins: a slow browser then skips years, and does not fall behind. The old picture stays until
// the new one is drawn: only then do the other bands stop drawing, and the bands that are not wanted go.
let want = [], drawing = false, redraw = false;
function showYear() {
  if (drawing) { redraw = true; return; }
  drawing = true;
  redraw = false;
  const { map, bands } = state, cur = S.bandIndexFor(mapYear(state.year), bands), started = performance.now();
  S.setYear(map, mapYear(state.year), [cur], cur);
  let frames = 0;
  const check = () => {
    // the first frame after the change starts the layout; after that the band's source says when it is done
    if (frames++ === 0 || !(map.isSourceLoaded("b" + cur) || performance.now() - started > 3000)) return map.triggerRepaint();
    map.off("render", check);
    for (const i of [...state.loaded]) {
      if (i === cur) continue;
      if (want.includes(i)) { S.setYear(map, mapYear(state.year), [i], -1); continue; }
      S.removeBand(map, i);
      forgetSource("b" + i);
      state.loaded = state.loaded.filter((j) => j !== i);
    }
    drawing = false;
    if (redraw) showYear();
  };
  map.on("render", check);
  map.triggerRepaint();
}

// The timeline can fire many times per frame; draw once per frame with the latest year.
// A frame finds nothing queued when setYearAll has run since (a pick or a link set the year).
let queued = null;
function drawLatest(year) {
  if (queued === null) requestAnimationFrame(() => { if (queued !== null) setYearAll(queued); });
  queued = year;
}

let entriesPromise = null, allEntries = []; // allEntries: the list when it has loaded; each pick of an entry comes after that
function getEntries() {
  entriesPromise ??= fetch(DATA + "search.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
    .then((entries) => (allEntries = entries))
    .catch((e) => { entriesPromise = null; throw e; }); // a failure is not cached: the next search tries again
  return entriesPromise;
}

// The cities and towns of today, for the search box only: so that a child can find home. The file loads when the child
// first uses the search box. If it does not load, the search works with no cities, and the next search tries again.
let citiesPromise = null;
const getCities = () => (citiesPromise ??= fetch(DATA + "cities.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
  .then(cityEntries).catch(() => { citiesPromise = null; return []; }));
const getSearchEntries = () => Promise.all([getEntries(), getCities()]).then(([entries, cities]) => entries.concat(cities));

const closePopup = () => popup?.remove();

// The pin of a place of today that the child picked in the search box: a small box with its name, at its position.
// It stays while the year changes, so the child sees what happened around home. Its close button removes it. The
// address of the page does not hold the pin: the page keeps no record of where a child lives.
let pin = null;
function setPin(entry) {
  pin?.remove();
  if (!state.map) return;
  pin = new maplibregl.Popup({ closeOnClick: false, focusAfterOpen: false, anchor: "bottom", maxWidth: "240px", className: "pin" })
    .setLngLat(entry.at).setDOMContent(pinContent(entry)).addTo(state.map);
}

// A theme is a variation of the level Full: it colours the shapes of the map by a number or a class (themes.js).
// state.theme is "theme.group" for a share map, for example "religion.islam", or "theme" for a class map, for example
// "slavery"; with no theme, Full shows the ship lanes and the cables. The file of the
// themes loads when the level Full is first chosen. If it does not load, Full shows the ship lanes and cables.
let themes = null, themesPromise = null;
const getThemes = () => (themesPromise ??= fetch(DATA + "themes.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
  .then((t) => (themes = t)).catch(() => { themesPromise = null; return null; }));
function themeOn() { // -> { id, t: the theme, key: the group of a share map } if a theme shows now
  if (state.level < 2 || !state.theme || !themes) return null;
  const [id, key] = state.theme.split("."), t = themes[id];
  return t && (t.kind === "share" ? t.groups.some(([k]) => k === key) : key === undefined) ? { id, t, key } : null;
}
const themeFill = () => { const on = themeOn(); return on ? fillExpression(on.t, on.key, mapYear(state.year)) : null; };

// The show "Ship lanes and cables" is the level Full with no theme of the file: state.theme has this name for it.
// (With the level Full and no show, the lanes and the cables are a detail of the map, and no polity is grey.)
const LANES = "lanes";
const lanesOn = () => state.level > 1 && state.theme === LANES;

// One rule for each item of the tabs "Lists" and "Shows" (and for a search result): while it is on, only the polities
// of the item are in the foreground, and all the others are grey. -> the polities of the item, or null if no item is
// on. A topic or a search result: its polities. A theme: the polities that have data in the year. The ship lanes and
// cables: no polity, because the lanes and the cables are the item.
function itemPids() {
  if (focusPids) return focusPids;
  const on = themeOn();
  return on ? dataPids(on.t, on.key, mapYear(state.year)) : state.level > 1 && state.theme === LANES ? [] : null;
}

// The same rule: a pick of a show goes to the first year that has data for it. The cables start after the ship lanes.
function toFirstYear() {
  const on = themeOn(), year = on ? themeFirstYear(on.t, on.key) : lanesOn() ? Math.min(...state.lanes.map(([from]) => from)) : null;
  if (!Number.isFinite(year)) return; // the data did not load: the year stays
  state.timeline.setYear(Math.max(year, MIN_YEAR));
  setYearAll(Math.max(year, MIN_YEAR));
}

// The legend of the theme, in the tab "Shows" of the panel "Find": the group, the five steps of the colour, and which
// count shows. The timeline also names the map, so the child knows what is on when the panel is closed.
function showThemeKey() {
  const on = themeOn(), box = document.getElementById("theme-key");
  const share = on?.t.kind === "share", group = share && on.t.groups.find(([k]) => k === on.key)[1];
  state.timeline?.setMap(on ? (share ? `${on.t.name}: ${group}` : on.t.name) : lanesOn() ? "Ship lanes and cables" : null);
  if (!box) return;
  box.hidden = !on;
  if (!on) return;
  const groups = document.getElementById("theme-group"); // a share map: the menu of its groups
  document.getElementById("theme-group-row").hidden = !share;
  if (share && groups.dataset.theme !== on.id) { groups.replaceChildren(...on.t.groups.map(([k, name]) => new Option(name, k))); groups.dataset.theme = on.id; }
  if (share) groups.value = on.key;
  const title = share ? `${group}: share of the people` : on.t.name;
  if (document.getElementById("theme-title").textContent !== title) {
    document.getElementById("theme-title").textContent = title;
    const key = ([color, text]) => {
      const span = Object.assign(document.createElement("span"), { className: "key" }), i = document.createElement("i");
      i.style.background = color;
      span.append(i, text);
      return span;
    };
    document.getElementById("theme-steps").replaceChildren(...legend(on.t).map(key));
    box.querySelector("a").href = "sources.html#" + on.id;
  }
  document.getElementById("theme-count").textContent = share ? countLine(on.t, mapYear(state.year))
    : mapYear(state.year) < on.t.from ? `No entries before ${formatYear(on.t.from)}.` : "From the entries in the list of cases. The list is not complete.";
}

// The line of the theme in the popup of a polity: its largest groups, so that a mixed country does not look like one colour.
function themeLine(pid) {
  const on = themeOn();
  if (!on) return null;
  const year = mapYear(state.year), list = (top) => top.map(([name, pct]) => `${name} ${pct}%`).join(", ");
  if (on.t.kind !== "share") return entriesLine(on.t, pid, year) ?? `${on.t.name}: the list has no entry for this place in this year.`;
  const top = topGroups(on.t, pid, year, 4);
  if (top) return `${on.t.name}, count of ${spanAt(on.t, pid, year)[2]}: ${list(top)}.`;
  // An empire with its colonies is one shape in the map data. The count is for the home country only.
  const [home, name] = on.t.homes?.[pid] ?? [], atHome = home && topGroups(on.t, home, year, 4);
  return atHome ? `${on.t.name}, count of ${spanAt(on.t, home, year)[2]}, ${name} only: ${list(atHome)}. The other lands of this area have no count.`
    : `${on.t.name}: no count for this place in this year.`;
}

function setTheme(theme) {
  state.theme = theme || null;
  setLevel(state.level);
  if (ready) setYearAll(state.year);
}

// A pick in the tab "Shows" sets the detail level to Full. levelBefore: the level before that, or null. When the map
// of the tab goes off, the level goes back, so nothing of the map stays (the ship lanes and the cables of Full).
let levelBefore = null;
function mapOff() {
  const level = levelBefore ?? state.level;
  levelBefore = null;
  state.theme = null;
  setLevel(level);
  if (ready) setYearAll(state.year);
}

// What the child found goes off: the pin of a city, and the topic or the search result that is on.
function clearFound() {
  pin?.remove();
  exitFocus();
}

// The button "Clear" at the timeline: the page as it was at the start. Nothing is on, the detail level is Simple,
// and the map shows the whole world in the last year that has map data.
const WORLD = [[-160, -50], [175, 72]];
function clearAll() {
  if (matchMedia("(max-width: 700px)").matches) document.getElementById("find").open = false; // there the open panel covers the map
  clearFound();
  closePopup();
  const today = document.getElementById("today-switch");
  if (today?.checked) today.click();
  levelBefore = null;
  state.theme = null;
  setLevel(0);
  state.timeline.setYear(DATA_YEAR);
  setYearAll(DATA_YEAR);
  state.map?.fitBounds(WORLD);
  saveToHash();
}

// The legend key of the ship lanes says if the year has lane data.
function showLaneKey() {
  const text = document.getElementById("key-lane-text");
  if (text) text.textContent = S.laneKey(mapYear(state.year), state.lanes);
}

// The list of the tab "Shows": "All history", the ship lanes and cables, and one row for each theme. The file of the
// themes loads when the level Full is first chosen, or when the tab "Shows" is first seen. "All history" is the show
// at the start: the map with no other show. The rows are buttons, not a menu: a menu does not
// react to a pick of the entry that is already on, and a click on "All history" must always work.
function showMenu() {
  // With a topic or a search result on, the timeline has only its years: "All history" is not on then.
  const show = state.level > 1 && state.theme ? state.theme.split(".")[0] : focusEntry ? null : "-";
  for (const row of document.querySelectorAll("#shows .t-row")) row.setAttribute("aria-pressed", String(row.dataset.show === show));
}

// The button "All history": a new selection. Nothing else is on, and the timeline goes to its first year, so the play
// shows all of history. The level goes back as in mapOff, or to Simple if the child chose Full.
function allHistory() {
  if (matchMedia("(max-width: 700px)").matches) document.getElementById("find").open = false; // there the open panel covers the map
  clearFound();
  if (state.level > 1) levelBefore ??= 0;
  mapOff();
  state.timeline.setYear(MIN_YEAR);
  setYearAll(MIN_YEAR);
  saveToHash();
}
const fillThemes = () => getThemes().then((all) => {
  const list = document.getElementById("shows");
  if (!all || !list) return;
  if (list.children.length === 2) for (const [id, t] of Object.entries(all)) {
    const row = Object.assign(document.createElement("button"), { type: "button", className: "t-row" });
    row.dataset.show = id;
    row.append(Object.assign(document.createElement("b"), { textContent: t.name }));
    if (t.kind === "share") row.append(Object.assign(document.createElement("small"), { textContent: "Share of the people" }));
    list.append(document.createElement("li"));
    list.lastChild.append(row);
  }
  showMenu();
  if (state.level < 2) return;
  if (state.theme && state.theme !== LANES && !themeOn()) return setTheme(null); // the address named a theme that the data does not have
  if (ready) setYearAll(state.year);
});

// A click on a row of the tab "Shows". It is a new selection: what was found before (a topic or a search result) goes
// off, and the search box is empty again. A show other than "All history" sets the detail level to Full: it needs it.
// A share map starts with its first group; the menu "Group" in its key changes the group. As each pick of an item, it
// goes to the first year that has data for the show.
function pickShow(show) {
  if (show === "-") return allHistory();
  clearFound();
  if (state.level < 2) levelBefore = state.level;
  state.level = 2;
  const t = themes?.[show];
  if (state.theme?.split(".")[0] !== show) state.theme = t?.kind === "share" ? `${show}.${t.groups[0][0]}` : show;
  setTheme(state.theme);
  toFirstYear();
  saveToHash();
}

// The detail level: 0 Simple, 1 More (rivers and mountains), 2 Full (More, and undersea cables and ship lanes).
// Before the map is ready this only remembers the level; begin() applies it.
const LEVELS = ["Simple", "More", "Full"];
function setLevel(level) {
  state.level = level;
  const radio = document.querySelector(`#level input[value="${level}"]`);
  if (radio) radio.checked = true;
  const name = document.getElementById("level-name"); // on the tab "Details": the level shows also when the tab is closed
  if (name) name.textContent = LEVELS[level];
  const lanes = level > 1 && (!state.theme || state.theme === LANES); // a theme takes the place of the ship lanes and the cables
  for (const id of ["key-cable", "key-lane"]) { const key = document.getElementById(id); if (key) key.hidden = !lanes; }
  showLaneKey();
  showMenu();
  if (level > 1) fillThemes();
  showThemeKey();
  if (!ready) return;
  S.setNature(state.map, level > 0 && !(level > 1 && state.theme), DATA); // a show is on: the rivers and the mountains would take the eye from it
  S.setLanes(state.map, lanes, DATA, mapYear(state.year));
  S.setCables(state.map, lanes, DATA, mapYear(state.year));
}

// "Today's borders" switch and the bottom panels' height (the Details panel sits above the timeline).
function wireToday() {
  const timeline = document.getElementById("timeline");
  const setH = () => document.documentElement.style.setProperty("--tl-h", timeline.offsetHeight + "px");
  setH();
  new ResizeObserver(setH).observe(timeline);
  document.getElementById("today-switch")?.addEventListener("change", (e) => {
    for (const id of ["today", "today-disputed"]) state.map?.setLayoutProperty(id, "visibility", e.target.checked ? "visible" : "none");
  });
  document.getElementById("level")?.addEventListener("change", (e) => { levelBefore = null; if (e.target.value < 2) state.theme = null; setLevel(Number(e.target.value)); if (ready) setYearAll(state.year); saveToHash(); });
  document.getElementById("shows")?.addEventListener("click", (e) => { const row = e.target.closest(".t-row"); if (row) pickShow(row.dataset.show); });
  document.getElementById("theme-group")?.addEventListener("change", (e) => { const on = themeOn(); if (on) { setTheme(`${on.id}.${e.target.value}`); toFirstYear(); saveToHash(); } });
  document.getElementById("tab-maps")?.addEventListener("change", fillThemes);
}

function wirePopup(map) {
  // Open the popup for the cable, the water, the polity or the ship lane at this point (MapLibre moves focus into it);
  // false if there is none. A cable is a thin line on top, so it is asked first, with 6 pixels around the point. A water
  // that changed lies on top of the polities, so it is asked before them. A ship lane is asked last, and only in the
  // sea: its band goes on under the land. Of the bands at the point, the strongest one is on top.
  const openAt = (point, lngLat) => {
    const near = [[point.x - 6, point.y - 6], [point.x + 6, point.y + 6]];
    const cable = map.getLayer("cables") && map.queryRenderedFeatures(near, { layers: ["cable-ends", "cables"] })[0];
    const water = !cable && map.queryRenderedFeatures(point, { layers: ["waters"] })[0];
    const polity = !cable && !water && pickFeature(map.queryRenderedFeatures(point, { layers: S.fillLayerIds(state.loaded) }));
    const lane = !cable && !water && !polity && map.getLayer("lanes") && !map.queryRenderedFeatures(point, { layers: ["land"] }).length
      && map.queryRenderedFeatures(point, { layers: ["lanes"] }).sort((a, b) => b.properties.n - a.properties.n)[0];
    const f = cable || water || polity || lane;
    if (!f) return false;
    closePopup();
    popupYear = state.year;
    const content = cable ? cableContent(f.properties, DATA_YEAR) : water ? waterContent(f.properties) : lane ? laneContent(f.properties) : popupContent(f.properties, mapYear(state.year));
    const line = f === polity && themeLine(f.properties.pid);
    if (line) content.append(Object.assign(document.createElement("p"), { textContent: line }));
    const p = popup = new maplibregl.Popup({ maxWidth: "300px" }).setLngLat(lngLat).setDOMContent(content).addTo(map);
    p.on("close", () => { if (popup === p) popup = null; });
    return true;
  };
  map.on("click", (e) => { if (!openAt(e.point, e.lngLat)) closePopup(); });
  // Keyboard: Enter on the map opens the popup for the polity under the centre.
  map.getCanvas().addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const c = map.getCenter();
    openAt(map.project(c), c);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !popup) return;
    const inside = popup.getElement()?.contains(document.activeElement);
    closePopup();
    if (inside) map.getCanvas().focus(); // focus was in the popup: give it back to the map
  });
}

// Keep the polity clear of the timeline (bottom), the zoom buttons (right) and an open tab panel (left), if the
// panel leaves at least half of the width. Capped so the padding never leaves less than 30% of the height
// (landscape phones).
// above: room to keep free over the place, for the box of a school topic.
const EDGE = 52; // the closed tabs at the left edge are 44 pixels wide
function fitPadding(above = 0) {
  const box = state.map.getContainer(), h = box.offsetHeight;
  const top = 24 + above, bottom = Math.max(24, h - document.getElementById("timeline").getBoundingClientRect().top + 12), cap = h * 0.7;
  const k = Math.min(1, cap / (top + bottom));
  const open = document.querySelector(".drawer[open]"), edge = open ? open.getBoundingClientRect().right + 12 : EDGE;
  return { top: top * k, bottom: bottom * k, left: edge <= box.offsetWidth / 2 ? edge : EDGE, right: 64 };
}

// MapLibre skips the animation itself under prefers-reduced-motion (non-essential moves), here and for the zoom buttons.
const fit = (bbox, above) => state.map?.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: fitPadding(above), maxZoom: 6 });

// The box of a school topic. It stands on the north edge of the topic's view, so that it does not cover the place: the
// fit leaves room for it above the place. The child can close it; the topic stays on. -> the height of the box.
function openTopicBox(entry) {
  closePopup();
  if (!state.map) return 0;
  const [west, , east, north] = entry.bbox;
  // The box is narrow enough to stand between the tab "Find" and the zoom buttons on a phone. The focus goes to its
  // name, not to its first link, so a screen reader starts at the top of the box.
  const p = popup = topicPopup = new maplibregl.Popup({ maxWidth: "min(300px, calc(100vw - 110px))", anchor: "bottom", focusAfterOpen: false, className: "topic-box" })
    .setLngLat([(west + east) / 2, north]).setDOMContent(topicContent(entry)).addTo(state.map);
  p.on("close", () => { if (popup === p) popup = null; if (topicPopup === p) topicPopup = null; });
  p.getElement().querySelector("h2")?.focus({ preventScroll: true });
  return p.getElement().offsetHeight;
}

// When the map cannot zoom out far enough to leave room above the place (a topic of the whole world), the box of the
// topic would stand off the top of the screen, or under the tab "Find" or the zoom buttons. Then it moves onto the map,
// between them.
function keepTopicBoxOnScreen() {
  const p = topicPopup, { map } = state;
  if (!p) return;
  // The map repeats the world to the left and to the right, and the box can stand on a copy that is off the screen.
  // So the place is first moved to the copy that is nearest the middle of the map.
  const place = p.getLngLat();
  place.lng += 360 * Math.round((map.getCenter().lng - place.lng) / 360);
  const el = p.getElement(), half = el.offsetWidth / 2, at = map.project(place);
  const left = fitPadding().left + half, right = map.getContainer().offsetWidth - 64 - half; // right of an open tab, as the fit
  const x = left <= right ? Math.min(right, Math.max(left, at.x)) : (left + right) / 2, y = Math.max(at.y, el.offsetHeight + 24);
  if (x !== at.x || y !== at.y) p.setLngLat(map.unproject([x, y]));
}

// A click on the name of the map at the timeline opens the tab "Shows", which has the menu and the colours of the map.
function showMaps() {
  document.getElementById("tab-maps").checked = true;
  document.getElementById("find").open = true;
  fillThemes();
}

// A click on the name at the timeline shows again what is on: the box of a topic (a tap on the map closes it), or the
// place of an empire.
function showFocusAgain() {
  if (!focusEntry) return;
  if (focusEntry.kind !== "topic") return fit(focusEntry.kind === "chain" ? memberAt(focusEntry, state.year).bbox : focusEntry.bbox);
  if (!topicPopup) { openTopicBox(focusEntry); keepTopicBoxOnScreen(); }
}

// An empire, a chain of empires or a school topic is "on": the timeline shows only its years. Only one is on at a time.
// The map goes to the first year that has data for it, and only its polities are in the foreground: the others are
// grey (itemPids). A topic names its polities (show); with no such list, no polity is in the foreground. A topic can
// ask for a detail level, and its text shows in a box.
// year: the address gave a year. keepView: the address gave a map position, which the focus keeps instead of fitting.
function enterFocus(entry, year = itemFirstYear(entry, allEntries), keepView = false) {
  const topic = entry.kind === "topic";
  focusEntry = entry;
  state.focus = entry.id;
  focusPids = topic ? entry.show ?? [] : entry.kind === "chain" ? entry.members.map((m) => m.pid) : [entry.id.slice(2)];
  if (topic && entry.level > state.level) setLevel(entry.level);
  if (topic && entry.level && state.theme) setTheme(null); // a topic that needs a detail level is about the ship lanes: no theme then
  state.timeline.setScale(lifeScale(Math.max(entry.from, MIN_YEAR), entry.to), 20); // a topic can start before the map does
  setYearAll(year);
  state.timeline.setYear(state.year);
  if (topic) box.clear(); else box.setText(entry.name); // the search box names a result of the search, not a topic of a list
  state.timeline.setOn(entry.name, topic ? "List" : "Search"); // the tab of the panel "Find" that has it
  showMenu();
  if (!topic) topicPopup?.remove();
  const above = topic ? openTopicBox(entry) + 12 : 0;
  if (!keepView) fit(entry.kind === "chain" ? memberAt(entry, state.year).bbox : entry.bbox, above);
  if (topic && state.map?.isMoving()) state.map.once("moveend", keepTopicBoxOnScreen); else keepTopicBoxOnScreen();
}

function exitFocus() {
  const was = focusEntry;
  focusEntry = focusPids = state.focus = null;
  if (was) state.timeline.setScale(WHOLE_SCALE, 60);
  box.clear();
  state.timeline.setOn(null);
  showMenu();
  topicPopup?.remove();
  setYearAll(state.year);
}

// The school topics in the tab "Find": drawn at the first opening of the tab, from the entries of the search list.
// With no approved topic, the tab holds the search box only. The guess of the country uses two settings of the
// browser and stays in the browser.
let topicsDrawn = false;
const guess = (codes) => guessCountry(Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.language, codes);

// The events for the line of names at the timeline: the long topics of the child's country and of the world. The
// list loads when the first map is drawn. If it does not load, the line shows no names, and the next play tries again.
async function loadEvents() {
  let entries;
  try { entries = await getEntries(); } catch { return; }
  const country = topicsDrawn ? document.getElementById("country").value || null : guess(topicLists(entries, null).codes);
  state.timeline.setEvents(eventsOf(entries, country));
}

async function drawTopics() {
  if (topicsDrawn) return;
  let entries;
  try { entries = await getEntries(); } catch { return; } // the list did not load: the next opening of the tab tries again
  const all = topicLists(entries, null);
  if (topicsDrawn || !(all.codes.length || all.world.length)) return;
  topicsDrawn = true;
  const byId = (id) => document.getElementById(id), menu = byId("country");
  for (const [code, name] of [...COUNTRIES.filter(([code]) => all.codes.includes(code)), ["", "World only"]]) menu.append(new Option(name, code));
  menu.value = guess(all.codes) ?? "";
  const row = (entry) => {
    const li = document.createElement("li"), button = Object.assign(document.createElement("button"), { type: "button", className: "t-row" });
    button.append(Object.assign(document.createElement("b"), { textContent: entry.name }),
      Object.assign(document.createElement("small"), { textContent: formatSpan(entry.from, entry.to) }));
    button.addEventListener("click", () => pick(entry, true));
    li.append(button);
    return li;
  };
  const draw = () => {
    const name = COUNTRIES.find(([code]) => code === menu.value)?.[1], lists = topicLists(entries, menu.value || null);
    byId("own-head").textContent = name ? name + " history" : "";
    byId("own-head").hidden = byId("own-list").hidden = !name;
    byId("own-list").replaceChildren(...lists.own.map(row));
    byId("world-head").hidden = byId("world-list").hidden = !lists.world.length; // only a country list is approved so far
    byId("world-list").replaceChildren(...lists.world.map(row));
    state.timeline.setEvents(eventsOf(entries, menu.value || null)); // the play names the events of the chosen country
  };
  menu.addEventListener("change", draw);
  draw();
  byId("topics").hidden = false;
}

// A pick in the tab "Search" or in the tab "Lists" (fromList). It is a new selection, so the page shows only this:
// a map of the tab "Shows" goes off, what was found before goes off, and after a pick in a list the search box is empty.
function pick(entry, fromList = false) {
  if (matchMedia("(max-width: 700px)").matches) document.getElementById("find").open = false; // there the open panel covers the map
  if (state.theme || levelBefore !== null) mapOff();
  if (entry.kind !== "place") {
    pin?.remove();
    enterFocus(entry);
    if (!fromList) box.setText(entry.name); // also a topic, if the child found it with the search
    return;
  }
  clearFound(); // a place moves the map; nothing is "on" with it
  fit(entry.bbox);
  if (entry.at) setPin(entry); // a city or town of today
  box.setText(entry.name);
}

// Apply the f, y and map= view from the address bar; an unknown id is dropped silently.
async function applyFocusId(id, year, keepView) {
  let entry = null, noList = false;
  try { entry = id && (await getEntries()).find((e) => e.id === id); } catch { noList = true; }
  if (entry) return enterFocus(entry, year ?? undefined, keepView);
  exitFocus();
  if (noList) state.focus = id; // the search list did not load: the address keeps f, so a reload restores the focus
  if (year !== null) { state.timeline.setYear(year); setYearAll(year); }
}

async function start() {
  state.timeline = createTimeline(document.getElementById("timeline"), { onYear: drawLatest, onClose: exitFocus, onName: showFocusAgain, onPlay: loadEvents, onEvent: enterFocus,
    onMapName: showMaps, onMapClose: () => { mapOff(); saveToHash(); }, onClear: clearAll });
  box = createSearchBox(document.getElementById("search"), { getEntries: getSearchEntries, onPick: pick, onClear: clearFound });
  const first = readState(location.hash);
  state.year = first.year ?? DATA_YEAR; // the page opens on the last year that has map data
  state.focus = first.focus; // set before the first hash write, which would otherwise drop it
  state.theme = first.theme;
  setLevel(first.level);
  state.timeline.setYear(state.year);
  if (first.focus) applyFocusId(first.focus, first.year, first.view);
  window.addEventListener("hashchange", () => {
    const { year, focus, view, level, theme } = readState(location.hash);
    if (level !== state.level || theme !== state.theme) {
      state.theme = theme;
      setLevel(level);
      if (ready) setYearAll(state.year);
    }
    if (focus !== state.focus) return applyFocusId(focus, year, view);
    if (year === null || year === state.year) return;
    state.timeline.setYear(year);
    setYearAll(year);
  });
  document.getElementById("find").addEventListener("toggle", (e) => {
    if (!e.target.open) return;
    drawTopics();
    if (document.getElementById("tab-maps").checked) fillThemes(); // if the file did not load, the next opening tries again
  });
  // Only one tab is open at a time. A new browser does this itself (the two have the same name); this is for an older one.
  const drawers = [...document.querySelectorAll(".drawer")];
  for (const d of drawers) d.addEventListener("toggle", () => { if (d.open) for (const other of drawers) if (other !== d) other.open = false; });
  useFreshProtocol();
  wireToday();
  try {
    state.map = new maplibregl.Map({
      container: "map", style: S.baseStyle(DATA), hash: "map",
      bounds: WORLD, maxZoom: 7, renderWorldCopies: true,
      dragRotate: false, attributionControl: false,
      fadeDuration: 0, // labels show at once: a fade at every year change costs frames while the year moves
    });
  } catch {
    return showError(NO_WEBGL);
  }
  const map = state.map;
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
  // The map does not zoom out to more than one world: at the lowest zoom, one world is as wide as the map.
  const oneWorld = () => map.setMinZoom(Math.log2(map.getContainer().offsetWidth / 512));
  oneWorld();
  map.on("resize", oneWorld);
  wirePopup(map); // the map has no credit line: the credits are in the "Sources" tab of the Details panel (index.html)
  map.on("error", (e) => {
    console.error(e.error);
    if (e.sourceId) { failed.add(failKey(e)); showError(LOAD_FAILED, reloadData); }
  });
  map.on("sourcedata", (e) => { if (e.tile) forget(failKey(e), e.sourceId); });
  mapLoaded = map.once("load");
  await begin();
}

window.__wim = { state, setYearAll };
start();
