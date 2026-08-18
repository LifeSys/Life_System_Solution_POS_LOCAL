import { contextBridge, ipcRenderer } from 'electron';
import type { Api } from '../shared/ipc.js';

const invoke = <T,>(channel: string, payload?: unknown) => ipcRenderer.invoke(channel, payload) as Promise<T>;
const api: Api = {
  config: {
    exists: () => invoke('config:exists'),
    save: (config) => invoke('config:save', config),
    startupState: () => invoke('config:startupState'),
    getPublic: () => invoke('config:getPublic'),
    test: () => invoke('config:test'),
  },
  auth: { login: (request) => invoke('auth:login', request), logout: (userId) => invoke('auth:logout', userId), createInitialAdmin: (request) => invoke('auth:createInitialAdmin', request) },
  dashboard: { summary: (user) => invoke('dashboard:summary', user) },
  users: { list: (actorId) => invoke('users:list', actorId), create: (request) => invoke('users:create', request), update: (request) => invoke('users:update', request) },
  audit: { list: (actorId) => invoke('audit:list', actorId) },
  orders: { create: (request) => invoke('orders:create', request), pay: (request) => invoke('orders:pay', request), updateStatus: (request) => invoke('orders:updateStatus', request), list: (user) => invoke('orders:list', user), getById: (id) => invoke('orders:getById', id) },
  inventory: { get: () => invoke('inventory:get'), adjust: (request) => invoke('inventory:adjust', request) },
  cash: { current: () => invoke('cash:current'), list: () => invoke('cash:list'), open: (request) => invoke('cash:open', request), close: (request) => invoke('cash:close', request), registerMovement: (request) => invoke('cash:registerMovement', request), getSummary: (id) => invoke('cash:getSummary', id), getBalance: (id) => invoke('cash:getBalance', id) },
  products: { list: (includeInactive) => invoke('products:list', includeInactive), create: (request) => invoke('products:create', request), update: (request) => invoke('products:update', request) },
  tables: { list: (user) => invoke('tables:list', user), create: (request) => invoke('tables:create', request), update: (request) => invoke('tables:update', request) }
};
contextBridge.exposeInMainWorld('api', api);
