using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

// IFileDialog wrapper for the workbench picker — all COM interop lives
// here so the PowerShell side stays a five-liner. Pick runs on the
// PowerShell main thread, which the spawn flags make STA (the classic
// FolderBrowserDialog flow proved it on this machine).
public class WbDialog {
  [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
  private class FileOpenDialogRCW {}

  // The dialog's vtable, declared in exact slot order (a wrong order
  // corrupts memory). The IID is IFileOpenDialog's, VERIFIED against
  // this machine (the widely-copied "D57B7FA4" snippet GUID is a myth
  // and QIs E_NOINTERFACE): IFileOpenDialog extends IFileDialog, so
  // this IFileDialog method prefix is its vtable prologue — valid.
  [ComImport, Guid("D57C7288-D4AD-4768-BE02-9D969532D960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IFileDialog {
    [PreserveSig] int Show(IntPtr hwndOwner);
    [PreserveSig] int SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
    [PreserveSig] int SetFileTypeIndex(uint iFileType);
    [PreserveSig] int GetFileTypeIndex(out uint piFileType);
    [PreserveSig] int Advise(IntPtr pfde, out uint pdwCookie);
    [PreserveSig] int Unadvise(uint dwCookie);
    [PreserveSig] int SetOptions(uint dwFOS);
    [PreserveSig] int GetOptions(out uint pdwFOS);
    [PreserveSig] int SetDefaultFolder(IShellItem psi);
    [PreserveSig] int SetFolder(IShellItem psi);
    [PreserveSig] int GetFolder(out IShellItem ppsi);
    [PreserveSig] int GetCurrentSelection(out IShellItem ppsi);
    [PreserveSig] int SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    [PreserveSig] int GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
    [PreserveSig] int SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
    [PreserveSig] int SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
    [PreserveSig] int SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
    [PreserveSig] int GetResult(out IShellItem ppsi);
  }

  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IShellItem {
    [PreserveSig] int BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
    [PreserveSig] int GetParent(out IShellItem ppsi);
    [PreserveSig] int GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
  }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  private static extern void SHCreateItemFromParsingName(string pszPath, IntPtr pbc, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItem ppsi);

  [DllImport("user32.dll")]
  private static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")]
  private static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern int GetClassName(IntPtr hwnd, [Out] StringBuilder name, int max);
  [DllImport("user32.dll")]
  private static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr l);
  [DllImport("user32.dll")]
  private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  private static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")]
  private static extern bool BringWindowToTop(IntPtr hwnd);
  [DllImport("kernel32.dll")]
  private static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")]
  private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

  private const uint FOS_PICKFOLDERS = 0x20;
  private const uint FOS_FORCEFILESYSTEM = 0x40;
  private const uint FOS_PATHMUSTEXIST = 0x800;
  private const uint FOS_FILEMUSTEXIST = 0x1000;
  private const uint SIGDN_FILESYSPATH = 0x80058000;

  // Two lifts work together so the dialog appears where the user
  // clicked, not as a taskbar entry behind the browser:
  //   1. FOREGROUND OWNER — a background process cannot activate its
  //      windows, so before Show() this thread ATTACHES its input
  //      queue to the current foreground window's thread
  //      (AttachThreadInput — the classic, legal foreground-lock
  //      bypass), then SetForegroundWindow + BringWindowToTop on the
  //      tiny owner form. Show() places an owned dialog directly
  //      ABOVE its owner, so with the owner now the top window the
  //      dialog opens in front, over the browser, with focus.
  //      (Proven on this machine: an owned dialog whose owner sat
  //      BEHIND the maximized browser opened visibly-but-behind, with
  //      no taskbar button and immune to external topmost
  //      SetWindowPos — the invisible-picker bug. A dialog can also
  //      never leave its owner's z-band, so fixing the OWNER is the
  //      only fix.)
  //   2. THE PIN — only the fallback when there is no foreground
  //      window to attach to: SetWindowPos(HWND_TOPMOST) on the
  //      dialog window, polled from a background thread, only once
  //      the dialog is actually VISIBLE, and without SWP_SHOWWINDOW
  //      (pinning the hidden, half-initialized window broke Show()
  //      once).
  // Diagnostics: what the pin thread actually did, reported verbatim on
  // a pick that never surfaces.
  private static string pinStatus = "n/a";

  private static void Pin() {
    pinStatus = "searching";
    uint pid = (uint)Process.GetCurrentProcess().Id;
    for (int i = 0; i < 100; i++) {
      IntPtr found = IntPtr.Zero;
      EnumWindows(delegate(IntPtr hwnd, IntPtr l) {
        uint windowPid;
        GetWindowThreadProcessId(hwnd, out windowPid);
        if (windowPid != pid) return true;
        StringBuilder name = new StringBuilder(32);
        GetClassName(hwnd, name, 32);
        if (name.ToString() == "#32770" && IsWindowVisible(hwnd)) { found = hwnd; return false; }
        return true;
      }, IntPtr.Zero);
      if (found != IntPtr.Zero) {
        // HWND_TOPMOST(-1), SWP_NOMOVE|SWP_NOSIZE (0x3).
        SetWindowPos(found, (IntPtr)(-1), 0, 0, 0, 0, 0x3);
        pinStatus = "pinned";
        return;
      }
      Thread.Sleep(100);
    }
    pinStatus = "no-dialog-window";
  }

  // The foreground lift: share input state with whoever owns the
  // foreground right now (the user's browser, at click time), then the
  // owner form can legally take foreground + the top of the z-order.
  // Best-effort — any failure just falls back to the pin.
  private static bool LiftOwnerToForeground(IntPtr owner) {
    try {
      IntPtr fg = GetForegroundWindow();
      if (fg == IntPtr.Zero || fg == owner) return false;
      uint fgPid;
      uint fgTid = GetWindowThreadProcessId(fg, out fgPid);
      uint myTid = GetCurrentThreadId();
      if (fgTid == 0 || fgTid == myTid) return false;
      if (!AttachThreadInput(fgTid, myTid, true)) return false;
      SetForegroundWindow(owner);
      BringWindowToTop(owner);
      AttachThreadInput(fgTid, myTid, false);
      return true;
    } catch {
      return false;
    }
  }

  // Diagnostics watchdog: for 20s after Pick starts, append what the
  // background machinery actually sees to WB_PICK_LOG — so a pick that
  // never surfaces leaves a timeline behind, not silence.
  private static void Watch() {
    try {
      string logPath = Environment.GetEnvironmentVariable("WB_PICK_LOG");
      if (string.IsNullOrEmpty(logPath)) return;
      uint pid = (uint)Process.GetCurrentProcess().Id;
      for (int i = 1; i <= 5; i++) {
        Thread.Sleep(4000);
        IntPtr dlg = IntPtr.Zero;
        EnumWindows(delegate(IntPtr hwnd, IntPtr l) {
          uint wpid;
          GetWindowThreadProcessId(hwnd, out wpid);
          if (wpid != pid) return true;
          StringBuilder name = new StringBuilder(32);
          GetClassName(hwnd, name, 32);
          if (name.ToString() == "#32770" && IsWindowVisible(hwnd)) { dlg = hwnd; return false; }
          return true;
        }, IntPtr.Zero);
        string line = DateTime.Now.ToString("HH:mm:ss.fff") + " watch t+" + (i * 4) + "s pin=" + pinStatus +
                      " dialog=" + (dlg == IntPtr.Zero ? "none" : dlg.ToString());
        System.IO.File.AppendAllText(logPath, line + "\r\n");
      }
    } catch { /* diagnostics must never break the pick */ }
  }

  // mode "folder" | "file"; returns the picked path, "" on a clean user
  // cancel, or an "ERR:..." diagnostic string on any failure (Show
  // HRESULT + pin outcome + apartment state, or the exception) so the
  // logs show WHY nothing opened instead of a silent no-op.
  public static string Pick(string mode, string title, string startDir, IntPtr owner) {
    try {
      return PickCore(mode, title, startDir, owner);
    } catch (Exception ex) {
      return "ERR:com=" + ex.GetType().Name + ":" + ex.Message;
    }
  }

  private static string PickCore(string mode, string title, string startDir, IntPtr owner) {
    if (mode != "folder") mode = "file";
    bool lifted = LiftOwnerToForeground(owner);
    pinStatus = lifted ? "foreground-owner" : "pin-fallback";
    if (!lifted) Task.Run(() => Pin());
    Task.Run(() => Watch());
    IFileDialog dialog = (IFileDialog)new FileOpenDialogRCW();
    uint options;
    dialog.GetOptions(out options);
    options |= FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST;
    if (mode == "folder") options |= FOS_PICKFOLDERS; else options |= FOS_FILEMUSTEXIST;
    dialog.SetOptions(options);
    dialog.SetTitle(title);
    if (!string.IsNullOrEmpty(startDir)) {
      try {
        Guid iid = typeof(IShellItem).GUID;
        IShellItem folder;
        SHCreateItemFromParsingName(startDir, IntPtr.Zero, ref iid, out folder);
        if (folder != null) dialog.SetFolder(folder);
      } catch { /* a vanished start dir is not a failure */ }
    }
    int hr = dialog.Show(owner);
    if (hr != 0) {
      // ERROR_CANCELLED (0x800704C7) = the user closed it — quiet.
      // Anything else is a real failure: report the exact code.
      if (hr != unchecked((int)0x800704C7)) {
        return "ERR:show=0x" + hr.ToString("X8") + " pin=" + pinStatus +
               " apt=" + Thread.CurrentThread.GetApartmentState();
      }
      return "";
    }
    IShellItem item;
    dialog.GetResult(out item);
    if (item == null) return "";
    string path;
    item.GetDisplayName(SIGDN_FILESYSPATH, out path);
    return path ?? "";
  }

  // Boot-time sanity check with NO window: the QI plus the option calls
  // probe the interface layout, and a real shell-item round trip probes
  // the IShellItem side — everything a pick needs except Show() itself.
  public static bool SelfTest() {
    try {
      IFileDialog dialog = (IFileDialog)new FileOpenDialogRCW();
      uint options;
      dialog.GetOptions(out options);
      dialog.SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
      Guid iid = typeof(IShellItem).GUID;
      IShellItem item;
      SHCreateItemFromParsingName(Environment.SystemDirectory, IntPtr.Zero, ref iid, out item);
      if (item == null) return false;
      string name;
      item.GetDisplayName(SIGDN_FILESYSPATH, out name);
      return !string.IsNullOrEmpty(name);
    } catch {
      return false;
    }
  }
}
