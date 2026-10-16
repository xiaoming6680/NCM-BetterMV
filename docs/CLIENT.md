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

- 客户端把正在播的歌完整缓存在「缓存目录」下的 `Cache\<歌曲ID>-<音质码>-<md5>.uc`，内容异或 0xA3 即原文件（实测是 FLAC）。`.idx` 是 JSON：`{"size":…, "zone":["0 size-1"]}`，zone 覆盖全长才算下载完。
- 缓存目录是「设置 → 下载设置 → 缓存目录」，默认 `%LOCALAPPDATA%\NetEase\CloudMusic\Cache`，所以歌默认在 `…\Cache\Cache`。客户端启动时用它调 `storage.init`，得到的路径就是 SDK 的 `Storage.cacheDir`；redux 的 `setting.cacheDir` 也是它。插件按这个顺序找，不写死路径（`src/plugin/source.ts`）。
- 这项设置存在 `%LOCALAPPDATA%\NetEase\CloudMusic\webapp91x64\Local Storage\leveldb`，源 `orpheus://orpheus`，键 `setting`。值经原生 `EncryptData.encode` 加密（base64 套 base64 套 AES 密文），客户端外面读不了。插件找到缓存目录后，会把它记进 `<BetterNCM 数据目录>\BetterMV\ncm-cache.json`（`{"songs": "…\\Cache"}`）。开发工具（`vite.config.ts`、`tools/aligner/eval.py`，共用 `tools/ncm-cache.ts` / `tools/aligner/ncm_cache.py`）按这个顺序找：环境变量 `BMV_NCM_CACHE` → 这份记录 → 默认目录。BetterNCM 数据目录不在 `C:\betterncm` 时，设 `BETTERNCM_PROFILE`。
- 改缓存目录（3.1.37，`orpheus.ntpk` 的 `59.chunk`）：弹窗提示「更改缓存目录将清空缓存并重启云音乐」，点确认后执行 `setting.update({cacheDir: 新, oldCacheDir: 旧})`，紧接着 `App.exitApp(restart)`。旧缓存不会搬过去，会被直接清空。2026-10-17 实测，点确认后十几秒内（启动是 00:04:29，旧 `Cache\Cache` 在 00:04:42 被清空），没等到重启就清完了，回收站里也没有。前端代码在这一步没有调 clearCache，所以应该是原生的 `exitApp(restart)` 清的。下次启动时，如果 `oldCacheDir` 非空，还会再对旧目录调一次 `Storage.clearCache({path})`，然后把 `oldCacheDir` 清空。想保留旧缓存，必须在点确认之前先把它复制出去。BetterNCM 环境下两次都没有自动重启：第一次的写入没进 leveldb，客户端照旧用旧目录；第二次写进去了。这个值的加密是按块确定性的，能比出改了哪一段，但解不出内容。
- 实测《Clarity》：读 24 MB 用 281 ms、异或 17 ms、`OfflineAudioContext(1,1,22050).decodeAudioData` 440 ms。
- 备选：带 cookie 请求 `https://music.163.com/api/song/enhance/player/url/v1?ids=[id]&level=standard&encodeType=mp3` 能拿到完整 128k 地址（不带 cookie 返回 404）。

## 实时音频

- `AudioPlayer.setAudioDataEnableState(true)` 后，`Bridge.appendRegisterCall('AudioData', 'audioplayer', ({data, pts}) => …)` 收到 Int16 立体声交错 PCM（每包约 12.8 KB，约 15 包/秒），`pts` 为毫秒播放位置（比 PlayProgress 超前约 0.15–0.2 s）。
- 用 `appendRegisterCall` 不会顶掉客户端和其他插件（如 InfLink-rs）的订阅；探针结束时如果是自己打开的就再关掉。

## 歌词与歌曲信息（不用登录）

- 歌词：`/api/song/lyric/v1?tv=0&lv=0&rv=0&kv=0&yv=0&ytv=0&yrv=0&cp=false&id=` → `lrc`、`tlyric`（翻译）、`yrc`（逐字，有的歌没有）。
- 音乐百科：`/api/song/play/about/block/page?songId=` → 曲风、推荐标签、语种、BPM（`src/meta/wiki.ts`）。
- 域名用 `window.APP_CONF.domain`（`https://music.163.com`）。

## BetterNCM 的文件接口

2026-10-17 从网易云目录的 `msimg32.dll`（BetterNCM 1.3.4 的加载器，前端框架的 JS 内嵌在里面）和 BetterNCM 源码（GitHub `std-microblock/chromatic`，分支 `3.0.0-adaption` 的 `src/App.cpp`、`src/PluginManager.cpp`）确认。

