# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who listen to music in the NetEase Cloud Music (网易云音乐) desktop client on Windows with BetterNCM installed. Confirmed situations (2026-10-13), all four in use:

- leaving the MV page full screen while listening, touching it only to skip a song or change the volume;
- screen-recording the MV page to post short videos (the picture itself is the content, so every control must be able to disappear);
- running it on a second screen or projector as ambience, often for a long time with nobody at the computer;
- trying different songs to see what the MV does, switching styles and turning scenes on and off.

## Product Purpose

BetterMV generates a music video for whatever song is playing, live, on the listener's own machine: it analyses the whole song (tempo, beats, sections such as verse, chorus and drop), builds 3D scenes from the song's cover, cuts shots on the song's structure, and sets the lyrics word by word inside the scenes. Success is a listener who opens the MV page, is struck by it, and keeps coming back to it after the novelty wears off.

## Positioning

Every song gets its own MV, made from that song's cover and that song's structure, with nothing uploaded and nothing pre-made: the colours come only from the cover, the cuts land on the analysed sections and beats, and each play draws a new random seed.

## Operating Context

- Lives inside NetEase Cloud Music 3.x via BetterNCM 1.3.4+. The MV page is a full-window layer over NetEase's own UI; it takes over NetEase's title-bar drag, resize grips, minimise / maximise / close.
- Opened from a small "MV" button above NetEase's play bar or with Ctrl+Shift+M; Esc leaves.
- The settings page is drawn inside BetterNCM's plugin panel, whose background may be light or dark (the host decides); a compact copy of it opens as a side panel on the MV page while the MV keeps playing.
- First open of a song waits a few seconds while the song is read, decoded and analysed (progress is known); later opens are instant.
- NetEase's embedded Chromium; no web workers; picture rendering is WebGL 2 and already costs a few ms per frame, so UI must stay cheap.

## Capabilities and Constraints

- Playback controls mirror NetEase's play bar: like, previous, play / pause, next, play mode, progress (drawn as the song's sections, loud sections marked in the cover's colour), volume, play list. Keys: Space, ← →, ↑ ↓, Esc; NetEase's own Ctrl shortcuts pass through.
- Settings: style (auto / 律动 / 抒情 / 字 / 墨), quality (high / mid / low), picture delay (ms), per-song lyric delay (MV page only), MV button on/off, controls on/off, optional aligner pack (≈400 MB download, install / remove / progress / error), scenes on/off (about thirty, grouped, each with a preview image in public/previews/), looks on/off (3).
- Terms used in the UI: 歌曲、场景、风格、画风、段落、drop、MV 页、控制栏、对齐包.
- Operation follows NetEase (button positions, shortcuts, play-control habits); the UI's visual identity is BetterMV's own and need not use NetEase red (confirmed 2026-10-13). The logo is the exception: it ties the plugin to NetEase through its red (see Brand Commitments).

## Brand Commitments

- Name: BetterMV. Plugin id `ncm-better-mv`. Promoted as its own product: no user-facing text may name any work (the author's videos, albums, other projects, or third-party works).
- Logo (`film/logo.svg`, `appIcon` in `src/plugin/icons.ts`, the same drawing): a play button cut into the song's sections (four white bars at 60 % and the drop, solid, as the tip) on a continuous-corner tile of NetEase red `#ec4141` sinking into night `#3a0f1f`. Chosen 2026-10-13: the author likes the flat play button, but the first logo's orange-pink-purple gradient read as a Chinese video app and a red tile with a plain white triangle reads as YouTube; the section bars make the play button this plugin's own.
- Copy is concise written Chinese, not colloquial ("点击""悬停""即时生效""正在…"); consistent terms as above.
- Each song gets an armillary (rings, ticks and the rhythm of their meshing from its sections, metre and drums; it replaced the earlier crystal on 2026-10-13) — an existing product motif.
- Bundled fonts (OFL), used in the picture: Archivo, Bodoni Moda, Cormorant Garamond for Latin lyrics; Smiley Sans (得意黑) and LXGW WenKai Lite (霞鹜文楷) for Chinese.
- UI craft bar (confirmed 2026-10-13, standing preference): the familiar full-screen-player and system-settings arrangement, executed at the level of Apple Music's full-screen player and macOS System Settings, classic vibrancy material (not Liquid Glass). The user found the standard player and the short-video feed layouts acceptable but "not premium enough"; failure looks like controls that compete with the picture or a generic template.

## Evidence on Hand

- Scene preview images: public/previews/*.webp (one per scene and look).
- README imagery: docs/images/cover.jpg, scenes.jpg, controls.jpg, settings.jpg (rendered from film/; text baked into them needs a re-render).
- No testimonials, user counts or benchmarks exist; none may be invented.

## Product Principles

1. The picture leads. Controls appear when wanted and vanish completely; nothing outshines the MV.
2. Familiar hands, own face: operations behave like NetEase; the look belongs to BetterMV.
3. Show, don't list: where the product has pictures (scenes, looks, the song's structure), the UI shows them rather than naming them.
4. Every song is different: the UI takes its colour from the playing song where that carries meaning, never a fixed decoration.
5. Waiting is part of the show: the first-open analysis is visible work about this song, not a blank spinner.
