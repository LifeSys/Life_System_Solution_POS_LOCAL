import { app, BrowserWindow } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { registerAuditIpc } from './ipc/audit.js';
import { registerAuthIpc } from './ipc/auth.js';
import { registerDashboardIpc } from './ipc/dashboard.js';
import { registerCashIpc } from './ipc/cash.js';
import { registerConfigIpc } from './ipc/config.js';
import { registerInventoryIpc } from './ipc/inventory.js';
import { registerOrdersIpc } from './ipc/orders.js';
import { registerProductsIpc } from './ipc/products.js';
import { registerUsersIpc } from './ipc/users.js';
import { getStartupState } from './data/prisma.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await win.loadFile(join(__dirname, '../../dist-renderer/index.html'));
  }
  return win;
}

async function bootstrap() {
  registerConfigIpc();
  registerAuthIpc();
  registerDashboardIpc();
  registerUsersIpc();
  registerAuditIpc();
  registerOrdersIpc();
  registerInventoryIpc();
  registerCashIpc();
  registerProductsIpc();

  await createWindow();
  const state = await getStartupState();
  BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('app:startupState', state));
}

app.whenReady().then(() => {
  bootstrap().catch((error: unknown) => {
    console.error('Error controlado durante el arranque:', error instanceof Error ? error.message : String(error));
  });
}).catch((error: unknown) => {
  console.error('Electron no pudo inicializar app.whenReady():', error instanceof Error ? error.message : String(error));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch((error: unknown) => {
      console.error('No se pudo crear la ventana:', error instanceof Error ? error.message : String(error));
    });
  }
});