- `betterncm.fs.*` 都是向本机 `http://localhost:<随机端口>/api/fs/…` 发请求（带 API Key）。`readDir`、`exists` 对响应调 `.json()`，`readFileText` 是 `.text()`，`readFile` 是 `.blob()`。
- 原生端列目录用 `fs::directory_iterator`，出错就抛异常，httplib 回 500、响应体为空，前端报 `SyntaxError: Unexpected end of JSON input`（实测读不存在的文件夹就是这个报错）。issue #1 的“无法生成 MV：Unexpected end of JSON input”就是缓存目录列不出来，0.9.1 及以前没接住，在线获取也没机会试。现在列目录失败会改走在线获取，两边都不行时报“无法读取网易云的缓存目录（路径），也无法在线获取这首歌曲”。
- 路径第二个字符不是 `:` 时按 BetterNCM 数据目录的相对路径处理，所以 `\NAS\…` 这类网络路径会被拼错。`readFileText` 读不存在的文件返回空字符串，不报错。
- 数据目录 `/local` 和 `mount_dir` 挂出来的目录不需要 API Key，但端口每次启动都变。

## 插件包的解压与更新（2026-10-17 读 BetterNCM 源码并实测）

- 每次网易云启动，BetterNCM 先清空 `plugins_runtime`（原生插件的 dll 占用时保留），再按文件名顺序把 `plugins\*.plugin` 逐个解压到 `plugins_runtime\tmp`，读 manifest，写 `.plugin.path.meta`（包相对数据目录的路径，如 `/plugins\BetterMV-0.9.1.plugin`），改名为 `plugins_runtime\<slug>`；同 slug 已存在就先删掉。所以同 slug 的多个包，只有文件名排在最后的生效：`BetterMV-0.10.0.plugin` 排在 `BetterMV-0.9.3.plugin` 前面，旧版会覆盖新版。
- 前端先加载 `plugins_runtime`，再加载 `plugins_dev`，同 slug 先到先得：`plugins` 里有 BetterMV 的包时，开发目录里的不会加载。开发插件没有 `.plugin.path.meta`。
- BetterNCM 自带的“删除插件”：读 `.plugin.path.meta`、删掉那个包，manifest 有 `require_restart`（BetterMV 有）就调 `betterncm_native.app.restart()` 重启网易云（不会带上原来的命令行参数）。
- 插件管理器在启动时就为每个插件调 `_getConfigElement()` 生成设置页并一直缓存，所以设置页在没打开时就已建好，状态变化要一直跟着更新，不能在页面没挂上时退订。
- 页面里调 `betterncm.app.reloadPlugins()`（`/app/reload_plugin`，重新解压）在网易云运行中不可靠：实测 `plugins_runtime` 没有重新解压（应是插件文件正被占用，原因未细查）；随后的 `betterncm.reload()` 把加载遮罩调成不透明后页面没有重载，界面被盖住，只能重启网易云。所以 BetterMV 的更新只走重启。
- BetterMV 的做法（`src/plugin/update.ts`）：启动 8 秒后读 `plugins` 里每个 `.plugin` 的 manifest（不看文件名），slug 为 `ncm-better-mv` 且比自己旧或同版本的删掉；比自己新的保留、删掉自己的包，设置里提示重启。每天（或刚换了版本时）查一次 `api.github.com/repos/xiaoming6680/NCM-BetterMV/releases`（带 `Access-Control-Allow-Origin: *`，未登录每小时 60 次），有新版本时齿轮上出现红点；点“更新”下载 `BetterMV-版本号.plugin` 到 `plugins`，核对大小和 manifest，删掉旧包，“重启网易云”后生效。开发安装只打开发布页。
- 实测（网易云 3.1.37 + BetterNCM 1.3.4）：0.9.0 和新版 0.9.1 同放，新版删掉 0.9.0；0.10.0 和 0.9.1 同放，按文件名 0.9.1 生效，它删掉自己的包并提示“已安装 0.10.0，重启网易云后生效”；用 0.9.0 版本号的新代码，自动查到 0.9.1，点“更新” 1.5 秒下载完、替换旧包，点“重启网易云”后运行的是 0.9.1。客户端里从 GitHub 下载发布附件没有跨域问题。
- 测试方法：网易云带 `--remote-debugging-port=9222` 启动后，可用 CDP（`http://127.0.0.1:9222/json` 找 `orpheus://orpheus/pub/app.html`，`Runtime.evaluate`）在页面里直接执行代码；`window.__betterMv` 有 `open()`、`close()`、`player`。
