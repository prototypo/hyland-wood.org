// Popup content for a clicked polity. Nothing here touches maplibregl, window or document
// at import time, so Node can test the pure functions.
import { formatSpan, formatYear } from "./year.js";
import { isSurveyed } from "./mapstyle.js";

export const pickFeature = (features) =>
  features.reduce((best, f) => (best === null || f.properties.a < best.properties.a ? f : best), null);

export const wikipediaUrl = (title) => "https://en.wikipedia.org/wiki/" + encodeURIComponent(title.replaceAll(" ", "_"));

export const isHttp = (s) => typeof s === "string" && /^https?:\/\//i.test(s);

export const spanLine = (p) => p.x // 1: control was contested; 2: a plain gap in the data
  ? `The data has no border for ${formatYear(p.of)} – ${formatYear(p.ot)}. The last known border is shown.`
  : `This border applies to ${formatYear(p.of)} – ${formatYear(p.ot)}.`;

// The frame of a small popup: its root, and helpers that add a line of text and a link (only an http(s) address
// becomes a link).
function frame() {
  const root = document.createElement("div");
  root.className = "popup";
  const add = (tag, text, className) => {
    const e = document.createElement(tag);
    e.textContent = text;
    if (className) e.className = className;
    root.append(e);
    return e;
  };
  const link = (parent, text, href) => {
    if (!isHttp(href)) return;
    const a = document.createElement("a");
    Object.assign(a, { textContent: text, href, rel: "noopener", target: "_blank" });
    parent.append(a);
  };
  return { root, add, link };
}

// The popup of an undersea cable: its name, its years, its landing places, the note, the source. A cable that is
// still in use in the last year of the map (lastYear) has no end year to show.
export function cableContent(p, lastYear) {
  const { root, add, link } = frame();
  add("h2", p.name, "popup-name");
  add("p", p.to >= lastYear ? `Undersea cable, in use from ${formatYear(p.from)}.` : `Undersea cable, in use ${formatYear(p.from)} – ${formatYear(p.to)}.`);
  add("p", `Lands at: ${p.lands}`);
  link(add("p", p.note + " "), "Source", p.src);
  add("p", "The line is an estimate. It shows which places the cable joins, not its true path.");
  add("p", "The map shows only some well-known cables, not all."); // no line in a year does not mean that no cable was there
  return root;
}

// The popup of a ship lane: its years, its strength (n: 1 to 3), what the band is made from, and its limits.
// src names the data: "cliwoc" (count is a number of voyages) or "icoads" (count is a number of reports).
const LANE_SHIPS = { 1: "Some", 2: "Many", 3: "Very many" };
const LANE_DATA = {
  cliwoc: [(n) => `The band is a summary of ${n} voyages, from the logbooks of British, Dutch, French and Spanish ships. Ships of other countries are not in it. `,
    "https://doi.org/10.1594/PANGAEA.611088"],
  icoads: [(n) => `The band is a summary of ${n} reports from ships of many countries. A ship that sent no report is not in it. `,
    "https://www.ncei.noaa.gov/products/international-comprehensive-ocean-atmosphere-data-set"],
};
export function laneContent(p) {
  const { root, add, link } = frame();
  const [words, source] = LANE_DATA[p.src];
  add("h2", "Ship lane", "popup-name");
  add("p", `${LANE_SHIPS[p.n]} ships went this way in the years ${formatYear(p.from)} – ${formatYear(p.to)}.`);
  link(add("p", words(Number(p.count).toLocaleString("en-US"))), "Source", source);
  add("p", "The band is an estimate. It does not show the path of one ship.");
  return root;
}

// The pin of a place of today that the child picked in the search box: its name and where it is. "Today" says that the
// place may not have been there in the year of the map.
export function pinContent(e) {
  const { root, add } = frame();
  add("h2", e.name, "popup-name");
  add("p", `${e.where} · a place of today`, "popup-data-name");
  return root;
}

// The box of a school topic: its name, its years, its text, the source of the text.
export function topicContent(e) {
  const { root, add, link } = frame();
  add("h2", e.name, "popup-name").tabIndex = -1; // the page moves the focus here, so a screen reader starts at the name
  add("p", formatSpan(e.from, e.to), "popup-data-name");
  add("p", e.text);
  link(add("p", "", "popup-links"), "Source", e.source);
  return root;
}

// The popup of a water that changed (the Aral Sea): its name, the years of this shape, the note, the sources.
export function waterContent(p) {
  const { root, add, link } = frame();
  add("h2", p.name, "popup-name");
  add("p", `This shape applies to ${formatYear(p.from)} – ${formatYear(p.to)}.`);
  add("p", "The edge of the water is an estimate.");
  link(add("p", p.note + " "), "Source", p.src);
  link(add("p", "", "popup-links"), "Shape of the water", p.au);
  return root;
}

export function popupContent(p, year) {
  const root = document.createElement("div");
  root.className = "popup";
  const add = (tag, text, className) => {
    const e = document.createElement(tag);
    e.textContent = text;
    if (className) e.className = className;
    root.append(e);
    return e;
  };
  const link = (parent, text, href, external = true) => {
    const a = document.createElement("a");
    a.textContent = text;
    a.href = href;
    if (external) { a.rel = "noopener"; a.target = "_blank"; }
    parent.append(a);
    return a;
  };
  add("h2", p.name, "popup-name");
  const dataName = p.pid.replace(/^\((.*)\)$/, "$1");
  if (dataName !== p.name) add("p", dataName, "popup-data-name");
  const noted = (label, note, source) => {
    const para = add("p", `${label}: ${note || "No note recorded."} `);
    if (isHttp(source)) link(para, "Source", source);
    else para.append(source ? `Source: ${source}` : "No source recorded.");
  };
  add("p", spanLine(p));
  add("p", isSurveyed(year, p.ls) ? "Surveyed border." : "This border is an estimate.");
  if (p.x === 1) noted("Contested", p.xn, p.xs);
  if (p.x === 2) noted("Gap in the data", p.xn, p.xs);
  if (p.d === 1) noted("Disputed", p.dn, p.ds);   // the disputed part of a polity is its own feature, with its own note
  else if (p.dn) noted("Border dispute", p.dn, p.ds); // a dispute with no shape to hatch: the note only
  const links = add("p", "", "popup-links");
  if (p.w) link(links, "Wikipedia", wikipediaUrl(p.w));
  // ad: a shape added from outside the data; au: where an outside shape (the whole row, or its hatched part) comes from
  if (p.ad !== 1) link(links, "Border data: Cliopatria", "sources.html#cliopatria", false);
  if (isHttp(p.au)) link(links, p.ad === 1 ? "Border data" : "Disputed area shape", p.au);
  return root;
}
