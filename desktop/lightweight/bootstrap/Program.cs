using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;

namespace SocialFollowerTracker.Bootstrap
{
    internal static class Program
    {
        private const string Version = "0.3.0";

        [STAThread]
        private static void Main(string[] args)
        {
            try
            {
                string appData = Environment.GetEnvironmentVariable("TRACKER_DESKTOP_APP_ROOT");
                if (String.IsNullOrWhiteSpace(appData)) appData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Social Follower Tracker", "app");
                string target = Path.Combine(appData, Version);
                string host = Path.Combine(target, "SocialFollowerTracker.Host.exe");
                if (!File.Exists(host)) ExtractPayload(target);
                if (!File.Exists(host)) throw new FileNotFoundException("The desktop application files could not be extracted.", host);
                var start = new ProcessStartInfo(host) { WorkingDirectory = target, UseShellExecute = false };
                if (Array.IndexOf(args, "--smoke-test") >= 0) start.Arguments = "--smoke-test";
                using (var process = Process.Start(start))
                {
                    if (Array.IndexOf(args, "--smoke-test") >= 0)
                    {
                        process.WaitForExit(30000);
                        if (!process.HasExited) { process.Kill(); Environment.ExitCode = 1; }
                        else Environment.ExitCode = process.ExitCode;
                    }
                }
            }
            catch (Exception error)
            {
                string smokeFile = Environment.GetEnvironmentVariable("TRACKER_DESKTOP_SMOKE_FILE");
                if (Array.IndexOf(args, "--smoke-test") >= 0 && !String.IsNullOrWhiteSpace(smokeFile))
                    File.WriteAllText(smokeFile, "{\"error\":\"" + error.Message.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"}");
                else
                    MessageBox.Show(error.Message, "Social Follower Tracker", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Environment.ExitCode = 1;
            }
        }

        private static void ExtractPayload(string target)
        {
            string staging = target + ".extracting-" + Guid.NewGuid().ToString("N");
            Directory.CreateDirectory(staging);
            try
            {
                using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("SocialFollowerTracker.Payload.zip"))
                using (var archive = new ZipArchive(stream, ZipArchiveMode.Read))
                {
                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        string destination = Path.GetFullPath(Path.Combine(staging, entry.FullName));
                        string prefix = Path.GetFullPath(staging) + Path.DirectorySeparatorChar;
                        if (!destination.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Unsafe path in application payload.");
                        if (String.IsNullOrEmpty(entry.Name)) { Directory.CreateDirectory(destination); continue; }
                        Directory.CreateDirectory(Path.GetDirectoryName(destination));
                        entry.ExtractToFile(destination, true);
                    }
                }
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                if (Directory.Exists(target)) Directory.Delete(target, true);
                Directory.Move(staging, target);
            }
            finally
            {
                if (Directory.Exists(staging)) Directory.Delete(staging, true);
            }
        }
    }
}
