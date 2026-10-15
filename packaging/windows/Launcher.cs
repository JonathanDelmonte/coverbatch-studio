using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle(Product.Name)]
[assembly: AssemblyProduct(Product.Name)]
[assembly: AssemblyCompany(Product.Publisher)]
[assembly: AssemblyCopyright(Product.Publisher)]
[assembly: AssemblyDescription("Carimba capas de jogos com o selo da plataforma e a logo da loja.")]
[assembly: AssemblyVersion(Product.AssemblyVersion)]
[assembly: AssemblyFileVersion(Product.AssemblyVersion)]

// The program's .exe: starts the local engine without a console window, opens the
// interface in its own app window (Edge/Chrome app mode) and keeps one instance.
static class Launcher
{
    static readonly string Root = Install.Normalize(AppDomain.CurrentDomain.BaseDirectory);
    static bool quiet;

    static string AddressFile { get { return Path.Combine(Install.StateFolder, "endereco.txt"); } }

    [STAThread]
    static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Options options = new Options(args);
        quiet = options.Has("/teste") || options.Has("/silencioso");
        if (options.Has("/desinstalar")) return Uninstaller.Run(Root, options);
        Directory.CreateDirectory(Install.StateFolder);
        bool owner;
        using (Mutex mutex = new Mutex(true, Install.RunningMutex, out owner))
        {
            if (!owner) return OpenRunning(options.Has("/teste"));
            try { return Run(options.Has("/teste")); }
            finally { mutex.ReleaseMutex(); }
        }
    }

    static int Run(bool test)
    {
        string node = Path.Combine(Root, "runtime", "node.exe");
        string script = Path.Combine(Root, "app", "scripts", "launcher.js");
        if (!File.Exists(node) || !File.Exists(script))
            return Fail("Arquivos do programa estão faltando nesta pasta. Instale o " + Product.Name + " novamente.");

        ProcessStartInfo start = new ProcessStartInfo(node, Quote(script) + " --no-browser");
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.WorkingDirectory = Root;
        start.RedirectStandardInput = true; // closing it (or this process dying) stops the engine
        start.RedirectStandardOutput = true;
        start.RedirectStandardError = true;
        start.StandardOutputEncoding = Encoding.UTF8;
        start.StandardErrorEncoding = Encoding.UTF8;
        start.EnvironmentVariables["COVERBATCH_PORTABLE_ROOT"] = Root + "\\";
        start.EnvironmentVariables["COVERBATCH_LIFETIME"] = "window";
        start.EnvironmentVariables["NODE_OPTIONS"] = "";
        if (test) start.EnvironmentVariables["COVERBATCH_FIRST_WINDOW_SECONDS"] = "600";

        StringBuilder log = new StringBuilder();
        string url = null;
        ManualResetEvent ready = new ManualResetEvent(false);
        Process server;
        try { server = Process.Start(start); }
        catch (Exception e) { return Fail("Não foi possível iniciar o programa: " + e.Message); }

        DataReceivedEventHandler read = delegate(object sender, DataReceivedEventArgs e)
        {
            if (e.Data == null) return;
            lock (log) log.AppendLine(e.Data);
            Match match = Regex.Match(e.Data, @"http://127\.0\.0\.1:\d+");
            if (match.Success && url == null) { url = match.Value; ready.Set(); }
        };
        server.OutputDataReceived += read;
        server.ErrorDataReceived += read;
        server.BeginOutputReadLine();
        server.BeginErrorReadLine();

        Splash splash = test ? null : new Splash();
        Thread waiter = new Thread(delegate()
        {
            Stopwatch clock = Stopwatch.StartNew();
            while (!ready.WaitOne(100) && !server.HasExited && clock.Elapsed.TotalSeconds < 60) { }
            if (splash != null) splash.Finish();
        });
        waiter.IsBackground = true;
        waiter.Start();
        if (splash != null) Application.Run(splash);
        waiter.Join();

        if (url == null)
        {
            try { if (!server.HasExited) server.Kill(); } catch { }
            SaveLog(log);
            return Fail("O programa não conseguiu abrir.\n\n" + Tail(log, 12));
        }
        File.WriteAllText(AddressFile, url);
        if (!test) OpenWindow(url);
        server.WaitForExit();
        SaveLog(log);
        try { File.Delete(AddressFile); } catch { }
        return server.ExitCode == 0 ? 0 : Fail("O programa foi encerrado por um erro.\n\n" + Tail(log, 12));
    }

    // Another launcher owns the engine: just open one more window on it.
    static int OpenRunning(bool test)
    {
        Stopwatch clock = Stopwatch.StartNew();
        while (clock.Elapsed.TotalSeconds < 30)
        {
            try
            {
                string url = File.ReadAllText(AddressFile).Trim();
                if (url.StartsWith("http://127.0.0.1:")) { if (!test) OpenWindow(url); return 0; }
            }
            catch { }
            Thread.Sleep(200);
        }
        return Fail("O " + Product.Name + " ainda está abrindo. Aguarde alguns segundos e tente de novo.");
    }

    static void OpenWindow(string url)
    {
        string browser = FindBrowser();
        if (browser != null)
        {
            // A dedicated profile gives the app its own window and taskbar entry.
            string profile = Path.Combine(Install.StateFolder, "janela");
            ProcessStartInfo start = new ProcessStartInfo(browser, "--app=" + url + " --user-data-dir=" + Quote(profile)
                + " --no-first-run --no-default-browser-check --disable-extensions --disable-sync --window-size=1400,920");
            start.UseShellExecute = false;
            try { Process.Start(start); return; } catch { }
        }
        try { Process.Start(url); }
        catch { Fail("Abra este endereço no navegador: " + url); }
    }

    static string FindBrowser()
    {
        List<string> candidates = new List<string>();
        foreach (string exe in new[] { "msedge.exe", "chrome.exe" })
        {
            foreach (RegistryKey hive in new[] { Registry.CurrentUser, Registry.LocalMachine })
            {
                using (RegistryKey key = hive.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + exe))
                {
                    string value = key == null ? null : key.GetValue("") as string;
                    if (!string.IsNullOrEmpty(value)) candidates.Add(value.Trim('"'));
                }
            }
            string relative = exe == "msedge.exe" ? @"Microsoft\Edge\Application\msedge.exe" : @"Google\Chrome\Application\chrome.exe";
            candidates.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), relative));
            candidates.Add(Path.Combine(Environment.GetEnvironmentVariable("ProgramW6432") ?? Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), relative));
            candidates.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), relative));
        }
        foreach (string candidate in candidates) if (File.Exists(candidate)) return candidate;
        return null;
    }

    static string Quote(string value) { return "\"" + value + "\""; }

    static string Tail(StringBuilder log, int lines)
    {
        string[] all;
        lock (log) all = log.ToString().Split(new[] { "\r\n", "\n" }, StringSplitOptions.RemoveEmptyEntries);
        int skip = Math.Max(0, all.Length - lines);
        return string.Join("\n", all, skip, all.Length - skip);
    }

    static void SaveLog(StringBuilder log)
    {
        try { lock (log) File.WriteAllText(Path.Combine(Install.StateFolder, "registro.txt"), log.ToString()); } catch { }
    }

    public static int Fail(string message)
    {
        try { File.WriteAllText(Path.Combine(Install.StateFolder, "erro.txt"), message); } catch { }
        if (!quiet) MessageBox.Show(message, Product.Name, MessageBoxButtons.OK, MessageBoxIcon.Warning);
        return 1;
    }
}

