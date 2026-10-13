---
name: BetterMV
description: The plugin's own chrome inside NetEase Cloud Music; white glyphs over the MV, grouped lists in settings
colors:
  indigo: "#5e5ce6"
  indigo-light-host: "#5856d6"
  indigo-text: "#a5a3ff"
  stage-black: "#000000"
  label-1: "#ffffff"
  label-2: "rgba(255,255,255,.7)"
  label-3: "rgba(255,255,255,.5)"
  label-4: "rgba(255,255,255,.18)"
  fill: "rgba(255,255,255,.14)"
  fill-2: "rgba(255,255,255,.08)"
  sheet-material: "rgba(28,28,31,.74)"
  card-material: "rgba(34,34,37,.97)"
  mvbtn-material: "rgba(28,28,30,.74)"
  tip-material: "rgba(30,30,32,.86)"
  ink: "#1d1d1f"
  ink-2: "rgba(60,60,67,.8)"
  ink-3: "rgba(60,60,67,.46)"
  snow: "#f5f5f7"
  snow-2: "rgba(235,235,245,.66)"
  snow-3: "rgba(235,235,245,.4)"
  group-light: "rgba(0,0,0,.035)"
  group-dark: "rgba(255,255,255,.055)"
  control-light: "#ffffff"
  control-dark: "rgba(255,255,255,.17)"
  segment-on-dark: "#68686d"
  switch-off-light: "rgba(120,120,128,.26)"
  switch-off-dark: "rgba(120,120,128,.38)"
  page-light: "#ffffff"
  page-dark: "#1f1f22"
  apply-light: "rgba(250,250,252,.97)"
  apply-dark: "rgba(50,50,54,.97)"
  error-dark: "#ff453a"
  error-light: "#d70015"
  mark-tile-top: "#ec4141"
  mark-tile-bottom: "#3a0f1f"
typography:
  display:
    fontFamily: "Segoe UI Variable Display, Segoe UI, Noto Sans SC, Microsoft YaHei UI, Microsoft YaHei, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.25
  title:
    fontFamily: "Segoe UI Variable Display, Segoe UI, Noto Sans SC, Microsoft YaHei UI, Microsoft YaHei, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.2
  song-title:
    fontFamily: "Segoe UI Variable Display, Segoe UI, Noto Sans SC, Microsoft YaHei UI, Microsoft YaHei, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.3
  subtitle:
    fontFamily: "Segoe UI Variable Text, Segoe UI, Noto Sans SC, Microsoft YaHei UI, Microsoft YaHei, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.4
  body:
    fontFamily: "Segoe UI Variable Text, Segoe UI, Noto Sans SC, Microsoft YaHei UI, Microsoft YaHei, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Segoe UI Variable Text, Segoe UI, Noto Sans SC, Microsoft YaHei UI, Microsoft YaHei, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: "tnum"
  caption:
    fontFamily: "Segoe UI Variable Text, Segoe UI, Noto Sans SC, Microsoft YaHei UI, Microsoft YaHei, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  xs: "5px"
  sm: "7px"
  md: "8px"
  group: "10px"
  lg: "12px"
  sheet: "14px"
  full: "50%"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  row: "14px"
  lg: "16px"
  xl: "24px"
  bar: "28px"
