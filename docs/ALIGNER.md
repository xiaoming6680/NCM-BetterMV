# 歌词对齐包

网易云多数歌只有逐行歌词（lrc）。插件把一句里的字按音节平均摊开（`spreadWords`），字亮起的时刻常和演唱差半拍以上；在插件里从音频直接找字的起点也试过，比平均摊还差（见 [ANALYSIS.md](ANALYSIS.md)“逐字时间”）。明显变好要靠语音模型做强制对齐，但模型几百 MB，而网易云的 Chrome 91 没有 Worker 和 WebGPU。

所以对齐做成插件之外的可选包：设置中下载（约 400 MB），由独立的本机进程（嵌入式 Python + onnxruntime，有显卡走 DirectML）计算，插件只写任务、读结果。插件体积不变，不装包时行为不变。

## 插件侧行为

- 设置“歌词与对齐”：下载（显示进度）/ 已安装 / 删除。
- 只有逐行歌词的歌第一次播放时，MV 先按估算开播，信息栏显示“歌词对齐中”；几秒到半分钟后换成对齐结果，显示“歌词已对齐”。结果按歌和歌词缓存，下次在分析之前就套上（段落分析也用对齐后的时间）。
- 有逐字歌词（yrc）的歌和纯音乐不走对齐包。yrc 是人工打的，比对齐包准：《Cytus II Opening - The Whole Rest》94 个词，对齐包比 yrc 中位晚 0.52 s，一成晚 1.6 s 以上。

## 流程

1. 插件（`src/plugin/aligner.ts`）用 `OfflineAudioContext` 把整首歌解码成 16 kHz 单声道 16 位 PCM，连同每句的时间戳、下一句的时间戳和句内的词写成任务文件，用 `app.exec` 直接启动 `pythonw.exe align.py <任务>`（不经 `cmd`，路径写法见 [CLIENT.md](CLIENT.md) 的“BetterNCM 的文件接口”），每 0.8 s 查一次结果文件。对齐进程是低优先级。
2. 对齐包（`tools/aligner/fa.py`）：
   - 模型：Meta 的 MMS-FA（`torchaudio.pipelines.MMS_FA`，wav2vec2，3 亿参数，按拉丁字母输出每帧概率），导出 ONNX，矩阵乘法量化为 int8：1.26 GB → 355 MB，精度不变。卷积也量化在 CPU 上反而慢一倍多，没用。
   - 文字转字母：汉字用 pypinyin 转无调拼音，假名、韩文按表转写，拉丁字母原样。转不出字母的词（数字等）不参与，事后按音节插到前后词之间。括号里的词（和声）不参与：强制对齐假设一个人逐字演唱，和声会把整组拖歪。
   - 整首按 30 s 一段（前后各多 1 s 上下文）算字母概率，再按 15 s 一组句子做 CTC 强制对齐（Viterbi）。约束：每句的字母落在“本句时间戳 − 0.5 s”到“下一句时间戳 + 0.5 s”之间，且不超过“本句时间戳 + 2 s + 每音节 0.8 s”；句首第一个字母不晚于时间戳 + 1.5 s。句间、词间插入可代表任何声音的 `*`（伴奏、和声、拖腔）。
   - 输出每个词的 [起点, 字母结束]，起点整体提前 0.04 s（CTC 认出字母比实际开始晚一两帧）；每句输出字母平均概率作为可信度。
3. 插件套用（`applyAlignment`）：可信度低于 `MIN_CONF`（0.005）的句子保留估算（这一档对齐比估算差）；没对上的词按音节插值；词的结束取下一个词的开始，中间停顿超过 0.6 s 时除外；最后一个词至少延续到字母结束 + 0.2 s 或每音节 0.3 s，不越过下一句。

## 效果

评测集：网易云缓存中同时有逐字和逐行歌词的歌，用逐行版去对齐、逐字版作答案，比较每个词的起点。中文歌《溯》没有网易云逐字歌词，用 AMLL 社区的 TTML 作答案。

| | 平均摊（估算） | 对齐后 |
|---|---|---|
| 58 首（几乎全英文，12 862 词）误差中位数 | 0.265 s | 0.050 s |
| ≤0.1 s | 21.2% | 70.2% |
| ≤0.25 s | 47.8% | 82.2% |
| 句首词 ≤0.25 s | 62.8% | 79.8% |
| 《溯》（181 字）误差中位数 | 0.437 s | 0.079 s |
| 《溯》≤0.25 s | 23.8% | 79.6% |