// Shown for the second or two the engine takes to start.
class Splash : Form
{
    bool done;

    public Splash()
    {
        SuspendLayout();
        AutoScaleDimensions = new SizeF(96f, 96f);
        AutoScaleMode = AutoScaleMode.Dpi;
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(400, 120);
        BackColor = Color.White;
        Text = Product.Name;
        Font = new Font("Segoe UI", 11f);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        PictureBox picture = new PictureBox();
        picture.Image = Install.Picture();
        picture.SizeMode = PictureBoxSizeMode.Zoom;
        picture.Bounds = new Rectangle(28, 34, 52, 52);
        Label label = new Label();
        label.Text = "Abrindo o " + Product.Name + "…";
        label.AutoSize = false;
        label.TextAlign = ContentAlignment.MiddleLeft;
        label.Bounds = new Rectangle(96, 34, 290, 52);
        Controls.Add(picture);
        Controls.Add(label);
        ResumeLayout(false);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        using (SolidBrush band = new SolidBrush(Color.FromArgb(29, 106, 178))) e.Graphics.FillRectangle(band, 0, 0, ClientSize.Width, 6);
        e.Graphics.DrawRectangle(Pens.Gainsboro, 0, 0, ClientSize.Width - 1, ClientSize.Height - 1);
    }

