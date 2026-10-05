# BetterMV 发布流程

源码仓库：[xiaoming6680/NCM-BetterMV](https://github.com/xiaoming6680/NCM-BetterMV)。作者：XIAOMING6680。

## 构建与发布

1. 改动后同步递增 `plugin/manifest.json` 和 `package.json` 的版本，在 `CHANGELOG.md` 写这一版的变化（面向用户，不提任何作品名）。
2. `bun run pack` 生成 `dist/ncm-better-mv.plugin`：`manifest.json`、`bettermv.js`、预览图、`LICENSE`、字体及其许可证、21 张场景示意图。
3. 推送 `main`，等 “Build plugin” 工作流通过：类型检查、打包、检查安装包内容，并确认 `bettermv.js` 里没有“《”（插件单独宣传，界面上不出现作品名）。
4. 打 `v版本号` 标签，建 GitHub Release：附件是 `BetterMV-版本号.plugin`（即 `dist/ncm-better-mv.plugin` 改名）和 `SHA256SUMS.txt`。开发阶段的版本标成 Pre-release。

本机装进 BetterNCM 的开发插件目录：`bun run plugin`，重启网易云。

## 客户端验收

在网易云 3.x + BetterNCM 1.3.4 里：

- 放一首歌，点 MV 和 Ctrl+Shift+M 都能打开；读取、分析、准备画面的提示依次出现，然后开始播放。
- 暂停、拖进度条、切歌时画面跟着走；Esc 退出后再打开同一首歌立刻播放。
- 设置页：风格、画质、画面延迟、MV 按钮、控制栏、场景开关都能生效，鼠标停在场景上显示示意图；MV 页右上角的齿轮打开同样的设置，在 MV 页里切换画质立刻变清晰或变糊。
- MV 页里：顶部能拖动窗口、双击最大化；四个角和右边缘能拉大缩小窗口（和网易云自己一样，左、上、下边缘不能拉）；右上角最小化、最大化 / 向下还原能用。
- MV 页控制栏：喜欢、播放模式和网易云自己的播放栏同步（在哪边改另一边都跟着变）；播放列表和网易云的一致，点一首切过去，正在播放的标红；Ctrl+← → 切歌（不是快进）；长歌名、长歌手名截断不压按钮，打开面板后右侧不压中间的按钮。
- 设置页标题旁和 MV 页设置面板标题旁的版本号与 `plugin/manifest.json` 一致。
- 深色和浅色主题下设置页都看得清。

还没开发完，暂不上架 BetterNCM 插件商店（用户 2026-09-30），只在 GitHub 发布预发布的开发版。
