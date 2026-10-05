# 歌词对齐包（可选）

用户（2026-10-01）：“现在的逐句效果太差，我有个想法，把下载分析包做成可选的，插件不自带”“我说的分析包指的是歌词的识别”。

## 为什么要单独一个包

网易云多数歌只给逐行歌词（lrc），插件把每句的字按音节平均摊在这句里（`spreadWords`），字亮起的时刻和实际唱的经常差半拍以上。在插件里从音频直接认（起音曲线 + 动态规划）试过，比平均摊还差（ANALYSIS.md“逐字时间”）。要明显变好得靠语音模型做强制对齐，但模型几百 MB，网易云的 Chrome 91 不让开 Worker、没有 WebGPU，只能在主线程算。

所以做成插件外的可选包：设置里点下载（约 400 MB），之后由一个独立的本机进程（嵌入式 Python + onnxruntime，有显卡走 DirectML）去听、去对齐，插件只写任务、等结果。插件本体不变大，不装的人一切照旧。

## 用户看到的

- 设置页“歌词 · 逐字对齐”：下载对齐包（约 400 MB）/ 进度 / 已安装 · 删除。
- 装了之后，第一次放一首只有逐行歌词的歌：MV 先按估算开播，信息栏显示“歌词对齐中”；几秒到半分钟后（下表）换成对齐的时间，显示“歌词已对齐”。结果按歌和歌词存下来，下次打开直接用（在分析之前套上，段落分析也用对齐后的时间）。
- 带逐字歌词（yrc）的歌、纯音乐不受影响。

## 怎么做的

1. 插件把整首歌解码成 16 kHz 单声道 16 位 PCM（`OfflineAudioContext`，网易云能放的格式都行），连同每句的时间戳、下一句的时间戳和句里的词写成任务文件，`cmd /c start "" /b pythonw.exe align.py <任务>` 启动，每 0.8 s 看一次结果文件（`src/plugin/aligner.ts`）。
2. 对齐包（`tools/aligner/fa.py`）：
   - 模型是 Meta 的 MMS-FA（`torchaudio.pipelines.MMS_FA`，wav2vec2 3 亿参数，1 130 种语言训练，按拉丁字母出每帧概率）。导出 ONNX，矩阵乘法量化成 int8：1.26 GB → 355 MB，精度不变（4 首上 ≤0.25 s：句首 85.3% 对 86.2%，其余 87.8% 对 86.2%）。卷积也量化反而在 CPU 上慢一倍多，没用。
   - 文字转字母：汉字用 pypinyin 转无调拼音，假名、韩文按表转写，拉丁字母原样；数字等转不出字母的词不参与，事后按音节插进前后词之间。括号里的词（和声，和主唱同时唱）不参与：强制对齐假设一个人一个字接一个字唱，括号句混进来会把整组拖歪。
   - 整首按 30 s 一段（前后各多 1 s 上下文）算每帧字母概率，再按 15 s 一组句子做 CTC 强制对齐（Viterbi）。每句的字母只能落在“这句时间戳 − 0.5 s”到“下一句时间戳 + 0.5 s”之间，并且不超过“这句时间戳 + 2 s + 每音节 0.8 s”，句首第一个字母不晚于时间戳 + 1.5 s；句子之间、词之间有可以代表任何声音的 `*`（伴奏、和声、拖腔）。
   - 结果每个词给出 [起点, 字母结束]，起点整体提前 0.04 s（CTC 认出一个字母比它真正开始晚一两帧；58 首上 ≤0.1 s 从 66.8% 提到 69.6%）；每句给出字母的平均概率当可信度。
3. 插件套用（`applyAlignment`）：可信度低于 0.005 的句子保留估算（这一档对齐的比估算还差：0–0.003 档 ≤0.25 s 36% 对 50%）；没对上的词按音节插值；词的结束 = 下一个词的开始，除非中间明显停了（> 0.6 s）；最后一个词至少延续到字母结束 + 0.2 s 或每音节 0.3 s，不越过下一句。

## 效果

拿网易云缓存里同时有逐字（yrc）和逐行（lrc）歌词的歌评测：逐行版去对齐，逐字版当答案，比每个词的起点。《溯》网易云没有逐字歌词，用 AMLL 社区的逐字歌词（TTML，人工打的）当答案。

| | 估算（现在） | 对齐后 |
|---|---|---|
| 58 首（几乎全是英文，12 862 个词）误差中位数 | 0.265 s | 0.050 s |
| ≤0.1 s | 21.2% | 70.2% |
| ≤0.25 s | 47.8% | 82.2% |
| 句首词 ≤0.25 s | 62.8% | 79.8% |
| 《溯》（中文，181 个字）误差中位数 | 0.437 s | 0.079 s |
| 《溯》≤0.25 s | 23.8% | 79.6% |

用上对齐的句子 1 906/2 066（其余可信度太低，保留估算）。样片：`dev/samples/歌词对齐-溯-主歌.mp4`（同一段先估算后对齐）。

