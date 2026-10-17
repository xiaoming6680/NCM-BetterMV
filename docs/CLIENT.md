# 网易云 3.x 与 BetterNCM 的接口

网易云 3.1.37.205354 + BetterNCM 1.3.4 上实测。接口最初由 `probe/` 探针插件摸出（`scripts/install-probe.ps1` 安装，报告写到本地 `dev/probe-report.json`，不入库），播放控制部分读的是客户端代码。

## 环境

- 内核 Chrome 91.0.4472（UA `NeteaseMusicDesktop/3.1.37`），页面 `orpheus://orpheus/pub/app.html`。不能用 Chrome 91 之后的接口（`Array.prototype.at`、`findLast`、`Object.hasOwn`、`structuredClone`、静态类块等）。
- 有 WebGL2（ANGLE D3D11）、OffscreenCanvas、AudioWorklet、OfflineAudioContext；没有 WebGPU。
- **blob Worker 被 CSP 禁止**，重计算只能在主线程分片做。
- 插件可用 `betterncm.fs`（文件）、`betterncm.app`（数据目录、执行程序）。`betterncm.ncm.getPlaying()` 在 3.x 上报错，不要用。
- 客户端代码在安装目录的 `package/orpheus.ntpk`（zip，开头多 100 字节，`unzip` 能直接解），主体在 `pub/hybrid/app.chunk.*.js`，`async:hostResource` 模型在另一个 chunk。

## 拿到客户端内部模块

往 `window.webpackJsonp` 推一个假 chunk 拿到 webpack 的 `require`，在 `require.c` 里按形状找（BetterDownload、InfLink-rs 也这么做）：

- `Bridge`：有 `appendRegisterCall`、`removeRegisterCall`、`call`、`registerCallOnce` 的对象。
- `AudioPlayer`：有 `subscribePlayStatus`、`setAudioDataEnableState`、`subscribeAudioData`、`getPlayedTime` 的对象。
- Redux store：导出里 `a.getStore` 是函数、`a.inited` 为真的模块的 `a.app._store`。

## 播放状态

- 进度：`Bridge.appendRegisterCall('PlayProgress', 'audioplayer', (playId, seconds, 1) => …)`，约每 31 ms 一次（p95 59 ms），精度 0.01 s。渲染时钟按墙钟外推并平滑（`src/plugin/clock.ts`）。
- 播放状态：`'PlayState'`，参数 `(playId, "id|resume|…", 1)`，第三个参数 1 是播放。另有 `'Seek'`、`'End'`。暂停后 PlayProgress 停发。
- store 的 `playing.playingState`（2 = 播放）比 PlayState 早到，任何入口的暂停（播放栏、媒体键、托盘）都会立刻改它。插件订阅 store 据此定格；两次 PlayProgress 之间最多外推 0.12 s；PlayState 缺失时，进度连续走约 0.6 s 视为在播。
- 当前歌曲：`store.getState().playing` 的 `resourceTrackId`、`resourceName`、`resourceArtists[].name`、`resourceCoverUrl`、`curTrack.album`、`curTrack.duration`（毫秒）、`trackFileType`（本地歌为 `local`，此时用 `onlineResourceId`）。
- 音量：`playing.playingVolume`（0–1）。设置用 dispatch `{ type: 'playing/setVolume', payload: { volume } }`，网易云自己的音量条同步。

## 播放控制

- 播放模式 `playing.playingMode`：`playOrder`、`playCycle`、`playOneCycle`、`playRandom`、`playAi`（心动模式）、`playFm`（私人 FM）。切换 dispatch `{ type: 'playing/switchPlayingMode', payload: { playingMode, triggerScene: 'sysTray' } }`。MV 页只在前四种之间循环。
- 喜欢：是否已喜欢看 `state['async:hostResource'].likeTracksMap[playing.onlineResourceId]`；未登录时 `state.host.uid` 为空，不显示红心。切换 dispatch `{ type: 'async:hostResource/setLikeCurPlayingTrack', payload: {} }`（取反）。不要带 `from: 'hotKey'`，那条路径成功后会弹托盘气泡。
- 播放列表在 `playingList.curPlayingList`（存放方式常量为 `"file"`，IndexedDB 那套未启用）。每项 `{ id, resourceId, resourceType, track: { id, name, artists: [{ name }], album: { name, picUrl }, duration } }`，当前项 `playing.curPlaying`。
- 播放列表中的某一首：dispatch `{ type: 'playing/playOneTrackInPlayingList', payload: { item, flag: 0, switchType: 'call', triggerScene: 'playingList' } }`，`item` 传列表项本身（传字符串时按 `resourceId` 严格相等查找）。
- 快捷键：应用内默认 Ctrl+P 播放 / 暂停、Ctrl+← → 切歌（全局快捷键再加 Alt）。MV 页在 window 上捕获按键，带 Ctrl / Alt 的一律放行。

## 窗口

