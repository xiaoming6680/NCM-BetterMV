// BetterMV OBS: the small local server behind the OBS output (docs/OBS.md). A BetterNCM plugin runs inside NetEase's
// page and can't listen on a port, so the plugin starts this program, which serves at a fixed address
// (http://127.0.0.1:32109/ by default) what a browser source in OBS needs: the OBS page and its fonts (from the
// plugin's folder), the song the plugin prepared, and where NetEase is playing, pushed to the page as server-sent
// events. It counts the pages connected (and those OBS shows), which the plugin reads to say "OBS 已连接" and to stop
// drawing its own MV page meanwhile. It ends itself when NetEase closes.
//
// Built with the C# compiler of .NET Framework 4.x, which every Windows 10/11 has (C# 5: no string interpolation, no ?.):
//   %WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe -nologo -optimize -target:winexe -out:bettermv-obs.exe BetterMVObs.cs
// (scripts/pack-plugin.ps1, scripts/install-plugin.ps1). Run: bettermv-obs.exe --port 32109 --root <plugin folder>
// --key <secret> --version <plugin version> [--watch cloudmusic]
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;

[assembly: AssemblyTitle("BetterMV OBS")]
[assembly: AssemblyDescription("BetterMV 的 OBS 输出：在本机为 OBS 浏览器源提供 MV 画面")]
[assembly: AssemblyProduct("BetterMV")]

static class BetterMVObs {
  const string App = "BetterMV OBS";
  /** How often the pages get a keep-alive comment: a page that went away is noticed within this. */
  const int PingMs = 2000;
  /** Songs kept for the pages (the playing one and the one before, for a page still loading it). */
  const int KeepSongs = 2;

  static int port = 32109;
  static string root = ".", key = "", version = "", watch = "cloudmusic";

  class Page { public string Id; public HttpListenerResponse Response; public bool Visible = true; public bool Obs; }

  static readonly object gate = new object();
  static readonly List<Page> pages = new List<Page>();
  static readonly Dictionary<string, byte[]> songs = new Dictionary<string, byte[]>();
  static readonly List<string> songOrder = new List<string>();
  static string state;
  /** What the pages reported going wrong (newest last), for the plugin's settings and for finding out why. */
  static readonly List<string> log = new List<string>();
  const int KeepLog = 12;

  static int Main(string[] args) {
    for (int i = 0; i + 1 < args.Length; i += 2) {
      switch (args[i]) {
        case "--port": port = int.Parse(args[i + 1]); break;
        case "--root": root = args[i + 1]; break;
        case "--key": key = args[i + 1]; break;
        case "--version": version = args[i + 1]; break;
        case "--watch": watch = args[i + 1]; break;
      }
    }
    var listener = new HttpListener();
    // (Both names: the Host header picks the prefix, and OBS may be given either.)
    listener.Prefixes.Add("http://127.0.0.1:" + port + "/");
    listener.Prefixes.Add("http://localhost:" + port + "/");
    try { listener.Start(); } catch { return 2; } // the port is taken (another copy, or another program)
    new Thread(Ping) { IsBackground = true }.Start();
    new Thread(Watch) { IsBackground = true }.Start();
    while (true) {
      HttpListenerContext ctx;
      try { ctx = listener.GetContext(); } catch { return 1; }
      ThreadPool.QueueUserWorkItem(_ => {
        try { Handle(ctx); } catch { try { ctx.Response.Abort(); } catch { } }
      });
    }
  }

  /** Ends with NetEase: once no process of that name has been seen for two checks in a row. */
  static void Watch() {
    if (string.IsNullOrEmpty(watch)) return;
    int missing = 0;
    while (true) {
      Thread.Sleep(2000);
      missing = Process.GetProcessesByName(watch).Length == 0 ? missing + 1 : 0;
      if (missing >= 2) Environment.Exit(0);
    }
  }

  static void Ping() {
    while (true) {
      Thread.Sleep(PingMs);
      Broadcast(": ping\n\n");
    }
  }

  /** Writes to every connected page; a page that can't be written to is gone. */
  static void Broadcast(string text) {
    var data = Encoding.UTF8.GetBytes(text);
    lock (gate) {
      foreach (var p in pages.ToArray()) {
        try { p.Response.OutputStream.Write(data, 0, data.Length); p.Response.OutputStream.Flush(); }
        catch { pages.Remove(p); try { p.Response.Abort(); } catch { } }
      }
    }
  }

