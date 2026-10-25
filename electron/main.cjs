const { BrowserWindow, app, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require('fs');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 700,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  win.loadURL("http://localhost:5173/");
  win.webContents.openDevTools({ mode: "detach" });
}

ipcMain.handle("full-screen", () => {
  win.kiosk = true;
});

let end_time = null;

ipcMain.handle("start-test", () => {
  end_time = Date.now() + 60 * 60 * 60;
});

ipcMain.handle("get-time", () => {
  return end_time - Date.now();
});

ipcMain.handle("show-rules", async () => {
  const res = await dialog.showMessageBox(win, {
    type: "info",
    title: "Exam rules",
    message: "Please follow these things:",
    detail: `
    1. Do not open any new tab
    2. You will get 0 marks if you cheat
    `,
    buttons: ["Cancel", "Accept"],
    defaultId: 0
  });

  return res.response;
});

ipcMain.handle("save-photo", (_, arrayBuffer) => {
  const filePath = path.join(__dirname, 'cameraFeed', `${Date.now()}.jpeg`)
  const buffer = Buffer.from(arrayBuffer);
  console.log(buffer);
  fs.writeFileSync(filePath, buffer)
});

app.whenReady().then(() => {
  createWindow();
});
