// The plates as users know them: their names (the HUD, the settings page), a line on each, and the family the
// settings page files it under. The lines name no other work (the user: the plugin is promoted on its own).
import type { LookId, SceneId } from './types.ts';

export interface SceneInfo { id: SceneId; name: string; note: string }

export const SCENE_GROUPS: Array<{ name: string; scenes: SceneInfo[] }> = [
  {
    name: '隧道与线条',
    scenes: [
      { id: 'drive', name: '推进', note: '高潮段落的冲刺隧道（与声道轮流开场）：每拍向前推进，冲击环逐层向深处扩散，每 4 小节切换一种隧道' },
      { id: 'tunnel', name: '隧道', note: '细线构成的隧道，每拍穿过一道框，底鼓激起冲击环；铺垫段落末尾冲出隧道、进入封面' },
      { id: 'rings', name: '律动环', note: '同心环如表盘逐拍走格，每段弧按对应频段的响度亮起、变粗（内圈低音、外圈高音）；外圈如音序器随小节点亮，中心的封面随底鼓起伏' },
      { id: 'ridges', name: '山脊', note: '以封面明暗绘出层层起伏的山脊线，底鼓时一道光由近及远扫过；国风歌里画成宣纸上层层叠叠的水墨远山' },
    ],
  },
  {
    name: '封面',
    scenes: [
      { id: 'shatter', name: '碎片', note: '封面切分为三角形墙面，声音像波一样从中心向外穿过，响处的三角片凸出墙面、边缘发亮；副歌重拍时整面翻转，drop 时碎裂散开，镜头从中穿过' },
      { id: 'flip', name: '翻牌', note: '封面铺成翻牌板，每拍掠过一道翻转波；板子同时是一台均衡器，每列对应一个频段，从底部往上点亮' },
      { id: 'align', name: '错位拼合', note: '封面切成的数百块三角形分布于不同深度，随各自频段的响度沿视线前后移动、明暗变化；镜头转至特定角度时拼合成完整封面' },
      { id: 'kaleido', name: '万花筒', note: '封面折叠为 6–12 瓣万花筒，持续推进，按拍旋转半瓣；每圈花纹只露出频谱条覆盖的部分，声音从中心涌出' },
      { id: 'halftone', name: '半调', note: '封面以网点印刷呈现，网点大小同时随频谱变化（中间低音、两侧高音，自下而上流动），军鼓使色版错位' },
      { id: 'particles', name: '粒子', note: '封面分解为三万个光点，声音从中心向外流过画面，响处的光点亮起浮出；重拍时散开并落回画面' },
      { id: 'relief', name: '浮雕', note: '封面转为高低起伏的柱阵，镜头贴近掠过；前方的柱阵是即将到来的声音，响处亮起；歌词如横幅立于航线上' },
      { id: 'diorama', name: '纸雕', note: '封面分为数层纸片，背光、前后错落，镜头移动时呈现纵深（用于图形类封面的慢歌）' },
      { id: 'bokeh', name: '光斑', note: '封面化为失焦光斑，副歌时焦点拉回、画面转为清晰' },
      { id: 'ink', name: '水墨', note: '封面呈现为宣纸水墨，镜头如展开卷轴般平移，歌词竖排（国风）' },
      { id: 'papercut', name: '窗花', note: '封面对折成一张圆形红纸窗花，贴在宣纸上：按封面明暗剪开，大块纸面上刻着月牙纹；窗花慢慢旋转，由中心向外不断生长（国风）' },
      { id: 'vinyl', name: '唱片', note: '歌曲压成一张唱片：封面是标签，纹路随响度明暗，段落之间留出音轨间隙，唱针停在正在播放的位置；歌词沿标签环绕' },
      { id: 'clouds', name: '云海', note: '日落时分掠过云海，封面化作地平线上的落日，为云层染色；镜头时而贴着云顶，时而从云中穿出；国风歌里是水墨云海，远山浮出云端，一轮朱红落日' },
    ],
  },
  {
    name: '世界',
    scenes: [
      { id: 'city', name: '夜城', note: '入夜的城市灯海与楼群，灯光取自封面的颜色；底鼓时街区灯光成片涌亮，副歌第一拍一道光环点亮整座城市，镜头时而穿行于高楼之间' },
      { id: 'aurora', name: '极光', note: '冰湖上空的极光，颜色取自封面；亮度随响度起伏，底鼓时一道光沿光幕掠过，副歌时仰望头顶的极光' },
      { id: 'pillars', name: '光柱', note: '光柱密排成一片圆盘，每个声音在上面激起一圈光环：底鼓的光环最大，军鼓是小白环，唱出的每个字落下一个小环；光环扫过之处逐渐升温，颜色由封面的第二色升至主色；盘面上的细针随频谱闪起（中心低音、外圈高音）' },
      { id: 'canvas', name: '画布', note: '一支发光的笔刷在暗色画布上作画，颜料取自封面对应位置的颜色：人声决定笔压，底鼓溅出颜料，段落之间抬笔换位；画面随整首歌累积，结尾镜头升起，呈现这首歌画出的封面；国风歌里是毛笔在宣纸上以水墨写意' },
      { id: 'rain', name: '雨窗', note: '隔着起雾、挂满雨珠的玻璃看夜里的城市，灯光是封面的颜色；每唱一句，歌词就像用手指写在雾上，透出窗外清晰的夜色；一句唱完，一颗水珠顺着玻璃滑下（慢歌）' },
      { id: 'lanterns', name: '灯海', note: '夜里的湖面上，每唱出一个字就放起一盏孔明灯，副歌时成倍升起，湖面倒映着灯影；灯光取自封面的暖色（慢歌）' },
    ],
  },
  {
    name: '音乐可视化',
    scenes: [
      { id: 'ripple', name: '声浪', note: '封面居中，外圈光柱是此刻的频谱；频谱不断向外流出、旋成旋臂，周围的光点即最近几秒的声音，越响越高越亮；底鼓时冲击环向外扩散' },
      { id: 'channel', name: '声道', note: '在频谱围成的光管中飞行：每一圈光点是某一刻的频谱，前方是即将到来的声音，经过镜头前方时亮起；底鼓化作迎面而来的光环，drop 时光管收紧、加速' },
      { id: 'orb', name: '声核', note: '数千根光刺组成的球体，赤道为低音、两极为高音，刺长即该频段此刻的响度；外圈两道环是左右声道的实时波形，底鼓时球体一胀、放出冲击波' },
      { id: 'scope', name: '示波器', note: '实时显示歌曲的波形；左右声道合成 X-Y 图形，示波器音乐可显现其中的图案' },
    ],
  },
  {
    name: '分形',
    scenes: [
      { id: 'menger', name: '门格回廊', note: '在门格海绵体内无限往里钻：穿过一层层方孔隧道，每段随机拐向，四周的墙和镜头的比例始终不变' },
      { id: 'sierpinski', name: '三角', note: '在谢尔宾斯基四面体体内无限往里钻：穿过一扇扇三角窗，从一个空腔进入下一个，四周的三角和镜头的比例始终不变' },
      { id: 'cantor', name: '悬城', note: '康托尘：大小不一的方块群悬在空中，每块又由更小的方块组成，块间留着窄缝；镜头沿缝隙无限往里钻，四周的方块和镜头的比例始终不变' },
    ],
  },
  {
    name: '歌词排版',
    scenes: [
      { id: 'poster', name: '图版', note: '瑞士风格海报排版：当前演唱的句子以大字排出，辅以色块、细线与网格' },
      { id: 'typewall', name: '字墙', note: '歌词逐行落下、堆叠成墙，正在演唱的词以强调色显示（说唱）' },
      { id: 'neon', name: '霓虹街', note: '踩着节拍走进夜里的窄街，两侧伸出一块块招牌，每段歌词一块；唱到时字像霓虹灯管一样逐个点亮，湿漉漉的街面映着招牌的颜色（说唱）' },
    ],
  },
  {
    name: '浑天仪与读数',
    scenes: [
      { id: 'cards', name: '片头', note: '开场一到两小节展示歌曲分析：整首歌的响度绕成一圈光柱，副歌高亮，这首歌的浑天仪悬于其上，旁列 BPM、拍号、时长与段落数' },
      { id: 'crystal', name: '浑天仪', note: '每首歌独有的浑天仪，环数、刻度与咬合节奏由歌曲决定：drop 前环绕后推入，结尾各环依次合拢' },
      { id: 'subdivide', name: '细分', note: '多面体每半拍细分一级，逐渐成为球体，成球后按纬度随频谱起伏（赤道低音、两极高音）' },
      { id: 'debug', name: '调试视图', note: '封面生成低多边形地形，声音从山顶向四周流过，所到之处隆起、亮起；每拍切换一种渲染调试视图（线框、法线、深度等）' },
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
  { id: 'riso', name: '孔版印刷', note: '段落改为 Riso 孔版印刷：画面分解为两三种专色油墨的网点，套色略有错位，印在米色纸上；歌词以实色油墨印出', styles: ['律动', '抒情', '字'] },
  { id: 'hibit', name: '像素', note: '段落改为像素画面：大像素块，少量色阶加抖动，像素之间留有点阵屏的暗缝', styles: ['律动', '字'] },
  { id: 'ascii', name: '字符', note: '段落改为曲面显像管上的字符画：画面由这首歌歌词（或译文）中的字组成，歌词清晰地显示在玻璃之外', styles: ['律动', '字'] },
  { id: 'vhs', name: '录像带', note: '段落改为从录像带上放出的画面：色彩柔化并向右拖影，画面轻微晃动，跟踪带卷过画面，底部几行被磁头撕开', styles: ['律动', '抒情', '字'] },
];
