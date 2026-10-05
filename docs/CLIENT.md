# 网易云 3.x 给插件的接口（实测）

2026-09-30 用 `probe/` 探针插件在网易云 3.1.37.205354 + BetterNCM 1.3.x 里实测。探针原始报告存在本地 `dev/probe-report.json`（不入库）。

## 环境

- 内核：Chrome 91.0.4472（`NeteaseMusicDesktop/3.1.37`），页面 `orpheus://orpheus/pub/app.html`。
- WebGL2 可用（实测机器：RTX 5070 Ti Laptop，ANGLE D3D11），OffscreenCanvas、AudioWorklet、OfflineAudioContext 都有。
- **blob Worker 被安全策略禁止**（`Access to the script at 'blob:orpheus://…' is denied by the document's Content Security Policy`）→ 重活在主线程分片做。
- 插件代码可用 `betterncm.fs`（读写文件）、`betterncm.app`（数据目录、执行程序）；`betterncm.ncm.getPlaying()` 在 3.x 上会报错，不要用。

## 拿到客户端内部模块

照 BetterDownload 和 InfLink-rs 的做法：往 `window.webpackJsonp` 推一个假 chunk 拿到 webpack 的 `require`，在 `require.c` 里找：

- `Bridge`：有 `appendRegisterCall / removeRegisterCall / call / registerCallOnce …` 的对象。
- `AudioPlayer`：有 `subscribePlayStatus / setAudioDataEnableState / subscribeAudioData / getPlayedTime …` 的对象。
- Redux store：导出里 `a.getStore` 为函数、`a.inited` 为真的模块，`a.app._store`。

## 播放状态

- 进度：`Bridge.appendRegisterCall('PlayProgress', 'audioplayer', (playId, seconds, 1) => …)`，约每 31 ms 一次（p95 59 ms），时间精度 0.01 s → 渲染时要按墙钟外推并平滑。
- 播放状态：`'PlayState'`，参数 `(playId, "id|resume|…", 1)`，第三个参数 1 = 播放，其他 = 暂停/停止。另有 `'Seek'`、`'End'`。暂停时 PlayProgress 就不再来；插件在收到 PlayState（或自己按暂停）的那一刻就把画面定住，不等进度事件断掉（原来要等 0.35 s，还会退回到最后一次上报的时间）。万一 PlayState 没来，连续约 0.6 s 进度在走就当作在播。
- store 里的 `playing.playingState`（2 = 播放）比 PlayState 事件来得早：任何地方暂停（网易云自己的按钮、媒体键、托盘）它都马上变，插件订阅 store、据此定格。两次 PlayProgress 之间时钟最多外推 0.12 s。
- 音量：`playing.playingVolume`（0–1）是网易云自己的音量；改音量 dispatch `{ type: 'playing/setVolume', payload: { volume } }`，网易云自己的音量条跟着变（InfLink-rs 也这么做）。

## 播放控制（2026-10-05 读 3.1.37 的客户端代码）

客户端代码在安装目录的 `package/orpheus.ntpk`（zip，开头多 100 字节，`unzip` 照样能解），主要在 `pub/hybrid/app.chunk.*.js`，`async:hostResource` 模型在另一个 chunk。

- 播放模式：`playing.playingMode`，`playOrder`（顺序）、`playCycle`（列表循环）、`playOneCycle`（单曲循环）、`playRandom`（随机）、`playAi`（心动模式）、`playFm`（私人 FM）。切换 dispatch `{ type: 'playing/switchPlayingMode', payload: { playingMode, triggerScene: 'sysTray' } }`（托盘菜单和 InfLink-rs 的做法）。MV 页的按钮只在前四种之间循环，心动模式和私人 FM 从网易云自己的页面进入。
- 喜欢：是否已喜欢看 `state['async:hostResource'].likeTracksMap[playing.onlineResourceId]`（客户端自己更新迷你播放器红心时就这么查）；未登录时 `state.host.uid` 为空，MV 页不显示红心。切换 dispatch `{ type: 'async:hostResource/setLikeCurPlayingTrack', payload: {} }`，取反当前状态。不要传 `from: 'hotKey'`：那是全局快捷键的路径，成功后会弹系统托盘气泡。
- 播放列表：列表存放方式是常量 `"file"`，即在 store 的 `playingList.curPlayingList`（另一套 IndexedDB 的实现没启用）。每项 `{ id, resourceId, resourceType, track: { id, name, artists: [{ name }], album: { name, picUrl }, duration（毫秒） } }`。当前项是 `playing.curPlaying`（同样有 `resourceId`）。
- 播放列表里的某一首：dispatch `{ type: 'playing/playOneTrackInPlayingList', payload: { item, flag: 0, switchType: 'call', triggerScene: 'playingList' } }`，`item` 传列表里的那一项本身（传字符串时客户端按 `resourceId` 严格相等去找）。迷你播放器点列表就是这样。
- 快捷键：网易云的应用内快捷键默认 Ctrl+P 播放 / 暂停、Ctrl+← → 上一首 / 下一首（全局快捷键再加 Alt）。MV 页在 window 上捕获按键，带 Ctrl / Alt 的一律放行，不然 Ctrl+→ 会被当成快进。

