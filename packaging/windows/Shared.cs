using System;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Win32;

// Shared by the app's launcher (.exe inside the installation) and the installer.
// C# 5 on purpose: it compiles with the csc.exe that ships with Windows (.NET Framework 4.8).
static class Install
{
    const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\";

    public static string DefaultFolder
    {
        get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", Product.Folder); }
    }

    // Window profile, address of the running instance and logs. Never the client's data.
    public static string StateFolder
    {
        get
        {
            string custom = Environment.GetEnvironmentVariable("COVERBATCH_LAUNCHER_HOME");
            return string.IsNullOrEmpty(custom) ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Product.Folder) : custom;
        }
    }

    public static string RunningMutex { get { return "Local\\" + Product.Id + "-app"; } }

    public static bool IsRunning()
    {
        Mutex mutex;
        if (!Mutex.TryOpenExisting(RunningMutex, out mutex)) return false;
        mutex.Dispose();
        return true;
    }

    public static string DesktopShortcut { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Product.Name + ".lnk"); } }
    public static string MenuShortcut { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), Product.Name + ".lnk"); } }

    public static string Normalize(string folder) { return Path.GetFullPath(folder).TrimEnd('\\'); }
    public static bool SameFolder(string a, string b) { return a != null && b != null && string.Equals(Normalize(a), Normalize(b), StringComparison.OrdinalIgnoreCase); }

    public static void CreateShortcut(string file, string target, string description)
    {
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        object shell = Activator.CreateInstance(shellType);
        try
        {
            object link = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { file });
            Type linkType = link.GetType();
            linkType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, link, new object[] { target });
            linkType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, link, new object[] { Path.GetDirectoryName(target) });
            linkType.InvokeMember("Description", BindingFlags.SetProperty, null, link, new object[] { description });
            linkType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, link, new object[] { target + ",0" });
            linkType.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
            Marshal.FinalReleaseComObject(link);
        }
        finally { Marshal.FinalReleaseComObject(shell); }
    }

    // Removes a shortcut only when it points to this installation.
    public static void RemoveShortcut(string file, string target)
    {
        if (!File.Exists(file)) return;
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        object shell = Activator.CreateInstance(shellType);
        try
        {
            object link = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { file });
            string current = (string)link.GetType().InvokeMember("TargetPath", BindingFlags.GetProperty, null, link, null);
            Marshal.FinalReleaseComObject(link);
            if (string.Equals(current, target, StringComparison.OrdinalIgnoreCase)) File.Delete(file);
        }
        catch { }
        finally { Marshal.FinalReleaseComObject(shell); }
    }

    // Per-user entry in Settings > Apps, so the client can uninstall like any program.
    public static void Register(string folder, long sizeKb)
    {
        string exe = Path.Combine(folder, Product.Exe);
        using (RegistryKey key = Registry.CurrentUser.CreateSubKey(UninstallKey + Product.Id))
        {
            key.SetValue("DisplayName", Product.Name);
            key.SetValue("DisplayVersion", Product.DisplayVersion);
            key.SetValue("Publisher", Product.Publisher);
            key.SetValue("DisplayIcon", exe + ",0");
            key.SetValue("InstallLocation", folder);
            key.SetValue("UninstallString", "\"" + exe + "\" /desinstalar");
            key.SetValue("QuietUninstallString", "\"" + exe + "\" /desinstalar /silencioso /manter-dados");
            key.SetValue("URLInfoAbout", Product.Url);
            key.SetValue("NoModify", 1, RegistryValueKind.DWord);
            key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            key.SetValue("EstimatedSize", (int)Math.Min(int.MaxValue, sizeKb), RegistryValueKind.DWord);
        }
    }

    public static string Registered(string value)
    {
        using (RegistryKey key = Registry.CurrentUser.OpenSubKey(UninstallKey + Product.Id))
        {
            return key == null ? null : key.GetValue(value) as string;
        }
    }

    public static void Unregister(string folder)
    {
        if (SameFolder(Registered("InstallLocation"), folder)) Registry.CurrentUser.DeleteSubKeyTree(UninstallKey + Product.Id, false);
    }

    public static Image Picture()
    {
        Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("icon.png");
        return stream == null ? null : Image.FromStream(stream);
    }
}

class Options
{
    readonly string[] args;
    public Options(string[] args) { this.args = args; }

    public bool Has(string name)
    {
        foreach (string arg in args) if (string.Equals(arg, name, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    public string Value(string name)
    {
        foreach (string arg in args)
            if (arg.StartsWith(name + "=", StringComparison.OrdinalIgnoreCase)) return arg.Substring(name.Length + 1).Trim('"');
        return null;
    }
}
