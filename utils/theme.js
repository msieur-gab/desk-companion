// theme: the companion's colours, chosen on the phone (Gab, 2026-11-01: "add the theme switch to the companion, but this
// require to start rethinking the settings inside the companion. let us make it simple for now"). A theme is three
// colours in css/theme.css; this names them, sets one and remembers it on the phone (localStorage, read by index.html
// before the page draws, so it opens in its colours). Each swatch shows its own theme's colours: a new theme in
// theme.css only needs a line here.
export const THEMES = [["phosphor", "Phosphor"], ["ink", "Ink"], ["amber", "Amber"], ["slate", "Slate"], ["blue", "Blue"], ["paper", "Paper"]];
export const current = () => document.documentElement.dataset.theme || "phosphor";

export function setTheme(id) {
  document.documentElement.dataset.theme = id;
  try { localStorage.setItem("theme", id); } catch { /* a private window: it holds until the page closes */ }
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg); // the phone's bar above the page
}

// the swatches, one tap each; chosen() redraws whoever shows them
export function themePicker(chosen) {
  const box = document.createElement("div");
  box.className = "t-pick";
  for (const [id, name] of THEMES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "t-swatch" + (id === current() ? " on" : "");
    b.innerHTML = `<i data-theme="${id}"></i><span>${name}</span>`;
    b.onclick = () => { setTheme(id); chosen?.(id); };
    box.append(b);
  }
  return box;
}
