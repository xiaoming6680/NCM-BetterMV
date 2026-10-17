# 发布

仓库：[xiaoming6680/NCM-BetterMV](https://github.com/xiaoming6680/NCM-BetterMV)。

## 版本号

- `plugin/manifest.json` 和 `package.json` 同步递增。构建时 Vite 的 `define` 从 manifest 读出 `__VERSION__`，插件设置页标题旁和 MV 页设置面板标题旁显示它。
- `CHANGELOG.md` 记录每一版的变化。插件单独宣传：CHANGELOG、界面文字、Release 说明里都不出现作品名。

## 构建

```sh
bun run pack     # dist/ncm-better-mv.plugin
bun run plugin   # 装进 BetterNCM 的 plugins_dev，重启网易云生效
```

包内容：`manifest.json`、`bettermv.js`、`preview.jpg`、`LICENSE`、`fonts/`（含 `OFL.txt`）、`previews/*.webp`（场景与画风示意图）、`obs/`（`index.html`、`obs.js`、`bettermv-obs.exe`）。

`plugins` 里有 BetterMV 的发布包时，`plugins_dev` 里的开发构建不会加载（见 [CLIENT.md](CLIENT.md)“插件包的解压与更新”）。

## CI

工作流 “Build plugin”（`.github/workflows/`）：类型检查 → 打包 → 检查包内容（上面列出的必需文件、示意图不少于 21 张）→ `bettermv.js`、`obs.js` 中不得出现“《”→ 上传 `.plugin` 和 `SHA256SUMS.txt`。

## GitHub Release

- 标签 `v主.次.修`，非预发布。附件：`BetterMV-版本号.plugin`（即 `dist/ncm-better-mv.plugin` 改名）和 `SHA256SUMS.txt`。
- 插件的检查更新（`src/plugin/update.ts`）只认这个格式：标签 `v主.次.修`、非预发布、附件含 `.plugin`、下载地址在本仓库的 `releases/download/` 下。改标签或附件格式前先改 `update.ts`。
- 0.9.2 起新版本启动时会删除同 slug 的旧包。从 0.9.1 及更早版本升级要手动删除旧的 `.plugin`（同 slug 的包只有文件名排在最后的生效），Release 说明里写明。
- 对齐包单独用 `aligner-v1` 标签，标成预发布，免得被 GitHub 当成最新版本。包格式变了才发新标签（见 [ALIGNER.md](ALIGNER.md)）。
- 只在 GitHub 发布，不上架 BetterNCM 插件商店。

## 客户端验收

网易云 3.x + BetterNCM 1.3.4：

- MV 按钮和 Ctrl+Shift+M 都能打开 MV 页；读取、分析、准备画面的提示依次出现，然后开始播放。
- 暂停、拖进度、切歌时画面跟随；Esc 退出后再打开同一首歌立即播放。
- 设置页的风格、画质、画面延迟、MV 按钮、控制栏、场景开关都生效，悬停场景显示示意图；MV 页齿轮打开同样的设置，切换画质立即生效。
- MV 页顶部能拖动窗口、双击最大化；四个角和右边缘能调整窗口大小（与网易云一致，左、上、下边缘不能）；右上角最小化、最大化 / 向下还原可用。
- 控制栏的喜欢、播放模式与网易云播放栏双向同步；播放列表与网易云一致，点击切歌，当前曲目标红；Ctrl+← → 切歌而不是快进；长歌名、长歌手名截断，不压按钮，面板打开时右栏不压中间按钮。
- 两处版本号与 `plugin/manifest.json` 一致。
- 更新：把上一版的包放进 `plugins`，启动后查到这一版，点“更新”下载、删掉旧包，重启网易云后运行的是这一版；新旧两个包同放，重启后旧包被删除。
- 深色、浅色主题下设置页都清楚。
