using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Instalar " + Product.Name)]
[assembly: AssemblyProduct(Product.Name)]
[assembly: AssemblyCompany(Product.Publisher)]
[assembly: AssemblyCopyright(Product.Publisher)]
[assembly: AssemblyDescription("Instalador do " + Product.Name)]
[assembly: AssemblyVersion(Product.AssemblyVersion)]
[assembly: AssemblyFileVersion(Product.AssemblyVersion)]

// One file to send to the client: it carries the whole program (payload.zip) and
// installs it for the current user, without administrator rights.
static class SetupProgram
{
    [STAThread]
    static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Options options = new Options(args);
        if (options.Has("/silencioso"))
        {
            // Used by the release checks: no window, shortcuts or registry unless asked.
            string folder = options.Value("/destino") ?? Install.DefaultFolder;
            try
            {
                bool register = options.Has("/registrar");
                Installer.Run(folder, register, register && options.Has("/atalho-area-de-trabalho"), register, null);
                return 0;
            }
            catch (Exception e)
            {
                try { File.WriteAllText(Path.Combine(Path.GetTempPath(), Product.Id + "-instalacao.txt"), e.ToString()); } catch { }
                return 1;
            }
        }
        Application.Run(new SetupForm());
        return 0;
    }
}

static class Installer
{
    static readonly string[] Replaced = { "app", "runtime", "perfil" };

    public static void Run(string folder, bool menuShortcut, bool desktopShortcut, bool register, Action<int> progress)
    {
        folder = Install.Normalize(folder);
        if (Install.IsRunning()) throw new InvalidOperationException("Feche a janela do " + Product.Name + " antes de instalar.");
        Directory.CreateDirectory(folder);
        // Program files are replaced; dados-locais (lotes e kit da loja) is never touched.
        foreach (string name in Replaced)
        {
            string old = Path.Combine(folder, name);
            if (Directory.Exists(old)) Directory.Delete(old, true);
        }
        long bytes = 0;
        string prefix = folder + "\\";
        using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
        using (ZipArchive zip = new ZipArchive(stream, ZipArchiveMode.Read))
        {
            int total = zip.Entries.Count, done = 0;
            foreach (ZipArchiveEntry entry in zip.Entries)
            {
                string target = Path.GetFullPath(Path.Combine(folder, entry.FullName.Replace('/', '\\')));
                if (!target.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Pacote de instalação inválido.");
                if (entry.FullName.EndsWith("/")) Directory.CreateDirectory(target);
                else
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    entry.ExtractToFile(target, true);
                    bytes += entry.Length;
                }
                done++;
                if (progress != null && (done % 25 == 0 || done == total)) progress(done * 100 / total);
            }
        }
        string exe = Path.Combine(folder, Product.Exe);
        if (menuShortcut) Install.CreateShortcut(Install.MenuShortcut, exe, "Carimba capas de jogos com o selo e a logo da loja");
        if (desktopShortcut) Install.CreateShortcut(Install.DesktopShortcut, exe, "Carimba capas de jogos com o selo e a logo da loja");
        if (register) Install.Register(folder, bytes / 1024);
    }
}

class SetupForm : Form
{
    readonly string folder = Install.DefaultFolder;
    readonly Label body = new Label();
    readonly Label detail = new Label();
    readonly CheckBox desktop = new CheckBox();
    readonly ProgressBar bar = new ProgressBar();
    readonly Button primary = new Button();
    readonly Button secondary = new Button();
    bool finished;

    static readonly Color Blue = Color.FromArgb(29, 106, 178);
    static readonly Color Graphite = Color.FromArgb(89, 97, 107);

