"use strict";
const { app, BrowserWindow } = require("electron");
require("path");
function createWindow() {
  const win = new BrowserWindow({
    width: 600,
    height: 400,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  win.webContents.openDevTools();
  win.loadFile("index.html");
}
app.whenReady().then(createWindow);
