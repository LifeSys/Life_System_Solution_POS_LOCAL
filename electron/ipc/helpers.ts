import type { Prisma, UserRole } from '@prisma/client';

export const wrap = async <T>(fn: () => Promise<T> | T) => {
  try {
    return { ok: true as const, data: await fn() };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : 'Unknown error' };
  }
};

export async function requireRole(tx: Prisma.TransactionClient, userId: string, allowed: UserRole[]) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, rol: true, activo: true } });
  if (!user || !user.activo) throw new Error('Usuario no autorizado');
  if (!allowed.includes(user.rol)) throw new Error('Permisos insuficientes');
  return user;
}

export function toMoney(value: { toString(): string } | string | number) {
  return Number(value.toString()).toFixed(2);
}

export function safeDetail<T>(detail: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(detail)) as Prisma.InputJsonValue;
}
