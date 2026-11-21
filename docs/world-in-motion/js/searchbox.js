import { formatSpan, formatYear } from "./year.js";
import { rankEntries } from "./search.js";

function el(tag, props = {}, parent) {
  const e = Object.assign(document.createElement(tag), props);
  if (parent) parent.append(e);
  return e;
}

const detail = (e) => (e.kind === "place" ? "Place today" + (e.where ? " · " + e.where : "") : e.kind === "topic" ? "School topic · " + formatSpan(e.from, e.to)
  : `${formatYear(e.from)} – ${formatYear(e.to)}`);

// getEntries() returns a promise of the entries; it is called on first focus so the file loads lazily.
export function createSearchBox(root, { getEntries, onPick, onClear }) {
  const row = el("div", { className: "sb-row" }, root);
  const input = el("input", { type: "search", className: "sb-input", placeholder: "Search a place, empire or topic" }, row);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-label", "Search a place, empire or topic");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", "sb-list");
  input.setAttribute("autocomplete", "off");
  const clearBtn = el("button", { type: "button", className: "sb-clear", textContent: "✕", hidden: true }, row);
  clearBtn.setAttribute("aria-label", "Clear search");
  const list = el("ul", { id: "sb-list", className: "sb-list", hidden: true }, root);
  list.setAttribute("role", "listbox");
  let options = [], active = -1;

  const syncClear = () => { clearBtn.hidden = input.value === ""; };

  function close() {
    list.hidden = true;
    list.replaceChildren();
    options = [];
    active = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function setActive(i) {
    if (active >= 0) options[active].el.removeAttribute("aria-selected");
    active = i;
    if (i < 0) return input.removeAttribute("aria-activedescendant");
    options[i].el.setAttribute("aria-selected", "true");
    options[i].el.scrollIntoView({ block: "nearest" });
    input.setAttribute("aria-activedescendant", options[i].el.id);
  }

  function pick(entry) {
    close();
    input.value = entry.name;
    syncClear();
    if (matchMedia("(pointer: coarse)").matches) input.blur();
    onPick(entry);
  }

  function open(found, none = "No match") {
    close();
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (!found.length) {
      el("li", { className: "sb-none", textContent: none }, list).setAttribute("role", "option");
      list.lastChild.setAttribute("aria-disabled", "true");
      return;
    }
    found.forEach((entry, i) => {
      const li = el("li", { id: `sb-opt-${i}`, className: "sb-opt" }, list);
      li.setAttribute("role", "option");
      el("span", { className: "sb-name", textContent: entry.name }, li);
      el("span", { className: "sb-detail", textContent: detail(entry) }, li);
      li.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the box
      li.addEventListener("click", () => pick(entry));
      options.push({ el: li, entry });
    });
  }

  input.addEventListener("focus", () => getEntries().catch(() => {})); // a failure shows when the student types
  input.addEventListener("input", async () => {
    syncClear();
    const text = input.value;
    if (!text) { close(); return onClear(); } // emptying the box leaves focus, as the ✕ does
    if (!text.trim()) return close();
    let found;
    try { found = rankEntries(text, await getEntries()); } catch { found = null; }
    if (input.value === text) found ? open(found) : open([], "Search did not load. Try again.");
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!options.length) return;
      e.preventDefault();
      const n = options.length;
      setActive(active < 0 ? (e.key === "ArrowDown" ? 0 : n - 1) : (active + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
    } else if (e.key === "Enter") {
      if (options.length) { e.preventDefault(); pick(options[Math.max(active, 0)].entry); } // no active option: the first
    } else if (e.key === "Escape") {
      if (!list.hidden) return close();
      input.value = "";
      syncClear();
      onClear();
    }
  });
  input.addEventListener("blur", close);
  clearBtn.addEventListener("click", () => { input.value = ""; syncClear(); close(); input.focus(); onClear(); });

  return {
    setText(s) { input.value = s; syncClear(); close(); },
    clear() { input.value = ""; syncClear(); close(); },
  };
}
