using System;
using System.Diagnostics;
using System.IO;
using System.Management;

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

        StopProcessesWithWmi(processName + ".exe", expectedPath);
    }

    private static void StopProcessesWithWmi(string processName, string expectedPath)
    {
        string escapedName = processName.Replace("'", "''");
        using (ManagementObjectSearcher searcher = new ManagementObjectSearcher(
            "SELECT ProcessId, ExecutablePath FROM Win32_Process WHERE Name = '" + escapedName + "'"))
        using (ManagementObjectCollection processes = searcher.Get())
        {
            foreach (ManagementObject process in processes)
            {
                using (process)
                {
                    try
                    {
                        string executable = process["ExecutablePath"] as string;
                        if (string.IsNullOrEmpty(executable) ||
                            !string.Equals(Path.GetFullPath(executable), expectedPath, StringComparison.OrdinalIgnoreCase))
                        {
                            continue;
                        }

                        int processId = Convert.ToInt32((uint)process["ProcessId"]);
                        KillProcessTree(processId);
                        process.InvokeMethod("Terminate", new object[] { 0 });
                    }
                    catch
                    {
                        // The process may have exited after taskkill completed.
                    }
                }
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