- 网易云没有系统标题栏，拖动由页面实现：标题栏上按下并移动超过 5 px 时调 `Bridge.call('winhelper.dragWindow')`；双击 dispatch `{type: 'app/maximizeWindow'}` 或 `'app/restoreWindow'`（看 `app.isMaxWindow`）。MV 页盖住了标题栏，顶部 56 px 照做一遍。
- 最小化 dispatch `{type: 'app/minimizeWindow'}`。关闭会弹“最小化到托盘 / 退出”对话框（随后 `app/hide` 或 `app/exitApp`，选择记在 `setting.closeFrameType`），对话框会被 MV 页盖住，所以 MV 页不提供关闭窗口，右上角 ✕ 只退出 MV。
- 调整大小也由页面实现（`orpheus.ntpk` 的 `ResizeHandler`）：只有四个角（8×8 px）和右边缘（5 px 宽，上下各让 8 px），按下时调 `Bridge.call('winhelper.sizeWindow', 'topleft' | 'topright' | 'bottomleft' | 'bottomright' | 'right')`。MV 页在同样位置放同样的热区，层级高于设置面板，最大化时移除。
- MV 页在根节点上 `stopPropagation` 鼠标事件，避免网易云和其他插件挂在 document / window 上的监听收到（如 RefinedNowPlaying 在 document 上捕获 pointerup / mouseup / click）。进度条拖动用 pointer capture。根节点用最大 z-index，打开时移到 body 末尾。

## 整首歌的音频

- 客户端把正在播放的歌完整缓存为 `<缓存目录>\Cache\<歌曲ID>-<音质码>-<md5>.uc`，内容逐字节异或 0xA3 即原文件（实测 FLAC）。旁边的 `.idx` 是 JSON `{"size":…, "zone":["0 size-1"]}`，zone 覆盖全长才算下载完。
- 缓存目录即“设置 → 下载设置 → 缓存目录”，默认 `%LOCALAPPDATA%\NetEase\CloudMusic\Cache`，歌在 `…\Cache\Cache`。客户端启动时用它调 `storage.init`，SDK 的 `Storage.cacheDir` 和 redux 的 `setting.cacheDir` 都是它。插件按这个顺序查找（`src/plugin/source.ts`），不写死路径。
- 这项设置存在 `%LOCALAPPDATA%\NetEase\CloudMusic\webapp91x64\Local Storage\leveldb`（源 `orpheus://orpheus`，键 `setting`），经原生 `EncryptData.encode` 加密，客户端外读不了。所以插件找到缓存目录后写一份 `<BetterNCM 数据目录>\BetterMV\ncm-cache.json`（`{"songs": "…\\Cache"}`）。开发工具（`vite.config.ts`、`tools/aligner/eval.py`，共用 `tools/ncm-cache.ts` / `tools/aligner/ncm_cache.py`）按顺序找：环境变量 `BMV_NCM_CACHE` → 这份记录 → 默认目录。数据目录不在 `C:\betterncm` 时设 `BETTERNCM_PROFILE`。
- 修改缓存目录会清空旧缓存：确认后客户端执行 `setting.update({cacheDir: 新, oldCacheDir: 旧})` 并 `App.exitApp(restart)`，旧目录在十几秒内被原生代码清空，不进回收站；下次启动若 `oldCacheDir` 非空，再对旧目录调一次 `Storage.clearCache({path})`。要保留旧缓存必须事先复制。BetterNCM 环境下不会自动重启，且第一次写入可能没进 leveldb。
- 耗时（《Clarity》24 MB）：读 281 ms，异或 17 ms，`OfflineAudioContext(1,1,22050).decodeAudioData` 440 ms。
- 备用来源：带 cookie 请求 `https://music.163.com/api/song/enhance/player/url/v1?ids=[id]&level=standard&encodeType=mp3` 得到完整 128k 地址（不带 cookie 返回 404）。

## 实时音频

- `AudioPlayer.setAudioDataEnableState(true)` 后，`Bridge.appendRegisterCall('AudioData', 'audioplayer', ({data, pts}) => …)` 收到 Int16 立体声交错 PCM（每包约 12.8 KB，约 15 包/秒）；`pts` 是毫秒播放位置，比 PlayProgress 超前约 0.15–0.2 s。
- `appendRegisterCall` 不会顶掉客户端和其他插件（如 InfLink-rs）的订阅。自己打开的数据流，用完要关掉。

## 歌词与歌曲信息

不需要登录。域名取 `window.APP_CONF.domain`（`https://music.163.com`）。

- 歌词：`/api/song/lyric/v1?tv=0&lv=0&rv=0&kv=0&yv=0&ytv=0&yrv=0&cp=false&id=` → `lrc`、`tlyric`（翻译）、`yrc`（逐字，部分歌有）。
- 音乐百科：`/api/song/play/about/block/page?songId=` → 曲风、推荐标签、语种、BPM（`src/meta/wiki.ts`）。
- 副歌标记：`/api/song/chorus`（见 [ANALYSIS.md](ANALYSIS.md)）。

## BetterNCM 的文件接口

