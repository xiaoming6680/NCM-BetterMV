// NetEase's song wiki ("音乐百科"): genre, mood tags, language and BPM, from the same public endpoint the
// client's song page uses. No login needed. Style choice leans on it; analysis uses the BPM to pick the tempo octave.

export interface SongWiki {
  /** e.g. "国风-国风流行", "电子-浩室舞曲" */
  genres: string[];
  /** Mood/use tags, e.g. "治愈", "活力". */
  tags: string[];
  language?: string;
  bpm?: number;
}

export const wikiUrl = (id: number | string, domain = 'https://music.163.com') => `${domain}/api/song/play/about/block/page?songId=${id}`;

/** Values under each titled item of the wiki blocks (titles of sub-items and link texts). */
export function parseWiki(json: unknown): SongWiki {
  const fields = new Map<string, string[]>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, any>;
    const title = o.uiElement?.mainTitle?.title;
    if (typeof title === 'string' && ['曲风', '推荐标签', '语种', 'BPM'].includes(title)) {
      const values: string[] = [];
      const collect = (x: unknown, top: boolean): void => {
        if (!x || typeof x !== 'object') return;
        const r = x as Record<string, any>;
        if (!top && typeof r.title === 'string' && r.title) values.push(r.title);
        if (typeof r.text === 'string' && r.text) values.push(r.text);
        for (const v of Object.values(r)) collect(v, false);
      };
      // Skip the heading itself; everything below it is a value.
      const { mainTitle, ...rest } = o.uiElement ?? {};
      collect(rest, true);
      for (const [k, v] of Object.entries(o)) if (k !== 'uiElement') collect(v, false);
      fields.set(title, Array.from(new Set(values.filter(v => v !== title))));
    }
    for (const v of Object.values(o)) visit(v);
  };
  visit(json);
  const bpm = Number((fields.get('BPM') ?? [])[0]);
  return {
    genres: fields.get('曲风') ?? [],
    tags: fields.get('推荐标签') ?? [],
    language: (fields.get('语种') ?? [])[0],
    bpm: Number.isFinite(bpm) && bpm > 0 ? bpm : undefined,
  };
}
