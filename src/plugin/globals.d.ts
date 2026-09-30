// What BetterNCM puts in scope for an injected plugin script (subset used here).

interface BetterNCMPlugin {
  pluginPath: string;
  onLoad(fn: () => void): void;
  onConfig(fn: () => HTMLElement): void;
  getConfig<T>(key: string, fallback: T): T;
  setConfig<T>(key: string, value: T): void;
}

declare const plugin: BetterNCMPlugin;

declare const betterncm: {
  fs: {
    readDir(path: string): Promise<string[]>;
    readFile(path: string): Promise<Blob>;
    readFileText(path: string): Promise<string>;
    exists(path: string): Promise<boolean>;
  };
  app: {
    getDataPath(): Promise<string>;
  };
};

interface Window {
  APP_CONF?: { domain?: string };
  webpackJsonp?: unknown[];
}
