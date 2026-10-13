<div align="center">

<img src="docs/images/cover.jpg" alt="BetterMV：为网易云音乐的每一首歌实时生成专属 MV" width="880">

# BetterMV

**为网易云音乐中的每一首歌，实时生成专属 MV。**

[下载](https://github.com/xiaoming6680/NCM-BetterMV/releases/latest) | [更新记录](CHANGELOG.md) | [问题反馈](https://github.com/xiaoming6680/NCM-BetterMV/issues)

</div>

## 功能

- **先读懂整首歌**：识别速度、拍号，以及前奏、主歌、副歌、drop 等段落；镜头按段落切换，动作落在重拍上。
- **颜色只取自封面**：每首歌的画面各不相同，黑白封面生成黑白 MV。
- **歌词在场景之中**：一句歌词立在场景里，随演唱逐词出现，有翻译时附带翻译。
- **每次播放都不同**：37 个场景、4 种风格（律动、抒情、字、墨）、4 种画风（孔版印刷、像素、字符、录像带），同一首歌每次播放重新编排。
- **专属浑天仪**：每首歌生成一架浑天仪，环数、刻度与转速都来自这首歌。
- **全部在本机生成**：不上传任何数据。

<p align="center"><img src="docs/images/scenes.jpg" alt="37 个场景" width="880"></p>

> 图中的封面和歌词仅为示意，插件使用当前播放歌曲的封面和歌词。

## 安装

1. **安装 BetterNCM**：下载并运行 [BetterNCM 安装器](https://github.com/std-microblock/BetterNCM-Installer/releases)，点击“安装”。BetterNCM 是网易云音乐 PC 版的开源插件管理器，已安装可跳过。
2. **放入插件**：从 [Releases](https://github.com/xiaoming6680/NCM-BetterMV/releases/latest) 下载 `BetterMV-版本号.plugin`，放入 BetterNCM 的插件文件夹（默认 `C:\betterncm\plugins`）。
3. **重启网易云音乐**。

**更新**：放入新版本后，删除旧版本的 `.plugin` 文件（文件名带版本号，新旧两个会同时加载），再重启网易云。**卸载**：删除插件文件夹中的 `BetterMV-*.plugin`，重启网易云。

运行环境：Windows、网易云音乐 3.x、BetterNCM 1.3.4 或更高版本，显卡需支持 WebGL 2。

## 使用

1. 在网易云中播放一首歌，点击播放栏上方的 **MV**，或按 **Ctrl+Shift+M**。
2. 首次打开一首歌时，BetterMV 先分析整首歌曲（一首四分半的歌约 3 秒），随后 MV 随歌曲播放。
3. 按 **Esc** 退出 MV 页，音乐继续播放。

<p align="center"><img src="docs/images/controls.jpg" alt="MV 页：控制栏与播放列表" width="880"></p>

- **控制栏**：移动鼠标时出现，静止后隐藏。包括喜欢、切歌、播放模式、进度、音量和播放列表；进度条按段落分格，悬停时显示段落与时间。
- **右上角**：设置、最小化、最大化、退出。
- **快捷键**：空格播放 / 暂停，← → 快退 / 快进，↑ ↓ 调节音量，Esc 退出；网易云自身的 Ctrl+← → 切歌同样有效。

## 设置

两个入口：MV 页右上角的齿轮，播放中调整即时生效；或在 BetterNCM 的插件管理界面中选择 BetterMV，快捷键在这里修改。

<p align="center"><img src="docs/images/settings.jpg" alt="设置页" width="620"></p>

| 需要 | 设置方法 |
|---|---|
| 画面卡顿、风扇噪音大 | 画质调为中或低，或将帧率上限设为 30；集成显卡建议选“低” |
| 戴蓝牙耳机时画面早于声音 | “画面延迟”调为 +150～250 ms |
| 某首歌的歌词偏早或偏晚 | MV 页设置中的“歌词延迟”，只对当前歌曲生效 |
| 换一种画面，或每次都一样 | MV 页设置中点击“换一种”；“画面编排”可改为固定 |
| 风格不合适 | “风格”改为律动、抒情、字或墨 |
| 不喜欢某个场景或画风 | 在“场景”“画风”中关闭，点击“应用” |
| 切歌时不想等待 | 开启“提前分析下一首” |
| 只有逐句歌词的歌曲也逐字显示 | 在“逐字对齐”中下载对齐包（约 400 MB），按音频对齐每个字 |
| 不显示播放栏上方的 MV 按钮 | 关闭“MV 按钮”，改用快捷键打开 |

## 常见问题

**需要联网吗？会上传哪些内容？**
音频使用网易云的本地缓存，未缓存完整时按标准音质向网易云获取；歌词、封面和曲风标签同样来自网易云。对齐包从 GitHub 下载一次，之后在本机运行。所有画面在本机生成，不上传任何数据。

**镜头切换的位置不对？**
段落识别不一定准确：对照网易云标出的副歌片段，约 85% 的副歌能被正确识别，其余可能把铺垫认成副歌，或边界偏差一两小节。欢迎附上歌曲名反馈。

**风格选得不对？**
风格依据网易云的曲风标签和音频选择，无标签的说唱、国风无法自动识别，可在设置中手动指定。

**逐字歌词不准？**
没有逐字歌词的歌曲按音节估算每个词的时间；安装对齐包后按音频对齐，但和声、重度处理的人声和日语歌词中的汉字仍可能不准。可用“歌词延迟”整体调整。

**画面中断，提示“显卡被重置”？**
点击“重试”重新生成画面。频繁出现时，调低画质或关闭分形等对显卡要求较高的场景。

**安装 BetterNCM 后网易云无法打开？**
重新运行 BetterNCM 安装器并点击“卸载”，即可恢复。

目前仅在网易云音乐 3.1.37 + BetterNCM 1.3.4、一台 RTX 5070 Ti 笔记本上测试过。遇到问题或画面观感不佳，欢迎在 [Issues](https://github.com/xiaoming6680/NCM-BetterMV/issues) 中反馈，附上歌曲名称会很有帮助。

## 开发者

需要 [Bun](https://bun.sh)。开发说明、风格手册和验证记录见 [docs/](docs/)。

```sh
bun install
bun run dev      # 浏览器预览：http://localhost:5190/?id=歌曲ID（歌曲需已在网易云中完整播放一遍）
bun run plugin   # 安装到 BetterNCM 的开发插件目录，重启网易云后生效
bun run pack     # 打包为 dist/ncm-better-mv.plugin
```

## 开源协议

GPL-3.0-or-later。内置字体 Archivo、Bodoni Moda、Cormorant Garamond、得意黑（Smiley Sans）、霞鹜文楷 Lite 均使用 SIL Open Font License 1.1（`public/fonts/OFL.txt`），打包进插件的 three.js 使用 MIT 协议。可选对齐包中的 MMS-FA 模型来自 Meta，使用 CC BY-NC 4.0（不可商用），其余组件见包内的 `LICENSES.txt`。

作者 [XIAOMING6680](https://github.com/xiaoming6680)。