    public void Finish()
    {
        lock (this)
        {
            done = true;
            if (IsHandleCreated) BeginInvoke(new MethodInvoker(Close));
        }
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        lock (this) { if (done) Close(); }
    }
}

static class Uninstaller
{
    // Only what the installer put here is removed: never anything else in the folder.
    static readonly string[] Folders = { "app", "runtime", "perfil" };
    // LEIA-ME.txt shipped up to 1.1.0; it stays listed so updated installs still uninstall cleanly.
    static readonly string[] Files = { "LEIA-ME.txt", "Como instalar.html", "THIRD-PARTY-NOTICES.txt", "distribuicao.json" };

    public static int Run(string root, Options options)
    {
        bool silent = options.Has("/silencioso");
        bool keepData = options.Has("/manter-dados");
        string exe = Path.Combine(root, Product.Exe);
        if (!File.Exists(Path.Combine(root, "distribuicao.json")) || !File.Exists(exe))
            return Launcher.Fail("Esta pasta não parece uma instalação do " + Product.Name + ". Nada foi removido.");
        if (!silent)
        {
            if (MessageBox.Show("Remover o " + Product.Name + " deste computador?", Product.Name, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return 1;
            keepData = MessageBox.Show("Guardar os lotes e o kit da loja para uma próxima instalação?\n\nSim: a pasta dados-locais continua no computador.\nNão: tudo é apagado.",
                Product.Name, MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes;
        }
        while (Install.IsRunning())
        {
            if (silent) return 2;
            if (MessageBox.Show("Feche a janela do " + Product.Name + " antes de remover.", Product.Name, MessageBoxButtons.RetryCancel, MessageBoxIcon.Information) != DialogResult.Retry) return 1;
        }
        Install.RemoveShortcut(Install.DesktopShortcut, exe);
        Install.RemoveShortcut(Install.MenuShortcut, exe);
        Install.Unregister(root);
        foreach (string folder in Folders) TryDelete(Path.Combine(root, folder));
        if (!keepData) TryDelete(Path.Combine(root, "dados-locais"));
        foreach (string file in Files) { try { File.Delete(Path.Combine(root, file)); } catch { } }
        TryDelete(Install.StateFolder);
        // A running .exe cannot delete itself: a hidden command does it a moment later.
        ProcessStartInfo cleanup = new ProcessStartInfo("cmd.exe", "/d /c ping 127.0.0.1 -n 3 > nul & del /f /q \"" + exe + "\" & rmdir \"" + root + "\"");
        cleanup.CreateNoWindow = true;
        cleanup.UseShellExecute = false;
        try { Process.Start(cleanup); } catch { }
        if (!silent)
            MessageBox.Show(Product.Name + " foi removido." + (keepData ? "\n\nSeus lotes e o kit da loja continuam em:\n" + Path.Combine(root, "dados-locais") : ""),
                Product.Name, MessageBoxButtons.OK, MessageBoxIcon.Information);
        return 0;
    }

    static void TryDelete(string folder)
    {
        try { if (Directory.Exists(folder)) Directory.Delete(folder, true); } catch { }
    }
}
