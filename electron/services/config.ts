import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DbConfig } from '../../shared/ipc.js';

const configPath = () => join(app.getPath('userData'), 'config.json');

export const hasDbConfig = () => existsSync(configPath());

export const readDbConfig = (): DbConfig | null => {
  if (!hasDbConfig()) return null;
  const parsed = JSON.parse(readFileSync(configPath(), 'utf8')) as DbConfig;
  return { ...parsed, port: Number(parsed.port) };
};

export const saveDbConfig = (config: DbConfig) => {
  writeFileSync(configPath(), JSON.stringify({ ...config, port: Number(config.port) }, null, 2));
};

export const buildDatabaseUrl = (config: DbConfig) => {
  const user = encodeURIComponent(config.user);
  const password = encodeURIComponent(config.password);
  const database = encodeURIComponent(config.database);
  return `postgresql://${user}:${password}@${config.host}:${config.port}/${database}?schema=public`;
};

export const redactDatabaseUrl = (url: string) => url.replace(/(:\/\/[^:]+:)([^@]+)(@)/, '$1*****$3');
