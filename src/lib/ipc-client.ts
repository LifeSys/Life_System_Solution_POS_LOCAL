import type { Api } from '../../shared/ipc';

export const missingPreloadApiMessage =
  'Electron preload API no está disponible. La aplicación debe ejecutarse dentro de Electron.';

declare global {
  interface Window {
    api?: Api;
  }
}

export function getApi(): Api {
  if (!window.api) {
    throw new Error(missingPreloadApiMessage);
  }

  return window.api;
}

export function hasApi(): boolean {
  return Boolean(window.api);
}

export const api = new Proxy({} as Api, {
  get(_target, property: keyof Api) {
    return getApi()[property];
  },
});