components:
  glyph-button:
    textColor: "{colors.label-1}"
    rounded: "{rounded.full}"
    size: "40px"
  glyph-button-hover:
    backgroundColor: "{colors.fill-2}"
  glyph-button-on:
    backgroundColor: "{colors.fill}"
  glyph-button-play:
    size: "48px"
  glyph-button-quiet:
    textColor: "{colors.label-2}"
  window-button:
    textColor: "{colors.label-1}"
    rounded: "9px"
    width: "38px"
    height: "34px"
  style-chip:
    textColor: "{colors.label-2}"
    rounded: "{rounded.md}"
    height: "30px"
    padding: "0 10px"
  style-chip-hover:
    backgroundColor: "{colors.fill-2}"
    textColor: "{colors.label-1}"
  sheet:
    backgroundColor: "{colors.sheet-material}"
    textColor: "{colors.label-1}"
    rounded: "{rounded.sheet}"
    width: "380px"
  queue-row:
    rounded: "{rounded.md}"
    height: "52px"
    padding: "0 12px"
  queue-row-now:
    backgroundColor: "{colors.fill-2}"
  settings-page:
    backgroundColor: "{colors.page-light}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "18px 18px 28px"
    width: "700px"
  settings-group:
    backgroundColor: "{colors.group-light}"
    rounded: "{rounded.group}"
  settings-row:
    padding: "10px 14px"
    height: "44px"
  segmented-control:
    rounded: "{rounded.md}"
    padding: "2px"
  segmented-option:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "6px"
    height: "24px"
    padding: "0 12px"
  segmented-option-on:
    backgroundColor: "{colors.control-light}"
  switch-off:
    backgroundColor: "{colors.switch-off-light}"
    rounded: "12px"
    width: "40px"
    height: "24px"
  switch-on:
    backgroundColor: "{colors.indigo-light-host}"
  push-button:
    backgroundColor: "{colors.control-light}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    height: "26px"
    padding: "0 12px"
  push-button-primary:
    backgroundColor: "{colors.indigo-light-host}"
    textColor: "{colors.label-1}"
  push-button-mv-page:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.label-1}"
    rounded: "{rounded.md}"
    height: "30px"
    padding: "0 16px"
  stepper:
    backgroundColor: "{colors.control-light}"
    rounded: "{rounded.sm}"
    height: "28px"
  shortcut-recorder:
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: "30px"
    padding: "3px 6px"
  key-cap:
    backgroundColor: "{colors.control-light}"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    height: "22px"
    padding: "0 6px"
  apply-bar:
    backgroundColor: "{colors.apply-light}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "8px 8px 8px 16px"
  scene-tile:
    rounded: "{rounded.sm}"
  scene-check:
    backgroundColor: "{colors.indigo-light-host}"
    textColor: "{colors.label-1}"
    rounded: "{rounded.full}"
    size: "20px"
  sketch-card:
    backgroundColor: "{colors.card-material}"
    textColor: "{colors.snow}"
    rounded: "{rounded.lg}"
    width: "320px"
  mv-button:
    backgroundColor: "{colors.mvbtn-material}"
    textColor: "{colors.label-1}"
    rounded: "{rounded.sheet}"
    height: "28px"
    padding: "0 12px 0 10px"
  hover-tip:
    backgroundColor: "{colors.tip-material}"
    textColor: "{colors.label-1}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "4px 9px"
---

# Design System: BetterMV

## Overview

**Creative North Star: "The Player That Steps Aside"**

BetterMV's chrome is the full-screen music player and the system settings window, played straight and finished carefully. On the MV page the picture is everything: a mouse move brings white glyphs up over a soft black scrim, and 2.5 s of rest takes them away again. Nothing on that page carries a fixed colour; the only hue is the playing song's own, and it marks only the loud sections of the progress line. The sheet that slides over the picture (settings, play list) is a dark vibrancy material, blurred and saturated, with a hairline edge; the scene sketch card beside it is a near-opaque solid of the same family. Everything that moves over the picture moves on the compositor: transform and opacity only. The page itself fades in (320ms) and out (200ms), and the controls slide a few pixels with their fade, so nothing pops.

The settings page follows the system-settings grammar: an app header with the app mark, then grouped inset lists with the label on the left and the control on the right, segmented controls, switches, a stepper, push buttons, shortcut recorders shown as key caps, and a thumbnail grid for scenes and looks. It follows NetEase's skin, judged from what is actually painted under the page (see Settings Page in Components), re-checked every second while shown, and it carries its own ground so its words stay legible even if the judgement is wrong; its one accent is indigo (never NetEase red). The same view, compacted and always dark, is the MV page's settings sheet.

Waiting is shown as work about this song: the cover alive behind a large artwork, the song's name, one line of progress drawn as the song's sections, the current step and its percentage. When the MV is ready and the controls are up, the artwork flies into the lower-left thumbnail, where it can be seen to land; when they are away (the usual case: nobody touches the mouse while waiting), the whole waiting view and the living cover fade out together as one, the artwork settling back a little, and the MV comes up behind it. Never fly to a thumbnail that is not on screen. There is no spinner.

