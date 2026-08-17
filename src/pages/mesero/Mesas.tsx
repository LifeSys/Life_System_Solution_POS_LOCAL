import { useEffect, useState } from 'react';
import type { OrderListItem, ProductListItem, RestaurantTableItem, UserSession } from '../../../shared/ipc';
import { api } from '../../lib/ipc-client';
import { ActionButton } from '../../components/ActionButton';
import { StatusBadge } from '../../components/StatusBadge';
import { conceptIcons, minutesSince, money } from '../../components/design';

type Notice = { kind: 'ok' | 'error' | 'info'; text: string } | null;

type CartItem = { variantId: string; product: string; variant: string; cantidad: number; precio: number; stock: number };

export function Mesas({ user, setNotice }: { user: UserSession; setNotice: (n: Notice) => void }) {
  const [tables, setTables] = useState<RestaurantTableItem[]>([]);
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [selected, setSelected] = useState<RestaurantTableItem | null>(null);
  const load = async () => {
    const [t, o] = await Promise.all([api.tables.list(user), api.orders.list(user)]);
    if (t.ok) setTables(t.data); else setNotice({ kind: 'error', text: t.error });
    if (o.ok) setOrders(o.data); else setNotice({ kind: 'error', text: o.error });
  };
  useEffect(() => { void load(); }, [user.id]);
  if (selected) return <Pedido user={user} table={selected} activeOrder={orders.find((o) => o.id === selected.activeOrderId) ?? null} onBack={() => setSelected(null)} onDone={async () => { setSelected(null); await load(); }} setNotice={setNotice} />;
  return <section className="space-y-6"><header className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-4xl font-black text-slate-950">Mesas</h2><div className="mt-3 flex gap-2"><StatusBadge estado="DISPONIBLE" /><StatusBadge estado="OCUPADA" /><StatusBadge estado="RESERVADA" /></div></div><ActionButton variant="ghost" onClick={() => void load()}>Actualizar</ActionButton></header><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">{tables.filter((t) => t.activa).map((table) => { const order = orders.find((o) => o.id === table.activeOrderId); return <button key={table.id} onClick={() => setSelected(table)} className={`pos-table-card ${table.estado === 'OCUPADA' ? 'pos-table-busy' : table.estado === 'RESERVADA' ? 'pos-table-reserved' : 'pos-table-free'}`}><span className="text-5xl">{conceptIcons.table}</span><strong className="mt-3 text-3xl">{table.nombre}</strong><StatusBadge estado={table.estado} className="mt-3" />{table.estado === 'OCUPADA' && <div className="mt-4 grid gap-1 text-left"><span className="text-2xl font-black">{money(table.activeOrderTotal ?? order?.total ?? 0)}</span><span className="font-bold text-slate-600">{order ? `${minutesSince(order.createdAt)} min` : 'Pedido abierto'}</span></div>}<span className="mt-3 text-sm font-bold text-slate-500">Cap. {table.capacidad}</span></button>; })}</div></section>;
}