耗时（一首约 3–4 分钟的歌，含载入模型）：RTX 5070 Ti 笔记本 DirectML 5–6 s；只用 CPU（i9 32 线程）9.6 s，限 4 线程 15.8 s。对齐包进程是低优先级。

对得差的：Daft Punk《Give Life Back to Music》（声码器人声，中位数 0.54 s）、《Why We Lose》《dashstar*》（0.26–0.27 s，电子乐里大量处理过的人声）。

## 试过、没用的

- **Qwen3-ForcedAligner-0.6B**（阿里，Apache 2.0，2026 年 1 月）：句中词很准，但句首常被拉到窗口开头或吃到上一句末尾的同一个词；按组对齐后 4 首上 ≤0.25 s 约 70%，同样条件 MMS 85%。模型 1.8 GB，需要 PyTorch。
- **人声分离**（Kim_Vocal_2，MDX-Net 66 MB）：分离后再对齐，全量上和直接对原曲几乎一样（句首 78.8% 对 78.9%，其余 82.3% 对 81.7%），却要多 66 MB、CPU 上每首多一分钟以上，模型也没写授权。不带。
- **不加时间约束、按组对齐后检查**（第一个可用版本）：重复歌词（“really really really…”“on my, on my…”“ooh-ooh”）会整句滑到相邻那一遍上，差一整句的时长，15% 的句子要退回估算。改成对齐时就把每句限制在时间戳附近，退回降到 3%（加可信度门槛后 8%）。
- 每句单独对齐（窗口只含这一句）：句首更差（窗口里混着上一句的尾巴），句首 ≤0.25 s 74.4% 对 78.8%。组长 8 s 和 15 s 没差别；句首的“不晚于时间戳 + 1.5 s”改成 0.8 s 也没差别。

## 包的结构和发布

`python tools/aligner/build.py --python <python-3.12.x-embed-amd64.zip> --wheels <目录> --model <mms_fa.onnx>` → `build/aligner/release/`：

- `aligner-runtime.zip`（48.5 MB）：嵌入式 Python 3.12 + numpy + onnxruntime-directml + pypinyin + `align.py`、`fa.py`、`LICENSES.txt`、`version.json`。
- `mms_fa.onnx.001`–`.004`（每个 ≤ 95 MB，共 355 MB）：模型拆开，插件逐个下载写盘，不用把几百 MB 放在内存里；`align.py` 第一次运行时拼回一个文件。
- `aligner.json`：版本、文件名、大小、SHA-256。

模型由 `tools/aligner/export_model.py` 从 torchaudio 导出（要 torch、torchaudio）。轮子：`pip download --platform win_amd64 --python-version 3.12 --only-binary=:all: --no-deps -d <目录> numpy onnxruntime-directml pypinyin`。

插件从 `https://github.com/xiaoming6680/NCM-BetterMV/releases/download/aligner-v1/` 下载（`aligner.json` 和上面的文件），装在 `<BetterNCM 数据目录>\BetterMV\aligner`（默认 `C:\betterncm\BetterMV\aligner`），结果缓存在其中的 `cache\`。删除时整个文件夹删掉。包的格式改了要升 `version`（插件和包里的 `PACK_VERSION` / `VERSION` 一起改）和发布标签。

BetterNCM 接口（从它的 framework.js 读的）：`fs.writeFile(path, blob)` 以表单上传到本地服务（BetterNCM 自己更新 dll 也这么写，大文件可以）；`fs.unzip(zip, dest)` 原生解压，返回是否成功；`app.exec(cmd, elevate, showWindow)` 启动后立即返回。

开发预览：`?align` 让开发服务器代插件跑对齐包（`vite.config.ts` 的 `/align/`，Python 和模型取 `dev/aligner/` 里解开的包，脚本用仓库里的），走的是插件的同一套解码、任务和套用。

## 授权

MMS-FA 模型是 CC BY-NC 4.0：可以免费分发，要署名，不能商用。BetterMV 免费，作为可选下载没问题；插件将来要收费就得换模型（Qwen3-ForcedAligner 是 Apache 2.0，但上面说的效果和体积问题要先解决）。其余组件见 `tools/aligner/LICENSES.txt`。

## 已知问题

- 中文只评测了一首（《溯》）。中文字普遍比答案晚约 0.08 s（英文约 0.03 s），可能是拼音声母（zh、sh、x）的字母概率起得晚，也可能是社区答案打得偏早，要更多中文歌才能定。
- 日文汉字会按普通话拼音读，日语歌的汉字词对不准（假名可以）。
- 括号里的和声、念白不对齐，按前后词插值。
- 声码器、重度处理的人声对不准，可信度低时退回估算，可信度高但错的会错。
- 下载地址只有 GitHub，国内可能很慢。

## 评测

```
python tools/aligner/eval.py --model <mms_fa.onnx> [--cpu] [--ttml <目录>] [歌曲 id …]
```

网易云缓存里所有同时有逐字和逐行歌词的歌（歌词第一次从网易云取，存在 `dev/align-eval/`）；`--ttml` 给 AMLL 的 TTML 文件当没有逐字歌词的歌的答案。需要 numpy、onnxruntime（-directml 才走显卡）、pypinyin、soundfile。