    public SetupForm()
    {
        SuspendLayout();
        AutoScaleDimensions = new SizeF(96f, 96f);
        AutoScaleMode = AutoScaleMode.Dpi;
        Text = "Instalar " + Product.Name;
        Font = new Font("Segoe UI", 10f);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(560, 330);
        BackColor = Color.White;
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        Panel band = new Panel();
        band.Bounds = new Rectangle(0, 0, 560, 84);
        band.BackColor = Blue;
        PictureBox picture = new PictureBox();
        picture.Image = Install.Picture();
        picture.SizeMode = PictureBoxSizeMode.Zoom;
        picture.Bounds = new Rectangle(24, 16, 52, 52);
        Label title = new Label();
        title.Text = Product.Name;
        title.ForeColor = Color.White;
        title.Font = new Font("Segoe UI Semibold", 15f);
        title.AutoSize = true;
        title.Location = new Point(90, 14);
        Label version = new Label();
        version.Text = "Versão " + Product.DisplayVersion + ", de " + Product.Publisher;
        version.ForeColor = Color.FromArgb(214, 228, 243);
        version.AutoSize = true;
        version.Location = new Point(92, 46);
        band.Controls.Add(picture);
        band.Controls.Add(title);
        band.Controls.Add(version);

        string previous = Install.Registered("DisplayVersion");
        body.AutoSize = false;
        body.Bounds = new Rectangle(24, 104, 512, 66);
        body.Text = previous == null
            ? "Vai ser instalado só para o seu usuário do Windows, sem pedir senha de administrador. Depois é só abrir pelo atalho."
            : "A versão " + previous + " vai ser atualizada. Os lotes e o kit da loja continuam guardados.";
        detail.AutoSize = false;
        detail.Bounds = new Rectangle(24, 172, 512, 40);
        detail.ForeColor = Graphite;
        detail.Font = new Font("Segoe UI", 8.75f);
        detail.Text = "Pasta: " + folder;
        desktop.Text = "Criar atalho na Área de Trabalho";
        desktop.Checked = true;
        desktop.AutoSize = true;
        desktop.Location = new Point(24, 222);
        bar.Bounds = new Rectangle(24, 226, 512, 8);
        bar.Style = ProgressBarStyle.Continuous;
        bar.Visible = false;

        primary.Text = previous == null ? "Instalar" : "Atualizar";
        primary.Bounds = new Rectangle(412, 270, 124, 38);
        primary.FlatStyle = FlatStyle.Flat;
        primary.FlatAppearance.BorderSize = 0;
        primary.BackColor = Color.Black;
        primary.ForeColor = Color.White;
        primary.Font = new Font("Segoe UI Semibold", 10f);
        primary.Cursor = Cursors.Hand;
        primary.Click += OnPrimary;
        secondary.Text = "Cancelar";
        secondary.Bounds = new Rectangle(296, 270, 108, 38);
        secondary.FlatStyle = FlatStyle.Flat;
        secondary.FlatAppearance.BorderColor = Color.FromArgb(213, 217, 222);
        secondary.BackColor = Color.White;
        secondary.Cursor = Cursors.Hand;
        secondary.Click += delegate { Close(); };
        AcceptButton = primary;
        CancelButton = secondary;

        Controls.Add(band);
        Controls.Add(body);
        Controls.Add(detail);
        Controls.Add(desktop);
        Controls.Add(bar);
        Controls.Add(primary);
        Controls.Add(secondary);
        ResumeLayout(false);
    }

    void OnPrimary(object sender, EventArgs e)
    {
        if (finished) { Launch(); Close(); return; }
        if (Install.IsRunning())
        {
            MessageBox.Show(this, "Feche a janela do " + Product.Name + " e tente de novo.", Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        bool shortcut = desktop.Checked;
        primary.Enabled = false;
        secondary.Enabled = false;
        desktop.Visible = false;
        bar.Visible = true;
        detail.Text = "Copiando os arquivos…";
        Thread worker = new Thread(delegate()
        {
            try
            {
                Installer.Run(folder, true, shortcut, true, delegate(int percent) { BeginInvoke(new MethodInvoker(delegate { bar.Value = percent; })); });
                BeginInvoke(new MethodInvoker(delegate { Done(shortcut); }));
            }
            catch (Exception error)
            {
                BeginInvoke(new MethodInvoker(delegate { Failed(error.Message); }));
            }
        });
        worker.IsBackground = true;
        worker.Start();
    }

    void Done(bool shortcut)
    {
        finished = true;
        bar.Visible = false;
        body.Text = "Pronto. O " + Product.Name + " está no menu Iniciar" + (shortcut ? " e na Área de Trabalho" : "") + ".";
        detail.Text = "Para remover: Configurações > Aplicativos > " + Product.Name + ".";
        primary.Text = "Abrir agora";
        primary.Enabled = true;
        secondary.Text = "Fechar";
        secondary.Enabled = true;
        primary.Focus();
    }

    void Failed(string message)
    {
        bar.Visible = false;
        desktop.Visible = true;
        detail.Text = "Pasta: " + folder;
        primary.Enabled = true;
        secondary.Enabled = true;
        MessageBox.Show(this, "A instalação não foi concluída.\n\n" + message, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
    }

    void Launch()
    {
        try
        {
            ProcessStartInfo start = new ProcessStartInfo(Path.Combine(folder, Product.Exe));
            start.WorkingDirectory = folder;
            Process.Start(start);
        }
        catch (Exception error) { MessageBox.Show(this, error.Message, Text); }
    }
}
