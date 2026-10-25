const { BrowserWindow, app, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 700,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,   // renderer cannot access Node APIs directly
      nodeIntegration: false,   // keeps the renderer isolated and secure
    },
  });

  win.loadURL("http://localhost:5173/");
  // DevTools removed from automatic startup.
  // To open DevTools during development, press Ctrl+Shift+I (or Cmd+Opt+I on Mac)
  // inside the Electron window, or add win.webContents.openDevTools() temporarily.
}

// Put the window into kiosk (full-screen lock-down) mode.
ipcMain.handle("full-screen", () => {
  win.setKiosk(true); // Fix: was "win.kiosk = true" which silently did nothing
});

// Show the exam rules dialog and return the student's choice.
// Returns 0 if the student clicks "Cancel", or 1 if they click "Accept".
ipcMain.handle("show-rules", async () => {
  const res = await dialog.showMessageBox(win, {
    type: "info",
    title: "Exam Rules",
    message: "Please read and accept the exam rules before continuing:",
    detail: [
      "1. Do not switch tabs or windows during the exam.",
      "2. Keep your face visible to the camera at all times.",
      "3. You have 10 minutes to complete all five questions.",
      "4. Once you submit, you cannot change your answers.",
    ].join("\n"),
    buttons: ["Cancel", "Accept"],
    defaultId: 1,
  });
  return res.response;
});

// Save a periodic camera snapshot to disk.
// The cameraFeed folder is created automatically if it does not already exist.
ipcMain.handle("save-photo", (_, arrayBuffer) => {
  try {
    const feedDir = path.join(__dirname, "cameraFeed");
    fs.mkdirSync(feedDir, { recursive: true }); // Fix: directory was never created
    const filePath = path.join(feedDir, `${Date.now()}.jpeg`);
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(filePath, buffer);
  } catch (err) {
    // Log the error but do not crash the main process.
    // The photo-capture interval in the renderer continues running.
    console.error("save-photo failed:", err.message);
  }
});

// Save the final exam result to a JSON file in Electron's user-data directory.
// Returns { ok: true, path: "..." } on success, or { ok: false, error: "..." } on failure.
ipcMain.handle("save-result", (_, resultData) => {
  try {
    // Basic validation: we expect an object with at least a submittedAt timestamp.
    if (
      !resultData ||
      typeof resultData !== "object" ||
      typeof resultData.submittedAt !== "string"
    ) {
      return { ok: false, error: "Invalid result data received." };
    }

    // app.getPath("userData") is always writable on every platform.
    // On macOS it is ~/Library/Application Support/athena_phase_1/
    const resultsDir = path.join(app.getPath("userData"), "athna-results");
    fs.mkdirSync(resultsDir, { recursive: true });

    // Build a filename from the submission timestamp so each file is unique.
    // e.g. result_2026-10-25_14-30-00.json
    const safestamp = resultData.submittedAt
      .replace("T", "_")   // ISO T separator → underscore
      .replace(/:/g, "-")  // colons → dashes (invalid on Windows filenames)
      .slice(0, 19);       // keep only YYYY-MM-DD_HH-MM-SS
    const filePath = path.join(resultsDir, `result_${safestamp}.json`);

    // Do not silently overwrite an earlier result with the same timestamp.
    if (fs.existsSync(filePath)) {
      return {
        ok: false,
        error: "A result file for this submission time already exists. No data was overwritten.",
      };
    }

    fs.writeFileSync(filePath, JSON.stringify(resultData, null, 2), "utf8");
    return { ok: true, path: filePath };
  } catch (err) {
    console.error("save-result failed:", err.message);
    return { ok: false, error: err.message };
  }
});

app.whenReady().then(() => {
  createWindow();
});
