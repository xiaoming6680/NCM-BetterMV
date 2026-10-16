// The plugin UI's stylesheet: one <style> in the page, every rule under a `bmv-` class so NetEase's own CSS and
// ours never meet. Chromium 91: no :has, container queries, color-mix, accent-color, nesting or @layer.
//
// The look follows a full-screen music player and a system settings window: white glyphs without plates over a soft
// scrim, frosted panels only where something slides over the picture, grouped lists with the label on the left and
// the control on the right. One motion curve throughout.

const FONT = '"Segoe UI Variable Text","Segoe UI","Noto Sans SC","Microsoft YaHei UI","Microsoft YaHei",sans-serif';
const DISPLAY = '"Segoe UI Variable Display","Segoe UI","Noto Sans SC","Microsoft YaHei UI","Microsoft YaHei",sans-serif';

const CSS = `
.bmv-ui{--font:${FONT};--display:${DISPLAY};--ease:cubic-bezier(.32,.72,0,1);--accent:#5e5ce6;--accent-text:#a5a3ff;--song:#fff;
  font:400 13px/1.4 var(--font);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.bmv-ui,.bmv-ui *{font-family:var(--font)}
.bmv-ui *,.bmv-ui *::before,.bmv-ui *::after{box-sizing:border-box}
/* Resets at the lowest weight, so any one class of ours overrides them. */
:where(.bmv-ui) button{margin:0;padding:0;border:0;background:none;color:inherit;font:inherit;line-height:inherit;letter-spacing:inherit;cursor:pointer;-webkit-appearance:none;appearance:none;text-align:inherit}
.bmv-ui :focus{outline:none}
.bmv-ui :focus-visible{outline:2px solid var(--focus,rgba(255,255,255,.9));outline-offset:2px}
.bmv-ui svg{display:block;flex:none}
.bmv-ui ::selection{background:rgba(94,92,230,.45)}

/* ---- The MV page ---- */
.bmv-root{position:fixed;inset:0;z-index:2147483647;display:none;overflow:hidden;background:#000;color:#fff;user-select:none;
  --l1:#fff;--l2:rgba(255,255,255,.7);--l3:rgba(255,255,255,.5);--l4:rgba(255,255,255,.18);--fill:rgba(255,255,255,.14);--fill2:rgba(255,255,255,.08)}
.bmv-stage{position:absolute;inset:0}

/* The cover, alive, while the MV is being made: two blurred copies turning slowly (small layers scaled up, so the blur
   is cheap), darkened at the edges. */
.bmv-backdrop{position:absolute;inset:0;overflow:hidden;background:radial-gradient(55% 60% at 50% 44%,rgba(72,70,180,.2),rgba(72,70,180,0) 70%),#000;opacity:0;transition:opacity .9s var(--ease);pointer-events:none}
.bmv-backdrop.is-on{opacity:1}
.bmv-bd{position:absolute;left:38%;top:38%;width:24%;height:24%;background-size:cover;background-position:center;
  filter:blur(9px) saturate(1.6) brightness(.62);will-change:transform;animation:bmv-drift 56s linear infinite}
.bmv-bd+.bmv-bd{opacity:.7;transform-origin:58% 42%;animation-duration:74s;animation-direction:reverse;mix-blend-mode:screen;filter:blur(9px) saturate(1.5) brightness(.42)}
.bmv-backdrop:not(.is-on) .bmv-bd{animation-play-state:paused}
.bmv-backdrop::after{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,rgba(0,0,0,0) 35%,rgba(0,0,0,.5) 100%)}
@keyframes bmv-drift{from{transform:scale(5.4) rotate(0deg)}to{transform:scale(5.4) rotate(360deg)}}

/* Loading, failure, nothing playing: the artwork, the song, one line of progress. */
.bmv-load{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;
  opacity:0;transition:opacity .45s var(--ease)}
.bmv-load.is-on{opacity:1}
/* Leaving with the controls away: the view fades as one (eased both ways: a fade that front-loads reads as a cut),
   the artwork settling back a little. */
.bmv-load.is-leaving,.bmv-backdrop.is-leaving{transition:opacity .8s cubic-bezier(.45,0,.25,1)}
.bmv-load.is-leaving .bmv-load-art{transform:scale(.95);transition:transform .8s cubic-bezier(.45,0,.25,1)}
.bmv-load-art{width:min(36vh,320px);height:min(36vh,320px);border-radius:12px;background:var(--fill2) center/cover no-repeat;
  box-shadow:0 2px 6px rgba(0,0,0,.25),0 28px 70px rgba(0,0,0,.5)}
.bmv-load-title{margin-top:28px;max-width:min(70vw,720px);font:600 22px/1.25 var(--display);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bmv-load-artist{margin-top:4px;max-width:min(70vw,720px);font-size:15px;color:var(--l2);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bmv-load-line{position:relative;width:min(36vh,320px);height:4px;margin-top:26px;border-radius:2px;overflow:hidden}
.bmv-load-line>.bmv-segs{position:absolute;inset:0}
.bmv-load-fill{position:absolute;inset:0;overflow:hidden;transform:translateX(-100%);transition:transform .6s var(--ease)}
.bmv-load-fill>.bmv-segs{position:absolute;inset:0;transform:translateX(100%);transition:transform .6s var(--ease)}
.bmv-load-step{display:flex;justify-content:space-between;gap:16px;width:min(36vh,320px);margin-top:10px;font-size:12px;color:var(--l2)}
.bmv-load-step b{font-weight:400;font-variant-numeric:tabular-nums}
.bmv-load.is-error .bmv-load-art{opacity:.45}
.bmv-load.is-error .bmv-load-line{display:none}
.bmv-load.is-error .bmv-load-step{justify-content:center;width:auto;max-width:min(70vw,560px);margin-top:18px;font-size:13px;color:var(--l1);text-align:center}
.bmv-load-hint{display:none;max-width:min(70vw,480px);margin-top:4px;font-size:12px;color:var(--l2);text-align:center}
.bmv-load.is-error .bmv-load-hint{display:block}
.bmv-load-retry{display:none;margin-top:16px;pointer-events:auto}
.bmv-load.is-error .bmv-load-retry{display:block}
.bmv-load.is-empty .bmv-load-art,.bmv-load.is-empty .bmv-load-title,.bmv-load.is-empty .bmv-load-artist,.bmv-load.is-empty .bmv-load-line{display:none}
.bmv-load-mark{display:none;border-radius:16px;box-shadow:0 2px 6px rgba(0,0,0,.3),0 18px 48px rgba(0,0,0,.45)}
.bmv-load.is-empty .bmv-load-mark{display:block}
.bmv-load.is-empty .bmv-load-step{justify-content:center;width:auto;margin-top:14px;font-size:15px}

/* Glyph buttons: white, no plate; a faint disc on hover. */
.bmv-g{flex:none;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;color:var(--l1);opacity:.9;
  transition:background-color .2s,opacity .2s,transform .25s var(--ease)}
.bmv-g:hover{opacity:1;background:var(--fill2)}
.bmv-g:active{transform:scale(.88);background:var(--fill)}
.bmv-g.is-play{width:48px;height:48px}
.bmv-g.is-quiet{color:var(--l2)}
.bmv-g.is-quiet:hover{color:var(--l1)}
.bmv-g.has-dot{position:relative}
.bmv-g.has-dot::after{content:"";position:absolute;top:9px;right:8px;width:7px;height:7px;border-radius:50%;background:#ff453a;box-shadow:0 0 0 1.5px rgba(0,0,0,.25)}
.bmv-g.is-on{opacity:1;color:var(--l1);background:var(--fill)}

.bmv-top{position:absolute;left:0;right:0;top:0;height:96px;pointer-events:none;transition:opacity .35s var(--ease),transform .45s var(--ease);will-change:opacity,transform;
  background:linear-gradient(to bottom,rgba(0,0,0,.36),rgba(0,0,0,.14) 55%,rgba(0,0,0,0))}
.bmv-top-btns{position:absolute;top:8px;right:10px;display:flex;align-items:center;gap:2px;pointer-events:auto}
.bmv-top-btns .bmv-g{width:38px;height:34px;border-radius:9px}
.bmv-rule{width:1px;height:14px;margin:0 8px;background:var(--l4)}
.bmv-drag{position:absolute;left:0;right:0;top:0;height:56px}

.bmv-bar{position:absolute;left:0;right:0;bottom:0;padding:52px 24px 14px;transition:opacity .35s var(--ease),transform .45s var(--ease);will-change:opacity,transform;
  background:linear-gradient(to top,rgba(0,0,0,.68),rgba(0,0,0,.46) 40%,rgba(0,0,0,.16) 75%,rgba(0,0,0,0));text-shadow:0 1px 3px rgba(0,0,0,.35)}
.bmv-seek{display:flex;align-items:center;gap:12px;font-size:12px;color:var(--l2);font-variant-numeric:tabular-nums}
.bmv-seek>span{flex:none;min-width:34px}
.bmv-seek>span:last-child{text-align:right}
.bmv-seek>.bmv-track{flex:1}

/* The progress line is the song's structure: a capsule per section, the loud ones in the song's own colour. */
.bmv-track{position:relative;height:20px;cursor:pointer;transform-origin:0 50%}
.bmv-track .bmv-segs{position:absolute;left:0;right:0;top:6px;height:8px;transform:scaleY(.5);transition:transform .25s var(--ease)}
.bmv-track:hover .bmv-segs,.bmv-track.is-drag .bmv-segs{transform:none}
.bmv-segs>i{position:absolute;top:0;bottom:0;border-radius:4px;background:var(--l4)}
.bmv-segs>i.is-loud{background:var(--song);opacity:.28}
.bmv-segs.is-lit>i{background:var(--l1)}
.bmv-segs.is-lit>i.is-loud{background:var(--song);opacity:1}
.bmv-knob{position:absolute;top:4px;width:12px;height:12px;margin-left:-6px;border-radius:50%;background:#fff;opacity:0;transform:scale(.6);
  box-shadow:0 1px 4px rgba(0,0,0,.4);transition:opacity .2s,transform .25s var(--ease);pointer-events:none}
.bmv-track:hover .bmv-knob,.bmv-track.is-drag .bmv-knob{opacity:1;transform:none}
.bmv-tip{position:absolute;bottom:24px;transform:translateX(-50%);padding:4px 9px;border-radius:7px;background:rgba(30,30,32,.86);
  box-shadow:0 0 0 .5px rgba(255,255,255,.12) inset,0 6px 16px rgba(0,0,0,.3);font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums;
  opacity:0;transform:translate(-50%,4px);transition:opacity .15s,transform .25s var(--ease);pointer-events:none}
.bmv-tip span{margin-left:8px;color:var(--l2)}

.bmv-row3{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;column-gap:16px;margin-top:4px}
.bmv-song{display:flex;align-items:center;gap:12px;min-width:0}
.bmv-cover{flex:none;width:44px;height:44px;border-radius:6px;object-fit:cover;background:var(--fill2);box-shadow:0 4px 14px rgba(0,0,0,.35)}
.bmv-song-text{min-width:0}
.bmv-name{font:600 16px/1.3 var(--display);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bmv-artist{margin-top:1px;font-size:13px;color:var(--l2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bmv-transport{display:flex;align-items:center;gap:6px}
.bmv-root.is-nosong .bmv-seek>span,.bmv-root.is-nosong .bmv-segs.is-lit,.bmv-root.is-nosong .bmv-knob,.bmv-root.is-nosong .bmv-tip,
.bmv-root.is-nosong .bmv-chip,.bmv-root.is-nosong .bmv-transport>.is-quiet,.bmv-root.is-nosong .bmv-transport>.is-liked{visibility:hidden!important}
.bmv-root.is-nosong .bmv-transport>.bmv-g{opacity:.35;pointer-events:none}
.bmv-right{display:flex;justify-content:flex-end;min-width:0}
.bmv-right-items{flex:none;display:flex;align-items:center;gap:2px}
.bmv-chip{flex:none;height:30px;margin-right:6px;padding:0 10px;border-radius:8px;font-size:13px;color:var(--l2);white-space:nowrap;
  transition:background-color .2s,color .2s}
.bmv-chip:hover{background:var(--fill2);color:var(--l1)}
.bmv-chip span{margin-left:8px;color:var(--l3)}
.bmv-vol{flex:none;display:flex;align-items:center}
.bmv-vol-track{position:relative;width:88px;height:20px;margin:0 10px 0 2px;cursor:pointer}
.bmv-vol-bar{position:absolute;left:0;right:0;top:6px;height:8px;transform:scaleY(.5);transition:transform .25s var(--ease)}
.bmv-vol-track:hover .bmv-vol-bar,.bmv-vol-track.is-drag .bmv-vol-bar{transform:scaleY(.75)}
.bmv-vol-rail,.bmv-vol-fill{position:absolute;left:0;top:0;bottom:0;border-radius:4px}
.bmv-vol-rail{right:0;background:var(--l4)}
.bmv-vol-fill{background:var(--l1)}
.bmv-vol-track .bmv-knob{top:4px}
.bmv-vol-track:hover .bmv-knob,.bmv-vol-track.is-drag .bmv-knob{opacity:1;transform:none}

/* The sheet over the right of the picture: the settings or the play list. */
.bmv-sheet{position:absolute;top:10px;right:10px;bottom:10px;width:380px;max-width:calc(100% - 20px);display:flex;flex-direction:column;border-radius:14px;
  background:rgba(28,28,31,.74);-webkit-backdrop-filter:blur(30px) saturate(180%);backdrop-filter:blur(30px) saturate(180%);will-change:transform;
  box-shadow:inset 0 0 0 .5px rgba(255,255,255,.13),0 24px 64px rgba(0,0,0,.45);color:var(--l1);
  transform:translateX(calc(100% + 24px));visibility:hidden;transition:transform .45s var(--ease),visibility 0s .45s}
.bmv-sheet.is-open{transform:none;visibility:visible;transition:transform .45s var(--ease)}
.bmv-sheet-head{flex:none;display:flex;align-items:center;gap:10px;padding:16px 14px 10px 20px}
.bmv-sheet-title{font:700 20px/1.2 var(--display)}
.bmv-sheet-aside{flex:1;display:flex;align-items:center;gap:6px;min-width:0;padding-top:3px;font-size:13px;color:var(--l2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bmv-x{flex:none;display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:var(--fill2);color:var(--l2);
  transition:background-color .2s,color .2s}
.bmv-x:hover{background:var(--fill);color:var(--l1)}
.bmv-sheet-body{position:relative;flex:1;overflow-y:auto;overscroll-behavior:contain}
.bmv-scroll::-webkit-scrollbar{width:12px}
.bmv-scroll::-webkit-scrollbar-track{background:transparent}
.bmv-scroll::-webkit-scrollbar-thumb{border:3px solid transparent;border-radius:6px;background:rgba(127,127,127,.38);background-clip:padding-box}
.bmv-scroll::-webkit-scrollbar-thumb:hover{background:rgba(127,127,127,.6);background-clip:padding-box}

.bmv-q{display:flex;align-items:center;gap:12px;height:52px;margin:0 8px;padding:0 12px;border-radius:8px;cursor:pointer;
  content-visibility:auto;contain-intrinsic-size:52px;transition:background-color .15s}
.bmv-q:hover{background:var(--fill2)}
.bmv-q-num{flex:none;display:flex;align-items:center;justify-content:flex-end;width:22px;font-size:12px;color:var(--l3);font-variant-numeric:tabular-nums}
.bmv-q-text{flex:1;min-width:0;line-height:1.35}
.bmv-q-name{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bmv-q-artist{font-size:12px;color:var(--l2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bmv-q-dur{flex:none;font-size:12px;color:var(--l3);font-variant-numeric:tabular-nums}
.bmv-q.is-now{background:var(--fill2)}
.bmv-q.is-now .bmv-q-name{font-weight:600}
.bmv-q-empty{padding:48px 20px;text-align:center;font-size:13px;color:var(--l2)}
.bmv-eq{display:flex;align-items:flex-end;gap:2px;height:12px}
.bmv-eq i{width:3px;height:12px;border-radius:1px;background:var(--l1);transform-origin:bottom;animation:bmv-eq 1.1s ease-in-out infinite}
.bmv-eq i:nth-child(2){animation-delay:-.45s}
.bmv-eq i:nth-child(3){animation-delay:-.8s}
.bmv-root:not(.is-playing) .bmv-eq i{animation-play-state:paused}
@keyframes bmv-eq{0%,100%{transform:scaleY(.3)}50%{transform:scaleY(1)}}

/* ---- The button above NetEase's play bar ---- */
.bmv-mvbtn{position:fixed;right:22px;bottom:92px;z-index:2147480000;display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 12px 0 10px;
  border-radius:14px;background:rgba(28,28,30,.74);-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);
  color:#fff;font-size:12px;font-weight:600;letter-spacing:.02em;line-height:1;
  box-shadow:inset 0 0 0 .5px rgba(255,255,255,.16),0 4px 16px rgba(0,0,0,.22);transition:background-color .2s,transform .25s var(--ease),box-shadow .2s}
.bmv-mvbtn:hover,.bmv-mvbtn[data-hot]{background:rgba(58,58,62,.86);transform:translateY(-1px);box-shadow:inset 0 0 0 .5px rgba(255,255,255,.22),0 8px 22px rgba(0,0,0,.28)}
.bmv-mvbtn:active,.bmv-mvbtn[data-press]{transform:scale(.95)}

/* ---- Settings: the plugin page (light or dark host) and the MV page's sheet ---- */
.bmv-set{--t1:#1d1d1f;--t2:rgba(60,60,67,.8);--t3:rgba(60,60,67,.46);--group:rgba(0,0,0,.035);--line:rgba(0,0,0,.06);--sep:rgba(0,0,0,.09);
  --ctl:#fff;--ctl-hover:#f4f4f6;--apply:rgba(250,250,252,.97);--page:#fff;--track:rgba(118,118,128,.13);--on:#fff;--off:rgba(120,120,128,.26);--accent:#5856d6;--accent-text:#5856d6;--focus:rgba(88,86,214,.6);
  color:var(--t1);font-size:13px;line-height:1.45}
.bmv-set[data-theme=dark]{--t1:#f5f5f7;--t2:rgba(235,235,245,.66);--t3:rgba(235,235,245,.4);--group:rgba(255,255,255,.055);--line:rgba(255,255,255,.07);
  --sep:rgba(255,255,255,.09);--ctl:rgba(255,255,255,.17);--ctl-hover:rgba(255,255,255,.24);--apply:rgba(50,50,54,.97);--page:#1f1f22;--track:rgba(118,118,128,.26);--on:#68686d;
  --off:rgba(120,120,128,.38);--accent:#5e5ce6;--accent-text:#a5a3ff;--focus:rgba(165,163,255,.8)}
/* The plugin page: a sidebar of sections and the current one beside it, in a column that scrolls on its own; the page
   fills the height BetterNCM's panel shows (set from script). Narrow, the sidebar becomes a row above the section. */
.bmv-set.is-page{--side:rgba(0,0,0,.025);display:flex;min-height:320px;border-radius:14px;background:var(--page);box-shadow:inset 0 0 0 .5px var(--line);overflow:hidden}
.bmv-set.is-page[data-theme=dark]{--side:rgba(255,255,255,.025)}
.bmv-set.is-compact{padding:0 16px 28px}
.bmv-appicon{flex:none;width:36px;height:36px;border-radius:9px;box-shadow:0 1px 3px rgba(0,0,0,.16),0 0 0 .5px rgba(0,0,0,.08)}
.bmv-side{position:relative;flex:none;display:flex;flex-direction:column;width:168px;padding:16px 10px;background:var(--side);box-shadow:inset -.5px 0 0 var(--sep)}
.bmv-side-app{display:flex;align-items:center;gap:10px;padding:2px 8px 16px}
.bmv-side-name{font:700 16px/1.2 var(--display)}
.bmv-side-ver{margin-top:2px;font-size:11px;line-height:1.2;color:var(--t2);font-variant-numeric:tabular-nums}
.bmv-side-list{display:flex;flex-direction:column;gap:2px}
.bmv-side-item{display:flex;align-items:center;gap:8px;width:100%;min-height:30px;padding:5px 10px;border-radius:7px;color:var(--t1);text-align:left;transition:background-color .15s}
.bmv-side-item:hover{background:var(--track)}
.bmv-side-item[aria-current=page]{background:var(--accent);color:#fff;font-weight:600}
.bmv-side-label{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bmv-nav-dot{flex:none;width:7px;height:7px;border-radius:50%;background:#ff453a}
.bmv-side-item[aria-current=page] .bmv-nav-dot{background:#fff}
.bmv-main{position:relative;flex:1;min-width:0;padding:20px 20px 28px;overflow-y:auto;overscroll-behavior:contain}
.bmv-pg{display:none;max-width:760px}
.bmv-pg.is-current{display:block}
.bmv-pg[data-page=start],.bmv-pg[data-page=scenes],.bmv-pg[data-page=looks],.bmv-set.is-compact .bmv-pg{max-width:none}
.bmv-pg-title{display:flex;align-items:baseline;gap:12px;padding:0 4px;font:700 20px/1.2 var(--display)}
.bmv-pg-title .bmv-sec-aside{font:400 12px/1.4 var(--font)}
.bmv-pg-lead{padding:4px 4px 0;line-height:1.5;color:var(--t2)}
.bmv-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(236px,1fr));column-gap:20px;align-items:start}
.bmv-set.is-page.is-narrow{flex-direction:column}
.bmv-set.is-narrow .bmv-side{width:auto;padding:8px 10px;box-shadow:inset 0 -.5px 0 var(--sep)}
.bmv-set.is-narrow .bmv-side-app{display:none}
.bmv-set.is-narrow .bmv-side-list{flex-direction:row;flex-wrap:nowrap;overflow-x:auto}
.bmv-set.is-narrow .bmv-side-list::-webkit-scrollbar{display:none}
.bmv-set.is-narrow .bmv-side-list.has-more{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent)}
.bmv-side-flag{display:none;position:absolute;right:6px;top:50%;margin-top:-3.5px}
.bmv-set:not(.is-narrow) .bmv-side-flag{display:none!important}
.bmv-set.is-narrow .bmv-side-item{width:auto;min-height:28px;padding:4px 6px;white-space:nowrap}
.bmv-set.is-narrow .bmv-main{padding:16px 16px 24px}
.bmv-sec{margin-top:24px}
.bmv-pg-title+.bmv-sec,.bmv-pg-lead+.bmv-sec{margin-top:18px}
.bmv-col>.bmv-sec:first-child{margin-top:18px}
.bmv-set.is-compact .bmv-sec:first-child{margin-top:4px}
.bmv-sec-h{display:flex;align-items:center;gap:10px;min-height:22px;padding:0 4px 7px}
.bmv-sec-title{font-size:13px;font-weight:600}
.bmv-sec-aside{display:flex;align-items:center;gap:12px;margin-left:auto;font-size:12px;color:var(--t2)}
.bmv-sec-note{padding:0 4px 8px;font-size:12px;line-height:1.5;color:var(--t2)}
.bmv-sub{padding:12px 4px 6px;font-size:12px;color:var(--t2)}
.bmv-group{border-radius:10px;background:var(--group);box-shadow:inset 0 0 0 .5px var(--line)}
.bmv-row{position:relative;display:flex;flex-wrap:wrap;align-items:center;column-gap:16px;row-gap:8px;min-height:44px;padding:10px 14px}
.bmv-row+.bmv-row::before{content:"";position:absolute;left:14px;right:14px;top:0;height:1px;background:var(--sep);transform:scaleY(.5);transform-origin:top}
.bmv-row-l{flex:1 1 96px;min-width:0}
.bmv-set.is-compact .bmv-row-l{flex-basis:56px}
.bmv-row-label{font-weight:500}
.bmv-row-sub{margin-top:1px;font-size:12px;line-height:1.5;color:var(--t2)}
.bmv-row-c{flex:none;display:flex;align-items:center;gap:8px;margin-left:auto;max-width:100%}
.bmv-row-note{flex:1 1 100%;margin-top:-2px;font-size:12px;line-height:1.5;color:var(--t2)}

.bmv-segc{display:inline-flex;gap:2px;padding:2px;border-radius:8px;background:var(--track)}
.bmv-segc button{height:24px;padding:0 12px;border-radius:6px;font-size:12px;color:var(--t1);white-space:nowrap;transition:background-color .2s,box-shadow .2s}
.bmv-segc button:hover{background:var(--ctl-hover)}
.bmv-segc button:active,.bmv-btn:active,.bmv-link:active,.bmv-x:active{transform:scale(.96)}
.bmv-segc button,.bmv-btn,.bmv-x{transition:background-color .2s,box-shadow .2s,transform .2s var(--ease)}
.bmv-tile .bmv-tile-img{transition:transform .25s var(--ease)}
.bmv-tile:active .bmv-tile-img{transform:scale(.97)}
.bmv-segc button[aria-pressed=true]{background:var(--on);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.14),0 0 0 .5px rgba(0,0,0,.05)}
.bmv-switch{position:relative;flex:none;width:40px;height:24px;border-radius:12px;background:var(--off);transition:background-color .25s var(--ease)}
.bmv-switch::after{content:"";position:absolute;left:2px;top:2px;width:20px;height:20px;border-radius:50%;background:#fff;
  box-shadow:0 1px 3px rgba(0,0,0,.28),0 0 0 .5px rgba(0,0,0,.04);transition:transform .3s var(--ease)}
.bmv-switch[aria-checked=true]{background:var(--accent)}
.bmv-switch[aria-checked=true]::after{transform:translateX(16px)}
.bmv-switch:active::after{transform:scaleX(1.18);transform-origin:left}
.bmv-switch[aria-checked=true]:active::after{transform:translateX(16px) scaleX(1.18);transform-origin:right}
.bmv-stepper{display:inline-flex;align-items:stretch;height:28px;border-radius:7px;background:var(--ctl);box-shadow:inset 0 0 0 .5px var(--line),0 1px 1px rgba(0,0,0,.05);overflow:hidden}
.bmv-stepper button{display:flex;align-items:center;justify-content:center;width:28px;color:var(--t2);transition:background-color .15s,color .15s}
.bmv-stepper button:hover{background:var(--ctl-hover);color:var(--t1)}
.bmv-stepper input{width:64px;border:0;border-left:.5px solid var(--sep);border-right:.5px solid var(--sep);background:transparent;color:var(--t1);
  font:500 13px var(--font);font-variant-numeric:tabular-nums;text-align:center;outline:none;padding:0}
.bmv-stepper input:focus{background:var(--ctl-hover)}
.bmv-unit{font-size:12px;color:var(--t2)}
.bmv-btn{flex:none;height:26px;padding:0 12px;border-radius:7px;background:var(--ctl);color:var(--t1);font-size:13px;white-space:nowrap;
  box-shadow:inset 0 0 0 .5px var(--line),0 1px 1px rgba(0,0,0,.06);transition:background-color .15s}
.bmv-btn:hover{background:var(--ctl-hover)}
.bmv-root .bmv-btn{--ctl:rgba(255,255,255,.16);--ctl-hover:rgba(255,255,255,.24);--line:rgba(255,255,255,.1);--t1:#fff;height:30px;padding:0 16px;border-radius:8px}
.bmv-link{flex:none;font-size:13px;color:var(--accent-text);white-space:nowrap;transition:opacity .15s}
.bmv-link:hover{opacity:.75}
.bmv-meter{width:140px;height:4px;border-radius:2px;background:var(--sep);overflow:hidden}
.bmv-meter i{display:block;height:100%;border-radius:2px;background:var(--accent);transition:width .3s var(--ease)}
.bmv-state{font-size:12px;color:var(--t2);font-variant-numeric:tabular-nums;white-space:nowrap}
.bmv-pack-progress{display:flex;flex-direction:column;align-items:flex-end;gap:6px}
.bmv-pack-progress .bmv-meter{width:160px}
.bmv-state.is-error{color:#ff453a}
.bmv-set[data-theme=light] .bmv-state.is-error{color:#d70015}
.bmv-row-note.is-error{color:#ff453a}
.bmv-set[data-theme=light] .bmv-row-note.is-error{color:#d70015}
/* The running state on 开始使用: a mark for how each thing stands (works, needs attention, not set up, news). */
.bmv-row.is-status{column-gap:12px}
.bmv-mark{flex:none;display:flex;align-items:center;justify-content:center;align-self:flex-start;width:20px;height:20px;margin-top:1px;border-radius:50%;color:#fff}
.bmv-mark.is-ok{background:#30d158}
.bmv-mark.is-warn{background:#ff9f0a}
.bmv-mark.is-off{background:var(--off);color:var(--t1)}
.bmv-mark.is-new{background:var(--accent)}
.bmv-mark.is-none{background:transparent}
.bmv-set[data-theme=light] .bmv-mark.is-ok{background:#28a745}
.bmv-set[data-theme=light] .bmv-mark.is-warn{background:#e07800}
.bmv-row.is-status .bmv-row-sub{overflow-wrap:anywhere}
/* The MV button as it looks above NetEase's play bar (a picture of it, not a control). */
.bmv-mvbtn-sample{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 12px 0 10px;border-radius:14px;background:rgba(28,28,30,.86);color:#fff;
  font-size:12px;font-weight:600;letter-spacing:.02em;line-height:1;box-shadow:inset 0 0 0 .5px rgba(255,255,255,.16),0 4px 12px rgba(0,0,0,.18)}
.bmv-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;width:100%;padding:12px 12px 8px}
.bmv-strip-img{display:block;aspect-ratio:16/9;border-radius:6px;overflow:hidden;background:var(--track);box-shadow:inset 0 0 0 .5px var(--line)}
.bmv-strip-img img{display:block;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .3s,transform .3s var(--ease)}
.bmv-strip:hover .bmv-strip-img img{transform:scale(1.045)}
.bmv-strip-img img.is-ready{opacity:1}
.bmv-strip-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 14px 12px;font-size:12px;color:var(--t2)}
/* The MV page's panel: rows that open a section, its current value and a chevron. */
.bmv-row.is-nav{flex-wrap:nowrap;column-gap:8px;width:100%;color:var(--t1);text-align:left;transition:background-color .15s}
.bmv-row.is-nav:hover{background:rgba(127,127,127,.12)}
.bmv-row.is-nav:first-child{border-radius:10px 10px 0 0}
.bmv-row.is-nav:last-child{border-radius:0 0 10px 10px}
.bmv-row.is-nav .bmv-row-label{flex:1;min-width:0}
.bmv-nav-value{min-width:0;max-width:55%;font-size:12px;color:var(--t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.bmv-nav-chevron{flex:none;display:flex;color:var(--t3)}
.bmv-back{margin-left:-6px}
.bmv-kbds{display:flex;align-items:center;gap:4px}
/* A key that is set by pressing it: its caps, a ring and a prompt while it waits. */
.bmv-keycap{display:inline-flex;align-items:center;gap:4px;min-height:30px;padding:3px 6px;border-radius:8px;color:var(--t2);font-size:12px;
  transition:background-color .2s,box-shadow .2s,transform .2s var(--ease)}
.bmv-keycap:hover{background:var(--ctl-hover)}
.bmv-keycap:active{transform:scale(.97)}
.bmv-keycap.is-recording{padding:3px 10px;color:var(--accent-text);box-shadow:inset 0 0 0 1.5px var(--accent);background:transparent}
.bmv-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:22px;padding:0 6px;border-radius:5px;background:var(--ctl);
  box-shadow:inset 0 0 0 .5px var(--line),0 1px 0 var(--sep);font-size:11px;font-weight:500;color:var(--t1);font-variant-numeric:tabular-nums}

/* Scenes and looks: their sketches, a check in the corner when on. */
.bmv-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:14px 12px;padding:14px}
.bmv-set.is-compact .bmv-tiles{grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:12px 10px;padding:12px}
.bmv-tile{display:block;min-width:0;border-radius:8px}
.bmv-tile-img{position:relative;display:block;padding-top:56.25%;border-radius:7px;overflow:hidden;background:var(--sep);box-shadow:inset 0 0 0 .5px var(--line)}
.bmv-tile-img img{position:absolute;inset:0;display:none;width:100%;height:100%;object-fit:cover;transition:opacity .3s,filter .3s,transform .45s var(--ease)}
.bmv-tile-img img.is-ready{display:block;animation:bmv-in .3s var(--ease)}
@keyframes bmv-in{from{opacity:0}}
.bmv-tile:hover .bmv-tile-img img{transform:scale(1.045)}
.bmv-tile[aria-pressed=false] .bmv-tile-img img.is-ready{opacity:.38;filter:grayscale(.7)}
.bmv-check{position:absolute;right:6px;top:6px;display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;color:#fff;
  background:var(--accent);box-shadow:0 1px 3px rgba(0,0,0,.3);transition:background-color .2s,box-shadow .2s}
.bmv-tile[aria-pressed=false] .bmv-check{background:rgba(0,0,0,.22);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.9),0 1px 3px rgba(0,0,0,.25)}
.bmv-tile[aria-pressed=false] .bmv-check svg{opacity:0}
.bmv-tile-name{display:block;margin-top:6px;padding:0 2px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:color .2s}
.bmv-tile[aria-pressed=false] .bmv-tile-name{color:var(--t3)}
.bmv-btn.is-primary{background:var(--accent);color:#fff;font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.15)}
.bmv-btn.is-primary:hover{background:var(--accent);filter:brightness(1.08)}
/* Changes to scenes and looks wait here until applied; it stays at the bottom of the view while it scrolls. */
.bmv-apply{position:sticky;bottom:12px;z-index:1;display:none;align-items:center;gap:8px;width:max-content;max-width:100%;margin:20px auto 0;
  padding:8px 8px 8px 16px;border-radius:12px;background:var(--apply);box-shadow:inset 0 0 0 .5px var(--line),0 10px 30px rgba(0,0,0,.22)}
.bmv-apply.is-on{display:flex;animation:bmv-rise .3s var(--ease)}
.bmv-apply.is-done .bmv-btn{display:none}
.bmv-apply.is-done .bmv-apply-text{margin-right:8px;color:var(--accent-text);font-weight:600}
.bmv-apply-text{margin-right:8px;font-size:13px;color:var(--t1);font-variant-numeric:tabular-nums;white-space:nowrap}
@keyframes bmv-rise{from{opacity:0;transform:translateY(8px)}}
.bmv-warn{color:#ff453a}
.bmv-set[data-theme=light] .bmv-warn{color:#d70015}

/* The sketch card over a scene the pointer rests on. */
.bmv-card{position:fixed;left:0;top:0;z-index:2147483647;width:320px;border-radius:12px;overflow:hidden;color:#f5f5f7;
  background:rgba(34,34,37,.97);
  box-shadow:inset 0 0 0 .5px rgba(255,255,255,.13),0 18px 48px rgba(0,0,0,.45);pointer-events:none;
  opacity:0;transform:translateY(4px) scale(.98);transition:opacity .16s var(--ease),transform .3s var(--ease)}
.bmv-card.is-on{opacity:1;transform:none}
.bmv-card-frame{position:relative;height:180px;background:#0b0b0e}
.bmv-card-frame img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;visibility:hidden}
.bmv-card-blank{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;color:rgba(235,235,245,.5)}
.bmv-card-body{padding:11px 14px 13px}
.bmv-card-title{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600}
.bmv-card-badge{padding:1px 7px;border-radius:5px;background:rgba(255,255,255,.14);font-size:11px;font-weight:500;color:rgba(235,235,245,.8)}
.bmv-card-note{margin-top:4px;font-size:12px;line-height:1.55;color:rgba(235,235,245,.78)}
.bmv-card-foot{margin-top:7px;font-size:11px;color:rgba(235,235,245,.5)}

/* The update window (src/plugin/updatePrompt.ts): a card at the top right of the MV page, moving over with the
   controls when a sheet opens; a dialog over the settings page, in its theme. The icon on the left, the rest in one
   column beside it; the page to update by hand along the bottom. */
.bmv-upd-slot.is-mv{position:absolute;top:52px;right:10px;width:340px;max-width:calc(100% - 20px);transition:transform .45s var(--ease);
  --t1:#fff;--t2:rgba(235,235,245,.68);--t3:rgba(235,235,245,.4);--ctl:rgba(255,255,255,.14);--ctl-hover:rgba(255,255,255,.22);--line:rgba(255,255,255,.1);
  --sep:rgba(255,255,255,.12);--track:rgba(255,255,255,.16)}
.bmv-root.has-sheet .bmv-upd-slot.is-mv{transform:translateX(-400px)}
.bmv-set.is-page{position:relative}
.bmv-upd-scrim{position:absolute;inset:0;z-index:3;background:rgba(0,0,0,.14)}
.bmv-set[data-theme=dark] .bmv-upd-scrim{background:rgba(0,0,0,.36)}
.bmv-upd-slot.is-dialog{position:absolute;left:50%;top:72px;z-index:4;width:380px;max-width:calc(100% - 32px);transform:translateX(-50%)}
.bmv-upd{padding:14px 14px 0;border-radius:14px;color:var(--t1);font-size:13px;line-height:1.45;text-align:left}
.bmv-upd.no-foot{padding-bottom:14px}
.bmv-upd-slot.is-mv .bmv-upd{background:rgba(28,28,31,.74);-webkit-backdrop-filter:blur(30px) saturate(180%);backdrop-filter:blur(30px) saturate(180%);
  box-shadow:inset 0 0 0 .5px rgba(255,255,255,.14),0 18px 50px rgba(0,0,0,.45)}
.bmv-upd-slot.is-dialog .bmv-upd{background:#fff;box-shadow:0 0 0 .5px rgba(0,0,0,.1),0 24px 64px rgba(0,0,0,.24)}
.bmv-set[data-theme=dark] .bmv-upd-slot.is-dialog .bmv-upd{background:#2c2c2e;box-shadow:inset 0 0 0 .5px rgba(255,255,255,.12),0 24px 64px rgba(0,0,0,.5)}
.bmv-upd-head{display:flex;align-items:flex-start;gap:12px}
.bmv-upd-icon{flex:none;width:40px;height:40px;border-radius:9px;box-shadow:0 1px 3px rgba(0,0,0,.2),0 0 0 .5px rgba(0,0,0,.08)}
.bmv-upd-titles{flex:1;min-width:0;padding-top:1px}
.bmv-upd-title{font:600 14px/1.35 var(--display)}
.bmv-upd-sub{margin-top:1px;font-size:12px;color:var(--t2);overflow-wrap:anywhere}
.bmv-upd-sub.is-error{color:#ff453a}
.bmv-set[data-theme=light] .bmv-upd-sub.is-error{color:#d70015}
.bmv-upd-x{flex:none;display:flex;align-items:center;justify-content:center;width:22px;height:22px;margin:-1px -2px 0 0;border-radius:50%;background:var(--track);color:var(--t2);
  transition:background-color .15s,color .15s,transform .2s var(--ease)}
.bmv-upd-x:hover{background:var(--ctl-hover);color:var(--t1)}
.bmv-upd-x:active{transform:scale(.9)}
.bmv-upd-main{padding-left:52px}
.bmv-upd-body{min-height:34px;margin-top:10px}
.bmv-upd-text{font-size:12px;line-height:1.5;color:var(--t2);overflow-wrap:anywhere}
/* The line of progress moves by transform (eased both ways: each step of the download glides, none jumps). */
.bmv-upd-bar{position:relative;height:4px;margin-top:5px;border-radius:2px;background:var(--track);overflow:hidden}
.bmv-upd-bar>i{position:absolute;inset:0;border-radius:2px;background:var(--accent);transform:translateX(-100%);transition:transform .45s cubic-bezier(.25,.1,.25,1)}
.bmv-upd-step{display:flex;justify-content:space-between;gap:12px;margin-top:7px;font-size:12px;color:var(--t2);font-variant-numeric:tabular-nums}
.bmv-upd-step b{font-weight:400}
.bmv-upd-actions{display:flex;align-items:center;gap:8px;margin-top:12px}
.bmv-upd-aside{flex:1;min-width:0;display:flex}
.bmv-upd-btns{flex:none;display:flex;gap:8px}
.bmv-upd .bmv-btn{height:28px;padding:0 14px;border-radius:7px;font-size:13px}
.bmv-upd-quiet{font-size:12px;color:var(--t2);white-space:nowrap;transition:color .15s}
.bmv-upd-quiet:hover{color:var(--t1)}
.bmv-upd-foot{display:flex;align-items:center;gap:2px;width:calc(100% + 28px);margin:14px -14px 0;padding:10px 14px 11px 66px;border-radius:0 0 14px 14px;
  box-shadow:inset 0 .5px 0 var(--sep);font-size:12px;color:var(--accent-text);text-align:left;transition:background-color .15s}
.bmv-upd-foot:hover{background:rgba(127,127,127,.1)}

@media (prefers-reduced-motion:reduce){
  .bmv-bd,.bmv-eq i{animation:none}
  .bmv-ui *{transition-duration:.01ms!important}
}
`;

/** Put the stylesheet in the page (once). */
export function ensureStyles(): void {
  if (document.getElementById('bmv-style')) return;
  const s = document.createElement('style');
  s.id = 'bmv-style';
  s.textContent = CSS;
  (document.head || document.documentElement).appendChild(s);
}