  static string Quote(string s) {
    var b = new StringBuilder("\"");
    foreach (var c in s) {
      if (c == '"' || c == '\\') b.Append('\\').Append(c);
      else if (c < ' ') b.Append("\\u").Append(((int)c).ToString("x4"));
      else b.Append(c);
    }
    return b.Append('"').ToString();
  }

  /**
   * What the server is; with the key also how it stands (pages, the songs it has, the pages' reports): the songs
   * name what is playing, which is nobody's business but the plugin's.
   */
  static string Status(bool full) {
    if (!full) return "{\"app\":" + Quote(App) + ",\"version\":" + Quote(version) + ",\"port\":" + port + "}";
    lock (gate) {
      int visible = 0, obs = 0;
      foreach (var p in pages) { if (p.Visible) visible++; if (p.Obs) obs++; }
      var keys = new List<string>();
      foreach (var k in songOrder) keys.Add(Quote(k));
      var lines = new List<string>();
      foreach (var l in log) lines.Add(Quote(l));
      return "{\"app\":" + Quote(App) + ",\"version\":" + Quote(version) + ",\"port\":" + port + ",\"pages\":" + pages.Count +
        ",\"visible\":" + visible + ",\"obs\":" + obs + ",\"songs\":[" + string.Join(",", keys.ToArray()) + "],\"log\":[" + string.Join(",", lines.ToArray()) + "]}";
    }
  }

