// Map style and band layers. Pure functions of their arguments: nothing here touches
// maplibregl or document at import time, so Node can test it.

export const SURVEYED_FROM = 1946;

// Soft, calm fills; index is the polity's stable colour index `c` (0-11).
export const PALETTE = ["#e8b4ac", "#b9d6a8", "#f1d68f", "#c5bbe4", "#a9d3d6", "#f0c09a",
  "#d4c4a4", "#e5b8d2", "#b3c7e8", "#cfd99a", "#dcb7a0", "#bfe0c4"];

const BAND_LAYERS = ["fill", "disputed", "contested", "line-est", "line-sur", "label"];
const UNDER_WATER = ["fill", "disputed", "contested"]; // the rest of a band draws over water, rivers and mountains
const LINE = "#4a4a50";
const SEA = "#dce9f2";
const NEVER = 1e9; // a year that matches nothing
export const PALE = 0.3;      // the borders and the names of the polities that are not of the item that is on
export const GREY = "#d3d1cb"; // their fill: the colour of "no data" in the key of a theme (themes.js NO_DATA)

export function bandIndexFor(year, bands) {
  return bands.findIndex((b) => b.from <= year && year <= b.to);
}

export const yearFilter = (year) => ["all", ["<=", ["get", "from"], year], [">=", ["get", "to"], year]];

// `ls` from the editorial overrides: "s" surveyed, "e" estimated, "" use the year rule.
export const isSurveyed = (year, ls) => ls === "s" || (ls !== "e" && year >= SURVEYED_FROM);

const LS = ["get", "ls"];
export const surveyedFilter = (year) =>
  ["all", yearFilter(year), year >= SURVEYED_FROM ? ["!=", LS, "e"] : ["==", LS, "s"]];
export const estimatedFilter = (year) =>
  ["all", yearFilter(year), year >= SURVEYED_FROM ? ["==", LS, "e"] : ["!=", LS, "s"]];
const disputedFilter = (year) => ["all", yearFilter(year), ["==", ["get", "d"], 1]];
const contestedFilter = (year) => ["all", yearFilter(year), ["==", ["get", "x"], 1]];

// Large features at every zoom; smaller ones (a higher rank in Natural Earth) as the student zooms in.
const rankFilter = ["<=", ["get", "rank"], ["step", ["zoom"], 1, 3, 3, 5, 99]];

export function baseStyle(dataUrl) {
  return {
    version: 8,
    sources: { base: { type: "vector", url: "pmtiles://" + dataUrl + "base.pmtiles" },
      waters: { type: "geojson", data: dataUrl + "waters.geojson" } },
    // Bottom to top: land, the colours of the polities (each band goes under "lakes"), lakes, waters that changed,
    // rivers and mountains and then their names (under "mark-lines"), borders and polity names (under "mark-names"),
    // today's borders. The two markers draw nothing: they hold the places. MapLibre places names from the top
    // layer down, so a polity name wins its place over the name of a river or a range.
    layers: [
      { id: "sea", type: "background", paint: { "background-color": SEA } },
      { id: "land", type: "fill", source: "base", "source-layer": "land", paint: { "fill-color": "#f4f1ea" } },
      { id: "mark-fills", type: "background", layout: { visibility: "none" } }, // the fills of the bands go under this marker; the shapes of a theme go over it
      { id: "lakes", type: "fill", source: "base", "source-layer": "lakes", filter: rankFilter, paint: { "fill-color": SEA } },
      { id: "waters", type: "fill", source: "waters", filter: yearFilter(NEVER), paint: { "fill-color": SEA } },
      { id: "mark-lines", type: "background", layout: { visibility: "none" } },
      { id: "mark-names", type: "background", layout: { visibility: "none" } },
      { id: "today", type: "line", source: "base", "source-layer": "today", layout: { visibility: "none" },
        paint: { "line-color": "#c0392b", "line-width": 1.5 } },
      { id: "today-disputed", type: "line", source: "base", "source-layer": "today_disputed", layout: { visibility: "none" },
        paint: { "line-color": "#c0392b", "line-width": 1.5, "line-dasharray": [1, 2] } },
    ],
  };
}

// Disputed: one set of diagonals. Contested: a wider, lighter crosshatch (both diagonals),
// so the two read apart in greyscale and the polity's colour still shows through.
function hatch(cross) {
  const size = cross ? 12 : 8, c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.strokeStyle = cross ? "rgba(60, 60, 70, 0.45)" : "rgba(60, 60, 70, 0.55)";
  g.lineWidth = cross ? 1 : 1.5;
  g.beginPath();
  for (const o of [-size, 0, size]) {
    g.moveTo(o, size); g.lineTo(o + size, 0);
    if (cross) { g.moveTo(o, 0); g.lineTo(o + size, size); }
  }
  g.stroke();
  return g.getImageData(0, 0, size, size);
}

