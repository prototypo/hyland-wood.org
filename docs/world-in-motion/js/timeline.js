import { clampYear, formatYear, parseYear, stepYear, posToYear, yearToPos, WHOLE_SCALE, POS_MAX, DATA_YEAR } from "./year.js";
import { reached, ongoing } from "./topics.js";

const PLAY = "▶", PAUSE = "❚❚";
// The play shows all of history in 60 seconds, so most events pass in less than a second. The name of an event stays
// for this much play time, so a child can read it.
const HOLD = 3000;

function el(tag, props = {}, parent) {
  const e = Object.assign(document.createElement(tag), props);
  if (parent) parent.append(e);
  return e;
}

export function createTimeline(root, { onYear, onClose, onName, onPlay, onEvent, onMapName, onMapClose, onClear }) {
  let scale = WHOLE_SCALE, sweep = 60, year = DATA_YEAR, playing = false, raf = 0, pos = 0, last = 0;
  let events = [], names = []; // the events of the timeline; the names that show now, each { e, button, age }
  let fromStart = false; // the play starts at the first year of the timeline: it also names the events that began before

  const play = el("button", { type: "button", className: "tl-play", textContent: PLAY }, root);
  play.setAttribute("aria-pressed", "false");
  play.setAttribute("aria-label", "Play");
  // One year back and one year forward, at the two sides of the year box. The slider finds a rough time; these step
  // through it year by year.
  const steps = el("span", { className: "tl-steps" }, root);
  const back = el("button", { type: "button", className: "tl-back", textContent: "‹" }, steps);
  back.setAttribute("aria-label", "One year back");
  const box = el("input", { type: "text", className: "tl-year" }, steps);
  const fwd = el("button", { type: "button", className: "tl-fwd", textContent: "›" }, steps);
  fwd.setAttribute("aria-label", "One year forward");
  // The page as it was at the start (main.js: clearAll). It is here, not in a panel, so the child always sees it.
  const clear = el("button", { type: "button", className: "tl-clear", textContent: "Clear" }, steps);
  clear.setAttribute("aria-label", "Clear: show the map as it was at the start");
  clear.addEventListener("click", () => onClear());
  box.setAttribute("aria-label", "Year");
  box.setAttribute("autocomplete", "off");
  box.setAttribute("inputmode", "text");
  // What is on (an empire or a school topic), and the button that ends it. The search box, which also names it, is in
  // a tab that can be closed; here the child always sees the name and the way out. Hidden when nothing is on.
  // There are two: what was found, and the map of the tab "Shows". Each says which tab it comes from.
  const ons = el("span", { className: "tl-ons", hidden: true }, root);
  function chip(onName, onClose) {
    const box = el("span", { className: "tl-on", hidden: true }, ons);
    const name = el("button", { type: "button", className: "tl-on-name" }, box); // a click shows it again
    name.addEventListener("click", () => onName());
    const close = el("button", { type: "button", className: "tl-on-close", textContent: "✕" }, box);
    close.addEventListener("click", () => onClose());
    box.set = (text, label) => { // the name, or null; label: the tab that it comes from
      if (!text && box.contains(document.activeElement)) play.focus(); // the button goes: keep the keyboard focus in the timeline
      box.hidden = !text;
      name.replaceChildren(...(text ? [el("small", { textContent: label }), text] : []));
      name.setAttribute("aria-label", text ? `${label}: ${text}. Show it again` : "");
      close.setAttribute("aria-label", text ? "Close " + text : "Close");
      ons.hidden = [...ons.children].every((c) => c.hidden);
    };
    return box;
  }
  const on = chip(() => onName(), () => onClose()), mapOn = chip(() => onMapName(), () => onMapClose());
  let mapText = null;
  // The line of names, in the place of `on` while nothing is on. A click on a name turns the topic on.
  // - The play stands still: the line shows the events that go on in the year of the timeline, the newest first, on
  //   more than one row.
  // - During play it is one row. The play names an event when it reaches its first year, and the name stays for HOLD;
  //   a name that does not fit is cut off whole (style.css).
  const now = el("span", { className: "tl-now", hidden: true }, root);
  now.setAttribute("role", "group");
  now.setAttribute("aria-label", "Events at this time");
  const range = el("input", { type: "range", className: "tl-range", min: 0, max: POS_MAX, step: 1 }, root);
  range.setAttribute("aria-label", "Timeline");
  const ticks = el("div", { className: "tl-ticks" }, root);
  ticks.setAttribute("aria-hidden", "true");
  const msg = el("div", { className: "tl-msg" }, root); // shares the tick row's grid cell; shown only when a typed year is invalid
  msg.setAttribute("role", "status");

  function show() {
    box.value = formatYear(year);
    box.removeAttribute("aria-invalid");
    // After the last year of the border data the borders do not change. The note says so; it is not an error. It does
    // not say "no newer data": the events of the lists go on after that year.
    msg.textContent = year > DATA_YEAR ? `The borders are those of ${DATA_YEAR}` : "";
    msg.classList.toggle("note", year > DATA_YEAR);
    range.value = playing ? Math.round(pos) : yearToPos(year, scale);
    range.setAttribute("aria-valuetext", formatYear(year));
  }

  function set(y, emit) {
    const next = clampYear(y);
    const changed = next !== year;
    year = next;
    show();
    if (emit && changed) onYear(year);
  }

  // The line of names has a row of its own on a narrow screen. It takes that room only during play or while it holds a name.
  const showNames = () => { now.hidden = !on.hidden || !(playing || names.length); now.classList.toggle("all", !playing); };
  function addName(e) {
    const button = el("button", { type: "button", textContent: e.name });
    button.addEventListener("click", () => onEvent(e));
    const n = { e, button, age: 0 };
    names.push(n);
    return n;
  }
  function dropNames(keep = () => false) {
    if (now.contains(document.activeElement) && !keep(names.find((n) => n.button === document.activeElement))) play.focus();
    names = names.filter((n) => keep(n) || (n.button.remove(), false));
    showNames();
  }
  // The play stands still: the names of the events that go on in this year. A name that stays keeps its button, and so
  // the keyboard focus.
  function standStill() {
    const list = on.hidden ? ongoing(events, year) : [], active = document.activeElement;
    dropNames((n) => list.includes(n.e));
    list.forEach((e, i) => {
      const n = names.find((x) => x.e === e) ?? addName(e);
      n.age = 0;
      if (now.children[i] !== n.button) now.insertBefore(n.button, now.children[i] ?? null);
    });
    if (now.contains(active)) active.focus(); // a button that moved in the line lost the focus
    showNames();
  }

  function pause() {
    playing = false;
    cancelAnimationFrame(raf);
    play.textContent = PLAY;
    play.setAttribute("aria-pressed", "false");
    play.setAttribute("aria-label", "Play");
    standStill();
  }

  function frame(time) {
    const passed = time - last, before = fromStart && events.length ? -Infinity : year;
    if (events.length) fromStart = false; // the list of events loads at the first play: wait for it
    pos = Math.min(POS_MAX, pos + (passed * POS_MAX) / (sweep * 1000));
    last = time;
    set(posToYear(pos, scale), true);
    if (!playing) return; // a year change can turn something on, which stops the play
    for (const n of names) n.age += passed;
    dropNames((n) => n.age <= HOLD || n.button === document.activeElement); // a name with the keyboard focus stays
    for (const e of on.hidden ? reached(events, before, year) : []) now.prepend(addName(e).button);
    if (pos >= POS_MAX) pause();
    else raf = requestAnimationFrame(frame);
  }

  function start() {
    pos = yearToPos(year, scale);
    if (pos >= POS_MAX) pos = 0; // at the end, play starts over
    fromStart = pos <= 0;
    playing = true;
    last = performance.now();
    play.textContent = PAUSE;
    play.setAttribute("aria-pressed", "true");
    play.setAttribute("aria-label", "Pause");
    raf = requestAnimationFrame(frame);
    showNames();
    onPlay?.();
  }

  function drawTicks() {
    ticks.replaceChildren();
    let prev = -Infinity; // position of the last visible label
    scale.forEach(([p, y], i) => {
      const t = el("span", { textContent: formatYear(y) }, ticks);
      t.style.left = `${p / 100}%`;
      t.className = i === 0 ? "first" : i === scale.length - 1 ? "last" : "mid";
      if (i > 0 && i < scale.length - 1 && p - prev < 1200) t.classList.add("skip"); // too close to the previous visible label
      else prev = p;
      if (i !== scale.length - 1 && i !== 0 && i !== scale.length >> 1) t.classList.add("minor"); // narrow screens keep only the ends and the middle label
    });
  }

  play.addEventListener("click", () => (playing ? pause() : start()));

  // A move of the year by hand: the play stops, and the line shows the events of the new year.
  function byHand(y) {
    pause();
    set(y, true);
    standStill();
  }
  back.addEventListener("click", () => byHand(stepYear(year, -1)));
  fwd.addEventListener("click", () => byHand(stepYear(year, 1)));

  range.addEventListener("input", () => byHand(posToYear(Number(range.value), scale)));

  const KEYS = {
    ArrowLeft: () => stepYear(year, -1), ArrowDown: () => stepYear(year, -1),
    ArrowRight: () => stepYear(year, 1), ArrowUp: () => stepYear(year, 1),
    PageDown: () => stepYear(year, -100), PageUp: () => stepYear(year, 100),
    Home: () => posToYear(0, scale), End: () => posToYear(POS_MAX, scale),
  };
  range.addEventListener("keydown", (e) => {
    const f = KEYS[e.key];
    if (!f || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    byHand(f());
  });

  function commit() {
    const y = parseYear(box.value);
    pause();
    if (y === null) {
      show();
      box.setAttribute("aria-invalid", "true");
      msg.textContent = "Try a year such as 44 BCE";
      msg.classList.remove("note"); // an error, also after the last year of the map data
    } else {
      set(y, true);
      standStill();
    }
  }
  box.addEventListener("change", commit);
  box.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); });
  box.addEventListener("input", () => { box.removeAttribute("aria-invalid"); msg.textContent = ""; });

  drawTicks();
  show();

  return {
    setYear(y) { pause(); set(y, false); standStill(); },
    setEvents(list) { events = list; if (!playing) standStill(); }, // the events of the line of names (topics.js eventsOf)
    say(text) { msg.textContent = text; msg.classList.remove("note"); }, // a short note under the year box; the next year change clears it
    setOn(text, label) { // the name of what is on, or null; label: "List" or "Search"
      on.set(text, label);
      if (playing) showNames(); else standStill();
    },
    setMap(text) { // the name of the map of the tab "Shows", or null. The page calls this at each year: it must be cheap.
      if (text !== mapText) mapOn.set((mapText = text), "Show");
    },
    setScale(s, sweepSeconds) {
      pause();
      scale = s;
      sweep = sweepSeconds;
      drawTicks();
      show();
    },
    pause,
  };
}
