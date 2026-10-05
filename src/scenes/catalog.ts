// The plates as users know them: their names (the HUD, the settings page), a line on each, and the family the
// settings page files it under. The lines name no other work (the user: the plugin is promoted on its own).
import type { SceneId } from './types.ts';

export interface SceneInfo { id: SceneId; name: string; note: string }

export const SCENE_GROUPS: Array<{ name: string; scenes: SceneInfo[] }> = [
  {
    name: '隧道与线条',
    scenes: [
      { id: 'drive', name: '推进', note: '高潮里的冲刺隧道：一拍一冲，冲击环一道道往深处跑，每 4 小节换一个世界' },
      { id: 'tunnel', name: '隧道', note: '发丝线框成的隧道，每拍穿过一道框，底鼓推出冲击环；铺垫里冲出去撞进封面' },
      { id: 'rings', name: '律动环', note: '同心环像表盘一样一拍走一格，外圈像音序器跟着小节亮，封面在中间随底鼓鼓起' },
      { id: 'ridges', name: '山脊', note: '封面的明暗画成一排排起伏的山脊线，底鼓从前往后推出一道光' },
      { id: 'scope', name: '示波器', note: '实时显示歌曲的波形；左右声道合成 X-Y 图形，示波器音乐可显现其中的图案' },
    ],
  },
  {
    name: '封面',
    scenes: [
      { id: 'shatter', name: '碎片', note: '封面切成三角墙，副歌重拍整面翻转；drop 里碎成一群，镜头从中穿过' },
      { id: 'flip', name: '翻牌', note: '封面铺成翻牌板，一拍一道波翻过去' },
      { id: 'align', name: '错位拼合', note: '封面切成的三角散在不同深度，镜头转到某个角度才拼成完整的封面' },
      { id: 'kaleido', name: '万花筒', note: '封面折成 6–12 瓣的万花筒，无限推进，踩拍转半瓣' },
      { id: 'halftone', name: '半调', note: '封面印成网点，底鼓让网点胀大，军鼓让色版错位' },
      { id: 'particles', name: '粒子', note: '封面拆成三万个光点，重拍炸开再落回画面' },
      { id: 'relief', name: '浮雕', note: '封面变成起伏的柱阵，镜头贴着飞过，歌词像横幅立在航线上' },
      { id: 'diorama', name: '纸雕', note: '封面拆成几层纸片，背光、前后错开，镜头一动就有纵深（图形类封面的慢歌）' },
      { id: 'bokeh', name: '光斑', note: '封面化成失焦的光点，副歌时焦点拉回、画面清晰起来' },
      { id: 'ink', name: '水墨', note: '封面画成宣纸上的水墨，镜头像展开卷轴一样移动，歌词竖排（国风）' },
    ],
  },
  {
    name: '歌词排版',
    scenes: [
      { id: 'poster', name: '图版', note: '瑞士海报排版：正在唱的句子排成大字，旁边色块、细线和网格' },
      { id: 'typewall', name: '字墙', note: '歌词一行行砸进来叠成墙，正在唱的词是强调色（说唱）' },
    ],
  },
  {
    name: '晶体与读数',
    scenes: [
      { id: 'cards', name: '片头', note: '开场两小节把这首歌读出来：响度、段落、BPM，这首歌的晶体从中长出来' },
      { id: 'crystal', name: '晶体', note: '这首歌独有的晶体多面体：drop 前一小节子弹时间环绕，结尾碎片收拢' },
      { id: 'subdivide', name: '细分', note: '晶体每半拍细分一级，长成一颗随低音呼吸的球' },
      { id: 'debug', name: '调试视图', note: '封面立成低多边形地形，每拍换一种渲染调试画面（线框、法线、深度…）' },
    ],
  },
];

export const SCENES: SceneInfo[] = SCENE_GROUPS.flatMap(g => g.scenes);

export const SCENE_NAME = Object.fromEntries(SCENES.map(s => [s.id, s.name])) as Record<SceneId, string>;
