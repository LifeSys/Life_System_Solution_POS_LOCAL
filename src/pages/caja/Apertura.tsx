import { useState } from 'react';
import type { CashRegisterSummary, UserSession } from '../../../shared/ipc';
import { ActionButton } from '../../components/ActionButton';
import { NumericKeypad } from '../../components/NumericKeypad';
import { StatusBadge } from '../../components/StatusBadge';
import { money } from '../../components/design';
import { api } from '../../lib/ipc-client';

type Notice = { kind: 'ok' | 'error' | 'info'; text: string } | null;

export function Apertura({ user, setNotice, onOpened }: { user: UserSession; setNotice: (n: Notice) => void; onOpened: (cash: CashRegisterSummary) => void }) {
  const [amount, setAmount] = useState('');
  async function open() {
    const r = await api.cash.open({ userId: user.id, initialAmount: Number(amount || 0).toFixed(2) });
    if (r.ok) { setNotice({ kind: 'ok', text: 'Caja abierta correctamente' }); onOpened(r.data); } else setNotice({ kind: 'error', text: r.error });
  }
  return <section className="grid min-h-[70vh] place-items-center"><div className="w-full max-w-3xl rounded-3xl bg-white p-8 shadow-xl"><StatusBadge estado="CAJA_CERRADA" /><h2 className="mt-4 text-5xl font-black text-slate-950">Abrir caja</h2><p className="mt-6 text-sm font-black uppercase text-slate-500">Monto inicial efectivo</p><p className="text-6xl font-black text-brand-600">{money(amount || 0)}</p><div className="mt-6 grid gap-6 md:grid-cols-[1fr_280px]"><div className="rounded-3xl bg-slate-950 p-6 text-white"><p className="text-2xl font-black">Caja bloqueada</p><p className="mt-3 text-lg font-bold text-slate-300">Abre caja para cobrar pedidos o registrar movimientos.</p><ActionButton className="mt-8 w-full" disabled={Number(amount || 0) < 0} onClick={() => void open()}>Abrir caja</ActionButton></div><NumericKeypad value={amount} onChange={setAmount} /></div></div></section>;
}