// The fill of a polity: its own colour of the palette. A theme of the level Full gives another fill (themes.js).
const OWN_COLOR = ["to-color", ["at", ["get", "c"], ["literal", PALETTE]]];
// pids: the polities of the item that is on (a topic, a search result, a show), or null if no item is on. The polities
// that are not of the item are grey.
const isItem = (pids) => ["in", ["get", "pid"], ["literal", pids]];
export function setFill(map, fill, loaded, pids = null) {
  const color = pids ? ["case", isItem(pids), fill ?? OWN_COLOR, GREY] : fill ?? OWN_COLOR;
  for (const i of loaded) map.setPaintProperty(`b${i}-fill`, "fill-color", color);
}

// The shapes of its own that a theme draws over the fills of the bands (themes.js shapesShown): the home country of
// an empire. shapes: GeoJSON, or null for no theme. pids: the shapes that show in this year. fill: the fill of the theme.
let themeShapes = null;
export function setThemeShapes(map, shapes, pids, fill) {
  if (!map.getSource("theme-shapes")) {
    if (!shapes) return;
    map.addSource("theme-shapes", { type: "geojson", data: shapes });
    map.addLayer({ id: "theme-shapes", type: "fill", source: "theme-shapes", paint: { "fill-color": fill } }, "lakes");   // no outline: a land can be in pieces
  } else if (shapes && shapes !== themeShapes) map.getSource("theme-shapes").setData(shapes);
  themeShapes = shapes ?? themeShapes;
  map.setFilter("theme-shapes", ["in", ["get", "pid"], ["literal", shapes ? pids : []]]);
  if (shapes) map.setPaintProperty("theme-shapes", "fill-color", fill);
}

export function addBand(map, i, band, dataUrl) {
  const source = `b${i}`, polities = { source, "source-layer": "polities" };
  if (!map.hasImage("hatch")) map.addImage("hatch", hatch(false));
  if (!map.hasImage("crosshatch")) map.addImage("crosshatch", hatch(true));
  map.addSource(source, { type: "vector", url: "pmtiles://" + dataUrl + band.file });
  for (const layer of [
    { id: `${source}-fill`, type: "fill", ...polities, layout: { "fill-sort-key": ["-", ["get", "a"]] },
      paint: { "fill-color": OWN_COLOR } },
    { id: `${source}-disputed`, type: "fill", ...polities, paint: { "fill-pattern": "hatch" } },
    { id: `${source}-contested`, type: "fill", ...polities, paint: { "fill-pattern": "crosshatch" } },
    { id: `${source}-line-est`, type: "line", ...polities,
      paint: { "line-color": LINE, "line-width": 1, "line-dasharray": [2, 2] } },
    { id: `${source}-line-sur`, type: "line", ...polities, paint: { "line-color": LINE, "line-width": 1 } },
    { id: `${source}-label`, type: "symbol", source, "source-layer": "labels",
      layout: { "text-field": ["get", "name"], "text-font": ["sans-serif"], "text-size": 12,
        "text-max-width": 8, "symbol-sort-key": ["-", ["get", "a"]] },
      paint: { "text-color": "#2a2a30", "text-halo-color": "rgba(255,255,255,0.85)", "text-halo-width": 1.5 } },
  ]) map.addLayer(layer, UNDER_WATER.includes(layer.id.slice(source.length + 1)) ? "mark-fills" : "mark-names");
}

// A small picture of two peaks, repeated inside each mountain range.
function peaks() {
  const c = document.createElement("canvas");
  c.width = c.height = 16;
  const g = c.getContext("2d");
  g.strokeStyle = "rgba(120, 95, 70, 0.45)";
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(1, 7); g.lineTo(4, 3); g.lineTo(7, 7);
  g.moveTo(9, 15); g.lineTo(12, 11); g.lineTo(15, 15);
  g.stroke();
  return g.getImageData(0, 0, 16, 16);
}

const NATURE_LAYERS = ["nature-rivers", "nature-ranges", "nature-range-names", "nature-river-names"];