All rules live under `bmv-` classes in one injected `<style id="bmv-style">` (`src/plugin/uiStyle.ts`), inside NetEase Cloud Music's embedded Chromium 91.

**Key Characteristics:**
- Monochrome white chrome at four label levels over gradient scrims; glyphs sit on no plate at rest.
- The song's colour is the MV page's only hue; indigo is the settings page's only accent.
- Vibrancy material only on the sheet that slides over the picture when opened (and the MV button over the host).
- Motion over the picture is transform and opacity only; layout changes happen at once and are played back as FLIP transforms.
- Hairline edges (0.5px inset) instead of borders; layered soft shadows for lifted surfaces.
- One motion curve, `cubic-bezier(.32,.72,0,1)`, for everything that moves; fades of a whole page or view ease separately (in `ease-out`, out `ease-in`, the waiting view's cross-fade on `cubic-bezier(.45,0,.25,1)`); nothing bounces except the like pop.
- Small, staggered arrivals: things that appear together come in one after another, rising a few pixels.
- Tabular numerals wherever a number changes.

## Colors

A colourless chrome: white at four strengths on the MV page, Apple-style ink and snow greys in settings, one indigo accent, and the song's colour supplied at run time.

### Primary
- **Indigo** (`indigo`; `indigo-light-host` on a light settings page): switch on, the scene/look selection check, the primary 应用 button, the aligner download meter, links (`indigo-text` on dark), the focus ring and text selection. It never appears on the MV page's controls.
- **The Song's Colour** (runtime `--song` on `.bmv-root`, set from the cover by `setStructure`): fills the loud sections of the progress line, at 0.28 opacity ahead of the playhead and full behind it. Not a token; every song brings its own.

### Neutral
- **Stage Black** (`stage-black`): the MV page's base under the WebGL picture and the waiting view.
- **Label 1 to 4** (`label-1` ... `label-4`): MV-page text and glyphs. 1 for titles, active glyphs, the lit progress; 2 for artist, times, the tip's time, quiet glyphs, chip text; 3 for row numbers, durations, the chip's BPM; 4 for the unplayed progress, the volume rail and the window-button rule.
- **Fill / Fill 2** (`fill`, `fill-2`): the hover disc (2) and the pressed/on disc (1) behind glyphs, the current play-list row, the close button's disc.
- **Materials** (`sheet-material`, `card-material`, `mvbtn-material`, `tip-material`): the bases for the sheet and MV button (translucent, under blur), the sketch card (near-opaque solid) and the progress tip.
- **Ink 1 to 3** (`ink`, `ink-2`, `ink-3`) and **Snow 1 to 3** (`snow`, `snow-2`, `snow-3`): settings text on a light and on a dark host.
- **Group / Control / Switch-off** (light and dark pairs): the grouped-list wash, control faces, the off switch track. The dark segmented control's selected face is `segment-on-dark`. The apply bar sits on `apply-light` / `apply-dark` (`--apply`); the settings page's own ground is `page-light` / `page-dark` (`--page`).
- **Error** (`error-dark`, `error-light`): failed aligner state and the "all scenes off" warning only.
- **Mark Tile** (`mark-tile-top` to `mark-tile-bottom`, diagonal gradient): NetEase red sinking into night, the app mark's tile (and film/logo.svg), nowhere else in the UI.

### Named Rules
**The Song's Colour Rule.** On the MV page the only hue is the playing song's, and it marks the loud sections of the progress line and nothing else. Indigo stays in settings.

**The Four Labels Rule.** MV-page text and glyphs use white at 1, .7, .5 and .18 and no other alpha. A new element picks a level by importance, not a new value.

## Typography

**Display Font:** Segoe UI Variable Display (with Segoe UI, Noto Sans SC, Microsoft YaHei UI, Microsoft YaHei)
**Body Font:** Segoe UI Variable Text (with the same fallbacks)

**Character:** The host OS's own face, optical sizes split between display and text, with YaHei UI / Noto Sans SC carrying the Chinese. It reads as part of the system the settings window imitates. Anti-aliased, `optimizeLegibility`.

### Hierarchy
- **Display** (600, 22px, 1.25): the song's name in the waiting view; the settings app name at 700 / 1.2.
- **Title** (700, 20px, 1.2): the sheet title.
- **Song Title** (600, 16px, 1.3): the song's name in the controls.
- **Subtitle** (400, 15px): the artist in the waiting view and the empty-state line; the sketch card title at 600.
- **Body** (400, 13px, 1.4 on the MV page, 1.45 in settings): artist under the controls, chip, play-list names (500, current 600), settings row labels (500), section titles (600).
- **Label** (400, 12px, tabular): times, tip, durations, row subtitles and notes, sub-group headings, segmented options, tile names.
- **Caption** (500, 11px): key caps and the sketch card's badge and foot.

### Named Rules
**The Tabular Numbers Rule.** Every number that changes in place (times, durations, row numbers, version, percentages, stepper values, key caps) uses `font-variant-numeric: tabular-nums`.

**The Sentence Label Rule.** Section and group headings are plain 13px/600 and 12px text in written Chinese; no uppercase, no tracking, no label set above a heading.

## Layout

**MV page.** Full-bleed picture (`.bmv-root`, fixed, inset 0). The top band (`.bmv-top`, 96px gradient) holds the window buttons at top 8px / right 10px. The bottom bar (`.bmv-bar`) pads 52px 24px 14px over its scrim: first the seek row (`.bmv-seek`: current time, progress track with a 20px hit area, length; 12px gap, each time min 34px wide, the length right-aligned), then 4px below a three-column row (`.bmv-row3`: `minmax(0,1fr) auto minmax(0,1fr)`, 16px gap) of song left (44px cover, 12px gap), transport centred (6px gap), and style chip, volume and play list right. When the right column runs short (a narrow window or an open sheet), a ResizeObserver drops the volume slider first, then the style chip. The bar's scrim always spans the whole window; when the sheet opens only its contents make room (`padding-right` of the sheet's width plus 20px, the window buttons' `right` likewise), applied at once and played as a FLIP (`Overlay.shift()`), so there is no seam beside the sheet.

### Named Rules
**The Compositor Rule.** Anything that moves over the picture animates `transform` and `opacity` only, never `top`, `height`, `width`, `right`, `clip-path` or `border-radius`. A size change is applied at once and played back from the old box as a transform; a thickening bar is a fixed box scaled in Y.

**Sheet.** Inset 10px from top, right and bottom, 380px wide (max `100% - 20px`), header padding 16px 14px 10px 20px, scrolling body with an overlay scrollbar (12px, 3px transparent border).

**Settings.** The page is its own rounded ground (max-width 700px, padding 18px 18px 28px, 14px corner, hairline); compact copy pads 0 16px 28px. Sections 24px apart; a section heading pads 0 4px 7px above its group; rows are min 44px, padding 10px 14px, 16px column gap, wrapping so a long control drops under its label. Scene tiles: `auto-fill, minmax(128px,1fr)`, gaps 14px / 12px, padding 14px (compact: 96px, 12px / 10px, 12px).

**Waiting view.** A centred column: artwork `min(36vh,320px)` square, title 28px below, artist 4px, progress line 26px, step line 10px.

Spacing values cluster on 2, 4, 8, 12, 14, 16, 24 and 28px; text measures are capped with `min(70vw, …)` and ellipsis rather than wrapping.

## Elevation & Depth

A hybrid: flat chrome over the picture, lifted surfaces with soft two-layer shadows, vibrancy for the sheet that slides over the picture, and near-opaque solids for transient overlays. Edges are hairlines drawn as `inset 0 0 0 .5px` shadows, not borders.

### Shadow Vocabulary
- **Sheet** (`inset 0 0 0 .5px rgba(255,255,255,.13), 0 24px 64px rgba(0,0,0,.45)`): the settings / play-list sheet.
- **Card** (`inset 0 0 0 .5px rgba(255,255,255,.13), 0 18px 48px rgba(0,0,0,.45)`): the sketch card.
- **Artwork** (`0 2px 6px rgba(0,0,0,.25), 0 28px 70px rgba(0,0,0,.5)`): the waiting view's artwork; the empty-state mark uses `0 2px 6px rgba(0,0,0,.3), 0 18px 48px rgba(0,0,0,.45)`.
- **Thumbnail** (`0 4px 14px rgba(0,0,0,.35)`): the cover in the controls.
- **MV button** (`inset 0 0 0 .5px rgba(255,255,255,.16), 0 4px 16px rgba(0,0,0,.22)`; hover `.22` edge, `0 8px 22px rgba(0,0,0,.28)`).
- **Control** (`inset 0 0 0 .5px var(--line), 0 1px 1px rgba(0,0,0,.06)`): push buttons, stepper; key caps take `0 1px 0` of the separator instead.
- **Thumb** (`0 1px 3px rgba(0,0,0,.28), 0 0 0 .5px rgba(0,0,0,.04)`): switch knob; the progress knob uses `0 1px 4px rgba(0,0,0,.4)`.
- **Apply bar** (`inset 0 0 0 .5px var(--line), 0 10px 30px rgba(0,0,0,.22)`): the floating apply bar in settings; the primary button carries `0 1px 2px rgba(0,0,0,.15)`.

### Materials
- **Sheet vibrancy:** `sheet-material` + `backdrop-filter: blur(30px) saturate(180%)`.
- **Card solid:** `card-material`, no backdrop filter (it sits over the moving picture).
- **MV button vibrancy:** `mvbtn-material` + `blur(20px) saturate(180%)` (sits over NetEase's own UI, not the picture).
- **Scrims:** top `linear-gradient(to bottom, rgba(0,0,0,.36), rgba(0,0,0,.14) 55%, transparent)`; bottom `linear-gradient(to top, rgba(0,0,0,.68), rgba(0,0,0,.46) 40%, rgba(0,0,0,.16) 75%, transparent)`, text-shadow `0 1px 3px rgba(0,0,0,.35)`.
- **Living cover:** two small copies of the cover scaled 5.4x, `blur(9px) saturate(1.6) brightness(.62)` and a screen-blended second at .42 brightness, turning over 56s and 74s (paused while the waiting view is off), under a radial vignette.

### Named Rules
**The Slide-Over Material Rule.** `backdrop-filter` is used only on the sheet (hidden until opened) and on the MV button (over the host's UI). Always-visible chrome over the WebGL picture uses gradient scrims, and transient overlays such as the sketch card are near-opaque solids, never blur.

**The Hairline Rule.** Edges are 0.5px: inset box-shadows on surfaces, 1px separators scaled to `scaleY(.5)` between rows, `.5px` dividers inside the stepper.

## Shapes

Continuous, moderate rounding that grows with the surface: 5px on key caps and badges, 6px on the controls' cover and segmented options, 7px on push buttons, steppers, tiles and the tip, 8px on chips, play-list rows and segmented tracks, 9px on window buttons, 10px on settings groups, 12px on the waiting artwork, sketch card and apply bar, 14px on the sheet, 16px on the empty-state mark, the continuous-corner squircle on the mark tile. Glyph buttons, the close disc, knobs and checks are circles. Progress and volume are capsules on a fixed 8px box shown at `scaleY(.5)` (4px), thickening to full (progress) or `.75` (volume) on hover, the progress split into one capsule per song section.

Glyphs (`src/plugin/icons.ts`) are drawn on a 24px grid in one family: transport glyphs (play, pause, previous, next, filled heart) are fills with a 1.6 round-joined stroke of the same colour, so their corners are soft; everything else is a 1.75 stroke with round caps and joins. Sizes: 18px window glyphs, 20px like and mode, 22px speaker and play list, 24px previous/next, 30px play.

## Components

### Glyph Buttons (`.bmv-g`)
White glyphs with no plate. 40px circle, opacity .9; hover brings opacity 1 and a `fill-2` disc; press scales to .88 on a `fill` disc; glyph swaps animate in (play / pause from scale .6 and opacity .2 over 240ms; the play-mode glyph turns in from -90deg at .6 over 320ms; like pops .7 to 1.22 to 1 over 380ms, unlike settles .8 to 1 over 220ms); `.is-on` keeps the `fill` disc. `.is-play` is a 48px target; `.is-quiet` (like, mode, speaker, play list) uses label 2 and rises to label 1 on hover. In the top band (`.bmv-top-btns`) they become 38 x 34px with a 9px corner, and a 14px `.bmv-rule` (label 4) separates settings from minimise / maximise / close.

### Progress Line (`.bmv-track`, `.bmv-segs`)
The song's structure as the scrubber: one capsule per section, gapped, label 4 ahead of the playhead and label 1 behind it, loud sections in the song's colour. It sits in the seek row between the two times (`.bmv-seek`, 12px tabular label 2). The 8px segment box (`.bmv-segs`) sits at `scaleY(.5)` and scales to 1 on hover or drag over 0.25s; a 12px white knob scales in from .6. When the sheet opens, the track stretches back with `scaleX` from its left edge. The tip (`.bmv-tip`, tip material, 7px) rises 4px as it fades in and names the section in label 1 and the time 8px after it in label 2. The waiting view reuses the same segments as its progress line (`.bmv-load-line`), revealed by two opposite `translateX` transforms: `.bmv-load-fill` slides in from -100% while its inner `.bmv-segs` counter-slides from 100%, over 0.6s.

### Style Chip (`.bmv-chip`)
A text button in the right column: style name in label 2, then "128 BPM" and, while aligning, "正在对齐歌词" as separate words in label 3, 8px apart (no middle dot or other separator glyph in user-facing copy); 30px tall, 8px corner, `fill-2` and label 1 on hover. Opens the settings sheet.

### Volume (`.bmv-vol`)
Speaker glyph plus an 88px track; the rail (label 4) and fill (label 1) sit in a fixed 8px `.bmv-vol-bar` at `scaleY(.5)`, scaling to `.75` with the knob on hover or drag; the wheel nudges by 5%.

### Sheet (`.bmv-sheet`)
Inset vibrancy panel on the right, sliding in from `translateX(100% + 24px)` over 0.45s. Its contents are built first and the slide starts two animation frames later; at the same moment the controls resize and are played as a FLIP on the house curve over 450ms (progress track `scaleX` from the left; transport, right items, end time and window buttons `translateX`). The settings view is laid out once off-screen 1.2s after the MV page opens, so the first opening does not stall. Header: 20px/700 title, a label 2 aside, a 28px circular close (`.bmv-x`, `fill-2`). Holds either the compact settings or the play list; as it slides, its contents arrive in turn from 10px below over 420ms (the first six settings sections 45ms apart, or the play-list rows in sight 22ms apart).

### Play List Rows (`.bmv-q`)
52px rows inset 8px, 8px corner: right-aligned number (12px, label 3) or a three-bar equaliser (`.bmv-eq`, paused when playback is), name 13/500 and artist 12px label 2, duration label 3. Current row on `fill-2` with the name at 600.

### Settings Groups (`.bmv-group`, `.bmv-row`)
Rounded 10px washes with a hairline edge; rows with the label (500) and an optional 12px subtitle on the left, the control on the right, hairline separators inset 14px.

### Controls in Settings
- **Segmented control** (`.bmv-segc`): a 2px-padded 8px track; options 24px tall, the selected one on the control face at 600 with `0 1px 2px rgba(0,0,0,.14)`.
- **Switch** (`.bmv-switch`): 40 x 24 track, 20px white thumb travelling 16px over 0.3s, stretching to `scaleX(1.18)` toward its travel while held; indigo when on.
- **Press**: segmented options, push buttons, links and the sheet's close scale to .96 while pressed (0.2s on the house curve); tile images to .97.
- **Stepper** (`.bmv-stepper`): 28px, minus / 64px tabular input / plus, hairline dividers, unit label after it.
- **Push button** (`.bmv-btn`): 26px, 7px corner, control face with hairline; on the MV page it is 30px, 8px, white-on-`fill` (the retry button). `.is-primary` fills with the accent, white 600 text, `brightness(1.08)` on hover; it is used only for the one committing action (应用).
- **Link** (`.bmv-link`): indigo text, opacity .75 on hover.
- **Meter** (`.bmv-meter`): 140 x 4px capsule, indigo fill.
- **Key caps** (`.bmv-kbd`): 22px, min 24px wide, 5px corner, 11px/500 tabular, a 1px bottom ledge.
- **Shortcut recorder** (`.bmv-keycap`): a borderless 30px button (8px corner, 3px 6px padding, 12px ink 2) holding the combination as key caps; `ctl-hover` on hover, .97 on press. Clicked, it takes `.is-recording`: caps replaced by 请按下快捷键… in the accent text colour inside a 1.5px inset accent ring. Esc cancels; a combination already used by another action trades places with it, and the section note reads 已与“…”互换 for 2.4s before returning to its usual text. A 恢复默认 link sits in the section header only while any key differs from the defaults.
- **Momentary confirmation**: a push button that acts at once may say what it did in its own label for a moment, then return (换一种 reads 已重新编排 for 1.4s); the apply bar's 已应用 follows the same idea.

### Scene and Look Tiles (`.bmv-tile`)
16:9 preview images (7px corner, hairline), name below in 12px. On: a 20px indigo check top-right, popping in from scale .4 (260ms) when turned on. Off: image at .38 opacity and 70% greyscale, an empty white-ringed check, name in the third ink. Hover zooms the image to 1.045 and, after a short rest, shows the sketch card. Clicking a tile (and 全部开启) only stages the choice; nothing reaches the MV until 应用 in the apply bar.

### Apply Bar (`.bmv-apply`)
A floating bar, `position: sticky` 12px above the bottom of the settings view, centred at its content width, 12px corner on `--apply` with the apply-bar shadow. It rises in (`bmv-rise`, 8px, 0.3s on the house curve) whenever the staged scenes and looks differ from the saved config, and holds "已修改 N 项" (13px, tabular), a 还原 push button and the primary 应用 button, which applies scenes and looks together in one replan. After applying, the buttons hide and the bar says 已应用 in the accent (600) for 1.1s, then goes.

### Settings Page (`.bmv-set.is-page`)
The plugin-panel copy of the settings sits on its own ground (`--page`, 14px corner, hairline), so it reads on either host. Its theme (`data-theme`) is judged by `hostIsDark()` in this order: what is painted under the page (`document.elementsFromPoint` at a point inside the page and in sight, skipping the plugin's own elements; the first opaque background wins), then the median text colour of the host's own words in sibling branches (BetterNCM's plugin list), then ancestor backgrounds, then `prefers-color-scheme`. The order is deliberate: BetterNCM hands down black text, NetEase paints its dark skin on a layer that is not an ancestor of the page, and the system colour scheme is not NetEase's skin. Re-checked every second while shown.

### Settings Sections
The settings view, on the plugin page and in the MV page's sheet alike, runs in this order: 画面 (风格 segmented with its note; 画面编排 segmented 每次不同 / 固定; on the MV page only, 当前歌曲 with a 换一种 push button; 画面延迟 stepper), 性能 (画质; 帧率上限 segmented 不限 / 240 / 120 / 60 / 30; 提前分析下一首 switch), 界面, 歌词, 快捷键 (a group of rows, label left, shortcut recorder right), 场景, 画风. The plugin page adds the app header above. Each section is a sentence-case title over one grouped list, with an optional note.

### Sketch Card (`.bmv-card`)
320px near-opaque card (`card-material`, card shadow, no blur) with a 180px picture frame, 15/600 title with a small badge, a 12px note at 1.55 line height and an 11px foot. Fades in from 4px lower at .98 scale.

### Waiting, Error and Empty Views (`.bmv-load`)
Living cover backdrop, artwork, title, artist, segmented progress line, step text with tabular percentage. On entrance the artwork comes in from scale .94 with a fade over 600ms, then the title, artist, line and step arrive 60ms apart, rising 8px. Error dims the artwork to .45, hides the line, centres the message in label 1 with a 12px hint and a retry push button. Empty swaps the artwork for the app mark (16px corner) and a 15px line. On ready, with the controls up, the artwork flies to the thumbnail in 720ms on the house curve as a transform only (translate + scale; the corner scales with it), then fades over 260ms; with the controls away the view and the backdrop take `.is-leaving` and fade out together over 0.8s on `cubic-bezier(.45,0,.25,1)`, the artwork settling to `scale(.95)` on the same timing. No clone of the artwork is made in that case.

### Page and Controls Entrance
The MV page fades in over 320ms (`ease-out`) when shown and out over 200ms (`ease-in`) when hidden. When the controls wake or sleep, the bottom bar slides from `translateY(10px)` and the top band from `translateY(-6px)` with their fade (transform 0.45s, opacity 0.35s, house curve). Every scripted movement goes through one helper that animates transform and opacity only and does nothing under `prefers-reduced-motion`; staggered entrances use a second helper (each item rises and fades in over 420ms, a fixed step apart).

### MV Button (`.bmv-mvbtn`)
Fixed above NetEase's play bar (right 22px, bottom 92px): a 28px capsule of MV-button material, 12px/600 white with .02em tracking. Hover lifts 1px and deepens the shadow; press scales to .95.

### App Mark (`appIcon`)
The same mark as film/logo.svg: a play button cut into the song's sections, four white bars at .6 and the drop, solid, as the tip, in the first logo's outline and place, on the mark tile; 56px with a 13px corner on the settings header, 72px on the empty waiting view, 18px in the sheet. Gradient ids are per call.

## Do's and Don'ts

### Do:
- **Do** run every eased transition on `cubic-bezier(.32,.72,0,1)`: 0.15 to 0.2s for colour, 0.25s for press and track thickening, 0.3s for thumbs and meters, 0.35s for the bars fading, 0.42s for staggered arrivals, 0.45s for the bars' slide, the sheet, the controls' FLIP and the waiting view, 0.6s for the waiting line, 0.72s for the artwork flight. The exceptions are whole-view fades: the waiting view's cross-fade (0.8s, `cubic-bezier(.45,0,.25,1)`; the house curve front-loads a fade into what reads as a cut) and the MV page's own fade in (320ms `ease-out`) and out (200ms `ease-in`).
- **Do** animate only `transform` and `opacity` over the picture; apply layout changes at once and play them as FLIP transforms.
- **Do** honour `prefers-reduced-motion`: stop the living cover and equaliser, cut transitions to 0.01ms, skip every scripted animation; pause continuous animation whenever its view is off.
- **Do** bring things that appear together in one after another (rise 8 to 10px, fade, 22 to 60ms apart) and give presses a small scale-down (.96, tiles .97).
- **Do** pick MV-page text levels from label 1 to 4 and settings levels from ink / snow 1 to 3, switching the whole `.bmv-set` palette with `[data-theme=dark]`.
- **Do** draw new glyphs on the 24px grid: filled with a 1.6 round join for transport, 1.75 round strokes for the rest.
- **Do** show progress as this song's sections whenever a song is known.
- **Do** name a shortcut from the setting, never a literal: every place that names the opening key (the MV button row's note, the MV button's tip, the play / close buttons' tips) shows the current combination as key caps or text from the same source.
- **Do** stage changes that cost a replan (scenes, looks) and commit them with one primary 应用 in the apply bar; immediate settings stay immediate.
- **Do** keep low-weight resets in `:where(.bmv-ui)` so any single `bmv-` class overrides them, and scope every new rule under a `bmv-` class in the one injected stylesheet.
- **Do** write user-facing copy as concise written Chinese. No middle dot (·) as a separator, ever: separate pieces with spacing and colour, list items with 、, song and artist with " - " (the hover titles), several artists with " / ", both as NetEase does. Picture readouts (HUD, cards, poster) separate with a full-width or em space.

### Don't:
- **Don't** put a plate, pill or fill under a glyph at rest; the disc appears only on hover, press or on-state.
- **Don't** use NetEase red, or any fixed hue, on the MV page's chrome.
- **Don't** judge the settings theme from inherited text colour or the system colour scheme first; ask what is painted under the page.
- **Don't** blur over the WebGL picture with anything that stays on screen.
- **Don't** animate `top`, `height`, `width`, `right`, `clip-path` or `border-radius` on anything over the picture.
- **Don't** hard-code the number of scenes or looks in copy or docs; the catalogue grows.
- **Don't** use a spinner for waiting; show the step and the song's progress line.
- **Don't** let a movement overshoot or bounce. The like pop (.7 to 1.22 to 1) is the one overshoot in the build; don't extend it to other controls.
- **Don't** use `:has`, container queries, `color-mix`, `accent-color`, CSS nesting, `@layer` or individual transform properties; the runtime is Chromium 91.
- **Don't** name any work (videos, albums, projects, third-party works) in user-facing text.
