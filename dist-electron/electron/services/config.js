import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const configPath = () => join(app.getPath('userData'), 'config.json');
export const hasDbConfig = () => existsSync(configPath());
export const readDbConfig = () => hasDbConfig() ? JSON.parse(readFileSync(configPath(), 'utf8')) : null;
export const saveDbConfig = (config) => writeFileSync(configPath(), JSON.stringify(config, null, 2));
export const buildDatabaseUrl = (config) => `postgresql://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@${config.host}:${config.port}/${config.database}?schema=public`;
//# sourceMappingURL=config.js.map