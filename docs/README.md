# 开发文档

| 文档 | 内容 |
|---|---|
| [CLIENT.md](CLIENT.md) | 网易云 3.x 和 BetterNCM 给插件的接口：内部模块、播放状态与控制、窗口、音频缓存、文件接口、插件包的解压与更新 |
| [ANALYSIS.md](ANALYSIS.md) | 歌曲分析：速度、节拍、段落、鼓点、示波器音乐、显示速度；评测工具 |
| [ALIGNER.md](ALIGNER.md) | 可选的歌词对齐包：流程、效果、打包与发布 |
| [PERFORMANCE.md](PERFORMANCE.md) | 配置要求、帧耗时与优化、自动画质、准备时间；`tools/bench` |
| [OBS.md](OBS.md) | OBS 输出：本机服务、歌曲数据格式、对时、已知限制 |
| [EXPORT.md](EXPORT.md) | MV 页右键菜单；下载 MV：导出选项、逐帧渲染、显卡里打包 NV12、编码程序（Media Foundation）、送帧的限制、兼容模式（MediaRecorder）、实测数据 |
| [PUBLISHING.md](PUBLISHING.md) | 版本号、构建、CI、GitHub Release、客户端验收 |

代码注释里提到的 `TREATMENT.md`（风格手册）、`FILM.md`（宣传片）、`TESTING.md`（测试记录）是本地文档，不在仓库里。

## 代码结构

| 目录 | 内容 |
|---|---|
| `src/analysis/` | 歌曲分析（主线程分片的生成器，无依赖） |
| `src/lyrics/`、`src/meta/` | 歌词解析、音乐百科 |
| `src/style/` | 风格选择与各风格的图版池 |
| `src/director/` | 导演：分镜、歌词排期、后期时刻、动态图形层 |
| `src/scenes/` | 场景（图版）与歌词载体；`catalog.ts` 是设置页的场景目录 |
| `src/sigil/` | 每首歌的浑天仪 |
| `src/render/` | 引擎、后期、镜头、转场、画风、配色、文字 |
| `src/app/` | 播放器、歌曲准备、自动画质、HUD |
| `src/plugin/` | 插件入口、网易云接口、界面与设置、右键菜单、下载 MV（导出面板、送帧、编码程序的客户端）、更新、对齐包、OBS 输出 |
| `src/export/` | 编码程序 `bettermv-encode.exe` 的 C# 源码（Media Foundation 写 MP4） |
| `src/obs/` | OBS 页面、歌曲数据格式、本机服务（C#） |
| `src/dev/` | 浏览器开发页 |
| `tools/` | 评测、性能测量、示意图渲染、对齐包构建、鼓点拟合、歌词出画检查（`lyric-fit.ts`，竖屏等窄画幅） |
| `film/` | 宣传片与 README 配图的渲染 |
| `probe/` | 接口探针插件 |

## 开发

需要 [Bun](https://bun.sh)。

```sh
bun install
bun run dev      # 开发页 http://localhost:5190/?id=歌曲ID（歌曲需已在网易云中完整播放一遍）
bun run plugin   # 装进 BetterNCM 的 plugins_dev，重启网易云生效
bun run pack     # 打包为 dist/ncm-better-mv.plugin
bun run eval     # 分析评测
./node_modules/.bin/tsc.exe --noEmit   # 类型检查
```

插件运行在网易云内嵌的 Chromium 91 里：不能用之后才有的 JS 接口，没有 Worker 和 WebGPU，重计算要在主线程分片（见 [CLIENT.md](CLIENT.md)）。
