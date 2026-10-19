# 鼓点模型与画面节奏

节拍仍是整理后的 Beat This!（[ANALYSIS.md](ANALYSIS.md)“节拍：Beat This!”）：稳定段、`onePace` 和恒速网格。本文讲另外两件事：对齐包里的鼓点模型，以及导演层怎样把节拍和鼓点变成画面上的动作。

## 鼓点模型（ADTOF）

装了对齐包（格式 2）时，第一次分析会另下一个 2,171,762 字节的 ADTOF ONNX 模型，复用包里的 Python、NumPy 和 ONNX Runtime。没装对齐包不下载。下载、校验或推理失败时用声学检测（`hits.ts`）。音频只在本机处理。

- 下载：先从对齐包自己的发布（`aligner-v2/adtof_frame_rnn.onnx`），不行再从 Hugging Face 的固定版本（国内常连不上）；每处最多等 15 s，检查大小，有 WebCrypto 时校验 SHA-256，Python 每次加载前再校验一次。
- 输入：插件把歌解码成 44.1 kHz 单声道（留住军鼓和镲的高频）；只在要跑任务时才解码，缓存里有的歌不解码。Beat This! 在进程里自己重采样到 22.05 kHz。
- `rhythm.py` 包着 `align.py`：两个模型可以分别失败，节拍失败而鼓点成功时仍留下鼓点。`drums.py` 每 20 s 一块、两侧各留 2 s 上下文，输出 100 fps 的底鼓、军鼓、通鼓、踩镲、镲片概率；踩镲和镲片并成 `hat`，通鼓不算军鼓。
- 合并（`analysis/drums.ts`，`index.ts`）：底鼓和镲用模型的；军鼓是模型的（起音 1–5 kHz 与 5 kHz 以上之比至少 2）加上声学检测里模型漏掉的（比值至少 3，40 ms 内算同一下）。比值挡住被认成军鼓的踩镲，也可能漏掉很亮的军鼓。模型整首没听到鼓的歌不留军鼓。
- 缓存：`cache\rhythm-3-<id>-<整秒时长>.json`。0.10 的 `beats-*`（只有节拍）照样读；鼓点模型在时任务带 `beatsFrom`，只跑鼓点（约 2 s），不重跑 Beat This!。

### 来源和许可

模型由 [Sillybit-io 转换](https://github.com/Sillybit-io/silly-midi-tools)，源自 [ADTOF](https://github.com/MZehren/ADTOF) 的 `Frame_RNN_adtofAll_0`，用 [Hugging Face 模型仓库](https://huggingface.co/thebluescreen/adtof-drums-onnx) 的固定版本：

```
revision: d0e809bb1c1b6fe8a4a00c576852117a0636ab5a
file: adtof_frame_rnn.onnx
SHA-256: 189ca3c2bc7339a5f0fdc0bb11069d4bcc4fafabd142e945228c368c379b6227
```

权重是 **CC BY-NC-SA 4.0（非商业）**，不属于插件代码的许可，不打进插件安装包，也不提交进仓库。许可和来源说明在 `tools/aligner/licenses/`，安装模型时一起写到对齐包的 `models/`。商业分发要换成许可兼容的模型。

## 画面节奏（`director/rhythm.ts`）

`Music.visual` 是导演的视觉时钟：按小节选每 1、2、4… 个音乐拍走一个视觉单位，让大幅运动的速度不超过 160 BPM；位置按整首积分，换速和拖动进度不会让镜头跳位。现在节拍按 `onePace` 折到 160 以下，这一层多数时候与 `beatPos` 相同。

试过、没留下：每个鼓点的动作至少隔 320 ms 的慢包络、按段落能量配动作幅度、在场景效果之后统一封顶泛光 / 残影 / 媒介画风并关掉闪白、反色和冲击帧、去掉 drop 前黑场和铺垫的加速切镜、切镜按秒数停留。画面整体变得克制，导演节奏也慢了一半（律动每分钟切镜 15.4 → 7.1），都已还原。

## 验证

`node --experimental-transform-types --test tools/rhythm.test.ts`（11 项）：恒速网格（残拍、慢漂、半速段、现场速度、连段条件）、`onePace` 加网格折回两倍速段、模型鼓点的清洗和与节拍无关、视觉时钟（拖动、可逆）、切镜（铺垫冲进 drop 时加速、响段每 2 小节一切）、旧分析。

《Clarity》手工标注（同一份 PCM 和 Beat This! 结果；鼓点模型用原音频的 44.1 kHz 解码）：

| | 0.10.1 | 无鼓点模型 | 有鼓点模型 |
|---|---:|---:|---:|
| 节拍 F（±70 ms） | 0.943 | 0.943 | 0.943 |
| 重拍 F | 0.927 | 0.927 | 0.927 |
| 底鼓 F（±50 ms） | 0.788 | 0.789 | 0.886 |
| 军鼓 F | 0.662 | 0.667 | 0.709 |

Clarity 的鼓点参照来自分离鼓轨后的起音提取，不是完整的人工标注；军鼓门限也参考了这首歌，不能据此说跨歌曲都更准。

试过、没留下：直接用 Beat This! 的每一拍（不整理、不折半）加逐小节可变拍组（2–12 拍）。198 首里相邻拍间隔突变 5131 处（151 首，整理后 218 处、60 首），88 首出现非 4 拍的小节，Clarity 重拍 F 0.831、段落标签 86%。鼓点检测去掉网格先验（只看音色）后，无模型时底鼓 0.75、军鼓 0.59。
