// BetterMV Encode: the video encoder behind "下载 MV" (docs/EXPORT.md). The page the plugin runs in (NetEase's Chromium
// 91) can only encode video through MediaRecorder, which gets Windows' software H.264 encoder set up for a 30-frame-a-
// second stream (Baseline, no CABAC, a fixed share of the rate per frame). So the plugin starts this program for each
// export and sends it the MV's frames, already rendered; it hands them to Media Foundation's sink writer, which uses the
// graphics card's H.264 encoder when there is one (else Windows' own, as High profile with B frames) and writes the MP4,
// the song's audio encoded as AAC beside them. Windows 10/11 have all of it: no ffmpeg, no codec pack.
//
//   POST /api/begin   {path, width, height, fps, bitrate, audioRate, audioChannels, audioKbps, hardware}  -> {encoder}
//   POST /api/audio   the song's audio, 16-bit little-endian PCM, interleaved (an empty body: no sound)
//   POST /api/frame   frames N, N+1, ... (header x-bmv-i, or ?i=N: the first) as NV12 (width x height x 3/2 bytes each, rows top
//                     to bottom), one or several to a request; requests in any order, a few at a time
//   POST /api/finish  (header x-bmv-frames, or ?frames=N) waits until the file is written                         -> {bytes, frames, seconds, encoder}
//   POST /api/cancel  stops and deletes the file;  POST /api/quit  ends the program;  GET /api/status
// Everything but GET /api/status needs the key (--key), and web pages (http/https origins) get nothing: only NetEase's
// own page (orpheus://) may use it. It ends itself when NetEase closes.
//
// Built with the C# compiler of .NET Framework 4.x, which every Windows 10/11 has (C# 5: no string interpolation, no ?.):
//   %WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe -nologo -optimize -platform:x64 -target:winexe -r:System.Web.Extensions.dll
//   -out:bettermv-encode.exe BetterMVEncode.cs     (scripts/build-encode.ps1)
// Run: bettermv-encode.exe --port 32110 --key <secret> --version <plugin version> [--watch cloudmusic] [--dev-origin <origin>]
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

[assembly: AssemblyTitle("BetterMV Encode")]
[assembly: AssemblyDescription("BetterMV 的视频编码：把 MV 的画面交给 Windows 的 H.264 编码器，写成 MP4")]
[assembly: AssemblyProduct("BetterMV")]

