// icons: the companion's glyphs in one place (Gab, 2026-11-01: "a consolidated js file with a list of icons, and perhaps one
// representing a little phone and desktop"). 24×24 lines in the text's colour, symbios mobile's 1-bit style. Started with
// the files' kinds and where a file is; app.js's own glyphs (its I) move here later, one at a time.
const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const ICONS = {
  // where a file is
  phone: svg('<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>'),
  desk: svg('<rect x="3" y="4" width="18" height="12" rx="1"/><path d="M9 20h6M12 16v4"/>'),
  // the kinds (desk/files.py)
  artist: svg('<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>'),
  album: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>'),
  show: svg('<circle cx="12" cy="11" r="2.5"/><path d="M8 15a5.5 5.5 0 1 1 8 0M5.3 18a9.5 9.5 0 1 1 13.4 0"/><path d="M12 13.5V21"/>'),
  folder: svg('<path d="M3 6.5h6l2 2h10V19H3z"/>'),
  track: svg('<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'),
  episode: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/><path d="M3 4l2 2M21 4l-2 2"/>'),
  memo: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>'),
  note: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 15h6M9 18h4"/>'),
  article: svg('<path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 0-3 3z"/><path d="M18 4h1v13"/>'),
  picture: svg('<rect x="3" y="5" width="18" height="14" rx="1"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/>'),
  video: svg('<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M10 9l5 3-5 3z"/>'),
  document: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>'),
  file: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>'),
};
