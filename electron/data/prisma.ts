import { PrismaClient } from '@prisma/client';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, delimiter, dirname, join } from 'node:path';
import { app } from 'electron';
import { buildDatabaseUrl, readDbConfig, redactDatabaseUrl } from '../services/config.js';
import type { DbConfig } from '../../shared/ipc.js';

let prisma: PrismaClient | null = null;

export type StartupState = {
  configured: boolean;
  databaseReady: boolean;
  needsAdmin: boolean;
  message?: string;
  detail?: string;
};

type MigrationFailure = {
  message: string;
  detail: string;
  command: string;
  schemaPath: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export class MigrationError extends Error {
  readonly info: MigrationFailure;
  constructor(info: MigrationFailure) {
    super(`${info.message}\nDetalle: ${info.detail}`);
    this.name = 'MigrationError';
    this.info = info;
  }
}

export function getPrisma() {
  if (!prisma) {
    const config = readDbConfig();
    if (!config) throw new Error('Falta la configuración de PostgreSQL.');
    process.env.DATABASE_URL = buildDatabaseUrl(config);
    prisma = new PrismaClient();
  }
  return prisma;
}

export function resetPrisma() {
  const current = prisma;
  prisma = null;
  if (current) {
    current.$disconnect().catch((error: unknown) => {
      console.error('No se pudo cerrar la conexión anterior de Prisma:', formatUnknownError(error));
    });
  }
}

export async function checkDatabaseHealth(config: DbConfig = requireDbConfig()) {
  const url = buildDatabaseUrl(config);
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    await client.$queryRaw`SELECT 1`;
    return { ok: true as const, message: 'Conexión correcta con PostgreSQL.' };
  } catch (error) {
    return { ok: false as const, message: classifyDatabaseError(error, config), detail: sanitizeError(error) };
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}

export async function runMigrations(config: DbConfig = requireDbConfig()) {
  process.env.DATABASE_URL = buildDatabaseUrl(config);
  const schemaPath = getSchemaPath();
  const prismaCommand = getPrismaCommand();
  const result = await runCommand(prismaCommand.command, [...prismaCommand.args, 'migrate', 'deploy', '--schema', schemaPath], {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL,
    PATH: getPrismaPathEnv(),
    ELECTRON_RUN_AS_NODE: prismaCommand.usesElectronAsNode ? '1' : process.env.ELECTRON_RUN_AS_NODE,
  });
  if (result.exitCode !== 0) {
    const detail = sanitizeText(result.stderr || result.stdout || 'Prisma terminó sin detalle adicional.');
    throw new MigrationError({
      message: 'No se pudo ejecutar la migración de PostgreSQL.',
      detail,
      command: `${basename(prismaCommand.command)} ${[...prismaCommand.args, 'migrate', 'deploy', '--schema', schemaPath].join(' ')}`,
      schemaPath,
      exitCode: result.exitCode,
      stdout: sanitizeText(result.stdout),
      stderr: sanitizeText(result.stderr),
    });
  }
  return { stdout: sanitizeText(result.stdout), stderr: sanitizeText(result.stderr), schemaPath };
}

export async function prepareDatabase(config: DbConfig = requireDbConfig()) {
  const health = await checkDatabaseHealth(config);
  if (!health.ok) throw new Error(`${health.message}\nDetalle: ${health.detail}`);
  await runMigrations(config);
  resetPrisma();
  const userCount = await getPrisma().user.count();
  return { needsAdmin: userCount === 0 };
}

export async function getStartupState(): Promise<StartupState> {
  const config = readDbConfig();
  if (!config) return { configured: false, databaseReady: false, needsAdmin: false };
  try {
    const result = await prepareDatabase(config);
    return { configured: true, databaseReady: true, needsAdmin: result.needsAdmin };
  } catch (error) {
    return { configured: true, databaseReady: false, needsAdmin: false, message: 'No se pudo inicializar PostgreSQL.', detail: sanitizeError(error) };
  }
}

function requireDbConfig() {
  const config = readDbConfig();
  if (!config) throw new Error('Falta la configuración de PostgreSQL.');
  return config;
}

function getSchemaPath() {
  return app.isPackaged ? join(process.resourcesPath, 'prisma', 'schema.prisma') : join(process.cwd(), 'prisma', 'schema.prisma');
}

function getPrismaCommand() {
  const cli = app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'prisma', 'build', 'index.js')
    : join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
  if (!existsSync(cli)) {
    const location = app.isPackaged ? 'empaquetado' : 'local';
    throw new Error(`No se encontró Prisma CLI ${location} en ${cli}. Ejecuta npm install.`);
  }
  return { command: process.execPath, args: [cli], usesElectronAsNode: true };
}

function getPrismaPathEnv() {
  return [join(process.cwd(), 'node_modules', '.bin'), process.env.PATH ?? ''].join(delimiter);
}

function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { env, cwd: process.cwd(), windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

function classifyDatabaseError(error: unknown, config: DbConfig) {
  const text = sanitizeError(error).toLowerCase();
  if (text.includes('authentication failed') || text.includes('password authentication failed') || text.includes('invalid password')) return 'Usuario o contraseña de PostgreSQL incorrectos.';
  if (text.includes('does not exist') && text.includes('database')) return `La base de datos "${config.database}" no existe.`;
  if (text.includes('connect') || text.includes('econnrefused') || text.includes('timed out') || text.includes('p1001')) return `PostgreSQL no está disponible en ${config.host}:${config.port}.`;
  return 'No se pudo conectar correctamente con PostgreSQL.';
}

function sanitizeError(error: unknown) {
  return sanitizeText(formatUnknownError(error));
}

function formatUnknownError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function sanitizeText(value: string) {
  const config = readDbConfig();
  let sanitized = value.replace(/postgresql:\/\/[^\s]+/g, (url) => redactDatabaseUrl(url));
  if (config?.password) sanitized = sanitized.split(config.password).join('*****');
  return sanitized.trim();
}
