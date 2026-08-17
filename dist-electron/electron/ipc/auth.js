import { ipcMain } from 'electron';
import bcrypt from 'bcryptjs';
import { getPrisma } from '../data/prisma.js';
const wrap = async (fn) => { try {
    return { ok: true, data: await fn() };
}
catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
} };
export function registerAuthIpc() {
    ipcMain.handle('auth:login', (_e, req) => wrap(async () => {
        const users = await getPrisma().user.findMany({ where: { activo: true } });
        const user = users.find((u) => bcrypt.compareSync(req.pin, u.pin_hash));
        if (!user)
            throw new Error('PIN inválido');
        return { id: user.id, nombre: user.nombre, rol: user.rol };
    }));
    ipcMain.handle('auth:logout', () => ({ ok: true, data: true }));
}
//# sourceMappingURL=auth.js.map