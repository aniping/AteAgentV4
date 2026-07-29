using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;

internal static class AteAgentLauncher
{
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            string installRoot = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            string runtimeRoot = Path.Combine(installRoot, "runtime");
            string nodePath = Path.Combine(installRoot, @"runtime\node.exe");
            string launcherPath = Path.Combine(installRoot, "launcher.cjs");
            if (!File.Exists(nodePath) || !File.Exists(launcherPath))
            {
                throw new FileNotFoundException("ATE Agent runtime files are missing. Please reinstall ATE Agent.");
            }

            ProcessStartInfo startInfo = new ProcessStartInfo
            {
                FileName = nodePath,
                Arguments = BuildArguments(launcherPath, args),
                WorkingDirectory = installRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            string inheritedPath = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
            startInfo.EnvironmentVariables["PATH"] = runtimeRoot + ";" + inheritedPath;

            Process process = Process.Start(startInfo);
            if (process == null)
            {
                throw new InvalidOperationException("ATE Agent could not be started.");
            }
            process.Dispose();
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "ATE Agent", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static string BuildArguments(string launcherPath, string[] args)
    {
        string[] quotedArgs = Array.ConvertAll(args, QuoteArgument);
        return QuoteArgument(launcherPath) + (quotedArgs.Length == 0 ? string.Empty : " " + string.Join(" ", quotedArgs));
    }

    private static string QuoteArgument(string value)
    {
        if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '"' }) < 0)
        {
            return value;
        }

        StringBuilder quoted = new StringBuilder("\"");
        int backslashes = 0;
        foreach (char character in value)
        {
            if (character == '\\')
            {
                backslashes++;
                continue;
            }

            if (character == '"')
            {
                quoted.Append('\\', backslashes * 2 + 1);
            }
            else
            {
                quoted.Append('\\', backslashes);
            }
            quoted.Append(character);
            backslashes = 0;
        }
        quoted.Append('\\', backslashes * 2);
        quoted.Append('"');
        return quoted.ToString();
    }
}
