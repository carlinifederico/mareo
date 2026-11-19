// MAREO Today widget: a frameless, always-on-top window that loads the web
// app in widget mode (?widget=today). Collapsed it is a small red dot at the
// top of the screen; clicked, it opens the Today list right below it.
// Install / autostart: tools/today-widget/install.ps1
const { app, BrowserWindow, ipcMain, screen, session, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const URL = 'https://mareo-app-8de88.web.app/?widget=today';
// Google refuses sign-in from browsers that say "Electron"
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const STATE = () => path.join(app.getPath('userData'), 'widget-state.json');

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE(), 'utf8')); } catch { return {}; }
}
function saveState(s) {
  try { fs.writeFileSync(STATE(), JSON.stringify(s)); } catch { /* ignore */ }
}

// Keep a point (top-center of the widget) inside some display's work area
function clampAnchor(cx, top) {
  const d = screen.getDisplayNearestPoint({ x: Math.round(cx), y: Math.round(top) });
  const a = d.workArea;
  return {
    cx: Math.min(Math.max(cx, a.x + 20), a.x + a.width - 20),
    top: Math.min(Math.max(top, a.y), a.y + a.height - 40),
  };
}

app.whenReady().then(() => {
  const ses = session.fromPartition('persist:mareo');
  ses.setUserAgent(UA);
  app.userAgentFallback = UA;

  const wa = screen.getPrimaryDisplay().workArea;
  const st = loadState();
  let anchor = clampAnchor(st.cx ?? wa.x + wa.width / 2, st.top ?? wa.y + 6);

  win = new BrowserWindow({
    width: 420, height: 620,
    x: Math.round(anchor.cx - 210), y: Math.round(anchor.top),
    frame: false, transparent: true, resizable: false, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, show: false, fullscreenable: false,
    backgroundColor: '#00000000', title: 'MAREO Today',
    webPreferences: { session: ses, preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);

  // Firebase's Google sign-in popup stays inside the app; other links open in Chrome
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/accounts\.google\.com|\/__\/auth\//.test(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 480, height: 640, alwaysOnTop: true, autoHideMenuBar: true } };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('https://mareo-app-8de88.web.app/')) { e.preventDefault(); shell.openExternal(url); }
  });

  win.loadURL(URL);
  win.once('ready-to-show', () => win.show());

  // The page asks for its size; the widget grows down from its top-center
  ipcMain.on('mw:resize', (_e, { w, h }) => {
    w = Math.max(16, Math.min(Math.round(w), 600));
    h = Math.max(16, Math.min(Math.round(h), 900));
    win.setBounds({ x: Math.round(anchor.cx - w / 2), y: Math.round(anchor.top), width: w, height: h });
  });

  // Manual drag (so a plain click still works on the dot)
  let dragFrom = null;
  ipcMain.on('mw:drag-start', (_e, { sx, sy }) => { dragFrom = { sx, sy, cx: anchor.cx, top: anchor.top }; });
  ipcMain.on('mw:drag', (_e, { sx, sy }) => {
    if (!dragFrom) return;
    anchor = { cx: dragFrom.cx + (sx - dragFrom.sx), top: dragFrom.top + (sy - dragFrom.sy) };
    const b = win.getBounds();
    win.setBounds({ x: Math.round(anchor.cx - b.width / 2), y: Math.round(anchor.top), width: b.width, height: b.height });
  });
  ipcMain.on('mw:drag-end', () => {
    dragFrom = null;
    anchor = clampAnchor(anchor.cx, anchor.top);
    const b = win.getBounds();
    win.setBounds({ x: Math.round(anchor.cx - b.width / 2), y: Math.round(anchor.top), width: b.width, height: b.height });
    saveState(anchor);
  });
  ipcMain.on('mw:quit', () => app.quit());

  screen.on('display-removed', () => { anchor = clampAnchor(anchor.cx, anchor.top); });
});

app.on('second-instance', () => { if (win) win.show(); });
app.on('window-all-closed', () => app.quit());