2 066 句中 1 906 句用上对齐结果，其余可信度太低。

耗时（3–4 分钟的歌，含载入模型）：RTX 5070 Ti 笔记本 DirectML 5–6 s；CPU（i9，32 线程）9.6 s，限 4 线程 15.8 s。

对得差的：声码器人声（Daft Punk《Give Life Back to Music》，中位 0.54 s）、电子乐里重度处理的人声（《Why We Lose》《dashstar*》，0.26–0.27 s）。

## 试过、没用的

- **Qwen3-ForcedAligner-0.6B**（Apache 2.0）：句中准，句首常被拉到窗口开头或吃到上一句末尾的同一个词；4 首上 ≤0.25 s 约 70%，同条件 MMS 85%。模型 1.8 GB，要 PyTorch。
- **先人声分离再对齐**（Kim_Vocal_2，MDX-Net）：结果与直接对原曲几乎相同，却多 66 MB、CPU 上每首多一分钟以上，模型授权不明。
- **不加时间约束、对齐后再检查**：重复歌词（“really really really…”）会整句滑到相邻那一遍，15% 的句子要退回估算；加约束后降到 3%（加可信度门槛后 8%）。
- **每句单独对齐**：窗口混入上一句尾巴，句首更差（≤0.25 s 74.4% 对 78.8%）。组长 8 s 与 15 s、句首上限 1.5 s 与 0.8 s 都没有差别。

## 包的结构与发布

```sh
python tools/aligner/build.py --python <python-3.12.x-embed-amd64.zip> --wheels <目录> --model <mms_fa.onnx>
```

输出到 `build/aligner/release/`：

- `aligner-runtime.zip`（48.5 MB）：嵌入式 Python 3.12、numpy、onnxruntime-directml、pypinyin，以及 `align.py`、`fa.py`、`LICENSES.txt`、`version.json`。
- `mms_fa.onnx.001`–`.004`（每个 ≤95 MB，共 355 MB）：分卷后插件逐个下载写盘，不在内存里放几百 MB；`align.py` 首次运行时拼回。
- `aligner.json`：版本、文件名、大小、SHA-256。

模型由 `tools/aligner/export_model.py` 从 torchaudio 导出（需要 torch、torchaudio）。轮子：

```sh
pip download --platform win_amd64 --python-version 3.12 --only-binary=:all: --no-deps -d <目录> numpy onnxruntime-directml pypinyin
```

插件从 `https://github.com/xiaoming6680/NCM-BetterMV/releases/download/aligner-v1/` 下载，装在 `<BetterNCM 数据目录>\BetterMV\aligner`（默认 `C:\betterncm\BetterMV\aligner`），结果缓存在其中的 `cache\`，删除时整个文件夹删掉。安装完成的标记是 `installed.json`（`{"version":1}`，读取时去掉 BOM，兼容手写的文件）。

包格式变化时：插件和包里的 `PACK_VERSION` / `VERSION` 一起递增，并发布新标签。

开发预览：URL 加 `?align`，开发服务器代替插件运行对齐包（`vite.config.ts` 的 `/align/`；Python 和模型取 `dev/aligner/` 里解开的包，脚本用仓库里的），解码、任务和套用走插件的同一套代码。

## 授权

MMS-FA 是 CC BY-NC 4.0：可免费分发，需署名，不可商用。作为免费插件的可选下载没有问题；如果插件收费，必须换模型。其余组件见 `tools/aligner/LICENSES.txt`。

## 已知问题

- 中文只评测了一首。中文字普遍比答案晚约 0.08 s（英文约 0.03 s），原因可能是拼音声母（zh、sh、x）的字母概率起得晚，也可能是答案偏早。
- 日文汉字按普通话拼音转写，对不准（假名可以）。
- 括号里的和声、念白不对齐，按前后词插值。
- 声码器和重度处理的人声：可信度低时退回估算，可信度高但错的会错。
- 下载只有 GitHub 一个源。

## 评测

```sh
python tools/aligner/eval.py --model <mms_fa.onnx> [--cpu] [--ttml <目录>] [歌曲 id …]
```

评测网易云缓存里所有同时有逐字和逐行歌词的歌（歌词首次从网易云取，存在 `dev/align-eval/`）；`--ttml` 指定 AMLL 的 TTML 文件作为无逐字歌词的歌的答案。依赖 numpy、onnxruntime（`-directml` 才走显卡）、pypinyin、soundfile。
