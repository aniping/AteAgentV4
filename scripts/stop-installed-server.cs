using System;
using System.Diagnostics;
using System.IO;

internal static class StopInstalledServer
{
    private static int Main(string[] args)
    {
        if (args.Length != 1)
        {
            return 2;
        }

        string expectedNode = Path.GetFullPath(Path.Combine(args[0], "runtime", "node.exe"));
        foreach (Process process in Process.GetProcessesByName("node"))
        {
            try
            {
                string executable = Path.GetFullPath(process.MainModule.FileName);
                if (!string.Equals(executable, expectedNode, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                process.Kill();
                process.WaitForExit(5000);
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

        return 0;
    }
}
