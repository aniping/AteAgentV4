using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("ATE Agent")]
[assembly: AssemblyDescription("ATE Agent")]
[assembly: AssemblyProduct("ATE Agent")]
[assembly: AssemblyCompany("ATE")]

internal static class AteAgentLauncher
{
    private const string AppUserModelId = "ATE.Agent";
    private const string ShowStatusSignalName = @"Local\ATEAgent.ShowStatusSignal";
    private const string SingleInstanceName = @"Local\ATEAgent.SingleInstance";

    [STAThread]
    private static int Main(string[] args)
    {
        bool firstInstance;
        bool createdSignal;
        using (EventWaitHandle showStatusSignal = new EventWaitHandle(
            false,
            EventResetMode.AutoReset,
            ShowStatusSignalName,
            out createdSignal))
        using (Mutex singleInstance = new Mutex(true, SingleInstanceName, out firstInstance))
        {
            if (!firstInstance)
            {
                showStatusSignal.Set();
                return 0;
            }

            try
            {
                SetCurrentProcessExplicitAppUserModelID(AppUserModelId);
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                using (LauncherForm form = new LauncherForm(args, showStatusSignal))
                {
                    Application.Run(form);
                    return form.ExitCode;
                }
            }
            catch (Exception error)
            {
                MessageBox.Show(error.Message, "ATE Agent", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }
    }

    private sealed class LauncherForm : Form
    {
        private const uint CREATE_NO_WINDOW = 0x08000000;
        private const uint CREATE_SUSPENDED = 0x00000004;
        private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
        private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
        private const uint WAIT_OBJECT_0 = 0x00000000;

        private readonly string[] _args;
        private readonly string _installRoot;
        private readonly string _runtimeRoot;
        private readonly string _nodePath;
        private readonly string _launcherPath;
        private readonly string _webAddress;
        private readonly string _browserHost;
        private readonly int _port;
        private readonly Icon _icon;
        private readonly Image _brandImage;
        private readonly Label _statusIndicator;
        private readonly Label _statusLabel;
        private readonly ContextMenuStrip _trayMenu;
        private readonly NotifyIcon _notifyIcon;
        private readonly System.Windows.Forms.Timer _statusTimer;
        private readonly RegisteredWaitHandle _showStatusSignalRegistration;

        private IntPtr _job = IntPtr.Zero;
        private PROCESS_INFORMATION _process = new PROCESS_INFORMATION();
        private bool _serverRunning;
        private bool _serverReady;
        private bool _exiting;
        private bool _disposed;

        public int ExitCode { get; private set; }

        public LauncherForm(string[] args, EventWaitHandle showStatusSignal)
        {
            _args = (string[])args.Clone();
            _installRoot = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            _runtimeRoot = Path.Combine(_installRoot, @"runtime\node");
            _nodePath = Path.Combine(_installRoot, @"runtime\node\node.exe");
            _launcherPath = Path.Combine(_installRoot, @"support\launcher.cjs");
            if (!File.Exists(_nodePath) || !File.Exists(_launcherPath))
            {
                throw new FileNotFoundException("ATE Agent runtime files are missing. Please reinstall ATE Agent.");
            }

            LaunchAddress address = ResolveLaunchAddress(_args);
            _browserHost = address.BrowserHost;
            _port = address.Port;
            _webAddress = address.Url;
            _icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? (Icon)SystemIcons.Application.Clone();
            _brandImage = LoadBrandImage(_icon);

            ConfigureStatusForm(out _statusLabel, out _statusIndicator);
            FormClosing += OnStatusFormClosing;
            _notifyIcon = CreateNotifyIcon(out _trayMenu);
            _statusTimer = new System.Windows.Forms.Timer { Interval = 500 };
            _statusTimer.Tick += OnStatusTimerTick;
            _showStatusSignalRegistration = ThreadPool.RegisterWaitForSingleObject(
                showStatusSignal,
                OnShowStatusSignal,
                null,
                Timeout.Infinite,
                false);

        }

        protected override void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            StartServer();
            _statusTimer.Start();
        }

        private sealed class BrandPanel : Panel
        {
            public BrandPanel()
            {
                DoubleBuffered = true;
                ResizeRedraw = true;
            }

            protected override void OnPaintBackground(PaintEventArgs e)
            {
                if (ClientSize.Width <= 0 || ClientSize.Height <= 0)
                {
                    return;
                }

                using (LinearGradientBrush background = new LinearGradientBrush(
                    ClientRectangle,
                    Color.FromArgb(31, 41, 55),
                    Color.FromArgb(15, 23, 42),
                    135F))
                {
                    e.Graphics.FillRectangle(background, ClientRectangle);
                }

                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                using (Pen signalLine = new Pen(Color.FromArgb(42, 248, 113, 113), 1F))
                {
                    e.Graphics.DrawEllipse(signalLine, 116, -32, 150, 150);
                    e.Graphics.DrawEllipse(signalLine, 138, -10, 106, 106);
                    e.Graphics.DrawEllipse(signalLine, 160, 12, 62, 62);
                    e.Graphics.DrawLine(signalLine, -20, 224, 226, 116);
                    e.Graphics.DrawLine(signalLine, -42, 275, 226, 157);
                }
                using (SolidBrush signalGlow = new SolidBrush(Color.FromArgb(150, 248, 113, 113)))
                {
                    e.Graphics.FillEllipse(signalGlow, 175, 27, 8, 8);
                }
            }
        }

        private void ConfigureStatusForm(out Label statusLabel, out Label statusIndicator)
        {
            Text = "ATE Agent";
            Icon = _icon;
            ClientSize = new Size(620, 382);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = true;
            Padding = Padding.Empty;
            BackColor = Color.FromArgb(246, 247, 249);
            Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Regular);
            AutoScaleMode = AutoScaleMode.Dpi;

            BrandPanel brandPanel = new BrandPanel
            {
                Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left,
                Location = Point.Empty,
                Margin = Padding.Empty,
                Size = new Size(205, ClientSize.Height),
            };
            Panel iconPlate = new Panel
            {
                BackColor = Color.White,
                Location = new Point(30, 30),
                Size = new Size(76, 76),
            };
            PictureBox brandIcon = new PictureBox
            {
                Image = _brandImage,
                Location = new Point(8, 8),
                Size = new Size(60, 60),
                SizeMode = PictureBoxSizeMode.Zoom,
            };
            Label title = new Label
            {
                AutoSize = true,
                BackColor = Color.Transparent,
                Font = new Font("Microsoft YaHei UI", 20F, FontStyle.Bold),
                ForeColor = Color.White,
                Location = new Point(28, 124),
                Text = "ATE Agent",
            };
            Label subtitle = new Label
            {
                AutoSize = true,
                BackColor = Color.Transparent,
                ForeColor = Color.FromArgb(203, 213, 225),
                Location = new Point(31, 168),
                Text = "\u65e0\u7ebf\u88c5\u5907\u667a\u80fd\u52a9\u624b",
            };
            Label versionCaption = new Label
            {
                AutoSize = true,
                BackColor = Color.Transparent,
                Font = new Font("Segoe UI", 8F, FontStyle.Bold),
                ForeColor = Color.FromArgb(148, 163, 184),
                Location = new Point(31, 247),
                Text = "BUILD VERSIONS",
            };
            Label agentVersion = new Label
            {
                BackColor = Color.FromArgb(30, 41, 59),
                ForeColor = Color.FromArgb(226, 232, 240),
                Location = new Point(30, 271),
                Padding = new Padding(11, 0, 11, 0),
                Size = new Size(145, 30),
                Text = "AGENT    v" + BuildVersions.Agent,
                TextAlign = ContentAlignment.MiddleLeft,
            };
            Label uiVersion = new Label
            {
                BackColor = Color.FromArgb(30, 41, 59),
                ForeColor = Color.FromArgb(226, 232, 240),
                Location = new Point(30, 307),
                Padding = new Padding(11, 0, 11, 0),
                Size = new Size(145, 30),
                Text = "UI             v" + BuildVersions.Ui,
                TextAlign = ContentAlignment.MiddleLeft,
            };

            Panel contentPanel = new Panel
            {
                Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right,
                BackColor = Color.FromArgb(250, 250, 250),
                Location = new Point(205, 0),
                Margin = Padding.Empty,
                Size = new Size(ClientSize.Width - 205, ClientSize.Height),
            };
            Label sectionCaption = new Label
            {
                AutoSize = true,
                Font = new Font("Segoe UI", 8F, FontStyle.Bold),
                ForeColor = Color.FromArgb(161, 161, 170),
                Location = new Point(32, 28),
                Text = "SYSTEM CONTROL",
            };
            statusIndicator = new Label
            {
                AutoSize = true,
                Font = new Font("Segoe UI Symbol", 15F, FontStyle.Bold),
                ForeColor = Color.FromArgb(245, 158, 11),
                Location = new Point(31, 60),
                Text = "\u25cf",
            };
            statusLabel = new Label
            {
                AutoSize = true,
                Font = new Font("Microsoft YaHei UI", 18F, FontStyle.Bold),
                ForeColor = Color.FromArgb(24, 24, 27),
                Location = new Point(63, 56),
                Text = "\u670d\u52a1\u6b63\u5728\u542f\u52a8\u2026",
            };
            Label statusDescription = new Label
            {
                AutoSize = true,
                ForeColor = Color.FromArgb(113, 113, 122),
                Location = new Point(65, 96),
                Text = "\u672c\u5730 Agent \u670d\u52a1\u7531 ATE Agent \u6301\u7eed\u5b88\u62a4",
            };
            Panel endpointPanel = new Panel
            {
                BackColor = Color.FromArgb(244, 244, 245),
                Location = new Point(32, 130),
                Size = new Size(351, 66),
            };
            Label addressCaption = new Label
            {
                AutoSize = true,
                Font = new Font("Segoe UI", 8F, FontStyle.Bold),
                ForeColor = Color.FromArgb(161, 161, 170),
                Location = new Point(14, 9),
                Text = "LOCAL ENDPOINT",
            };
            LinkLabel addressLink = new LinkLabel
            {
                AutoSize = true,
                Font = new Font("Consolas", 10F, FontStyle.Regular),
                LinkColor = Color.FromArgb(220, 38, 38),
                ActiveLinkColor = Color.FromArgb(153, 27, 27),
                Location = new Point(14, 34),
                Text = _webAddress,
            };
            addressLink.LinkClicked += delegate { OpenWebInterfaceWhenReady(); };

            Button openButton = new Button
            {
                BackColor = Color.FromArgb(220, 38, 38),
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Microsoft YaHei UI", 10F, FontStyle.Bold),
                ForeColor = Color.White,
                Location = new Point(32, 216),
                Size = new Size(351, 50),
                Text = "\u6253\u5f00 ATE Agent \u5de5\u4f5c\u53f0    \u2192",
                UseVisualStyleBackColor = false,
            };
            openButton.FlatAppearance.BorderSize = 0;
            openButton.Click += delegate { OpenWebInterfaceWhenReady(); };
            Button restartButton = new Button
            {
                BackColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                ForeColor = Color.FromArgb(63, 63, 70),
                Location = new Point(32, 282),
                Size = new Size(170, 44),
                Text = "\u91cd\u542f\u670d\u52a1",
                UseVisualStyleBackColor = false,
            };
            restartButton.FlatAppearance.BorderColor = Color.FromArgb(212, 212, 216);
            restartButton.Click += delegate { RestartServer(); };
            Button exitButton = new Button
            {
                BackColor = Color.FromArgb(244, 244, 245),
                FlatStyle = FlatStyle.Flat,
                ForeColor = Color.FromArgb(82, 82, 91),
                Location = new Point(213, 282),
                Size = new Size(170, 44),
                Text = "\u9000\u51fa\u7a0b\u5e8f",
                UseVisualStyleBackColor = false,
            };
            exitButton.FlatAppearance.BorderSize = 0;
            exitButton.Click += delegate { ExitApplication(); };
            Label backgroundHint = new Label
            {
                AutoSize = true,
                ForeColor = Color.FromArgb(161, 161, 170),
                Location = new Point(32, 344),
                Text = "\u5173\u95ed\u7a97\u53e3\u540e\uff0c\u670d\u52a1\u5c06\u7ee7\u7eed\u5728\u540e\u53f0\u8fd0\u884c",
            };

            iconPlate.Controls.Add(brandIcon);
            brandPanel.Controls.Add(iconPlate);
            brandPanel.Controls.Add(title);
            brandPanel.Controls.Add(subtitle);
            brandPanel.Controls.Add(versionCaption);
            brandPanel.Controls.Add(agentVersion);
            brandPanel.Controls.Add(uiVersion);
            endpointPanel.Controls.Add(addressCaption);
            endpointPanel.Controls.Add(addressLink);
            contentPanel.Controls.Add(sectionCaption);
            contentPanel.Controls.Add(statusIndicator);
            contentPanel.Controls.Add(statusLabel);
            contentPanel.Controls.Add(statusDescription);
            contentPanel.Controls.Add(endpointPanel);
            contentPanel.Controls.Add(openButton);
            contentPanel.Controls.Add(restartButton);
            contentPanel.Controls.Add(exitButton);
            contentPanel.Controls.Add(backgroundHint);
            Controls.Add(contentPanel);
            Controls.Add(brandPanel);
        }

        private NotifyIcon CreateNotifyIcon(out ContextMenuStrip menu)
        {
            menu = new ContextMenuStrip();
            ToolStripMenuItem openItem = new ToolStripMenuItem("\u6253\u5f00 ATE Agent \u7f51\u9875");
            openItem.Font = new Font(openItem.Font, FontStyle.Bold);
            openItem.Click += delegate { OpenWebInterfaceWhenReady(); };
            ToolStripMenuItem showItem = new ToolStripMenuItem("\u663e\u793a\u8fd0\u884c\u72b6\u6001");
            showItem.Click += delegate { ShowStatusWindow(); };
            ToolStripMenuItem restartItem = new ToolStripMenuItem("\u91cd\u542f\u670d\u52a1");
            restartItem.Click += delegate { RestartServer(); };
            ToolStripMenuItem exitItem = new ToolStripMenuItem("\u9000\u51fa ATE Agent");
            exitItem.Click += delegate { ExitApplication(); };
            menu.Items.Add(openItem);
            menu.Items.Add(showItem);
            menu.Items.Add(restartItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(exitItem);

            NotifyIcon notifyIcon = new NotifyIcon
            {
                Icon = _icon,
                Text = "ATE Agent - \u6b63\u5728\u542f\u52a8",
                ContextMenuStrip = menu,
                Visible = true,
            };
            notifyIcon.MouseDoubleClick += delegate(object sender, MouseEventArgs eventArgs)
            {
                if (eventArgs.Button == MouseButtons.Left)
                {
                    ShowStatusWindow();
                }
            };
            return notifyIcon;
        }

        private void StartServer()
        {
            if (_serverRunning)
            {
                return;
            }

            IntPtr job = IntPtr.Zero;
            IntPtr environment = IntPtr.Zero;
            PROCESS_INFORMATION process = new PROCESS_INFORMATION();
            bool processCreated = false;
            bool assignedToJob = false;
            try
            {
                job = CreateKillOnCloseJob();
                environment = Marshal.StringToHGlobalUni(BuildEnvironmentBlock(_runtimeRoot));
                STARTUPINFO startup = new STARTUPINFO();
                startup.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFO));
                StringBuilder commandLine = new StringBuilder(
                    QuoteArgument(_nodePath) + " " + BuildArguments(_launcherPath, _args));
                if (!CreateProcess(
                    _nodePath,
                    commandLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    false,
                    CREATE_NO_WINDOW | CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
                    environment,
                    _installRoot,
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

                CloseHandle(process.hThread);
                process.hThread = IntPtr.Zero;
                _job = job;
                _process = process;
                _serverRunning = true;
                _serverReady = false;
                SetStatus("\u670d\u52a1\u6b63\u5728\u542f\u52a8\u2026", "ATE Agent - \u6b63\u5728\u542f\u52a8", Color.FromArgb(245, 158, 11));
            }
            catch
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
                throw;
            }
            finally
            {
                if (environment != IntPtr.Zero)
                {
                    Marshal.FreeHGlobal(environment);
                }
            }
        }

        private void RestartServer()
        {
            try
            {
                SetStatus("\u670d\u52a1\u6b63\u5728\u91cd\u542f\u2026", "ATE Agent - \u6b63\u5728\u91cd\u542f", Color.FromArgb(245, 158, 11));
                StopServer();
                StartServer();
            }
            catch (Exception error)
            {
                SetStatus("\u670d\u52a1\u542f\u52a8\u5931\u8d25", "ATE Agent - \u670d\u52a1\u5df2\u505c\u6b62", Color.FromArgb(220, 38, 38));
                MessageBox.Show(error.Message, "ATE Agent", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void StopServer()
        {
            if (_job != IntPtr.Zero)
            {
                TerminateJobObject(_job, 0);
            }
            if (_process.hProcess != IntPtr.Zero)
            {
                WaitForSingleObject(_process.hProcess, 5000);
            }
            CleanupServerHandles();
            if (!_exiting)
            {
                SetStatus("\u670d\u52a1\u5df2\u505c\u6b62", "ATE Agent - \u670d\u52a1\u5df2\u505c\u6b62", Color.FromArgb(220, 38, 38));
            }
        }

        private void CleanupServerHandles()
        {
            if (_process.hThread != IntPtr.Zero)
            {
                CloseHandle(_process.hThread);
            }
            if (_process.hProcess != IntPtr.Zero)
            {
                CloseHandle(_process.hProcess);
            }
            if (_job != IntPtr.Zero)
            {
                CloseHandle(_job);
            }
            _process = new PROCESS_INFORMATION();
            _job = IntPtr.Zero;
            _serverRunning = false;
            _serverReady = false;
        }

        private void OnStatusTimerTick(object sender, EventArgs eventArgs)
        {
            if (!_serverRunning || _process.hProcess == IntPtr.Zero)
            {
                return;
            }

            if (WaitForSingleObject(_process.hProcess, 0) == WAIT_OBJECT_0)
            {
                uint exitCode;
                GetExitCodeProcess(_process.hProcess, out exitCode);
                ExitCode = unchecked((int)exitCode);
                CleanupServerHandles();
                SetStatus("\u670d\u52a1\u5df2\u505c\u6b62", "ATE Agent - \u670d\u52a1\u5df2\u505c\u6b62", Color.FromArgb(220, 38, 38));
                return;
            }

            if (!_serverReady && CanConnect())
            {
                _serverReady = true;
                SetStatus("\u670d\u52a1\u6b63\u5728\u8fd0\u884c", "ATE Agent - \u6b63\u5728\u8fd0\u884c", Color.FromArgb(22, 163, 74));
            }
        }

        private void OpenWebInterfaceWhenReady()
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                for (int attempt = 0; attempt < 60 && !_disposed; attempt++)
                {
                    if (_serverRunning && CanConnect())
                    {
                        OpenWebInterface();
                        return;
                    }
                    Thread.Sleep(250);
                }
            });
        }

        private bool CanConnect()
        {
            try
            {
                using (TcpClient client = new TcpClient())
                {
                    IAsyncResult result = client.BeginConnect(_browserHost, _port, null, null);
                    using (result.AsyncWaitHandle)
                    {
                        if (!result.AsyncWaitHandle.WaitOne(200))
                        {
                            return false;
                        }
                        client.EndConnect(result);
                        return true;
                    }
                }
            }
            catch
            {
                return false;
            }
        }

        private void OpenWebInterface()
        {
            try
            {
                string explorerPath = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.Windows),
                    "explorer.exe");
                Process.Start(new ProcessStartInfo
                {
                    FileName = explorerPath,
                    Arguments = _webAddress,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                });
            }
            catch (Exception error)
            {
                ShowOpenWebError(error.Message);
            }
        }

        private void ShowOpenWebError(string message)
        {
            if (_disposed)
            {
                return;
            }

            try
            {
                BeginInvoke((MethodInvoker)delegate
                {
                    if (!_disposed)
                    {
                        MessageBox.Show(message, "ATE Agent", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    }
                });
            }
            catch (InvalidOperationException)
            {
                // The application exited while the browser request was pending.
            }
        }

        private void OnShowStatusSignal(object state, bool timedOut)
        {
            if (_disposed)
            {
                return;
            }
            try
            {
                BeginInvoke((MethodInvoker)delegate
                {
                    if (!_disposed)
                    {
                        ShowStatusWindow();
                    }
                });
            }
            catch (InvalidOperationException)
            {
                // The application exited while a second launch was being handled.
            }
        }

        private void ShowStatusWindow()
        {
            WindowState = FormWindowState.Normal;
            Show();
            Activate();
        }

        private void HideToTray()
        {
            Hide();
        }

        private static Image LoadBrandImage(Icon fallbackIcon)
        {
            using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("ATE.Agent.Brand.png"))
            {
                if (stream == null)
                {
                    return fallbackIcon.ToBitmap();
                }
                using (Image embeddedImage = Image.FromStream(stream))
                {
                    return new Bitmap(embeddedImage);
                }
            }
        }

        private void OnStatusFormClosing(object sender, FormClosingEventArgs e)
        {
            if (_exiting)
            {
                return;
            }

            e.Cancel = true;
            HideToTray();
        }

        private void ExitApplication()
        {
            if (_exiting)
            {
                return;
            }
            _exiting = true;
            Close();
        }

        private void SetStatus(string status, string trayText, Color indicatorColor)
        {
            if (!_statusLabel.IsDisposed)
            {
                _statusLabel.Text = status;
            }
            if (!_statusIndicator.IsDisposed)
            {
                _statusIndicator.ForeColor = indicatorColor;
            }
            if (!_disposed)
            {
                _notifyIcon.Text = trayText;
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing && !_disposed)
            {
                _disposed = true;
                _statusTimer.Stop();
                _statusTimer.Dispose();
                _showStatusSignalRegistration.Unregister(null);
                _notifyIcon.Visible = false;
                _notifyIcon.Dispose();
                _trayMenu.Dispose();
                StopServer();
                _icon.Dispose();
                _brandImage.Dispose();
            }
            base.Dispose(disposing);
        }

        private static LaunchAddress ResolveLaunchAddress(string[] args)
        {
            string hostname = Environment.GetEnvironmentVariable("PI_WEB_HOSTNAME") ?? "0.0.0.0";
            string rawPort = Environment.GetEnvironmentVariable("PORT") ?? "30141";
            for (int index = 0; index < args.Length; index++)
            {
                string argument = args[index];
                if ((argument == "-H" || argument == "--hostname") && index + 1 < args.Length)
                {
                    hostname = args[++index];
                }
                else if (argument.StartsWith("--hostname=", StringComparison.Ordinal))
                {
                    hostname = argument.Substring("--hostname=".Length);
                }
                else if ((argument == "-p" || argument == "--port") && index + 1 < args.Length)
                {
                    rawPort = args[++index];
                }
                else if (argument.StartsWith("--port=", StringComparison.Ordinal))
                {
                    rawPort = argument.Substring("--port=".Length);
                }
            }

            int port;
            if (!int.TryParse(rawPort, out port) || port < 1 || port > 65535)
            {
                throw new ArgumentException("port must be an integer between 1 and 65535");
            }
            hostname = hostname.Trim();
            if (hostname.Length == 0)
            {
                throw new ArgumentException("hostname must not be empty");
            }

            string browserHost = hostname;
            if (hostname == "0.0.0.0" || hostname == "::" || hostname == "[::]" || hostname == "*" || hostname == "+")
            {
                browserHost = "127.0.0.1";
            }
            UriBuilder url = new UriBuilder("http", browserHost, port);
            return new LaunchAddress(browserHost, port, url.Uri.AbsoluteUri.TrimEnd('/'));
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

        private sealed class LaunchAddress
        {
            public readonly string BrowserHost;
            public readonly int Port;
            public readonly string Url;

            public LaunchAddress(string browserHost, int port, string url)
            {
                BrowserHost = browserHost;
                Port = port;
                Url = url;
            }
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

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

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

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(string appId);

}
