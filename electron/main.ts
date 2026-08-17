import { app, BrowserWindow } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { registerAuthIpc } from './ipc/auth.js';
import { registerCashIpc } from './ipc/cash.js';
import { registerConfigIpc } from './ipc/config.js';
import { registerInventoryIpc } from './ipc/inventory.js';
import { registerOrdersIpc } from './ipc/orders.js';
import { registerProductsIpc } from './ipc/products.js';
import { hasDbConfig } from './services/config.js';
import { runMigrations } from './data/prisma.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(join(__dirname, '../../dist-renderer/index.html'));
  }
}

app.whenReady().then(() => {
  registerConfigIpc();
  registerAuthIpc();
  registerOrdersIpc();
  registerInventoryIpc();
  registerCashIpc();
  registerProductsIpc();

  if (hasDbConfig()) {
    void runMigrations();
  }

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