// The More level: rivers and mountain ranges. The page asks for the nature file only when `on` is true for the
// first time. After that the layers stay, and only show or hide.
export function setNature(map, on, dataUrl) {
  if (!map.getSource("nature")) {
    if (!on) return;
    if (!map.hasImage("peaks")) map.addImage("peaks", peaks());
    map.addSource("nature", { type: "vector", url: "pmtiles://" + dataUrl + "nature.pmtiles" });
    const src = (layer) => ({ source: "nature", "source-layer": layer }), text = { "text-font": ["sans-serif"] };
    const halo = { "text-halo-color": "rgba(255,255,255,0.8)", "text-halo-width": 1.2 };
    map.addLayer({ id: "nature-ranges", type: "fill", ...src("ranges"), paint: { "fill-pattern": "peaks" } }, "mark-lines");
    map.addLayer({ id: "nature-rivers", type: "line", ...src("rivers"), filter: rankFilter, layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#5d9ac2", "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.8, 6, 2.2] } }, "mark-lines");
    map.addLayer({ id: "nature-range-names", type: "symbol", ...src("range_names"), filter: rankFilter,
      layout: { ...text, "text-field": ["upcase", ["get", "name"]], "text-size": 11, "text-letter-spacing": 0.2, "text-max-width": 7 },
      paint: { "text-color": "#6b5a48", ...halo } }, "mark-lines");
    map.addLayer({ id: "nature-river-names", type: "symbol", ...src("rivers"), minzoom: 4, filter: ["all", rankFilter, ["!=", ["get", "name"], ""]],
      layout: { ...text, "text-field": ["get", "name"], "text-size": 11, "symbol-placement": "line", "symbol-spacing": 400 },
      paint: { "text-color": "#3f7396", ...halo } }, "mark-lines");
    return;
  }
  for (const id of NATURE_LAYERS) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
}

export function setWaterYear(map, year) { map.setFilter("waters", yearFilter(year)); }

const CABLE = "#9a4d1c";
const cableEndFilter = (year) => ["all", ["has", "place"], yearFilter(year)]; // a circle layer would else mark every point of a line

// The Full level: undersea cables, and a dot for each landing place. The line of a cable is an estimate, so it is
// dashed. The page asks for the cable file only when `on` is true for the first time. After that the layers stay,
// and only show or hide. They sit under the borders and under every name.
export function setCables(map, on, dataUrl, year) {
  if (!map.getSource("cables")) {
    if (!on) return;
    map.addSource("cables", { type: "geojson", data: dataUrl + "cables.geojson" });
    map.addLayer({ id: "cables", type: "line", source: "cables", filter: yearFilter(year), layout: { "line-join": "round" },
      paint: { "line-color": CABLE, "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1.2, 6, 2], "line-dasharray": [3, 2] } }, "mark-lines");
    map.addLayer({ id: "cable-ends", type: "circle", source: "cables", filter: cableEndFilter(year),
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 2, 6, 4], "circle-color": CABLE,
        "circle-stroke-color": "#fff", "circle-stroke-width": 1 } }, "mark-lines");
    return;
  }
  for (const id of ["cables", "cable-ends"]) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
}

export function setCableYear(map, year) {
  if (!map.getLayer("cables")) return;
  map.setFilter("cables", yearFilter(year));
  map.setFilter("cable-ends", cableEndFilter(year));
}

// The Full level: ship lanes. A lane is a band of sea that many ships passed in a period of years (the build makes the
// bands from ship logbooks and reports: tools/lanes.py). `n` is the strength of a band, 1 to 3; a strong band lies on the weaker ones.
// A band has no line, because its edge is not exact. The bands lie under the land, so the land covers them at the
// coast. The page asks for the lane file only when `on` is true for the first time.
const LANE = ["match", ["get", "n"], 3, "#8fb4d6", 2, "#b0cbe3", "#cbdded"];
export function setLanes(map, on, dataUrl, year) {
  if (!map.getSource("lanes")) {
    if (!on) return;
    map.addSource("lanes", { type: "geojson", data: dataUrl + "lanes.geojson" });
    map.addLayer({ id: "lanes", type: "fill", source: "lanes", filter: yearFilter(year), paint: { "fill-color": LANE } }, "land");
    return;
  }
  map.setLayoutProperty("lanes", "visibility", on ? "visible" : "none");
}

export function setLaneYear(map, year) {
  if (map.getLayer("lanes")) map.setFilter("lanes", yearFilter(year));
}

// The legend key of the ship lanes. periods: the [from, to] years that have lane data. In any other year the key says
// that there is no data: an empty sea must not read as "no ships".
export const laneKey = (year, periods) => (periods.some(([from, to]) => from <= year && year <= to)
  ? "ship lanes (from ship logbooks and reports)" : "ship lanes: no data for this year");

export function removeBand(map, i) {
  for (const l of BAND_LAYERS) map.removeLayer(`b${i}-${l}`);
  map.removeSource(`b${i}`);
}

// A new filter makes MapLibre lay out every tile of the band again, which is slow. So only the band of the year
// (current) gets the year. The neighbour bands wait with a year that matches nothing: their filter does not change
// while the year moves, so they cost nothing until the year enters them.
export function setYear(map, year, loaded, current) {
  if (loaded.includes(current)) { setWaterYear(map, year); setCableYear(map, year); setLaneYear(map, year); } // with the band of the year: one layout for each year drawn
  for (const i of loaded) {
    const y = i === current ? year : NEVER;
    map.setFilter(`b${i}-fill`, yearFilter(y));
    map.setFilter(`b${i}-disputed`, disputedFilter(y));
    map.setFilter(`b${i}-contested`, contestedFilter(y));
    map.setFilter(`b${i}-line-est`, estimatedFilter(y));
    map.setFilter(`b${i}-line-sur`, surveyedFilter(y));
    map.setFilter(`b${i}-label`, yearFilter(y));
  }
}

// The polities that are not of the item that is on: their borders, names and hatches are pale (setFill makes them grey).
const OPACITY = { disputed: "fill-opacity", contested: "fill-opacity", "line-est": "line-opacity", "line-sur": "line-opacity", label: "text-opacity" };

export function setFocus(map, pids, loaded) {
  const value = pids ? ["case", isItem(pids), 1, PALE] : 1;
  for (const i of loaded) for (const [l, prop] of Object.entries(OPACITY)) map.setPaintProperty(`b${i}-${l}`, prop, value);
}

export const fillLayerIds = (loaded) => loaded.map((i) => `b${i}-fill`);
