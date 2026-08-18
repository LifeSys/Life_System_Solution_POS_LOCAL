import { useEffect, useState } from 'react';
import type { CashMovementType, CashRegisterSummary, OrderListItem, PaymentMethod, UserSession } from '../../../shared/ipc';
import { api } from '../../lib/ipc-client';
import { ActionButton } from '../../components/ActionButton';
import { NumericKeypad } from '../../components/NumericKeypad';
import { StatusBadge } from '../../components/StatusBadge';
import { conceptIcons, money } from '../../components/design';
import { Apertura } from './Apertura';
import { Cierre } from './Cierre';

type Notice = { kind: 'ok' | 'error' | 'info'; text: string } | null;
type CashView = 'cobro' | 'cierre';

export function Cobro({ user, setNotice }: { user: UserSession; setNotice: (n: Notice) => void }) {
  const [cash, setCash] = useState<CashRegisterSummary | null>(null);
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [selected, setSelected] = useState<OrderListItem | null>(null);
  const [method, setMethod] = useState<PaymentMethod | 'MIXTO'>('EFECTIVO');
  const [received, setReceived] = useState('');
  const [movementOpen, setMovementOpen] = useState(false);
  const [view, setView] = useState<CashView>('cobro');

  const load = async () => {
    const [c, o] = await Promise.all([api.cash.current(), api.orders.list(user)]);
    if (c.ok) setCash(c.data); else setNotice({ kind: 'error', text: c.error });
    if (o.ok) setOrders(o.data.filter((x) => x.estado === 'ENTREGADO')); else setNotice({ kind: 'error', text: o.error });
  };
  useEffect(() => { void load(); const id = window.setInterval(() => void load(), 7000); return () => window.clearInterval(id); }, [user.id]);
  if (!cash) return <Apertura user={user} setNotice={setNotice} onOpened={(opened) => { setCash(opened); void load(); }} />;
  if (view === 'cierre') return <Cierre cash={cash} user={user} setNotice={setNotice} onClosed={() => { setCash(null); setView('cobro'); void load(); }} onCancel={() => setView('cobro')} />;

  async function pay() {
    if (!selected) return;
    const total = Number(selected.total);
    const value = method === 'EFECTIVO' ? Number(received || 0) : total;
    if (method === 'EFECTIVO' && value < total) return setNotice({ kind: 'error', text: 'Efectivo insuficiente' });
    const r = await api.orders.pay({ orderId: selected.id, userId: user.id, paymentMethod: method === 'MIXTO' ? 'EFECTIVO' : method, receivedAmount: method === 'EFECTIVO' ? value.toFixed(2) : undefined, payments: method === 'MIXTO' ? [{ method: 'EFECTIVO', amount: total.toFixed(2) }] : undefined });
    if (r.ok) { setNotice({ kind: 'ok', text: `Pedido pagado. Vuelto ${money(Math.max(0, value - total))}` }); setSelected(null); setReceived(''); await load(); } else setNotice({ kind: 'error', text: r.error });
  }

  return <section className="space-y-5"><header className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-5xl font-black text-slate-950">{conceptIcons.cash} Caja</h2><StatusBadge estado="CAJA_ABIERTA" /></div><div className="flex gap-2"><ActionButton variant="ghost" onClick={() => setMovementOpen(true)}>Movimiento</ActionButton><ActionButton variant="danger" onClick={() => setView('cierre')}>Cerrar caja</ActionButton><ActionButton variant="ghost" onClick={() => void load()}>Actualizar</ActionButton></div></header><div className="grid gap-4 lg:grid-cols-3">{orders.map((order) => <article key={order.id} className="rounded-3xl bg-white p-6 shadow-xl"><p className="text-sm font-black uppercase text-slate-500">Mesa</p><h3 className="text-5xl font-black">{order.mesa}</h3><p className="mt-4 text-5xl font-black text-brand-600">{money(order.total)}</p><StatusBadge estado={order.estado} className="mt-4" /><ActionButton className="mt-5 w-full" onClick={() => { setSelected(order); setReceived(order.total); setMethod('EFECTIVO'); }}>Cobrar</ActionButton></article>)}{!orders.length && <p className="rounded-3xl bg-white p-8 text-3xl font-black text-slate-500">Sin pedidos por cobrar</p>}</div>{selected && <PaymentModal order={selected} method={method} setMethod={setMethod} received={received} setReceived={setReceived} onClose={() => setSelected(null)} onPay={() => void pay()} />}{movementOpen && <MovementModal cash={cash} user={user} setNotice={setNotice} onClose={() => setMovementOpen(false)} onDone={async () => { setMovementOpen(false); await load(); }} />}</section>;
}