来源：网易云目录下的 `msimg32.dll`（BetterNCM 1.3.4 的加载器，内嵌前端框架 JS）和 BetterNCM 源码（GitHub `std-microblock/chromatic`，分支 `3.0.0-adaption`，`src/App.cpp`、`src/PluginManager.cpp`）。

- `betterncm.fs.*` 都是向 `http://localhost:<随机端口>/api/fs/…` 发请求（带 API Key）。`readDir`、`exists` 对响应调 `.json()`，`readFileText` 调 `.text()`，`readFile` 调 `.blob()`。
- 原生端列目录出错时抛异常，httplib 回 500 空响应，前端报 `SyntaxError: Unexpected end of JSON input`（读不存在的文件夹就是这样）。插件列缓存目录失败时改走在线获取，两边都失败才报错。
- 路径第二个字符不是 `:` 时按数据目录的相对路径处理，`\NAS\…` 这类网络路径会被拼错。`readFileText` 读不存在的文件返回空字符串，不报错。
- 数据目录 `/local` 和 `mount_dir` 挂出的目录不需要 API Key，但端口每次启动都变。
- `fs.writeFile(path, blob)` 以表单上传，大文件可用；`fs.unzip(zip, dest)` 原生解压，返回是否成功；`app.exec(cmd, elevate, showWindow)` 启动后立即返回。
- 网易云读歌、对齐时文件接口会很慢：读一个 35 字节的文件实测 1.8–15 s。
- `betterncm.ncm.openUrl` 走 `channel.call('os.navigateExternal')`，在 3.x 上可用，用系统浏览器打开。

## 插件包的解压与更新

- 每次启动，BetterNCM 先清空 `plugins_runtime`（被占用的原生 dll 保留），再按**文件名顺序**把 `plugins\*.plugin` 逐个解压到 `plugins_runtime\tmp`，读 manifest，写 `.plugin.path.meta`（包相对数据目录的路径），改名为 `plugins_runtime\<slug>`，同 slug 已存在就先删除。所以同 slug 的多个包只有文件名排在最后的生效：`BetterMV-0.10.0.plugin` 排在 `BetterMV-0.9.3.plugin` 前面，旧版会覆盖新版。
- 前端先加载 `plugins_runtime`，再加载 `plugins_dev`，同 slug 先到先得。开发插件没有 `.plugin.path.meta`。
- BetterNCM 自带的“删除插件”读 `.plugin.path.meta` 删包；manifest 有 `require_restart`（BetterMV 有）时调 `betterncm_native.app.restart()`，重启不带原来的命令行参数。
- 插件管理器启动时就为每个插件调 `_getConfigElement()` 生成设置页并一直缓存：设置页在打开前已经建好，状态订阅不能在页面未挂载时退订。
- `betterncm.app.reloadPlugins()`（`/app/reload_plugin`）在运行中不可靠：`plugins_runtime` 没有重新解压；随后的 `betterncm.reload()` 留下不透明遮罩、页面不重载，只能重启网易云。所以更新只走重启。
- `plugins_dev` 变化时 BetterNCM 会重载页面，重载后整页明显变慢；装开发构建前先退出网易云。

### BetterMV 的更新（`src/plugin/update.ts`、`updatePrompt.ts`）

- 启动 8 s 后读 `plugins` 里每个 `.plugin` 的 manifest（不看文件名）：slug 为 `ncm-better-mv` 且版本不高于自己的删除；有更新的，删掉自己的包，设置里提示重启。
- 每天（或版本刚变时）查一次 `api.github.com/repos/xiaoming6680/NCM-BetterMV/releases`（返回 `Access-Control-Allow-Origin: *`，未登录每小时 60 次）。有新版本时齿轮上出现红点。“更新”把 `BetterMV-版本号.plugin` 下载到 `plugins`，核对大小和 manifest，删掉旧包，重启后生效。开发安装只打开发布页。客户端内从 GitHub 下载附件没有跨域问题。
- 点“更新”后先进入下载状态再找自己的包（防止连点）。超时：找包 20 s、安装 60 s、下载 20 s 无数据，超时后提示原因并引导到发布页。
- 更新窗口只为每日自动检查（或启动时记下的）新版本弹出，手动“检查更新”不弹。MV 页（1.5 s 后）和设置页（0.6 s 后）哪个先出现就在哪个上弹，弹出即记下版本和时间，一天内不再弹；“忽略此版本”记在 `updateIgnored`。点“立即更新”后窗口随更新在两个页面间移动，否则随页面关闭。MV 页上是右上角卡片（无遮罩，设置面板打开时左移），设置页上是对话框（Esc 关闭）。

## 用 CDP 调试

网易云带 `--remote-debugging-port=9222` 启动后，从 `http://127.0.0.1:9222/json` 找 `orpheus://orpheus/pub/app.html`，用 `Runtime.evaluate` 在页面里执行代码。`window.__betterMv` 提供 `open()`、`close()`、`player`。性能测量见 [PERFORMANCE.md](PERFORMANCE.md) 的 `tools/bench`。
