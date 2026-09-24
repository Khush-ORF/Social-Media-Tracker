using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace SocialFollowerTracker
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new TrackerForm());
        }
    }

    internal sealed class TrackerForm : Form
    {
        private const string Version = "0.3.0";
        private readonly WebView2 view = new WebView2();
        private readonly bool smokeTest = Environment.GetCommandLineArgs().Contains("--smoke-test");
        private readonly string dataRoot;
        private readonly string runtimeRoot;
        private readonly string readyFile;
        private Process server;
        private string serverUrl;
        private bool smokeTestFinished;

        public TrackerForm()
        {
            Text = "Social Follower Tracker";
            Width = 1440;
            Height = 940;
            MinimumSize = new System.Drawing.Size(880, 600);
            StartPosition = FormStartPosition.CenterScreen;
            if (smokeTest) { Opacity = 0; ShowInTaskbar = false; }

            string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Social Follower Tracker");
            if (!String.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("TRACKER_DESKTOP_HOME")))
                root = Environment.GetEnvironmentVariable("TRACKER_DESKTOP_HOME");
            dataRoot = Path.Combine(root, "records");
            runtimeRoot = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "runtime");
            readyFile = Path.Combine(Path.GetTempPath(), "social-tracker-" + Guid.NewGuid().ToString("N") + ".url");

            var menu = new MenuStrip();
            var fileMenu = new ToolStripMenuItem("File");
            fileMenu.DropDownItems.Add("Open data folder", null, (_, __) => OpenPath(dataRoot));
            fileMenu.DropDownItems.Add("Edit accounts.csv", null, (_, __) => OpenPath(Path.Combine(dataRoot, "accounts.csv")));
            fileMenu.DropDownItems.Add(new ToolStripSeparator());
            fileMenu.DropDownItems.Add("Exit", null, (_, __) => Close());
            menu.Items.Add(fileMenu);
            var helpMenu = new ToolStripMenuItem("Help");
            helpMenu.DropDownItems.Add("GitHub releases", null, (_, __) => OpenExternal("https://github.com/Khush-ORF/Social-Media-Tracker/releases"));
            menu.Items.Add(helpMenu);
            MainMenuStrip = menu;
            Controls.Add(view);
            Controls.Add(menu);
            view.Dock = DockStyle.Fill;
            menu.Dock = DockStyle.Top;
            menu.BringToFront();
            Shown += StartApplication;
            FormClosing += BeforeClose;
        }

        private async void StartApplication(object sender, EventArgs e)
        {
            try
            {
                Directory.CreateDirectory(dataRoot);
                SeedData();
                StartBackend();
                await WaitForServer();
                string webViewData = Path.Combine(dataRoot, "webview");
                Directory.CreateDirectory(webViewData);
                await view.EnsureCoreWebView2Async(await CoreWebView2Environment.CreateAsync(null, webViewData));
                view.CoreWebView2.NewWindowRequested += (_, args) =>
                {
                    args.Handled = true;
                    OpenExternal(args.Uri);
                };
                view.CoreWebView2.NavigationStarting += (_, args) =>
                {
                    if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out var target) || target.Host != "127.0.0.1")
                    {
                        args.Cancel = true;
                        OpenExternal(args.Uri);
                    }
                };
                view.CoreWebView2.NavigationCompleted += (_, __) =>
                {
                    if (smokeTest) _ = FinishSmokeTest();
                };
                view.Source = new Uri(serverUrl);
            }
            catch (Exception error)
            {
                MessageBox.Show(this, error.Message + "\r\n\r\nInstall Node.js 24 or later and the Microsoft Edge WebView2 Runtime, then reopen the tracker.", "Unable to start tracker", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
            }
        }

        private void SeedData()
        {
            string accountFile = Path.Combine(dataRoot, "accounts.csv");
            if (File.Exists(accountFile)) return;
            File.Copy(Path.Combine(runtimeRoot, "accounts.csv"), accountFile);
            string seed = Path.Combine(runtimeRoot, "data");
            string destination = Path.Combine(dataRoot, "data");
            if (Directory.Exists(seed)) CopyDirectory(seed, destination);
        }

        private static void CopyDirectory(string source, string destination)
        {
            Directory.CreateDirectory(destination);
            foreach (string file in Directory.GetFiles(source))
            {
                if (file.EndsWith("-wal", StringComparison.OrdinalIgnoreCase) || file.EndsWith("-shm", StringComparison.OrdinalIgnoreCase)) continue;
                string target = Path.Combine(destination, Path.GetFileName(file));
                if (!File.Exists(target)) File.Copy(file, target);
            }
            foreach (string directory in Directory.GetDirectories(source))
                CopyDirectory(directory, Path.Combine(destination, Path.GetFileName(directory)));
        }

        private void StartBackend()
        {
            string node = FindNode();
            if (node == null) throw new InvalidOperationException("Node.js 24 or later was not found. Install the free Node.js 24 LTS runtime, then reopen the tracker.");
            string serverScript = Path.Combine(runtimeRoot, "app", "server.mjs");
            var start = new ProcessStartInfo(node, "\"" + serverScript + "\"")
            {
                WorkingDirectory = runtimeRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            start.EnvironmentVariables["TRACKER_DATA_ROOT"] = dataRoot;
            start.EnvironmentVariables["TRACKER_READY_FILE"] = readyFile;
            start.EnvironmentVariables["TRACKER_ALLOW_SHUTDOWN"] = "true";
            start.EnvironmentVariables["PORT"] = "0";
            string edge = FindEdge();
            if (edge != null) start.EnvironmentVariables["TRACKER_BROWSER_CHANNEL"] = "msedge";
            server = Process.Start(start);
            server.BeginOutputReadLine();
            server.BeginErrorReadLine();
        }

        private async Task WaitForServer()
        {
            DateTime until = DateTime.UtcNow.AddSeconds(30);
            while (DateTime.UtcNow < until)
            {
                if (server.HasExited) throw new InvalidOperationException("The local tracker service exited during startup.");
                if (File.Exists(readyFile))
                {
                    serverUrl = File.ReadAllText(readyFile).Trim();
                    if (Uri.TryCreate(serverUrl, UriKind.Absolute, out var url) && url.Port > 0) return;
                }
                await Task.Delay(150);
            }
            throw new TimeoutException("The local tracker service did not start within 30 seconds.");
        }

        private static string FindNode()
        {
            string[] candidates = (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';')
                .Select(folder => Path.Combine(folder.Trim(), "node.exe"))
                .Concat(new[] { @"C:\Program Files\nodejs\node.exe", @"C:\Program Files (x86)\nodejs\node.exe" }).ToArray();
            foreach (string candidate in candidates.Where(File.Exists))
            {
                try
                {
                    var check = Process.Start(new ProcessStartInfo(candidate, "--version") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true });
                    string version = check.StandardOutput.ReadToEnd();
                    check.WaitForExit(3000);
                    var match = Regex.Match(version, @"^v(\d+)");
                    if (match.Success && Int32.Parse(match.Groups[1].Value) >= 24) return candidate;
                }
                catch { }
            }
            return null;
        }

        private static string FindEdge()
        {
            string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            return new[] {
                Path.Combine(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
            }.FirstOrDefault(File.Exists);
        }

        private async Task FinishSmokeTest()
        {
            if (smokeTestFinished) return;
            smokeTestFinished = true;
            string output = Environment.GetEnvironmentVariable("TRACKER_DESKTOP_SMOKE_FILE");
            if (!String.IsNullOrWhiteSpace(output))
            {
                string json = "{\"nativeWindowLoaded\":" + (view.CoreWebView2 != null && view.CoreWebView2.DocumentTitle == "Social Follower Tracker" ? "true" : "false") +
                    ",\"title\":\"" + (view.CoreWebView2.DocumentTitle ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"}";
                File.WriteAllText(output, json);
            }
            await Task.Delay(500);
            Close();
        }

        private void BeforeClose(object sender, FormClosingEventArgs e)
        {
            if (server != null)
            {
                try
                {
                    if (!String.IsNullOrEmpty(serverUrl))
                    {
                        using (var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) })
                        {
                            string status = client.GetStringAsync(serverUrl + "/api/run-status").GetAwaiter().GetResult();
                            if (Regex.IsMatch(status, "\\\"running\\\"\\s*:\\s*true") && !smokeTest)
                            {
                                var answer = MessageBox.Show(this, "Collection is still running. Close the tracker and stop this run?", "Collection in progress", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
                                if (answer != DialogResult.Yes) { e.Cancel = true; return; }
                            }
                            client.PostAsync(serverUrl + "/api/shutdown", new StringContent("{}")).GetAwaiter().GetResult();
                        }
                    }
                }
                catch { }
                StopBackend();
            }
        }

        private void StopBackend()
        {
            try
            {
                if (server != null && !server.HasExited)
                {
                    var killer = Process.Start(new ProcessStartInfo("taskkill.exe", "/PID " + server.Id + " /T /F") { UseShellExecute = false, CreateNoWindow = true });
                    killer.WaitForExit(5000);
                }
            }
            catch { }
            try { if (File.Exists(readyFile)) File.Delete(readyFile); } catch { }
        }

        private static void OpenPath(string path)
        {
            try { Process.Start(new ProcessStartInfo(path) { UseShellExecute = true }); }
            catch (Exception error) { MessageBox.Show(error.Message, "Unable to open path", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        }

        private static void OpenExternal(string url)
        {
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
        }
    }

}
