// The plates as users know them: their names (the HUD, the settings page), a line on each, and the family the
// settings page files it under. The lines name no other work (the user: the plugin is promoted on its own).
import type { LookId, SceneId } from './types.ts';

export interface SceneInfo { id: SceneId; name: string; note: string }

export const SCENE_GROUPS: Array<{ name: string; scenes: SceneInfo[] }> = [
  {
    name: '隧道与线条',
    scenes: [
      { id: 'drive', name: '推进', note: '高潮段落的冲刺隧道：每拍向前推进，冲击环逐层向深处扩散' },
      { id: 'tunnel', name: '隧道', note: '细线构成的隧道，每拍穿过一道框，底鼓激起冲击环' },
      { id: 'rings', name: '律动环', note: '同心环如表盘逐拍走格，每段弧随对应频段的响度亮起，中心的封面随底鼓起伏' },
      { id: 'ridges', name: '山脊', note: '以封面明暗绘出层层山脊线，底鼓时一道光由近及远扫过；国风歌里是水墨远山' },
    ],
  },
  {
    name: '封面',
    scenes: [
      { id: 'flip', name: '翻牌', note: '封面铺成翻牌板，每拍掠过一道翻转波，每列随一个频段从底部亮起' },
      { id: 'kaleido', name: '万花筒', note: '封面折叠为万花筒，持续推进，按拍旋转，花纹随频谱从中心涌出' },
      { id: 'halftone', name: '半调', note: '封面以网点印刷呈现，网点大小随频谱变化，军鼓使色版错位' },
      { id: 'particles', name: '粒子', note: '封面分解为三万个光点，响处亮起浮出，重拍时散开又落回' },
      { id: 'relief', name: '浮雕', note: '封面转为起伏的柱阵，镜头贴近掠过，前方是即将到来的声音' },
      { id: 'diorama', name: '纸雕', note: '封面分为数层背光纸片，镜头移动时呈现纵深' },
      { id: 'bokeh', name: '光斑', note: '封面化为失焦光斑，副歌时焦点拉回、画面转为清晰' },
      { id: 'ink', name: '水墨', note: '封面呈现为宣纸水墨，镜头如展开卷轴般平移，歌词竖排（国风）' },
      { id: 'papercut', name: '窗花', note: '封面剪成一张圆形红纸窗花，慢慢旋转，由中心向外生长（国风）' },
      { id: 'vinyl', name: '唱片', note: '歌曲压成一张唱片：纹路随响度明暗，唱针停在正在播放的位置，歌词沿标签环绕' },
      { id: 'clouds', name: '云海', note: '日落时分掠过云海，封面化作地平线上的落日；国风歌里是水墨云海' },
    ],
  },
  {
    name: '世界',
    scenes: [
      { id: 'city', name: '夜城', note: '入夜的城市，灯光取自封面的颜色；底鼓时街区成片亮起，副歌第一拍一道光环点亮整座城市' },
      { id: 'aurora', name: '极光', note: '冰湖上空的极光，颜色取自封面，亮度随响度起伏；副歌时仰望头顶的极光' },
      { id: 'pillars', name: '光柱', note: '光柱密排成一片圆盘，每个声音激起一圈光环：底鼓的最大，唱出的每个字落下一个小环' },
      { id: 'canvas', name: '画布', note: '一支发光的笔刷用封面的颜色作画，人声决定笔压，底鼓溅出颜料；结尾镜头升起，呈现整首歌画出的画面；国风歌里是水墨写意' },
      { id: 'rain', name: '雨窗', note: '隔着起雾的玻璃看夜里的城市，歌词像用手指写在雾上（慢歌）' },
      { id: 'lanterns', name: '灯海', note: '夜里的湖面上，每唱出一个字就放起一盏孔明灯，副歌时成倍升起（慢歌）' },
    ],
  },
  {
    name: '音乐可视化',
    scenes: [
      { id: 'ripple', name: '声浪', note: '封面居中，外圈是此刻的频谱，不断向外流出、旋成旋臂；底鼓时冲击环向外扩散' },
      { id: 'channel', name: '声道', note: '在频谱围成的光管中飞行，前方是即将到来的声音；drop 时光管收紧、加速' },
      { id: 'orb', name: '声核', note: '数千根光刺组成的球体，刺长即各频段此刻的响度；底鼓时球体一胀，放出冲击波' },
      { id: 'dots', name: '点阵', note: '一整面 LED 点阵墙：歌词以点阵字逐词点亮，底部是点阵频谱，鼓点时光带横扫过墙' },
      { id: 'cubes', name: '条纹方块', note: '音游 BGA 式的两色斜条纹上，成千方块翻滚涌来，每块随一个频段的响度胀缩，鼓点上条纹错位' },
      { id: 'blackhole', name: '黑洞', note: '光被引力弯曲的黑洞，吸积盘就是声音：每个音从视界边缘流出、铺满盘面，底鼓是一圈光波' },
      { id: 'scope', name: '示波器', note: '实时显示歌曲的波形，示波器音乐会显现其中的图案' },
    ],
  },
  {
    name: '分形',
    scenes: [
      { id: 'menger', name: '门格回廊', note: '在门格海绵中无限深入，穿过一层层方孔隧道' },
      { id: 'sierpinski', name: '三角', note: '在谢尔宾斯基四面体中无限深入，穿过一扇扇三角窗' },
      { id: 'cantor', name: '悬城', note: '悬在空中的方块群，每块又由更小的方块组成，镜头沿缝隙无限深入' },
    ],
  },
  {
    name: '歌词排版',
    scenes: [
      { id: 'poster', name: '图版', note: '海报排版：正在演唱的句子以大字排出，辅以色块、细线与网格' },
      { id: 'typewall', name: '字墙', note: '歌词逐行落下、堆叠成墙，正在演唱的词以强调色显示（说唱）' },
      { id: 'neon', name: '霓虹街', note: '走进夜里的窄街，每段歌词一块招牌，唱到时像霓虹灯管一样逐字点亮（说唱）' },
      { id: 'kinetic', name: '叠字', note: '音游 BGA 式的动态字：唱到的词放大、重复叠起，压在斜纹色条上，随鼓点错位滑动' },
    ],
  },
  {
    name: '浑天仪与读数',
    scenes: [
      { id: 'cards', name: '片头', note: '开场展示歌曲分析：整首歌的响度绕成一圈光柱，旁列 BPM、拍号、时长与段落数' },
      { id: 'crystal', name: '浑天仪', note: '每首歌独有的浑天仪，环数与刻度由歌曲决定，结尾各环依次合拢' },
      { id: 'subdivide', name: '细分', note: '多面体每半拍细分一级，成球后随频谱起伏' },
      { id: 'debug', name: '调试视图', note: '封面生成的低多边形地形，每拍切换一种渲染调试视图（线框、法线、深度等）' },
    ],
  },
];

export const SCENES: SceneInfo[] = SCENE_GROUPS.flatMap(g => g.scenes);

export const SCENE_NAME = Object.fromEntries(SCENES.map(s => [s.id, s.name])) as Record<SceneId, string>;

/**
 * The looks a section may be redrawn in (src/render/looks.ts), for the settings page; their sketches are
 * previews/look-<id>.webp. `styles`: the styles that use each (director.ts, planLooks).
 */
export const LOOKS: Array<{ id: LookId; name: string; note: string; styles: string[] }> = [
  { id: 'riso', name: '孔版印刷', note: '两三种专色油墨的网点，套色略有错位，印在米色纸上', styles: ['律动', '抒情', '字'] },
  { id: 'hibit', name: '像素', note: '大像素块，少量色阶加抖动，像点阵屏', styles: ['律动', '字'] },
  { id: 'ascii', name: '字符', note: '曲面显像管上的字符画，由这首歌歌词中的字组成', styles: ['律动', '字'] },
  { id: 'vhs', name: '录像带', note: '录像带画面：色彩柔化、向右拖影，跟踪带卷过画面', styles: ['律动', '抒情', '字'] },
];
