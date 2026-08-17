import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { app } from 'electron';
import { join } from 'node:path';
import { buildDatabaseUrl, readDbConfig } from '../services/config.js';
let prisma = null;
export function getPrisma() {
    if (!prisma) {
        const config = readDbConfig();
        if (!config)
            throw new Error('Database configuration is missing');
        process.env.DATABASE_URL = buildDatabaseUrl(config);
        prisma = new PrismaClient();
    }
    return prisma;
}
export function resetPrisma() { prisma?.$disconnect(); prisma = null; }
export function runMigrations() {
    const config = readDbConfig();
    if (!config)
        return;
    process.env.DATABASE_URL = buildDatabaseUrl(config);
    const schema = app.isPackaged ? join(process.resourcesPath, 'prisma', 'schema.prisma') : join(process.cwd(), 'prisma', 'schema.prisma');
    const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['prisma', 'migrate', 'deploy', '--schema', schema], { stdio: 'inherit', env: process.env });
    if (result.status !== 0)
        throw new Error('Prisma migrations failed');
}
//# sourceMappingURL=prisma.js.map