function Pedido({ user, table, activeOrder, onBack, onDone, setNotice }: { user: UserSession; table: RestaurantTableItem; activeOrder: OrderListItem | null; onBack: () => void; onDone: () => Promise<void>; setNotice: (n: Notice) => void }) {
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('TODOS');
  useEffect(() => { api.products.list(false).then((r) => r.ok ? setProducts(r.data) : setNotice({ kind: 'error', text: r.error })); }, []);
  const categories = ['TODOS', ...Array.from(new Set(products.map((p) => p.categoria)))];
  const visible = products.filter((p) => p.activo && (category === 'TODOS' || p.categoria === category) && p.nombre.toLowerCase().includes(search.toLowerCase()));
  const total = cart.reduce((sum, i) => sum + i.precio * i.cantidad, 0);
  const invalid = !!activeOrder || !cart.length || cart.some((i) => i.cantidad <= 0 || i.cantidad > i.stock);
  function add(product: ProductListItem, variant = product.variants[0]) {
    if (!variant) return setNotice({ kind: 'error', text: 'Producto sin precio disponible' });
    const current = cart.find((i) => i.variantId === variant.id)?.cantidad ?? 0;
    if (current + 1 > variant.stock) return setNotice({ kind: 'error', text: `Stock insuficiente: ${product.nombre} ${variant.nombre}` });
    setCart((prev) => prev.some((i) => i.variantId === variant.id) ? prev.map((i) => i.variantId === variant.id ? { ...i, cantidad: i.cantidad + 1 } : i) : [...prev, { variantId: variant.id, product: product.nombre, variant: variant.nombre, cantidad: 1, precio: Number(variant.precio), stock: variant.stock }]);
  }
  async function send() {
    const r = await api.orders.create({ userId: user.id, tableId: table.id, mesa: table.nombre, note, items: cart.map((i) => ({ variantId: i.variantId, cantidad: i.cantidad })) });
    if (r.ok) { setNotice({ kind: 'ok', text: `Pedido #${r.data.id.slice(-6)} enviado a cocina` }); await onDone(); } else setNotice({ kind: 'error', text: r.error });
  }
  return <section className="space-y-4"><div className="flex items-center justify-between"><ActionButton variant="ghost" onClick={onBack}>← Mesas</ActionButton><div className="text-right"><h2 className="text-4xl font-black text-slate-950">{table.nombre}</h2><StatusBadge estado={table.estado} /></div></div>{activeOrder ? <article className="rounded-3xl bg-white p-8 shadow-xl"><h3 className="text-4xl font-black">Pedido #{activeOrder.id.slice(-6)}</h3><p className="mt-3 text-5xl font-black text-brand-600">{money(activeOrder.total)}</p><StatusBadge estado={activeOrder.estado} className="mt-4" /></article> : <div className="grid gap-5 xl:grid-cols-[1fr_420px]"><section className="rounded-3xl bg-white p-5 shadow-xl"><div className="flex gap-3 overflow-x-auto pb-2">{categories.map((c) => <ActionButton key={c} variant={category === c ? 'primary' : 'ghost'} onClick={() => setCategory(c)}>{c}</ActionButton>)}</div><input value={search} onChange={(e) => setSearch(e.target.value)} className="input input-light mt-4 min-h-touch text-lg" placeholder="Buscar" /><div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{visible.map((p) => <article key={p.id} className="rounded-3xl border border-slate-200 p-4"><h3 className="text-2xl font-black">{p.nombre}</h3><div className="mt-4 grid gap-2">{p.variants.map((v) => <ActionButton key={v.id} disabled={v.stock <= 0} variant="secondary" onClick={() => add(p, v)} className="justify-start text-left normal-case">{v.nombre} · {money(v.precio)}</ActionButton>)}</div></article>)}</div></section><aside className="sticky top-24 rounded-3xl bg-slate-950 p-5 text-white shadow-xl"><h3 className="text-3xl font-black">Pedido actual</h3><div className="mt-4 space-y-3">{cart.map((i) => <div key={i.variantId} className="rounded-2xl bg-white/10 p-3"><b>{i.product}</b><p>{i.variant} · {money(i.precio)}</p><div className="mt-2 flex items-center gap-2"><ActionButton size="md" variant="ghost" onClick={() => setCart(cart.map((x) => x.variantId === i.variantId ? { ...x, cantidad: Math.max(1, x.cantidad - 1) } : x))}>-</ActionButton><span className="text-2xl font-black">{i.cantidad}</span><ActionButton size="md" variant="ghost" onClick={() => i.cantidad < i.stock && setCart(cart.map((x) => x.variantId === i.variantId ? { ...x, cantidad: x.cantidad + 1 } : x))}>+</ActionButton></div></div>)}</div><textarea value={note} onChange={(e) => setNote(e.target.value)} className="input mt-4 min-h-24" placeholder="Observaciones" /><div className="mt-5 border-t border-white/20 pt-5"><p className="text-sm font-bold uppercase text-slate-400">Total</p><p className="text-5xl font-black">{money(total)}</p><ActionButton disabled={invalid} onClick={() => void send()} className="mt-4 w-full">Enviar a cocina</ActionButton></div></aside></div>}</section>;
}