function PaymentModal({ order, method, setMethod, received, setReceived, onClose, onPay }: { order: OrderListItem; method: PaymentMethod | 'MIXTO'; setMethod: (m: PaymentMethod | 'MIXTO') => void; received: string; setReceived: (v: string) => void; onClose: () => void; onPay: () => void }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-4"><section className="w-full max-w-3xl rounded-3xl bg-white p-6 shadow-2xl"><div className="flex justify-between gap-4"><div><h3 className="text-4xl font-black">{order.mesa}</h3><p className="text-xl font-bold">Pedido #{order.id.slice(-6)}</p></div><ActionButton variant="ghost" onClick={onClose}>Cerrar</ActionButton></div><div className="mt-5 grid gap-2">{order.items.map((item) => <div key={item.id} className="flex justify-between rounded-2xl bg-slate-100 p-3 text-lg font-bold"><span>{item.cantidad}× {item.producto} {item.variante}</span><span>{money(item.subtotal)}</span></div>)}</div><p className="mt-6 text-right text-6xl font-black text-brand-600">{money(order.total)}</p><div className="mt-5 grid grid-cols-4 gap-2">{(['EFECTIVO','TARJETA','YAPE','MIXTO'] as const).map((m) => <ActionButton key={m} variant={method === m ? 'primary' : 'ghost'} onClick={() => setMethod(m)}>{m}</ActionButton>)}</div>{method === 'EFECTIVO' && <div className="mt-5 grid gap-4 md:grid-cols-[1fr_280px]"><div className="rounded-3xl bg-slate-950 p-5 text-white"><p className="text-sm font-black uppercase text-slate-400">Recibido</p><p className="text-6xl font-black">{money(received || 0)}</p><p className="mt-4 text-3xl font-black text-pos-success">Vuelto {money(Math.max(0, Number(received || 0) - Number(order.total)))}</p></div><NumericKeypad value={received} onChange={setReceived} /></div>}<ActionButton className="mt-6 w-full" variant="success" onClick={onPay}>Confirmar pago</ActionButton></section></div>;
}

function MovementModal({ cash, user, setNotice, onClose, onDone }: { cash: CashRegisterSummary; user: UserSession; setNotice: (n: Notice) => void; onClose: () => void; onDone: () => Promise<void> }) {
  const [tipo, setTipo] = useState<Extract<CashMovementType, 'GASTO' | 'INGRESO' | 'RETIRO'>>('GASTO');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  async function confirm() {
    const r = await api.cash.registerMovement({ cashRegisterId: cash.id, userId: user.id, tipo, monto: Number(amount || 0).toFixed(2), detalle: { motivo: reason } });
    if (r.ok) { setNotice({ kind: 'ok', text: 'Movimiento registrado' }); await onDone(); } else setNotice({ kind: 'error', text: r.error });
  }
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-4"><section className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl"><div className="flex justify-between"><h3 className="text-4xl font-black">Movimiento</h3><ActionButton variant="ghost" onClick={onClose}>Cerrar</ActionButton></div><div className="mt-5 grid grid-cols-3 gap-2">{(['GASTO','INGRESO','RETIRO'] as const).map((m) => <ActionButton key={m} variant={tipo === m ? 'primary' : 'ghost'} onClick={() => setTipo(m)}>{m}</ActionButton>)}</div><div className="mt-5 grid gap-4 md:grid-cols-[1fr_280px]"><div><p className="text-sm font-black uppercase text-slate-500">Monto</p><p className="text-6xl font-black text-brand-600">{money(amount || 0)}</p><input value={reason} onChange={(e) => setReason(e.target.value)} className="input input-light mt-5 min-h-touch" placeholder="Motivo opcional" /><ActionButton disabled={Number(amount || 0) <= 0} className="mt-5 w-full" onClick={() => void confirm()}>Registrar</ActionButton></div><NumericKeypad value={amount} onChange={setAmount} /></div></section></div>;
}
