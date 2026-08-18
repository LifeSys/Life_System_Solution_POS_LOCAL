import { useEffect, useState } from 'react';
import type { CashRegisterCloseSummary, CashRegisterSummary, UserSession } from '../../../shared/ipc';
import { ActionButton } from '../../components/ActionButton';
import { NumericKeypad } from '../../components/NumericKeypad';
import { StatusBadge } from '../../components/StatusBadge';
import { money } from '../../components/design';
import { api } from '../../lib/ipc-client';

type Notice = { kind: 'ok' | 'error' | 'info'; text: string } | null;

export function Cierre({ cash, user, setNotice, onClosed, onCancel }: { cash: CashRegisterSummary; user: UserSession; setNotice: (n: Notice) => void; onClosed: () => void; onCancel: () => void }) {
  const [summary, setSummary] = useState<CashRegisterCloseSummary | null>(null);
  const [counted, setCounted] = useState('');
  const difference = Number(counted || 0) - Number(summary?.expectedCash ?? 0);
  useEffect(() => { api.cash.getSummary(cash.id).then((r) => r.ok ? setSummary(r.data) : setNotice({ kind: 'error', text: r.error })); }, [cash.id]);
  async function close() {
    if (!window.confirm('El cierre de caja es irreversible. ¿Confirmar cierre?')) return;
    const r = await api.cash.close({ cashRegisterId: cash.id, userId: user.id, countedCash: Number(counted || 0).toFixed(2) });
    if (r.ok) { setNotice({ kind: 'ok', text: 'Caja cerrada correctamente' }); onClosed(); } else setNotice({ kind: 'error', text: r.error });
  }
  if (!summary) return <section className="rounded-3xl bg-white p-8 text-3xl font-black shadow-xl">Calculando arqueo...</section>;
  return <section className="space-y-5"><div className="flex items-center justify-between"><div><h2 className="text-5xl font-black text-slate-950">Cierre de caja</h2><StatusBadge estado={Math.abs(difference) < 0.01 ? 'PAGADO' : 'CANCELADO'} className="mt-2" /></div><ActionButton variant="ghost" onClick={onCancel}>Volver</ActionButton></div><div className="grid gap-4 lg:grid-cols-3"><Metric title="Inicial" value={summary.initialAmount} /><Metric title="Ventas efectivo" value={summary.sales.efectivo} /><Metric title="Ventas tarjeta" value={summary.sales.tarjeta} /><Metric title="Ventas Yape" value={summary.sales.yape} /><Metric title="Ingresos" value={summary.manual.ingresos} /><Metric title="Gastos/Retiros" value={`${summary.manual.gastos} / ${summary.manual.retiros}`} /></div><div className="grid gap-5 xl:grid-cols-[1fr_320px]"><div className="rounded-3xl bg-white p-6 shadow-xl"><p className="text-sm font-black uppercase text-slate-500">Efectivo esperado</p><p className="text-6xl font-black text-brand-600">{summary.expectedCash}</p><p className="mt-6 text-sm font-black uppercase text-slate-500">Efectivo contado</p><p className="text-6xl font-black">{money(counted || 0)}</p><p className={`mt-6 text-4xl font-black ${Math.abs(difference) < 0.01 ? 'text-pos-success' : 'text-pos-danger'}`}>Diferencia {money(difference)}</p><ActionButton className="mt-6 w-full" variant="danger" onClick={() => void close()}>Cerrar caja</ActionButton></div><NumericKeypad value={counted} onChange={setCounted} /></div></section>;
}

function Metric({ title, value }: { title: string; value: string }) { return <div className="rounded-3xl bg-white p-5 shadow-xl"><p className="text-sm font-black uppercase text-slate-500">{title}</p><p className="mt-2 text-3xl font-black text-slate-950">{value}</p></div>; }
