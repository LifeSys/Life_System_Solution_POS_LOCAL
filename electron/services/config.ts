import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DbConfig } from '../../shared/ipc.js';

const configPath = () => join(app.getPath('userData'), 'config.json');
export const hasDbConfig = () => existsSync(configPath());
export const readDbConfig = (): DbConfig | null => hasDbConfig() ? JSON.parse(readFileSync(configPath(), 'utf8')) as DbConfig : null;
export const saveDbConfig = (config: DbConfig) => writeFileSync(configPath(), JSON.stringify(config, null, 2));
export const buildDatabaseUrl = (config: DbConfig) => `postgresql://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@${config.host}:${config.port}/${config.database}?schema=public`;