  static void Send(HttpListenerResponse r, int code, string type, byte[] body) {
    r.StatusCode = code;
    r.ContentType = type;
    r.Headers["Cache-Control"] = "no-store";
    r.ContentLength64 = body.Length;
    r.OutputStream.Write(body, 0, body.Length);
    r.Close();
  }
  static void Text(HttpListenerResponse r, int code, string text) { Send(r, code, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(text)); }
  static void Json(HttpListenerResponse r, string json) { Send(r, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json)); }

  /** A query parameter, percent-decoded as UTF-8 (HttpListener's own QueryString decodes with the system's code page). */
  static string Arg(HttpListenerRequest q, string name) {
    var query = q.Url.Query;
    if (query.StartsWith("?")) query = query.Substring(1);
    foreach (var part in query.Split('&')) {
      var eq = part.IndexOf('=');
      var k = eq < 0 ? part : part.Substring(0, eq);
      if (Uri.UnescapeDataString(k.Replace('+', ' ')) != name) continue;
      return eq < 0 ? "" : Uri.UnescapeDataString(part.Substring(eq + 1).Replace('+', ' '));
    }
    return null;
  }

  static byte[] Body(HttpListenerRequest q) {
    using (var ms = new MemoryStream()) { q.InputStream.CopyTo(ms); return ms.ToArray(); }
  }

  /**
   * A web page in a browser (http or https). NetEase's page, where the plugin runs, is orpheus:// (or "null"), and it
   * is the only kind let into /api/.
   */
  static bool FromWebPage(string origin) {
    return origin.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || origin.StartsWith("https://", StringComparison.OrdinalIgnoreCase);
  }

  /** This server's own page (the OBS page, by either name it may be opened with). */
  static bool OwnPage(string origin) {
    return origin == "http://127.0.0.1:" + port || origin == "http://localhost:" + port;
  }

  static void Handle(HttpListenerContext ctx) {
    var q = ctx.Request;
    var r = ctx.Response;
    var path = q.Url.AbsolutePath;
    // (A request without an Origin is not a web page's: the OBS page's own GETs, curl, the plugin's checks.)
    var origin = q.Headers["Origin"];

    // The plugin, from NetEase's page (another origin): what the server is, and with the key how it stands and the
    // writes. Web pages in a browser get nothing, not even a CORS answer.
    if (path.StartsWith("/api/")) {
      if (origin != null && FromWebPage(origin)) { Text(r, 403, "forbidden"); return; }
      if (origin != null) {
        r.Headers["Access-Control-Allow-Origin"] = origin;
        r.Headers["Access-Control-Allow-Headers"] = "content-type, x-bmv-key";
        r.Headers["Access-Control-Allow-Methods"] = "GET, POST";
        r.Headers["Access-Control-Allow-Private-Network"] = "true";
      }
      if (q.HttpMethod == "OPTIONS") { r.StatusCode = 204; r.Close(); return; }
      if (path == "/api/status") { Json(r, Status(key.Length > 0 && q.Headers["x-bmv-key"] == key)); return; }
      if (q.HttpMethod != "POST" || key.Length == 0 || q.Headers["x-bmv-key"] != key) { Text(r, 403, "forbidden"); return; }
      if (path == "/api/state") {
        var s = Encoding.UTF8.GetString(Body(q)).Replace("\r", "").Replace("\n", " ");
        lock (gate) state = s;
        Broadcast("event: state\ndata: " + s + "\n\n");
        Json(r, "{}");
        return;
      }
      if (path.StartsWith("/api/song/")) {
        var name = path.Substring("/api/song/".Length);
        var body = Body(q);
        lock (gate) {
          songs[name] = body;
          songOrder.Remove(name);
          songOrder.Add(name);
          while (songOrder.Count > KeepSongs) { songs.Remove(songOrder[0]); songOrder.RemoveAt(0); }
        }
        Json(r, "{\"bytes\":" + body.Length + "}");
        return;
      }
      if (path == "/api/quit") { Json(r, "{}"); Environment.Exit(0); }
      Text(r, 404, "not found");
      return;
    }

    // The OBS page: its push channel, what it says about itself, the songs. Only from itself: another page could
    // otherwise pose as a shown OBS page (and rest the MV page) or fill the log.
    if (origin != null && !OwnPage(origin) && (path == "/events" || path == "/log" || path == "/presence" || path.StartsWith("/song/"))) {
      Text(r, 403, "forbidden");
      return;
    }
    if (path == "/events") {
      var page = new Page { Id = Arg(q, "id") ?? "", Obs = Arg(q, "obs") == "1", Visible = Arg(q, "visible") != "0", Response = r };
      r.ContentType = "text/event-stream; charset=utf-8";
      r.Headers["Cache-Control"] = "no-store";
      r.SendChunked = true;
      string s;
      lock (gate) { s = state; }
      var hello = Encoding.UTF8.GetBytes("retry: 1000\n\n" + (s != null ? "event: state\ndata: " + s + "\n\n" : ""));
      r.OutputStream.Write(hello, 0, hello.Length);
      r.OutputStream.Flush();
      // (Counted once the first write went through; kept open, written by Broadcast.)
      lock (gate) {
        pages.RemoveAll(p => p.Id.Length > 0 && p.Id == page.Id);
        pages.Add(page);
      }
      return;
    }
    if (path == "/log") {
      var msg = Arg(q, "msg") ?? "";
      if (msg.Length > 300) msg = msg.Substring(0, 300);
      lock (gate) {
        log.Add(DateTime.Now.ToString("HH:mm:ss") + (Arg(q, "obs") == "1" ? " OBS " : " ") + msg);
        while (log.Count > KeepLog) log.RemoveAt(0);
      }
      Text(r, 200, "");
      return;
    }
    if (path == "/presence") {
      var id = Arg(q, "id") ?? "";
      lock (gate) { foreach (var p in pages) if (p.Id == id) p.Visible = Arg(q, "visible") != "0"; }
      Text(r, 200, "");
      return;
    }
    if (path.StartsWith("/song/")) {
      byte[] b;
      lock (gate) songs.TryGetValue(path.Substring("/song/".Length), out b);
      if (b == null) { Text(r, 404, "not found"); return; }
      Send(r, 200, "application/octet-stream", b);
      return;
    }

    // The page and its files: obs\ and fonts\ in the plugin's folder, nothing outside them.
    string dir, file;
    if (path == "/" || path == "/index.html") { dir = "obs"; file = "index.html"; }
    else if (path == "/obs.js") { dir = "obs"; file = "obs.js"; }
    else if (path.StartsWith("/fonts/")) { dir = "fonts"; file = Uri.UnescapeDataString(path.Substring("/fonts/".Length)); }
    else { Text(r, 404, "not found"); return; }
    string full;
    try {
      // (Within that folder, the separator included: a sibling sharing the name's start, fonts-x, is outside it.)
      var within = Path.GetFullPath(Path.Combine(root, dir)) + Path.DirectorySeparatorChar;
      full = Path.GetFullPath(Path.Combine(within, file));
      if (!full.StartsWith(within, StringComparison.OrdinalIgnoreCase)) full = null;
    } catch { full = null; } // a name Windows refuses
    if (full == null || !File.Exists(full)) { Text(r, 404, "not found"); return; }
    var ext = Path.GetExtension(full).ToLowerInvariant();
    var type = ext == ".html" ? "text/html; charset=utf-8" : ext == ".js" ? "text/javascript; charset=utf-8"
      : ext == ".woff2" ? "font/woff2" : ext == ".ttf" ? "font/ttf" : "application/octet-stream";
    Send(r, 200, type, File.ReadAllBytes(full));
  }
}
