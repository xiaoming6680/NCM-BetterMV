// The plugin's glyphs, drawn on a 24 × 24 grid in one family: transport glyphs filled with rounded corners (a fill
// plus a round-joined stroke of the same colour), everything else in 1.75 strokes with round ends.

type Glyph = { fill?: string; line?: string };

const G = {
  play: { fill: '<path d="M8.6 5.6v12.8L18.9 12z"/>' },
  pause: { fill: '<rect x="6.4" y="5" width="4" height="14" rx="1.1"/><rect x="13.6" y="5" width="4" height="14" rx="1.1"/>' },
  prev: { fill: '<path d="M11.4 6.6v10.8L3.8 12zM20.4 6.6v10.8L12.8 12z"/>' },
  next: { fill: '<path d="M3.6 6.6v10.8l7.6-5.4zM12.6 6.6v10.8l7.6-5.4z"/>' },
  heart: { line: '<path d="M12 19.6c-5.2-3.6-8.2-6.6-8.2-10A4.3 4.3 0 0 1 8.1 5.3c1.6 0 3 .8 3.9 2.1.9-1.3 2.3-2.1 3.9-2.1a4.3 4.3 0 0 1 4.3 4.3c0 3.4-3 6.4-8.2 10z"/>' },
  heartFill: { fill: '<path d="M12 19.6c-5.2-3.6-8.2-6.6-8.2-10A4.3 4.3 0 0 1 8.1 5.3c1.6 0 3 .8 3.9 2.1.9-1.3 2.3-2.1 3.9-2.1a4.3 4.3 0 0 1 4.3 4.3c0 3.4-3 6.4-8.2 10z"/>' },
  order: { line: '<path d="M4 6.5h11M4 12h11M4 17.5h7M18.5 9v9.5M15.8 15.8l2.7 2.7 2.7-2.7"/>' },
  repeat: { line: '<path d="M16.8 3.8l2.7 2.7-2.7 2.7M4.5 11.2v-1a3.7 3.7 0 0 1 3.7-3.7h11.3M7.2 20.2l-2.7-2.7 2.7-2.7M19.5 12.8v1a3.7 3.7 0 0 1-3.7 3.7H4.5"/>' },
  repeatOne: { line: '<path d="M16.8 3.8l2.7 2.7-2.7 2.7M4.5 11.2v-1a3.7 3.7 0 0 1 3.7-3.7h11.3M7.2 20.2l-2.7-2.7 2.7-2.7M19.5 12.8v1a3.7 3.7 0 0 1-3.7 3.7H4.5M11 10.6l1.4-.9v4.8"/>' },
  shuffle: { line: '<path d="M16.5 4h3.5v3.5M4 18.5c4.5 0 6-2.3 8-6.5s3.5-6.5 8-6.5M16.5 20H20v-3.5M4 5.5c2.4 0 3.9.7 5 2M20 18.5c-4.5 0-6-1.4-7.2-3.6"/>' },
  sparkle: { line: '<path d="M12 3.5l1.7 5.1 5.1 1.7-5.1 1.7L12 17.1l-1.7-5.1-5.1-1.7 5.1-1.7zM18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>' },
  speaker: { line: '<path d="M4 9.6h2.9L11 5.8v12.4l-4.1-3.8H4z"/><path d="M14.6 9.4a3.6 3.6 0 0 1 0 5.2M17.3 6.8a7.3 7.3 0 0 1 0 10.4"/>' },
  muted: { line: '<path d="M4 9.6h2.9L11 5.8v12.4l-4.1-3.8H4z"/><path d="M15 9.5l5 5M20 9.5l-5 5"/>' },
  list: { line: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/>', fill: '<circle cx="4.8" cy="6.5" r="1.25"/><circle cx="4.8" cy="12" r="1.25"/><circle cx="4.8" cy="17.5" r="1.25"/>' },
  sliders: { line: '<path d="M4 7.5h8M17.5 7.5H20M4 16.5h2.5M12 16.5h8"/><circle cx="14.8" cy="7.5" r="2.4"/><circle cx="9.2" cy="16.5" r="2.4"/>' },
  minimize: { line: '<path d="M5.5 12h13"/>' },
  maximize: { line: '<rect x="5.75" y="5.75" width="12.5" height="12.5" rx="1.6"/>' },
  restore: { line: '<rect x="5.75" y="8.75" width="9.5" height="9.5" rx="1.4"/><path d="M8.75 6.4v-.4c0-.7.5-1.25 1.25-1.25h7c.7 0 1.25.55 1.25 1.25v7c0 .7-.55 1.25-1.25 1.25h-.4"/>' },
  close: { line: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>' },
  xmark: { line: '<path d="M7.5 7.5l9 9M16.5 7.5l-9 9"/>' },
  check: { line: '<path d="M5.5 12.6l4.1 4.1 8.9-9.4"/>' },
  minus: { line: '<path d="M6.5 12h11"/>' },
  plus: { line: '<path d="M12 6.5v11M6.5 12h11"/>' },
  note: { line: '<path d="M9 17.5V5.6l10-2v11.9"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>' },
  warning: { line: '<path d="M12 4.2l8.6 15.1H3.4zM12 10v4.2"/>', fill: '<circle cx="12" cy="16.9" r="1.05"/>' },
  exclaim: { line: '<path d="M12 6v7.4"/>', fill: '<circle cx="12" cy="17.6" r="1.5"/>' },
  arrowUp: { line: '<path d="M12 18.5V6M6.5 11.5L12 6l5.5 5.5"/>' },
  chevronLeft: { line: '<path d="M14.8 5.6L8.4 12l6.4 6.4"/>' },
  chevronRight: { line: '<path d="M9.2 5.6l6.4 6.4-6.4 6.4"/>' },
} satisfies Record<string, Glyph>;

export type IconName = keyof typeof G;

/** One glyph at `size` px, in the current text colour; `weight` thickens the line glyphs. */
export function icon(name: IconName, size = 20, weight = 1.75): string {
  const g: Glyph = G[name];
  const fill = g.fill ? `<g fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">${g.fill}</g>` : '';
  const line = g.line ? `<g fill="none" stroke="currentColor" stroke-width="${weight}" stroke-linecap="round" stroke-linejoin="round">${g.line}</g>` : '';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${line}${fill}</svg>`;
}

const TILE = 'M64 0c12.6 0 18.9 0 23.71 2.45a22.5 22.5 0 0 1 9.83 9.83c2.45 4.81 2.45 11.11 2.45 23.71V64c0 12.6 0 18.9-2.45 23.71a22.5 22.5 0 0 1-9.83 9.83c-4.81 2.45-11.11 2.45-23.71 2.45H36c-12.6 0-18.9 0-23.71-2.45a22.5 22.5 0 0 1-9.83-9.83C0 82.9 0 76.6 0 64V36c0-12.6 0-18.9 2.45-23.71a22.5 22.5 0 0 1 9.83-9.83C17.1 0 23.4 0 36 0Z';
let appIcons = 0;

/**
 * The plugin's mark, as film/logo.svg: a play button cut into the song's sections (four bars and the drop, solid, as
 * the tip) on a tile of NetEase red sinking into night. Used as the settings page's app icon, on the empty loading
 * screen and in the MV page's panel. Ids are per call: an icon inside a hidden element must not own the gradients.
 */
export function appIcon(size = 56): string {
  const id = `bmv-icon${appIcons++}`;
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">
<defs><linearGradient id="${id}b" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ec4141"/><stop offset="1" stop-color="#3a0f1f"/></linearGradient>
<linearGradient id="${id}e" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".42"/><stop offset=".12" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity=".1"/></linearGradient>
<clipPath id="${id}c"><path d="${TILE}"/></clipPath>
<clipPath id="${id}p"><path d="M37.92 27.5Q30.12 23 30.12 32.01V67.99Q30.12 77 37.92 72.5L69.08 54.5Q76.88 50 69.08 45.5Z"/></clipPath></defs>
<path d="${TILE}" fill="url(#${id}b)"/><path d="${TILE}" fill="none" stroke="url(#${id}e)" stroke-width="2" clip-path="url(#${id}c)"/>
<g fill="#fff" clip-path="url(#${id}p)"><rect x="30.12" y="20" width="6.07" height="60" fill-opacity=".6"/><rect x="38.69" y="20" width="3.97" height="60" fill-opacity=".6"/><rect x="45.17" y="20" width="7.73" height="60" fill-opacity=".6"/><rect x="55.39" y="20" width="3.53" height="60" fill-opacity=".6"/><rect x="61.43" y="20" width="15.45" height="60"/></g></svg>`;
}