// ---- Media Foundation (the few interfaces the sink writer needs, declared by hand: no SDK, no interop assembly) ----
// (Each interface that derives from IMFAttributes repeats its 30 methods: the managed side lays a COM vtable out from the
// methods an interface declares, not from the ones it inherits; the ones not called are placeholders.)
[ComImport, Guid("2cd2d921-c447-44a7-a13c-4adabfc247e3"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMFAttributes {
  void m0(); void m1(); void m2(); void m3(); void m4(); void m5(); void m6(); void m7(); void m8(); void m9();
  void m10(); void m11(); void m12(); void m13(); void m14(); void m15(); void m16(); void m17();
  [PreserveSig] int SetUINT32(ref Guid key, uint value);
  [PreserveSig] int SetUINT64(ref Guid key, ulong value);
  void m20();
  [PreserveSig] int SetGUID(ref Guid key, ref Guid value);
  void m22(); void m23(); void m24(); void m25(); void m26(); void m27(); void m28(); void m29();
}

[ComImport, Guid("44ae0fa8-ea31-4109-8d2e-4cae4997c555"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMFMediaType {
  void m0(); void m1(); void m2(); void m3(); void m4(); void m5(); void m6(); void m7(); void m8(); void m9();
  void m10(); void m11(); void m12(); void m13(); void m14(); void m15(); void m16(); void m17();
  [PreserveSig] int SetUINT32(ref Guid key, uint value);
  [PreserveSig] int SetUINT64(ref Guid key, ulong value);
  void m20();
  [PreserveSig] int SetGUID(ref Guid key, ref Guid value);
  void m22(); void m23(); void m24(); void m25(); void m26(); void m27(); void m28(); void m29();
  void GetMajorType(); void IsCompressedFormat(); void IsEqual(); void GetRepresentation(); void FreeRepresentation();
}

[ComImport, Guid("045FA593-8799-42b8-BC8D-8968C6453507"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMFMediaBuffer {
  [PreserveSig] int Lock(out IntPtr buffer, out int max, out int current);
  [PreserveSig] int Unlock();
  [PreserveSig] int GetCurrentLength(out int length);
  [PreserveSig] int SetCurrentLength(int length);
  [PreserveSig] int GetMaxLength(out int length);
}

[ComImport, Guid("c40a00f2-b93a-4d80-ae8c-5a1c634f58e4"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMFSample {
  void m0(); void m1(); void m2(); void m3(); void m4(); void m5(); void m6(); void m7(); void m8(); void m9();
  void m10(); void m11(); void m12(); void m13(); void m14(); void m15(); void m16(); void m17(); void m18(); void m19();
  void m20(); void m21(); void m22(); void m23(); void m24(); void m25(); void m26(); void m27(); void m28(); void m29();
  void GetSampleFlags(); void SetSampleFlags();
  void GetSampleTime();
  [PreserveSig] int SetSampleTime(long time);
  void GetSampleDuration();
  [PreserveSig] int SetSampleDuration(long duration);
  void GetBufferCount(); void GetBufferByIndex(); void ConvertToContiguousBuffer();
  [PreserveSig] int AddBuffer(IMFMediaBuffer buffer);
  void RemoveBufferByIndex(); void RemoveAllBuffers(); void GetTotalLength(); void CopyToBuffer();
}

[ComImport, Guid("3137f1cd-fe5e-4805-a5d8-fb477448cb3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMFSinkWriter {
  [PreserveSig] int AddStream(IMFMediaType type, out int index);
  [PreserveSig] int SetInputMediaType(int index, IMFMediaType type, IntPtr encoderParameters);
  [PreserveSig] int BeginWriting();
  [PreserveSig] int WriteSample(int index, IMFSample sample);
  void SendStreamTick(); void PlaceMarker(); void NotifyEndOfSegment(); void Flush();
  [PreserveSig] int DoFinalize();
  void GetServiceForStream(); void GetStatistics();
}

/** One MP4 being written: the sink writer with a video stream (H.264, NV12 in) and, if there is sound, an AAC one. */
class Mf {
  [DllImport("mfplat.dll")] static extern int MFStartup(uint version, uint flags);
  [DllImport("mfplat.dll")] static extern int MFCreateMediaType(out IMFMediaType type);
  [DllImport("mfplat.dll")] static extern int MFCreateAttributes(out IMFAttributes attributes, uint size);
  [DllImport("mfplat.dll")] static extern int MFCreateSample(out IMFSample sample);
  [DllImport("mfplat.dll")] static extern int MFCreateMemoryBuffer(int max, out IMFMediaBuffer buffer);
  [DllImport("mfreadwrite.dll", CharSet = CharSet.Unicode)] static extern int MFCreateSinkWriterFromURL(string url, IntPtr stream, IMFAttributes attributes, out IMFSinkWriter writer);

  static Guid G(string s) { return new Guid(s); }
  static Guid MAJOR = G("48eba18e-f8c9-4687-bf11-0a74c9f96a8f"), SUBTYPE = G("f7e34c9a-42e8-4714-b74b-cb29d72c35e5"),
    BITRATE = G("20332624-fb0d-4d9e-bd0d-cbf6786c102e"), INTERLACE = G("e2724bb8-e676-4806-b4b2-a8d6efb44ccd"),
    FRAME_SIZE = G("1652c33d-d6b2-4012-b834-72030849a37d"), FRAME_RATE = G("c459a2e8-3d2c-4e44-b132-fee5156c7bb0"),
    PIXEL_ASPECT = G("c6376a1e-8d0a-4027-be45-6d9a0ad39bb6"), PROFILE = G("ad76a80b-2d5c-4e0b-b375-64e520137036"),
    YUV_MATRIX = G("3e23d450-2c75-4d25-a00e-b91670d12327"), PRIMARIES = G("dbfbe4d7-0740-4ee0-8192-850ab0e21935"),
    TRANSFER = G("5fb0fce9-be5c-4935-a811-ec838f8eed93"), RANGE = G("c21b8ee5-b956-4071-8daf-325edf5cab11"),
    CHANNELS = G("37e48bf5-645e-4c5b-89de-ada9e29b696a"), SAMPLE_RATE = G("5faeeae7-0290-4c31-9e8a-c534f68d9dba"),
    BITS = G("f2deb57f-40fa-4764-aa33-ed4f2d1ff669"), BYTES_PER_SECOND = G("1aab75c8-cfef-451c-ab95-ac034b8e1731"),
    BLOCK_ALIGN = G("322de230-9eeb-43bd-ab7a-ff412251541d"), AAC_PAYLOAD = G("bfbabe79-7434-4d1c-94f0-72a3b9e17188"),
    AAC_LEVEL = G("7632f0e6-9538-4d61-acda-ea29c8c14456"), KEYFRAME_SPACING = G("c16eb52b-73a1-476f-8d62-839d6a020652"),
    HARDWARE = G("a634a91c-822b-41b9-a494-4de4643612b0"), NO_THROTTLE = G("08b845d8-2b74-4afe-9d53-be16d2d5ae4f"),
    MOOV_FIRST = G("f672e3ac-e1e6-4f10-b5ec-5f3b30b4ee68"),
    VIDEO = G("73646976-0000-0010-8000-00AA00389B71"), AUDIO = G("73647561-0000-0010-8000-00AA00389B71"),
    H264 = G("34363248-0000-0010-8000-00AA00389B71"), NV12 = G("3231564E-0000-0010-8000-00AA00389B71"),
    AAC = G("00001610-0000-0010-8000-00AA00389B71"), PCM = G("00000001-0000-0010-8000-00AA00389B71");

  static bool started;
  static void Check(int hr, string what) { if (hr < 0) throw new Exception(what + "（0x" + hr.ToString("X8") + "）"); }
  static void Set(IMFMediaType t, Guid key, uint v) { Check(t.SetUINT32(ref key, v), "SetUINT32"); }
  static void Set64(IMFMediaType t, Guid key, ulong v) { Check(t.SetUINT64(ref key, v), "SetUINT64"); }
  static void SetId(IMFMediaType t, Guid key, Guid v) { Check(t.SetGUID(ref key, ref v), "SetGUID"); }
  static ulong Pack(uint hi, uint lo) { return ((ulong)hi << 32) | lo; }

  /** 100-ns units: the start of frame (or sample) i of `perSecond`. */
  public static long At(long i, long perSecond) { return i * 10000000L / perSecond; }

  readonly IMFSinkWriter writer;
  readonly int videoStream, audioStream = -1, fps, channels, rate;
  /** Samples of sound written (per channel). */
  public long Sent;
  int frames;

  public Mf(string path, int width, int height, int fps, int bitrate, bool hardware, int rate, int channels, int aacKbps, bool moovFirst) {
    lock (typeof(Mf)) { if (!started) { Check(MFStartup(0x00020070, 0), "MFStartup"); started = true; } }
    this.fps = fps; this.rate = rate; this.channels = channels;
    IMFAttributes attrs;
    Check(MFCreateAttributes(out attrs, 4), "MFCreateAttributes");
    if (hardware) attrs.SetUINT32(ref HARDWARE, 1);
    attrs.SetUINT32(ref NO_THROTTLE, 1);
    if (moovFirst) attrs.SetUINT32(ref MOOV_FIRST, 1);
    Check(MFCreateSinkWriterFromURL(path, IntPtr.Zero, attrs, out writer), "MFCreateSinkWriterFromURL");
    Check(writer.AddStream(VideoType(H264, width, height, fps, bitrate, true), out videoStream), "AddStream（视频）");
    Check(writer.SetInputMediaType(videoStream, VideoType(NV12, width, height, fps, 0, false), IntPtr.Zero), "SetInputMediaType（视频）");
    if (rate > 0) {
      IMFMediaType o, i;
      Check(MFCreateMediaType(out o), "MFCreateMediaType");
      SetId(o, MAJOR, AUDIO); SetId(o, SUBTYPE, AAC); Set(o, BITS, 16); Set(o, SAMPLE_RATE, (uint)rate); Set(o, CHANNELS, (uint)channels);
      Set(o, BYTES_PER_SECOND, (uint)(aacKbps * 125)); Set(o, AAC_PAYLOAD, 0); Set(o, AAC_LEVEL, 0x29);
      Check(writer.AddStream(o, out audioStream), "AddStream（音频）");
      Check(MFCreateMediaType(out i), "MFCreateMediaType");
      SetId(i, MAJOR, AUDIO); SetId(i, SUBTYPE, PCM); Set(i, BITS, 16); Set(i, SAMPLE_RATE, (uint)rate); Set(i, CHANNELS, (uint)channels);
      Set(i, BYTES_PER_SECOND, (uint)(rate * channels * 2)); Set(i, BLOCK_ALIGN, (uint)(channels * 2));
      Check(writer.SetInputMediaType(audioStream, i, IntPtr.Zero), "SetInputMediaType（音频）");
    }
    Check(writer.BeginWriting(), "BeginWriting");
  }

  /** H.264 (High, BT.709, limited range, a key frame every 2 s) when it is the output, NV12 when it is the input. */
  static IMFMediaType VideoType(Guid subtype, int width, int height, int fps, int bitrate, bool output) {
    IMFMediaType t;
    Check(MFCreateMediaType(out t), "MFCreateMediaType");
    SetId(t, MAJOR, VIDEO); SetId(t, SUBTYPE, subtype);
    if (output) { Set(t, BITRATE, (uint)bitrate); Set(t, PROFILE, 100); Set(t, KEYFRAME_SPACING, (uint)(fps * 2)); }
    Set(t, INTERLACE, 2);
    Set64(t, FRAME_SIZE, Pack((uint)width, (uint)height)); Set64(t, FRAME_RATE, Pack((uint)fps, 1)); Set64(t, PIXEL_ASPECT, Pack(1, 1));
    Set(t, YUV_MATRIX, 1); Set(t, PRIMARIES, 2); Set(t, TRANSFER, 5); Set(t, RANGE, 2);
    return t;
  }

  static IMFSample Sample(byte[] data, int offset, int length, long time, long duration) {
    IMFMediaBuffer b;
    Check(MFCreateMemoryBuffer(length, out b), "MFCreateMemoryBuffer");
    IntPtr p; int max, current;
    Check(b.Lock(out p, out max, out current), "Lock");
    Marshal.Copy(data, offset, p, length);
    b.Unlock();
    b.SetCurrentLength(length);
    IMFSample s;
    Check(MFCreateSample(out s), "MFCreateSample");
    s.AddBuffer(b);
    s.SetSampleTime(time);
    s.SetSampleDuration(duration);
    Marshal.ReleaseComObject(b);
    return s;
  }

  public void Video(byte[] nv12, int length) {
    IMFSample s = Sample(nv12, 0, length, At(frames, fps), At(frames + 1, fps) - At(frames, fps));
    try { Check(writer.WriteSample(videoStream, s), "写入第 " + frames + " 帧"); } finally { Marshal.ReleaseComObject(s); }
    frames++;
  }

  /** The sound up to `samples` (per channel) of `pcm` written, in pieces of at least `piece` unless `all`. */
  public void Audio(byte[] pcm, long samples, int piece, bool all) {
    if (audioStream < 0) return;
    long total = pcm.Length / (2 * channels);
    if (samples > total) samples = total;
    while (Sent < samples) {
      long n = Math.Min(samples - Sent, 16384);
      if (n < piece && !all) return;
      IMFSample s = Sample(pcm, (int)(Sent * channels * 2), (int)(n * channels * 2), At(Sent, rate), At(Sent + n, rate) - At(Sent, rate));
      try { Check(writer.WriteSample(audioStream, s), "写入音频"); } finally { Marshal.ReleaseComObject(s); }
      Sent += n;
    }
  }

  public void Finish() { Check(writer.DoFinalize(), "写入文件"); Marshal.ReleaseComObject(writer); }
  /**
   * Gives the writer up: finished first (what it has written is closed properly: a writer only released kept the file
   * open, so that it could not be deleted), then let go of.
   */
  public void Abort() {
    try { writer.DoFinalize(); } catch { }
    try { while (Marshal.ReleaseComObject(writer) > 0) { } } catch { }
  }
}

static class BetterMVEncode {
  const string App = "BetterMV Encode";
  /** Frames the writer may be behind the newest one it was given (the senders wait beyond that). */
  const int Window = 16;
  /** A job that hears nothing for this long (the page went away) is dropped. */
  const int IdleSeconds = 60;

  static int port = 32110;
  static string key = "", version = "", watch = "cloudmusic", devOrigin = "";

  class Job {
    public string Path, Encoder = "";
    public int Width, Height, Fps, Bitrate, Rate, Channels, AacKbps, FrameBytes;
    public bool Hardware;
    public byte[] Audio;
    public bool AudioReady;
    public readonly Dictionary<int, byte[]> Pending = new Dictionary<int, byte[]>();
    /** The next frame to write; Total (once known): the frames there are. */
    public int Next, Total = -1;
    public bool Finishing, Done, Cancelled;
    public string Error;
    public long Bytes;
    public double Seconds;
    public DateTime Seen = DateTime.UtcNow;
    /** Set once the writer thread is done, its unfinished file deleted. */
    public readonly ManualResetEvent Ended = new ManualResetEvent(false);
  }

  static readonly object gate = new object();
  static Job job;
  static readonly ConcurrentBag<byte[]> pool = new ConcurrentBag<byte[]>();
  static readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 1 << 20 };

  static int Main(string[] args) {
    for (int i = 0; i + 1 < args.Length; i += 2) {
      switch (args[i]) {
        case "--port": port = int.Parse(args[i + 1]); break;
        case "--key": key = args[i + 1]; break;
        case "--version": version = args[i + 1]; break;
        case "--watch": watch = args[i + 1]; break;
        case "--dev-origin": devOrigin = args[i + 1]; break; // a page of a dev server may use it too (tools/export-test.ts)
      }
    }
    var listener = new HttpListener();
    listener.Prefixes.Add("http://127.0.0.1:" + port + "/");
    listener.Prefixes.Add("http://localhost:" + port + "/");
    try { listener.Start(); } catch { return 2; } // the port is taken
    new Thread(Watch) { IsBackground = true }.Start();
    while (true) {
      HttpListenerContext ctx;
      try { ctx = listener.GetContext(); } catch { return 1; }
      ThreadPool.QueueUserWorkItem(_ => {
        try { Handle(ctx); } catch (Exception e) { Log("请求出错 " + ctx.Request.Url.AbsolutePath + "：" + e); try { Text(ctx.Response, 500, e.Message); } catch { try { ctx.Response.Abort(); } catch { } } }
      });
    }
  }

  /** What went wrong, for finding out why: a line in bettermv-encode.log in the temp folder (the program has no window). */
  static void Log(string line) {
    try { File.AppendAllText(Path.Combine(Path.GetTempPath(), "bettermv-encode.log"), DateTime.Now.ToString("HH:mm:ss.fff ") + line + Environment.NewLine, Encoding.UTF8); } catch { }
  }

  /** Ends with NetEase: once no process of that name has been seen for two checks in a row. */
  static void Watch() {
    if (string.IsNullOrEmpty(watch)) return;
    int missing = 0;
    while (true) {
      Thread.Sleep(2000);
      missing = Process.GetProcessesByName(watch).Length == 0 ? missing + 1 : 0;
      if (missing >= 2) { Stop(); Environment.Exit(0); }
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
  static void Json(HttpListenerResponse r, object value) { Send(r, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json.Serialize(value))); }

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

  static byte[] Read(HttpListenerRequest q, byte[] into, int length) {
    var s = q.InputStream;
    int got = 0, n;
    while (got < length && (n = s.Read(into, got, length - got)) > 0) got += n;
    if (got != length) throw new Exception("请求内容不完整（" + got + " / " + length + "）");
    return into;
  }

  static Dictionary<string, object> Status(bool full) {
    var d = new Dictionary<string, object> { { "app", App }, { "version", version }, { "port", port } };
    if (!full) return d;
    lock (gate) {
      if (job == null) { d["state"] = "idle"; return d; }
      d["state"] = job.Error != null ? "error" : job.Done ? "done" : job.Finishing ? "finishing" : job.Cancelled ? "cancelled" : "encoding";
      d["frames"] = job.Next; d["pending"] = job.Pending.Count; d["encoder"] = job.Encoder;
      if (job.Error != null) d["error"] = job.Error;
    }
    return d;
  }

  static void Handle(HttpListenerContext ctx) {
    var q = ctx.Request;
    var r = ctx.Response;
    var path = q.Url.AbsolutePath;
    var origin = q.Headers["Origin"];
    var web = origin != null && origin != devOrigin && (origin.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || origin.StartsWith("https://", StringComparison.OrdinalIgnoreCase));
    if (!path.StartsWith("/api/") || web) {
      Text(r, 403, "forbidden");
      return;
    }
    if (origin != null) {
      r.Headers["Access-Control-Allow-Origin"] = origin;
      r.Headers["Access-Control-Allow-Headers"] = "content-type, x-bmv-key, x-bmv-i, x-bmv-frames";
      r.Headers["Access-Control-Max-Age"] = "7200"; // (one preflight, not one per frame)
      r.Headers["Access-Control-Allow-Methods"] = "GET, POST";
      r.Headers["Access-Control-Allow-Private-Network"] = "true";
    }
    if (q.HttpMethod == "OPTIONS") { r.StatusCode = 204; r.Close(); return; }
    var keyed = key.Length > 0 && q.Headers["x-bmv-key"] == key;
    if (path == "/api/status") { Json(r, Status(keyed)); return; }
    if (q.HttpMethod != "POST" || !keyed) { Text(r, 403, "forbidden"); return; }

    switch (path) {
      case "/api/begin": Begin(q, r); return;
      case "/api/audio": Audio(q, r); return;
      case "/api/frame": Frame(q, r); return;
      case "/api/finish": Finish(q, r); return;
      case "/api/cancel": Cancel(); Json(r, new Dictionary<string, object>()); return;
      case "/api/quit": Stop(); Json(r, new Dictionary<string, object>()); Environment.Exit(0); return;
    }
    Text(r, 404, "not found");
  }

  static int Int(Dictionary<string, object> d, string name) { return Convert.ToInt32(d[name]); }

  static void Begin(HttpListenerRequest q, HttpListenerResponse r) {
    byte[] raw;
    using (var ms = new MemoryStream()) { q.InputStream.CopyTo(ms); raw = ms.ToArray(); }
    var d = json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(raw));
    var j = new Job {
      Path = Convert.ToString(d["path"]), Width = Int(d, "width"), Height = Int(d, "height"), Fps = Int(d, "fps"), Bitrate = Int(d, "bitrate"),
      Rate = Int(d, "audioRate"), Channels = Int(d, "audioChannels"), AacKbps = Int(d, "audioKbps"), Hardware = Convert.ToBoolean(d["hardware"]),
    };
    if (j.Width < 64 || j.Height < 64 || j.Width % 2 != 0 || j.Height % 2 != 0 || j.Fps < 1 || j.Fps > 240 || j.Bitrate < 100000 || j.Channels < 1 || j.Channels > 2) { Text(r, 400, "bad arguments"); return; }
    j.FrameBytes = j.Width * j.Height * 3 / 2;
    Cancel();
    lock (gate) job = j;
    var ready = new ManualResetEvent(false);
    var thread = new Thread(() => Run(j, ready)) { IsBackground = true };
    thread.SetApartmentState(ApartmentState.MTA);
    thread.Start();
    ready.WaitOne();
    if (j.Error != null) { Text(r, 500, j.Error); return; }
    Json(r, new Dictionary<string, object> { { "encoder", j.Encoder } });
  }

  static void Audio(HttpListenerRequest q, HttpListenerResponse r) {
    var j = Current(r);
    if (j == null) return;
    var length = (int)q.ContentLength64;
    var pcm = new byte[Math.Max(0, length)];
    if (length > 0) Read(q, pcm, length);
    lock (gate) { j.Audio = pcm; j.AudioReady = true; j.Seen = DateTime.UtcNow; Monitor.PulseAll(gate); }
    Json(r, new Dictionary<string, object>());
  }

  static void Frame(HttpListenerRequest q, HttpListenerResponse r) {
    var j = Current(r);
    if (j == null) return;
    int i = int.Parse(Arg(q, "i") ?? q.Headers["x-bmv-i"] ?? "-1");
    long length = q.ContentLength64;
    if (i < 0 || length < j.FrameBytes || length % j.FrameBytes != 0) { Text(r, 400, "bad frame"); return; }
    int n = (int)(length / j.FrameBytes);
    var bufs = new byte[n][];
    for (int k = 0; k < n; k++) {
      byte[] buf;
      if (!pool.TryTake(out buf) || buf.Length != j.FrameBytes) buf = new byte[j.FrameBytes];
      Read(q, buf, j.FrameBytes);
      bufs[k] = buf;
    }
    string failed = null;
    lock (gate) {
      // (Held here while the writer is far behind: the page's requests in flight then wait, which paces it.)
      while (j.Error == null && !j.Cancelled && i - j.Next >= Window) Monitor.Wait(gate, 500);
      j.Seen = DateTime.UtcNow;
      if (j.Error != null || j.Cancelled) failed = j.Error ?? "cancelled";
      else { for (int k = 0; k < n; k++) j.Pending[i + k] = bufs[k]; Monitor.PulseAll(gate); }
    }
    if (failed != null) { Text(r, 500, failed); return; }
    Json(r, new Dictionary<string, object>());
  }

  static void Finish(HttpListenerRequest q, HttpListenerResponse r) {
    var j = Current(r);
    if (j == null) return;
    string failed = null;
    lock (gate) {
      j.Total = int.Parse(Arg(q, "frames") ?? q.Headers["x-bmv-frames"] ?? "0");
      j.Finishing = true;
      Monitor.PulseAll(gate);
      while (!j.Done && j.Error == null && !j.Cancelled) Monitor.Wait(gate, 500);
      if (j.Error != null || j.Cancelled) failed = j.Error ?? "cancelled";
    }
    if (failed != null) { Text(r, 500, failed); return; }
    Json(r, new Dictionary<string, object> { { "bytes", j.Bytes }, { "frames", j.Total }, { "seconds", j.Seconds }, { "encoder", j.Encoder } });
  }

  static Job Current(HttpListenerResponse r) {
    Job j;
    lock (gate) j = job;
    if (j == null) { Text(r, 409, "no export begun"); return null; }
    if (j.Error != null) { Text(r, 500, j.Error); return null; }
    return j;
  }

  /** Stops the job in hand and waits (a few seconds) for its writer to drop the unfinished file, before the program ends. */
  static void Stop() {
    Job j;
    lock (gate) j = job;
    Cancel();
    if (j != null) j.Ended.WaitOne(20000);
  }

  /** Stops the job in hand: the writer is dropped and the unfinished file deleted. */
  static void Cancel() {
    Job j;
    lock (gate) {
      j = job;
      if (j == null || j.Done) return;
      j.Cancelled = true;
      Monitor.PulseAll(gate);
    }
  }

  // ---- The writer thread: one per export, with every Media Foundation call of it ----
  static void Run(Job j, ManualResetEvent ready) {
    Mf mf = null;
    var began = Stopwatch.StartNew();
    try {
      // (The software probe throws, saying why, when Windows can't encode at all.)
      bool hardware = j.Hardware && Probe(j, true);
      if (!hardware) Probe(j, false);
      mf = new Mf(j.Path, j.Width, j.Height, j.Fps, j.Bitrate, hardware, j.Rate, j.Channels, j.AacKbps, true);
      j.Encoder = hardware ? "hardware" : "software";
    } catch (Exception e) {
      lock (gate) j.Error = e.Message;
      ready.Set();
      j.Ended.Set();
      return;
    }
    ready.Set();
    try {
      // (The sound is sent first: the writer needs it to put each piece beside its frames.)
      lock (gate) while (!j.AudioReady && !j.Cancelled && j.Error == null && Alive(j)) Monitor.Wait(gate, 500);
      began.Restart();
      long dt = 0;
      while (true) {
        byte[] frame = null;
        bool end = false;
        lock (gate) {
          while (true) {
            if (j.Cancelled || j.Error != null) break;
            if (j.Pending.TryGetValue(j.Next, out frame)) { j.Pending.Remove(j.Next); break; }
            if (j.Finishing && j.Total >= 0 && j.Next >= j.Total) { end = true; break; }
            if (!Alive(j)) { j.Error = "页面停止了发送"; break; }
            Monitor.Wait(gate, 500);
          }
          if (j.Cancelled || j.Error != null) break;
        }
        if (end) break;
        mf.Video(frame, j.FrameBytes);
        pool.Add(frame);
        if (j.Audio != null) mf.Audio(j.Audio, Mf.At(j.Next + 1, j.Fps) * j.Rate / 10000000L, 4096, false);
        lock (gate) { j.Next++; Monitor.PulseAll(gate); }
        dt++;
      }
      lock (gate) { if (j.Cancelled || j.Error != null) throw new OperationCanceledException(); }
      if (j.Audio != null) mf.Audio(j.Audio, long.MaxValue, 0, true);
      mf.Finish();
      mf = null;
      var info = new FileInfo(j.Path);
      lock (gate) { j.Bytes = info.Exists ? info.Length : 0; j.Seconds = began.Elapsed.TotalSeconds; j.Done = true; Monitor.PulseAll(gate); }
    } catch (Exception e) {
      if (!(e is OperationCanceledException)) Log("写入出错：" + e);
      lock (gate) { if (j.Error == null && !(e is OperationCanceledException)) j.Error = e.Message; Monitor.PulseAll(gate); }
    } finally {
      bool failed;
      lock (gate) failed = !j.Done;
      if (mf != null) mf.Abort();
      // (The writer lets go of its file a moment after its last reference: tried again for a few seconds.)
      if (failed) for (int k = 0; k < 40; k++) { try { File.Delete(j.Path); break; } catch (Exception de) { if (k == 0 || k == 39) Log("删除没写完的文件失败（第 " + (k + 1) + " 次）：" + de.Message); Thread.Sleep(100); } }
      lock (gate) j.Pending.Clear();
      j.Ended.Set();
    }
  }

  static bool Alive(Job j) { return (DateTime.UtcNow - j.Seen).TotalSeconds < IdleSeconds; }

  /**
   * Whether the sink writer can encode here: a few frames and a moment of silence written to a temporary file with this
   * job's size and rate (a graphics card's encoder can refuse a size, an encoder can be missing, and some only fail at
   * the first frame). With `hardware`, false when only that failed; without, the exception when Windows can't at all.
   */
  static bool Probe(Job j, bool hardware) {
    var path = Path.Combine(Path.GetTempPath(), "bettermv-probe-" + Process.GetCurrentProcess().Id + ".mp4");
    try {
      var mf = new Mf(path, j.Width, j.Height, j.Fps, Math.Min(j.Bitrate, 8000000), hardware, 44100, 2, 128, false);
      var frame = new byte[j.FrameBytes];
      for (int i = 0; i < j.Width * j.Height; i++) frame[i] = 90;
      for (int i = j.Width * j.Height; i < frame.Length; i++) frame[i] = 128;
      for (int i = 0; i < 6; i++) mf.Video(frame, frame.Length);
      mf.Audio(new byte[44100 / 5 * 4], 44100 / 5, 0, true);
      mf.Finish();
      return new FileInfo(path).Length > 1000;
    } catch (Exception e) {
      if (hardware) return false;
      throw new Exception("这台电脑上 Windows 无法编码 H.264 / AAC：" + e.Message);
    } finally {
      try { File.Delete(path); } catch { }
    }
  }
}
