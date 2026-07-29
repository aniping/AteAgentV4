using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

internal static class AteAgentLauncher
{
    private const uint CREATE_NO_WINDOW = 0x08000000;
    private const uint CREATE_SUSPENDED = 0x00000004;
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    private const uint INFINITE = 0xFFFFFFFF;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;

    [STAThread]
    private static int Main(string[] args)
    {
        IntPtr job = IntPtr.Zero;
        IntPtr environment = IntPtr.Zero;
        PROCESS_INFORMATION process = new PROCESS_INFORMATION();
        bool processCreated = false;
        bool assignedToJob = false;
        try
        {
            string installRoot = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            string runtimeRoot = Path.Combine(installRoot, @"runtime\node");
            string nodePath = Path.Combine(installRoot, @"runtime\node\node.exe");
            string launcherPath = Path.Combine(installRoot, "launcher.cjs");
            if (!File.Exists(nodePath) || !File.Exists(launcherPath))
            {
                throw new FileNotFoundException("ATE Agent runtime files are missing. Please reinstall ATE Agent.");
            }

            job = CreateKillOnCloseJob();
            environment = Marshal.StringToHGlobalUni(BuildEnvironmentBlock(runtimeRoot));
            STARTUPINFO startup = new STARTUPINFO();
            startup.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFO));
            StringBuilder commandLine = new StringBuilder(
                QuoteArgument(nodePath) + " " + BuildArguments(launcherPath, args));
            if (!CreateProcess(
                nodePath,
                commandLine,
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                CREATE_NO_WINDOW | CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
                environment,
                installRoot,
                ref startup,
                out process))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "ATE Agent could not start its server process.");
            }
            processCreated = true;
            if (!AssignProcessToJobObject(job, process.hProcess))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "ATE Agent could not manage its server process.");
            }
            assignedToJob = true;
            if (ResumeThread(process.hThread) == uint.MaxValue)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "ATE Agent could not resume its server process.");
            }
            if (WaitForSingleObject(process.hProcess, INFINITE) == uint.MaxValue)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "ATE Agent could not wait for its server process.");
            }
            uint exitCode;
            if (!GetExitCodeProcess(process.hProcess, out exitCode))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "ATE Agent could not read its server exit code.");
            }
            return unchecked((int)exitCode);
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "ATE Agent", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        finally
        {
            if (processCreated && !assignedToJob)
            {
                TerminateProcess(process.hProcess, 1);
            }
            if (process.hThread != IntPtr.Zero)
            {
                CloseHandle(process.hThread);
            }
            if (process.hProcess != IntPtr.Zero)
            {
                CloseHandle(process.hProcess);
            }
            if (job != IntPtr.Zero)
            {
                CloseHandle(job);
            }
            if (environment != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(environment);
            }
        }
    }

    private static string BuildEnvironmentBlock(string runtimeRoot)
    {
        SortedDictionary<string, string> variables = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (DictionaryEntry entry in Environment.GetEnvironmentVariables())
        {
            variables[(string)entry.Key] = Convert.ToString(entry.Value) ?? string.Empty;
        }
        string inheritedPath;
        variables.TryGetValue("PATH", out inheritedPath);
        variables["PATH"] = runtimeRoot + ";" + (inheritedPath ?? string.Empty);

        StringBuilder block = new StringBuilder();
        foreach (KeyValuePair<string, string> variable in variables)
        {
            block.Append(variable.Key).Append('=').Append(variable.Value).Append('\0');
        }
        block.Append('\0');
        return block.ToString();
    }

    private static IntPtr CreateKillOnCloseJob()
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "ATE Agent could not create its server process group.");
        }

        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        int length = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref limits, (uint)length))
        {
            int error = Marshal.GetLastWin32Error();
            CloseHandle(job);
            throw new Win32Exception(error, "ATE Agent could not configure its server process group.");
        }
        return job;
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

    private const int JobObjectExtendedLimitInformation = 9;

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public uint cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public uint dwX;
        public uint dwY;
        public uint dwXSize;
        public uint dwYSize;
        public uint dwXCountChars;
        public uint dwYCountChars;
        public uint dwFillAttribute;
        public uint dwFlags;
        public ushort wShowWindow;
        public ushort cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr securityAttributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
        IntPtr job,
        int informationClass,
        ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION information,
        uint informationLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(
        string applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref STARTUPINFO startupInfo,
        out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
}