## 窗口

- 网易云的窗口没有系统标题栏，拖动是页面自己做的：标题栏上按下鼠标、移动超过 5 像素就调 `Bridge.call('winhelper.dragWindow')`，交给系统拖动；双击 dispatch `{type: 'app/maximizeWindow'}` 或 `'app/restoreWindow'`（看 `store.getState().app.isMaxWindow`）。MV 页盖住了标题栏，所以顶部 56 像素照做一遍。
- 标题栏的按钮：最小化 dispatch `{type: 'app/minimizeWindow'}`，最大化 / 向下还原同上。关闭会先弹“最小化到托盘 / 退出”的对话框（之后 `app/hide` 或 `app/exitApp`，记在 `setting.closeFrameType`），对话框会被 MV 页盖住，所以 MV 页不做关闭窗口，右上角的 ✕ 是退出 MV。
- 改窗口大小也是页面自己做的（3.1.37 的 `orpheus.ntpk` 里的 `ResizeHandler`）：只有四个角（8×8 像素）和右边缘（5 像素宽，上下各让开 8 像素），按下鼠标调 `Bridge.call('winhelper.sizeWindow', 'topleft' | 'topright' | 'bottomleft' | 'bottomright' | 'right')`，交给系统拖边框。MV 页盖住了它们，所以在同样的位置、同样的尺寸照做一遍，放在设置面板之上；窗口最大化时去掉。
- MV 页的鼠标事件在自己的根节点上 `stopPropagation`，不让网易云和其他插件挂在 document/window 上的监听收到（例如 RefinedNowPlaying 在 document 上捕获 pointerup/mouseup/click）；进度条拖动用 pointer capture，不挂 window 监听。层级用最大 z-index，并在打开时移到 body 最后。
- 当前歌曲：`store.getState().playing`：`resourceTrackId`、`resourceName`、`resourceArtists[].name`、`resourceCoverUrl`、`curTrack.album`、`curTrack.duration`（毫秒）、`trackFileType`（本地歌为 `local`，此时用 `onlineResourceId`）。

## 整首歌的音频（分析用）

- 客户端把正在播的歌完整缓存在 `%LOCALAPPDATA%\NetEase\CloudMusic\Cache\Cache\<歌曲ID>-<音质码>-<md5>.uc`，内容异或 0xA3 即原文件（实测是 FLAC）。`.idx` 是 JSON：`{"size":…, "zone":["0 size-1"]}`，zone 覆盖全长才算下载完。
- 实测《Clarity》：读 24 MB 用 281 ms、异或 17 ms、`OfflineAudioContext(1,1,22050).decodeAudioData` 440 ms。
- 备选：带 cookie 请求 `https://music.163.com/api/song/enhance/player/url/v1?ids=[id]&level=standard&encodeType=mp3` 能拿到完整 128k 地址（不带 cookie 返回 404）。

## 实时音频

- `AudioPlayer.setAudioDataEnableState(true)` 后，`Bridge.appendRegisterCall('AudioData', 'audioplayer', ({data, pts}) => …)` 收到 Int16 立体声交错 PCM（每包约 12.8 KB，约 15 包/秒），`pts` 为毫秒播放位置（比 PlayProgress 超前约 0.15–0.2 s）。
- 用 `appendRegisterCall` 不会顶掉客户端和其他插件（如 InfLink-rs）的订阅；探针结束时如果是自己打开的就再关掉。

## 歌词与歌曲信息（不用登录）

- 歌词：`/api/song/lyric/v1?tv=0&lv=0&rv=0&kv=0&yv=0&ytv=0&yrv=0&cp=false&id=` → `lrc`、`tlyric`（翻译）、`yrc`（逐字，有的歌没有）。
- 音乐百科：`/api/song/play/about/block/page?songId=` → 曲风、推荐标签、语种、BPM（`src/meta/wiki.ts`）。
- 域名用 `window.APP_CONF.domain`（`https://music.163.com`）。
