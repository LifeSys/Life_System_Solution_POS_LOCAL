import { contextBridge, ipcRenderer } from 'electron';
const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);
const api = {
    config: { exists: () => invoke('config:exists'), save: (config) => invoke('config:save', config) },
    auth: { login: (request) => invoke('auth:login', request), logout: () => invoke('auth:logout') },
    orders: { create: (request) => invoke('orders:create', request), updateStatus: (request) => invoke('orders:updateStatus', request), list: () => invoke('orders:list'), getById: (id) => invoke('orders:getById', id) },
    inventory: { get: () => invoke('inventory:get'), adjust: (request) => invoke('inventory:adjust', request) },
    cash: { open: (request) => invoke('cash:open', request), close: (request) => invoke('cash:close', request), registerMovement: (request) => invoke('cash:registerMovement', request), getBalance: (id) => invoke('cash:getBalance', id) },
    products: { list: () => invoke('products:list'), create: (request) => invoke('products:create', request), update: (request) => invoke('products:update', request) }
};
contextBridge.exposeInMainWorld('api', api);
//# sourceMappingURL=preload.js.map