// School topics for the tab "Find": the countries that can have a list, the guess of the child's country, and the two
// groups of the list. Pure helpers: no DOM and no navigator, so Node can test them.
// The topics come from search.json (the entries of the kind "topic"); tools/topics.py says what a topic is.

import { MIN_YEAR } from "./year.js";

// The lists, in the owner's order. tools/topics.py has the same codes.
export const COUNTRIES = [["us", "United States"], ["de", "Germany"], ["jp", "Japan"], ["gb", "United Kingdom"],
  ["fr", "France"], ["it", "Italy"], ["ca", "Canada"]];

// The time zones of the seven countries: the names of today, and old names that some browsers still give.
const AMERICA = {
  us: "New_York Detroit Chicago Menominee Denver Boise Phoenix Los_Angeles Anchorage Juneau Sitka Metlakatla Yakutat Nome Adak "
    + "Indianapolis Fort_Wayne Louisville Knox_IN Shiprock Atka",
  ca: "St_Johns Halifax Glace_Bay Moncton Goose_Bay Toronto Iqaluit Winnipeg Resolute Rankin_Inlet Regina Swift_Current Edmonton "
    + "Cambridge_Bay Inuvik Dawson_Creek Fort_Nelson Whitehorse Dawson Vancouver Atikokan Blanc-Sablon Creston "
    + "Montreal Thunder_Bay Nipigon Rainy_River Pangnirtung Yellowknife Coral_Harbour",
};
const ZONES = new Map([["Pacific/Honolulu", "us"], ["Europe/Berlin", "de"], ["Europe/Busingen", "de"], ["Asia/Tokyo", "jp"],
  ["Europe/London", "gb"], ["Europe/Belfast", "gb"], ["Europe/Paris", "fr"], ["Europe/Rome", "it"],
  ...Object.entries(AMERICA).flatMap(([code, names]) => names.split(" ").map((n) => ["America/" + n, code]))]);
const PREFIXES = [["US/", "us"], ["America/Indiana/", "us"], ["America/Kentucky/", "us"], ["America/North_Dakota/", "us"], ["Canada/", "ca"]];
const zoneCountry = (zone) => ZONES.get(zone) ?? PREFIXES.find(([p]) => zone.startsWith(p))?.[1] ?? null;

// The guess of the child's country, from two settings of the browser. It stays in the browser: nothing is sent or
// stored. A time zone that names a place decides alone, so a child in Germany with a browser in American English
// does not get the United States list. With no such time zone (UTC), the region of the language decides.
// have: the countries that have a list. -> one of them, or null.
export function guessCountry(timeZone, language, have) {
  let code = null;
  if (typeof timeZone === "string" && timeZone.includes("/") && !timeZone.startsWith("Etc/")) code = zoneCountry(timeZone);
  else try { code = new Intl.Locale(language).maximize().region?.toLowerCase() ?? null; } catch { /* not a language tag: no guess */ }
  return have.includes(code) ? code : null;
}

const byTime = (a, b) => a.from - b.from || a.name.localeCompare(b.name, "en");

// codes: the countries that have a topic, in the order of COUNTRIES. own: the topics of the country. world: the topics
// that belong to no one country; they show for each country.
export function topicLists(entries, country) {
  const topics = entries.filter((e) => e.kind === "topic");
  const of = (code) => topics.filter((e) => e.for.includes(code)).sort(byTime);
  return { codes: COUNTRIES.map(([code]) => code).filter((code) => topics.some((e) => e.for.includes(code))),
    own: country ? of(country) : [], world: of("world") };
}

// The events for the line of names at the timeline: the topics of the country and of the world that last more than
// one year. A thing of one year passes too fast in the play; it stays a topic in the tab "Find". A topic that needs a
// detail level is about a layer of the map (ship lanes), not about a time: it is not an event.
export const eventsOf = (entries, country) => {
  const { own, world } = topicLists(entries, country);
  return [...own, ...world].filter((e) => e.to > e.from && !e.level);
};

// The events that go on in a year, the newest first: the line shows them while the play stands still.
export const ongoing = (events, year) => events.filter((e) => e.from <= year && year <= e.to)
  .sort((a, b) => b.from - a.from || a.name.localeCompare(b.name, "en"));

// The events whose first year the play reached in one step: after the year `prev`, up to the year `year`.
export const reached = (events, prev, year) => events.filter((e) => prev < e.from && e.from <= year);

// The first year of an item (a topic, an empire or a chain of empires) that the map can show: a pick goes there. For a
// topic that names its polities (show), it is the first year of the topic in which one of them is on the map.
// all: the entries of the search list, which has the years of each polity.
export function firstYear(entry, all) {
  const from = Math.max(entry.from, MIN_YEAR);
  const years = (entry.show ?? []).map((pid) => all.find((e) => e.id === "p:" + pid)).filter((p) => p && p.to >= from && p.from <= entry.to)
    .map((p) => Math.max(p.from, from));
  return years.length ? Math.min(...years) : from;
}
