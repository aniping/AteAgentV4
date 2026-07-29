using System;
using System.Diagnostics;
using System.IO;

internal static class StopAllServer
{
    private static int Main(string[] args)
    {
        if (args.Length > 1)
        {
            return 2;
        }

        string installRoot = args.Length == 1
            ? Path.GetFullPath(args[0])
            : Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory);
        StopProcesses("ATE-Agent", Path.Combine(installRoot, "ATE-Agent.exe"));
        StopProcesses("node", Path.Combine(installRoot, @"runtime\node\node.exe"));
        return 0;
    }

    private static void StopProcesses(string processName, string expectedExecutable)
    {
        string expectedPath = Path.GetFullPath(expectedExecutable);
        foreach (Process process in Process.GetProcessesByName(processName))
        {
            try
            {
                string executable = Path.GetFullPath(process.MainModule.FileName);
                if (!string.Equals(executable, expectedPath, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                KillProcessTree(process.Id);
            }
            catch
            {
                // Processes that exit during enumeration or cannot be inspected are unrelated.
            }
            finally
            {
                process.Dispose();
            }
        }
    }

    private static void KillProcessTree(int processId)
    {
        string systemRoot = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        ProcessStartInfo startInfo = new ProcessStartInfo
        {
            FileName = Path.Combine(systemRoot, "System32", "taskkill.exe"),
            Arguments = "/PID " + processId + " /T /F",
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        using (Process taskkill = Process.Start(startInfo))
        {
            if (taskkill != null)
            {
                taskkill.WaitForExit(5000);
            }
        }
    }
}
