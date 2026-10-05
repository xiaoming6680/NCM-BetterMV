// What BetterNCM puts in scope for an injected plugin script (subset used here).

interface BetterNCMPlugin {
  pluginPath: string;
  onLoad(fn: () => void): void;
  onConfig(fn: () => HTMLElement): void;
  getConfig<T>(key: string, fallback: T): T;
  setConfig<T>(key: string, value: T): void;
}

declare const plugin: BetterNCMPlugin;

/** The version in plugin/manifest.json (Vite's `define`). */
declare const __VERSION__: string | undefined;

declare const betterncm: {
  fs: {
    readDir(path: string): Promise<string[]>;
    readFile(path: string): Promise<Blob>;
    readFileText(path: string): Promise<string>;
    exists(path: string): Promise<boolean>;
    /** Uploads the blob to BetterNCM's local server as a form file (streams; large files are fine). */
    writeFile(path: string, content: Blob): Promise<boolean>;
    writeFileText(path: string, content: string): Promise<boolean>;
    mkdir(path: string): Promise<boolean>;
    /** Removes a file. */
    remove(path: string): Promise<boolean>;
    /** Unzips natively into `dest`; true on success. */
    unzip(path: string, dest?: string): Promise<boolean>;
  };
  app: {
    /** BetterNCM's data folder, backslashed (C:etterncm by default). */
    getDataPath(): Promise<string>;
    /** Starts a command line (it doesn't wait for it to finish). */
    exec(cmd: string, elevate?: boolean, showWindow?: boolean): Promise<boolean>;
  };
};

interface Window {
  APP_CONF?: { domain?: string };
  webpackJsonp?: unknown[];
}
