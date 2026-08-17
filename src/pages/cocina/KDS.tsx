import { useEffect, useState } from 'react';
import type { OrderListItem, OrderStatus, UserSession } from '../../../shared/ipc';
import { api } from '../../lib/ipc-client';
import { ActionButton } from '../../components/ActionButton';
import { StatusBadge } from '../../components/StatusBadge';
import { conceptIcons, minutesSince } from '../../components/design';

type Notice = { kind: 'ok' | 'error' | 'info'; text: string } | null;
const columns: Array<{ title: string; statuses: OrderStatus[]; next?: OrderStatus; action?: string }> = [
  { title: 'Pendiente', statuses: ['PENDIENTE', 'EN_COCINA'], next: 'EN_PREPARACION', action: 'Preparar' },
  { title: 'Preparando', statuses: ['EN_PREPARACION'], next: 'LISTO', action: 'Listo' },
  { title: 'Listo', statuses: ['LISTO'], next: 'ENTREGADO', action: 'Entregar' },
];

export function KDS({ user, setNotice }: { user: UserSession; setNotice: (n: Notice) => void }) {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const load = async () => { const r = await api.orders.list(user); if (r.ok) setOrders(r.data.filter((o) => ['PENDIENTE','EN_COCINA','EN_PREPARACION','LISTO'].includes(o.estado))); else setNotice({ kind: 'error', text: r.error }); };
  useEffect(() => { void load(); const id = window.setInterval(() => void load(), 5000); return () => window.clearInterval(id); }, [user.id]);
  async function move(order: OrderListItem, estado: OrderStatus) { const r = await api.orders.updateStatus({ orderId: order.id, estado, userId: user.id }); if (r.ok) await load(); else setNotice({ kind: 'error', text: r.error }); }
  return <section className="space-y-5"><header className="flex items-center justify-between"><h2 className="text-5xl font-black text-slate-950">{conceptIcons.kitchen} Cocina</h2><ActionButton variant="ghost" onClick={() => void load()}>Actualizar</ActionButton></header><div className="grid gap-4 xl:grid-cols-3">{columns.map((column) => { const colOrders = orders.filter((o) => column.statuses.includes(o.estado)); return <section key={column.title} className="min-h-[70vh] rounded-3xl bg-white p-4 shadow-xl"><div className="flex items-center justify-between"><h3 className="text-3xl font-black">{column.title}</h3><span className="rounded-full bg-slate-900 px-4 py-2 text-xl font-black text-white">{colOrders.length}</span></div><div className="mt-4 space-y-4">{colOrders.map((order) => <article key={order.id} className="rounded-3xl border-2 border-slate-200 p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-black uppercase text-slate-500">Mesa</p><p className="text-6xl font-black text-brand-600">{order.mesa ?? '—'}</p></div><div className="text-right"><StatusBadge estado={order.estado} /><p className="mt-2 text-2xl font-black">{conceptIcons.time} {minutesSince(order.createdAt)} min</p></div></div><ul className="mt-5 space-y-2 text-xl font-bold">{order.items.map((item) => <li key={item.id} className="rounded-2xl bg-slate-100 p-3">{item.cantidad}× {item.producto} <span className="text-slate-500">{item.variante}</span></li>)}</ul>{order.note && <div className="mt-4 rounded-2xl bg-pos-progress-soft p-3 font-bold text-pos-progress-ink">{order.note}</div>}{column.next && <ActionButton onClick={() => void move(order, column.next!)} className="mt-5 w-full" variant={column.next === 'LISTO' ? 'success' : 'primary'}>{column.action}</ActionButton>}</article>)}</div></section>; })}</div></section>;
}
