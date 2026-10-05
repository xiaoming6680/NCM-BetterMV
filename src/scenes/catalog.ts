// The plates as users know them: their names (the HUD, the settings page), a line on each, and the family the
// settings page files it under. The lines name no other work (the user: the plugin is promoted on its own).
import type { SceneId } from './types.ts';

export interface SceneInfo { id: SceneId; name: string; note: string }

export const SCENE_GROUPS: Array<{ name: string; scenes: SceneInfo[] }> = [
  {
    name: '隧道与线条',
    scenes: [
      { id: 'drive', name: '推进', note: '高潮段落的冲刺隧道：每拍向前推进，冲击环逐层向深处扩散，每 4 小节切换一种隧道' },
      { id: 'tunnel', name: '隧道', note: '细线构成的隧道，每拍穿过一道框，底鼓激起冲击环；铺垫段落末尾冲出隧道、进入封面' },
      { id: 'rings', name: '律动环', note: '同心环如表盘逐拍走格，外圈如音序器随小节点亮，中心的封面随底鼓起伏' },
      { id: 'ridges', name: '山脊', note: '以封面明暗绘出层层起伏的山脊线，底鼓时一道光由近及远扫过' },
      { id: 'scope', name: '示波器', note: '实时显示歌曲的波形；左右声道合成 X-Y 图形，示波器音乐可显现其中的图案' },
    ],
  },
  {
    name: '封面',
    scenes: [
      { id: 'shatter', name: '碎片', note: '封面切分为三角形墙面，副歌重拍时整面翻转；drop 时碎裂散开，镜头从中穿过' },
      { id: 'flip', name: '翻牌', note: '封面铺成翻牌板，每拍掠过一道翻转波' },
      { id: 'align', name: '错位拼合', note: '封面切成的三角形分布于不同深度，镜头转至特定角度时拼合成完整封面' },
      { id: 'kaleido', name: '万花筒', note: '封面折叠为 6–12 瓣万花筒，持续推进，按拍旋转半瓣' },
      { id: 'halftone', name: '半调', note: '封面以网点印刷呈现，底鼓使网点扩张，军鼓使色版错位' },
      { id: 'particles', name: '粒子', note: '封面分解为三万个光点，重拍时散开并落回画面' },
      { id: 'relief', name: '浮雕', note: '封面转为高低起伏的柱阵，镜头贴近掠过，歌词如横幅立于航线上' },
      { id: 'diorama', name: '纸雕', note: '封面分为数层纸片，背光、前后错落，镜头移动时呈现纵深（用于图形类封面的慢歌）' },
      { id: 'bokeh', name: '光斑', note: '封面化为失焦光斑，副歌时焦点拉回、画面转为清晰' },
      { id: 'ink', name: '水墨', note: '封面呈现为宣纸水墨，镜头如展开卷轴般平移，歌词竖排（国风）' },
    ],
  },
  {
    name: '歌词排版',
    scenes: [
      { id: 'poster', name: '图版', note: '瑞士风格海报排版：当前演唱的句子以大字排出，辅以色块、细线与网格' },
      { id: 'typewall', name: '字墙', note: '歌词逐行落下、堆叠成墙，正在演唱的词以强调色显示（说唱）' },
    ],
  },
  {
    name: '晶体与读数',
    scenes: [
      { id: 'cards', name: '片头', note: '开场两小节展示歌曲分析：响度、段落、BPM，并由此生成这首歌的晶体' },
      { id: 'crystal', name: '晶体', note: '每首歌独有的晶体多面体：drop 前一小节以子弹时间环绕，结尾时碎片收拢' },
      { id: 'subdivide', name: '细分', note: '晶体每半拍细分一级，逐渐成为随低音起伏的球体' },
      { id: 'debug', name: '调试视图', note: '封面生成低多边形地形，每拍切换一种渲染调试视图（线框、法线、深度等）' },
    ],
  },
];

export const SCENES: SceneInfo[] = SCENE_GROUPS.flatMap(g => g.scenes);

export const SCENE_NAME = Object.fromEntries(SCENES.map(s => [s.id, s.name])) as Record<SceneId, string>;
