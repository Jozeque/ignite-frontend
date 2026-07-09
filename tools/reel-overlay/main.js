// STRIDE 9:16 Story Overlay — a transparent, always-on-top, click-through
// framing guide you float over Ableton to compose a vertical reel.
const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const path = require('path');

let win = null;
let displayIdx = 0;

function targetDisplay() {
  const all = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  if (displayIdx === 0) return primary;
  return all[displayIdx % all.length] || primary;
}

function coverDisplay() {
  if (!win) return;
  const b = targetDisplay().bounds;
  win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
  win.setAlwaysOnTop(true, 'screen-saver');
}

function createWindow() {
  const b = screen.getPrimaryDisplay().bounds;
  win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'overlay.html'));

  // start fully click-through; renderer flips this off while hovering controls
  win.setIgnoreMouseEvents(true, { forward: true });
}

ipcMain.on('set-ignore', (_e, ignore) => {
  if (win) win.setIgnoreMouseEvents(!!ignore, { forward: true });
});

ipcMain.on('cycle-display', () => {
  const n = screen.getAllDisplays().length;
  displayIdx = (displayIdx + 1) % n;
  coverDisplay();
});

ipcMain.on('quit', () => app.quit());

app.whenReady().then(() => {
  createWindow();
  // global (work even when the overlay isn't focused / is click-through)
  globalShortcut.register('CommandOrControl+Shift+X', () => app.quit());
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (win) win.webContents.executeJavaScript("document.getElementById('bar').style.display = (document.getElementById('bar').style.display==='none'?'block':'none');");
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
