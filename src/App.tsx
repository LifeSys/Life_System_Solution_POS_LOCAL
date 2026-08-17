import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api, missingPreloadApiMessage } from './lib/ipc-client';
import type { AuditLogItem, CashRegisterSummary, DashboardSummary, InventoryItem, OrderListItem, OrderStatus, PaymentMethod, ProductListItem, RestaurantTableItem, StartupState, UserRole, UserSession, UserSummary } from '../shared/ipc';

type ModuleKey = 'mesas' | 'cocina' | 'caja' | 'admin' | 'inventario' | 'reportes' | 'comprobantes';
type Notice = { kind: 'ok' | 'error' | 'info'; text: string } | null;
type BoardColumn = { key: 'PENDIENTE' | 'EN_PREPARACION' | 'LISTO' | 'ENTREGADO'; title: string; accent: string; helper: string };
const roles: UserRole[] = ['ADMIN', 'CAJERO', 'MESERO', 'COCINA'];
const statuses: OrderStatus[] = ['PENDIENTE', 'EN_COCINA', 'EN_PREPARACION', 'LISTO', 'ENTREGADO', 'PAGADO', 'CANCELADO'];
const money = (value: string | number) => `S/ ${Number(value || 0).toFixed(2)}`;
const boardColumns: BoardColumn[] = [
  { key: 'PENDIENTE', title: 'PENDIENTES', accent: 'border-amber-400 bg-amber-50 text-amber-900', helper: 'Pedidos por iniciar' },
  { key: 'EN_PREPARACION', title: 'EN PREPARACIÓN', accent: 'border-sky-400 bg-sky-50 text-sky-900', helper: 'Cocina trabajando' },
  { key: 'LISTO', title: 'LISTOS', accent: 'border-emerald-400 bg-emerald-50 text-emerald-900', helper: 'Para llevar a mesa' },
  { key: 'ENTREGADO', title: 'ENTREGADOS', accent: 'border-slate-400 bg-slate-100 text-slate-900', helper: 'Pendientes de cobro' },
];

export default function App() {
  if (!window.api) return <PreloadDiagnostic />;
  const [startup, setStartup] = useState<StartupState | null>(null);
  const [message, setMessage] = useState('');
  const [user, setUser] = useState<UserSession | null>(null);
  useEffect(() => { void refreshStartup(setStartup, setMessage); }, []);
  if (startup === null) return <main className="p-8">Cargando...</main>;
  if (!startup.configured) return <ConfigScreen onDone={setStartup} setMessage={setMessage} message={message} />;
  if (!startup.databaseReady) return <DatabaseErrorScreen startup={startup} onRetry={setStartup} message={message} setMessage={setMessage} />;
  if (startup.needsAdmin) return <InitialAdminScreen onDone={() => setStartup({ ...startup, needsAdmin: false })} setMessage={setMessage} message={message} />;
  if (user) return <AuthenticatedApp user={user} onLogout={() => setUser(null)} />;
  return <LoginScreen onLogin={setUser} message={message} setMessage={setMessage} />;
}

async function refreshStartup(setStartup: (s: StartupState) => void, setMessage: (m: string) => void) {
  try {
    const r = await api.config.startupState();
    if (r.ok) setStartup(r.data); else { setMessage(r.error); setStartup({ configured: true, databaseReady: false, needsAdmin: false }); }
  } catch (error) {
    setMessage(error instanceof Error ? error.message : 'No se pudo consultar el estado inicial.');
    setStartup({ configured: true, databaseReady: false, needsAdmin: false });
  }
}

function PreloadDiagnostic() {
  return <main className="mx-auto mt-16 max-w-2xl rounded-2xl bg-amber-950 p-8 shadow-xl"><h1 className="text-2xl font-bold text-amber-100">API de Electron no disponible</h1><p className="mt-4 text-amber-100">{missingPreloadApiMessage}</p></main>;
}

function ConfigScreen({ onDone, message, setMessage }: { onDone: (state: StartupState) => void; message: string; setMessage: (m: string) => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage('Probando conexión y ejecutando migraciones...');
    const form = new FormData(event.currentTarget);
    const result = await api.config.save({ host: String(form.get('host')), port: Number(form.get('port')), user: String(form.get('user')), password: String(form.get('password')), database: String(form.get('database')) });
    if (result.ok) { setMessage(''); onDone(result.data); } else setMessage(result.error);
  }
  return <AuthCard title="Configurar PostgreSQL local"><p className="mt-2 text-slate-300">Se guardará en userData/config.json y se ejecutarán migraciones automáticamente.</p><form onSubmit={submit} className="mt-6 grid gap-4"><input name="host" defaultValue="localhost" className="input" placeholder="Host" /><input name="port" defaultValue="5432" type="number" className="input" placeholder="Puerto" /><input name="user" className="input" placeholder="Usuario" /><input name="password" type="password" className="input" placeholder="Password" /><input name="database" className="input" placeholder="Base de datos" />{message && <p className="text-red-300">{message}</p>}<button className="btn-primary">Guardar y migrar</button></form></AuthCard>;
}

function DatabaseErrorScreen({ startup, onRetry, message, setMessage }: { startup: StartupState; onRetry: (state: StartupState) => void; message: string; setMessage: (m: string) => void }) {
  async function retry() { setMessage('Reintentando conexión y migraciones...'); await refreshStartup(onRetry, setMessage); }
  return <AuthCard title="No se pudo inicializar PostgreSQL"><p className="mt-4 whitespace-pre-wrap rounded bg-slate-800 p-4 text-red-100">{startup.detail || startup.message || message}</p><button onClick={retry} className="btn-primary mt-6">Reintentar</button></AuthCard>;
}

function InitialAdminScreen({ onDone, message, setMessage }: { onDone: () => void; message: string; setMessage: (m: string) => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const result = await api.auth.createInitialAdmin({ nombre: String(form.get('nombre')), pin: String(form.get('pin')) }); if (result.ok) { setMessage('ADMIN inicial creado. Ingresa con el PIN configurado.'); onDone(); } else setMessage(result.error); }
  return <AuthCard title="Crear ADMIN inicial"><p className="mt-2 text-slate-300">Define el primer ADMIN sin usar un PIN hardcodeado.</p><form onSubmit={submit} className="mt-6 grid gap-4"><input name="nombre" className="input" placeholder="Nombre del ADMIN" /><input name="pin" type="password" className="input" placeholder="PIN (4 a 12 dígitos)" />{message && <p className="text-red-300">{message}</p>}<button className="btn-primary">Crear ADMIN</button></form></AuthCard>;
}

function LoginScreen({ onLogin, message, setMessage }: { onLogin: (user: UserSession) => void; message: string; setMessage: (m: string) => void }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setIsSubmitting(true); setMessage(''); const form = event.currentTarget; const pin = String(new FormData(form).get('pin'));
    try { const result = await api.auth.login({ pin }); if (result.ok) { form.reset(); onLogin(result.data); } else setMessage(result.error); } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo iniciar sesión.'); } finally { setIsSubmitting(false); }
  }
  return <AuthCard title="Life System POS"><p className="mt-2 text-slate-300">Login por PIN usando IPC seguro.</p><form onSubmit={submit} className="mt-6 grid gap-4"><input name="pin" type="password" className="input text-center text-2xl tracking-widest" placeholder="PIN" /><button disabled={isSubmitting} className="btn-primary disabled:opacity-60">{isSubmitting ? 'Ingresando...' : 'Ingresar'}</button></form>{message && <p className="mt-4 rounded bg-slate-800 p-3">{message}</p>}</AuthCard>;
}

function AuthCard({ title, children }: { title: string; children: React.ReactNode }) { return <main className="flex min-h-screen items-center justify-center p-8"><section className="w-full max-w-xl rounded-2xl bg-slate-900 p-8 shadow-xl"><h1 className="text-3xl font-bold">{title}</h1>{children}</section></main>; }

function AuthenticatedApp({ user, onLogout }: { user: UserSession; onLogout: () => void }) {
  const modules = allowedModules(user.rol);
  const [active, setActive] = useState<ModuleKey>(modules[0]);
  const [db, setDb] = useState<{ connected: boolean; message: string }>({ connected: false, message: 'Verificando...' });
  const [notice, setNotice] = useState<Notice>(null);
  useEffect(() => { void checkDb(setDb); }, []);
  async function logout() { const result = await api.auth.logout(user.id); if (!result.ok) setNotice({ kind: 'error', text: result.error }); else onLogout(); }
  return <div className="min-h-screen bg-slate-100 text-slate-900"><header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3 shadow-sm"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-600 font-bold text-white">LS</div><div><h1 className="text-lg font-bold">{roleTitle(user.rol)}</h1><p className="text-xs text-slate-500">Life System POS · único local operativo</p></div></div><nav className="flex flex-wrap gap-2">{modules.map((m) => <button key={m} onClick={() => setActive(m)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${active === m ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{moduleLabel(m)}</button>)}</nav><div className="flex items-center gap-2 text-sm"><span>{user.nombre}</span><span className="rounded-full bg-slate-100 px-2 py-1">{user.rol}</span><button onClick={logout} className="btn-danger">Salir</button></div></header><main className="p-4 lg:p-6">{notice && <NoticeBox notice={notice} onClose={() => setNotice(null)} />}{renderModule(active, user, setNotice, db, setDb)}</main></div>;
}
function renderModule(active: ModuleKey, user: UserSession, setNotice: (n: Notice) => void, db: { connected: boolean; message: string }, setDb: (d: { connected: boolean; message: string }) => void) {
  if (active === 'mesas') return <Sales user={user} setNotice={setNotice} />;
  if (active === 'cocina') return <Orders user={user} setNotice={setNotice} />;
  if (active === 'caja') return <Cash user={user} setNotice={setNotice} />;
  if (active === 'admin') return <Admin user={user} setNotice={setNotice} />;
  if (active === 'inventario') return <Inventory user={user} setNotice={setNotice} />;
  if (active === 'reportes') return <><Dashboard user={user} /><Audit user={user} /></>;
  if (active === 'comprobantes') return <Panel title="Comprobantes"><p>Módulo preparado para comprobantes internos. SUNAT queda fuera de alcance por ahora.</p></Panel>;
  return <Settings db={db} setDb={setDb} />;
}
function roleTitle(role: UserRole) { return role === 'ADMIN' ? 'Administración' : role === 'CAJERO' ? 'Cajera' : role === 'MESERO' ? 'Mesero' : 'Cocina'; }
function allowedModules(role: UserRole): ModuleKey[] { if (role === 'ADMIN') return ['mesas','cocina','caja','admin','inventario','reportes','comprobantes']; if (role === 'CAJERO') return ['mesas','cocina','caja']; if (role === 'MESERO') return ['mesas']; return ['cocina']; }
function moduleLabel(m: ModuleKey) { return ({ mesas: 'Mesas', cocina: 'Cocina', caja: 'Caja', admin: 'Admin', inventario: 'Inventario', reportes: 'Reportes', comprobantes: 'Comprobantes' } as Record<ModuleKey, string>)[m]; }
async function checkDb(setDb: (d: { connected: boolean; message: string }) => void) { const r = await api.config.test(); setDb(r.ok ? r.data : { connected: false, message: r.error }); }
function NoticeBox({ notice, onClose }: { notice: NonNullable<Notice>; onClose: () => void }) { return <div className={`mb-4 rounded-lg p-3 ${notice.kind === 'error' ? 'bg-red-950 text-red-100' : notice.kind === 'ok' ? 'bg-emerald-950 text-emerald-100' : 'bg-blue-950 text-blue-100'}`}><button onClick={onClose} className="float-right">×</button>{notice.text}</div>; }

function Dashboard({ user }: { user: UserSession }) {
  const [data, setData] = useState<DashboardSummary | null>(null); const [error, setError] = useState('');
  useEffect(() => { api.dashboard.summary(user).then((r) => r.ok ? setData(r.data) : setError(r.error)).catch((e: unknown) => setError(String(e))); }, [user]);
  if (error) return <Panel title="Dashboard"><p className="text-red-300">{error}</p></Panel>; if (!data) return <Panel title="Dashboard">Cargando métricas...</Panel>;
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><Metric title="Ventas del día" value={Number(data.salesToday) ? money(data.salesToday) : 'Sin ventas'} /><Metric title="Pedidos del día" value={data.ordersToday || 'Sin pedidos'} /><Metric title="Productos registrados" value={data.productsCount || 'Sin productos'} /><Metric title="Stock bajo" value={data.lowStockCount} /><Metric title="Caja" value={`${data.cashStatus} · ${money(data.cashBalance)}`} /><Metric title="Usuario" value={`${data.currentUser.nombre} (${data.currentUser.rol})`} /><Metric title="PostgreSQL" value={data.database.connected ? 'Conectado' : 'Desconectado'} /><div className="rounded-xl bg-slate-900 p-5 shadow md:col-span-2 xl:col-span-3"><h3 className="font-semibold">Últimas ventas</h3><Table headers={['Hora','Pedido','Usuario','Total','Método']} rows={data.latestSales.map((sale) => [new Date(sale.time).toLocaleTimeString(), sale.orderId.slice(-6), sale.userName, money(sale.total), sale.paymentMethod ?? '—'])} /></div></div>;
}
function Metric({ title, value }: { title: string; value: React.ReactNode }) { return <div className="rounded-xl bg-slate-900 p-5 shadow"><p className="text-sm text-slate-400">{title}</p><p className="mt-2 text-2xl font-bold">{value}</p></div>; }

function Products({ user, setNotice }: { user: UserSession; setNotice: (n: Notice) => void }) {
  const [products, setProducts] = useState<ProductListItem[]>([]); const [edit, setEdit] = useState<ProductListItem | null>(null); const canEdit = user.rol === 'ADMIN';
  const load = async () => { const r = await api.products.list(true); if (r.ok) setProducts(r.data); else setNotice({ kind: 'error', text: r.error }); };
  useEffect(() => { void load(); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const f = new FormData(event.currentTarget); const payload = { actorId: user.id, nombre: String(f.get('nombre')), categoria: String(f.get('categoria')), tipo: (String(f.get('tipo') || 'CON_VARIANTES') as any), variants: [{ id: edit?.variants[0]?.id, nombre: String(f.get('variante')), precio: String(f.get('precio')), stock: Number(f.get('stock') || 0) }] }; const r = edit ? await api.products.update({ ...payload, id: edit.id }) : await api.products.create(payload); if (r.ok) { setNotice({ kind: 'ok', text: 'Producto guardado correctamente' }); setEdit(null); event.currentTarget.reset(); await load(); } else setNotice({ kind: 'error', text: r.error }); }
  return <Panel title="Productos">{canEdit && <form onSubmit={submit} className="grid gap-3 rounded-xl bg-slate-800 p-4 md:grid-cols-3"><input name="nombre" defaultValue={edit?.nombre} className="input" placeholder="Producto" required /><input name="categoria" defaultValue={edit?.categoria} className="input" placeholder="Categoría" required /><select name="tipo" defaultValue={edit?.tipo ?? 'CON_VARIANTES'} className="input"><option value="PIZZA">Pizza</option><option value="CON_VARIANTES">Producto con variantes</option><option value="SIN_VARIANTES">Producto sin variantes</option></select><input name="variante" defaultValue={edit?.variants[0]?.nombre} className="input" placeholder="Variante" required /><input name="precio" defaultValue={edit?.variants[0]?.precio} className="input" placeholder="Precio" type="number" step="0.01" required /><input name="stock" defaultValue={edit ? undefined : 0} className="input" placeholder="Stock inicial" type="number" min="0" /><button className="btn-primary">{edit ? 'Actualizar' : 'Crear producto'}</button></form>}<Table headers={['Código', 'Nombre', 'Tipo', 'Categoría', 'Activo', 'Variantes', 'Precio/Stock', '']} rows={products.map((p) => [p.codigo, p.nombre, p.tipo, p.categoria, p.activo ? 'Activo' : 'Inactivo', p.variants.map((v) => `${v.sku} · ${v.nombre}`).join('\n') || 'Sin variantes', p.variants.map((v) => `${money(v.precio)} · stock ${v.stock}`).join('\n') || '—', canEdit ? <button onClick={() => setEdit(p)} className="btn-muted">Editar</button> : ''])} /></Panel>;
}


function Admin({ user, setNotice }: { user: UserSession; setNotice: (n: Notice) => void }) {
  const [tab, setTab] = useState<'productos' | 'usuarios' | 'mesas'>('productos');
  return <div className="space-y-4"><div className="flex gap-2 rounded-xl bg-white p-2 shadow-sm"><button onClick={() => setTab('productos')} className={tab === 'productos' ? 'btn-primary' : 'btn-muted'}>Productos</button><button onClick={() => setTab('usuarios')} className={tab === 'usuarios' ? 'btn-primary' : 'btn-muted'}>Usuarios</button><button onClick={() => setTab('mesas')} className={tab === 'mesas' ? 'btn-primary' : 'btn-muted'}>Mesas</button></div>{tab === 'productos' && <Products user={user} setNotice={setNotice} />}{tab === 'usuarios' && <Users user={user} setNotice={setNotice} />}{tab === 'mesas' && <TablesAdmin user={user} setNotice={setNotice} />}</div>;
}

function TablesAdmin({ user, setNotice }: { user: UserSession; setNotice: (n: Notice) => void }) {
  const [tables, setTables] = useState<RestaurantTableItem[]>([]);
  const load = async () => { const r = await api.tables.list(user); if (r.ok) setTables(r.data); else setNotice({ kind: 'error', text: r.error }); };
  useEffect(() => { void load(); }, []);
  async function create(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const f = new FormData(e.currentTarget); const r = await api.tables.create({ actorId: user.id, nombre: String(f.get('nombre')), capacidad: Number(f.get('capacidad') || 4), activa: true }); if (r.ok) { e.currentTarget.reset(); await load(); setNotice({ kind: 'ok', text: 'Mesa creada' }); } else setNotice({ kind: 'error', text: r.error }); }
  async function update(t: RestaurantTableItem, data: Partial<RestaurantTableItem>) { const r = await api.tables.update({ actorId: user.id, id: t.id, nombre: data.nombre, capacidad: data.capacidad, activa: data.activa, estado: data.estado }); if (r.ok) await load(); else setNotice({ kind: 'error', text: r.error }); }
  return <Panel title="Administración de mesas"><form onSubmit={create} className="grid gap-3 rounded-xl bg-slate-800 p-4 md:grid-cols-3"><input name="nombre" className="input" placeholder="Mesa 13" required /><input name="capacidad" className="input" type="number" min="1" defaultValue="4" /><button className="btn-primary">Crear mesa</button></form><Table headers={['Mesa','Capacidad','Estado','Activa','Acciones']} rows={tables.map((t) => [<input defaultValue={t.nombre} onBlur={(e) => e.currentTarget.value !== t.nombre && void update(t, { nombre: e.currentTarget.value })} className="input input-light" />, <input defaultValue={t.capacidad} type="number" min="1" onBlur={(e) => Number(e.currentTarget.value) !== t.capacidad && void update(t, { capacidad: Number(e.currentTarget.value) })} className="input input-light w-24" />, t.estado, t.activa ? 'Sí' : 'No', <button onClick={() => void update(t, { activa: !t.activa })} className="btn-muted">{t.activa ? 'Desactivar' : 'Activar'}</button>])} /></Panel>;
}

function Inventory({ user, setNotice }: { user: UserSession; setNotice: (n: Notice) => void }) { const [items, setItems] = useState<InventoryItem[]>([]); const canEdit = user.rol === 'ADMIN'; const load = async () => { const r = await api.inventory.get(); if (r.ok) setItems(r.data); else setNotice({ kind: 'error', text: r.error }); }; useEffect(() => { void load(); }, []); async function adjust(variantId: string, delta: number) { const r = await api.inventory.adjust({ variantId, delta, userId: user.id, reason: 'Ajuste manual desde POS' }); if (r.ok) { setNotice({ kind: 'ok', text: 'Stock actualizado correctamente' }); await load(); } else setNotice({ kind: 'error', text: r.error }); } return <Panel title="Inventario"><Table headers={['Producto', 'Variante', 'SKU', 'Precio', 'Stock actual', 'Estado', 'Ajuste']} rows={items.map((i) => [i.producto, i.variante, i.sku, money(i.precio), i.stock, i.estado === 'sin_stock' ? 'Sin stock' : i.estado === 'stock_bajo' ? 'Stock bajo' : 'Normal', canEdit ? <InventoryAdjust onAdjust={(d) => void adjust(i.variantId, d)} /> : 'Solo lectura'])} /></Panel>; }
function InventoryAdjust({ onAdjust }: { onAdjust: (delta: number) => void }) { const [qty, setQty] = useState(1); return <div className="flex gap-2"><input value={qty} onChange={(e) => setQty(Number(e.target.value))} className="input w-20" type="number" min="1" /><button onClick={() => onAdjust(qty)} className="btn-muted">+</button><button onClick={() => onAdjust(-qty)} className="btn-danger">-</button></div>; }

function Sales({ user, setNotice }: { user: UserSession; setNotice: (n: Notice) => void }) {
  const [tables, setTables] = useState<RestaurantTableItem[]>([]);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [selectedTable, setSelectedTable] = useState<RestaurantTableItem | null>(null);
  const [cart, setCart] = useState<Array<{ variantId: string; product: string; variant: string; cantidad: number; precio: number; stock: number; type: string }>>([]);
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('TODOS');
  const load = async () => {
    const [t, p, o] = await Promise.all([api.tables.list(user), api.products.list(false), api.orders.list(user)]);
    if (t.ok) setTables(t.data); else setNotice({ kind: 'error', text: t.error });
    if (p.ok) setProducts(p.data); else setNotice({ kind: 'error', text: p.error });
    if (o.ok) setOrders(o.data); else setNotice({ kind: 'error', text: o.error });
  };
  useEffect(() => { void load(); }, []);
  const selectedOrder = selectedTable?.activeOrderId ? orders.find((o) => o.id === selectedTable.activeOrderId) : null;
  const categories = ['TODOS', ...Array.from(new Set(products.map((p) => p.categoria)))];
  const visibleProducts = products.filter((p) => p.activo && (category === 'TODOS' || p.categoria === category) && p.nombre.toLowerCase().includes(search.toLowerCase()));
  const total = cart.reduce((sum, item) => sum + item.precio * item.cantidad, 0);
  const invalid = !selectedTable || !!selectedOrder || !cart.length || cart.some((i) => i.cantidad <= 0 || i.cantidad > i.stock);
  function add(product: ProductListItem, variant = product.variants[0]) {
    if (!variant) return setNotice({ kind: 'error', text: 'El producto no tiene variante/precio válido' });
    const current = cart.filter((i) => i.variantId === variant.id).reduce((s, i) => s + i.cantidad, 0);
    if (current + 1 > variant.stock) return setNotice({ kind: 'error', text: `Stock insuficiente para ${product.nombre} ${variant.nombre}` });
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.variantId === variant.id);
      if (idx >= 0) return prev.map((i, n) => n === idx ? { ...i, cantidad: i.cantidad + 1 } : i);
      return [...prev, { variantId: variant.id, product: product.nombre, variant: variant.nombre, cantidad: 1, precio: Number(variant.precio), stock: variant.stock, type: product.tipo }];
    });
  }
  async function confirm() {
    if (invalid || !selectedTable) return;
    const r = await api.orders.create({ userId: user.id, tableId: selectedTable.id, mesa: selectedTable.nombre, note, items: cart.map((i) => ({ variantId: i.variantId, cantidad: i.cantidad })) });
    if (r.ok) { setCart([]); setNote(''); setNotice({ kind: 'ok', text: `Pedido #${r.data.id.slice(-6)} enviado a cocina` }); await load(); setSelectedTable(null); } else setNotice({ kind: 'error', text: r.error });
  }
  if (selectedTable) return <Panel title={`Pedido · ${selectedTable.nombre}`}><button onClick={() => { setSelectedTable(null); setCart([]); }} className="btn-muted mb-4">← Volver a mesas</button>{selectedOrder ? <div className="grid gap-4 lg:grid-cols-[1fr_360px]"><OrderTicket order={selectedOrder} user={user} onMove={async()=>undefined} setNotice={setNotice} onPaid={load} /><aside className="ticket-card"><h3 className="text-xl font-black text-slate-950">Mesa ocupada</h3><p className="mt-2 text-slate-600">Esta mesa tiene el pedido activo #{selectedOrder.id.slice(-6)}. Regla inicial: una mesa puede tener máximo un pedido abierto.</p></aside></div> : <div className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]"><section className="rounded-2xl bg-white p-4 text-slate-900"><div className="grid gap-3 md:grid-cols-[1fr_220px]"><input value={search} onChange={(e) => setSearch(e.target.value)} className="input input-light" placeholder="Buscar producto..." /><select value={category} onChange={(e) => setCategory(e.target.value)} className="input input-light">{categories.map((c) => <option key={c}>{c}</option>)}</select></div><div className="mt-4 flex flex-wrap gap-2">{categories.map((c) => <button key={c} onClick={() => setCategory(c)} className={category === c ? 'btn-primary' : 'btn-muted'}>{c}</button>)}</div><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{visibleProducts.map((p) => <article key={p.id} className="rounded-2xl border border-slate-200 p-4 shadow-sm"><div className="flex justify-between gap-2"><b>{p.nombre}</b><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{p.tipo}</span></div><p className="text-sm text-slate-500">{p.categoria}</p><div className="mt-3 grid gap-2">{p.variants.map((v) => <button key={v.id} disabled={v.stock <= 0} onClick={() => add(p, v)} className="btn-touch rounded-xl bg-slate-900 px-3 py-3 text-left font-bold text-white disabled:bg-slate-300">{v.nombre} · {money(v.precio)} · stock {v.stock}</button>)}</div></article>)}</div></section><aside className="rounded-2xl bg-white p-4 text-slate-900 shadow-sm"><h3 className="text-xl font-black">Pedido actual</h3><p className="text-slate-500">{selectedTable.nombre}</p><div className="mt-4 space-y-3">{cart.map((i) => <div key={i.variantId} className="rounded-xl bg-slate-50 p-3"><b>{i.product}</b><p className="text-sm">{i.variant} · {i.cantidad} x {money(i.precio)}</p><div className="mt-2 flex gap-2"><button onClick={() => setCart(cart.map((x) => x.variantId === i.variantId ? { ...x, cantidad: Math.max(1, x.cantidad - 1) } : x))} className="btn-muted">-</button><button onClick={() => i.cantidad < i.stock && setCart(cart.map((x) => x.variantId === i.variantId ? { ...x, cantidad: x.cantidad + 1 } : x))} className="btn-muted">+</button><button onClick={() => setCart(cart.filter((x) => x.variantId !== i.variantId))} className="btn-danger">Eliminar</button></div></div>)}{!cart.length && <p className="rounded-xl border border-dashed p-4 text-slate-500">Selecciona productos del catálogo.</p>}</div><label className="label mt-4">Observaciones<textarea value={note} onChange={(e) => setNote(e.target.value)} className="input input-light mt-1 min-h-24" placeholder="Sin cebolla, agregar ají..." /></label><div className="mt-5 flex items-center justify-between border-t pt-4"><b className="text-2xl">{money(total)}</b><button disabled={invalid} onClick={() => void confirm()} className="btn-primary btn-touch disabled:opacity-40">Enviar a cocina</button></div></aside></div>}</Panel>;
  return <Panel title="Mesas"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-3 text-sm font-bold"><span>🟢 Disponibles</span><span>🔴 Ocupadas</span><span>🟡 Reservadas</span></div><button onClick={() => void load()} className="btn-muted">Actualizar</button></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">{tables.filter((t) => t.activa).map((t) => <button key={t.id} onClick={() => setSelectedTable(t)} className={`table-card ${t.estado === 'OCUPADA' ? 'table-busy' : t.estado === 'RESERVADA' ? 'table-reserved' : 'table-free'}`}><span className="text-4xl">{t.estado === 'OCUPADA' ? '🔴' : t.estado === 'RESERVADA' ? '🟡' : '🟢'}</span><b className="mt-2 text-2xl">{t.nombre}</b><span>{t.estado === 'OCUPADA' ? `Pedido #${t.activeOrderId?.slice(-6)}` : t.estado === 'RESERVADA' ? 'Reservada' : 'Libre'}</span><small>Cap. {t.capacidad}</small></button>)}</div></Panel>;
}

function Orders({ user, setNotice }: { user: UserSession; setNotice: (n: Notice) => void }) {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const load = async () => { const result = await api.orders.list(user); if (result.ok) setOrders(result.data); else setNotice({ kind: 'error', text: result.error }); };
  useEffect(() => { void load(); }, []);
  async function update(orderId: string, estado: OrderStatus) { const r = await api.orders.updateStatus({ orderId, estado, userId: user.id }); if (r.ok) { setNotice({ kind: 'ok', text: 'Estado actualizado' }); await load(); } else setNotice({ kind: 'error', text: r.error }); }
  const visible = orders.filter((o) => ['PENDIENTE','EN_COCINA','EN_PREPARACION','LISTO','ENTREGADO'].includes(o.estado));
  return <Panel title="Tablero de pedidos"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-500">Vista POS por tickets: mesa, pedido, hora, productos, cantidades y observaciones.</p><button onClick={() => void load()} className="btn-muted">Actualizar</button></div><div className="order-board">{boardColumns.map((column) => { const columnOrders = visible.filter((o) => column.key === 'EN_PREPARACION' ? ['EN_COCINA','EN_PREPARACION'].includes(o.estado) : o.estado === column.key); return <section key={column.key} className="kanban-column"><div className={`rounded-t-2xl border-b-4 px-3 py-3 ${column.accent}`}><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-black tracking-wide">{column.title}</h3><span className="rounded-full bg-white/70 px-2 py-1 text-xs font-bold">{columnOrders.length}</span></div><p className="mt-1 text-xs opacity-80">{column.helper}</p></div><div className="space-y-3 p-3">{columnOrders.map((o) => <OrderTicket key={o.id} order={o} user={user} onMove={update} setNotice={setNotice} onPaid={load} />)}{!columnOrders.length && <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm text-slate-500">Sin pedidos</p>}</div></section>; })}</div></Panel>;
}

function OrderTicket({ order, user, onMove, setNotice, onPaid }: { order: OrderListItem; user: UserSession; onMove: (orderId: string, estado: OrderStatus) => Promise<void>; setNotice: (n: Notice) => void; onPaid: () => Promise<void> }) {
  const time = new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return <article className="ticket-card"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase text-slate-500">Mesa</p><h4 className="text-2xl font-black text-slate-950">{order.mesa || 'Sin mesa'}</h4></div><div className="text-right"><p className="text-xs font-semibold uppercase text-slate-500">Pedido</p><p className="font-mono text-lg font-bold text-slate-800">#{order.id.slice(-6)}</p><p className="text-xs text-slate-500">{time}</p></div></div><ul className="mt-4 space-y-2">{order.items.map((item) => <li key={item.id} className="rounded-xl bg-slate-50 p-3"><div className="flex justify-between gap-3"><span className="font-semibold text-slate-900">{item.producto} {item.variante}</span><span className="rounded-full bg-slate-900 px-2 py-1 text-sm font-bold text-white">x{item.cantidad}</span></div></li>)}</ul><div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950"><b>Observaciones:</b> {order.note || 'Sin observaciones'}</div><div className="mt-4 flex items-center justify-between"><b>{money(order.total)}</b><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{order.estado}</span></div><div className="mt-4 grid gap-2 sm:grid-cols-3"><button disabled={!['PENDIENTE','EN_COCINA'].includes(order.estado)} onClick={() => void onMove(order.id, 'EN_PREPARACION')} className="btn-primary btn-touch disabled:cursor-not-allowed disabled:opacity-40">Preparar</button><button disabled={order.estado !== 'EN_PREPARACION'} onClick={() => void onMove(order.id, 'LISTO')} className="btn-success btn-touch disabled:cursor-not-allowed disabled:opacity-40">Listo</button><button disabled={order.estado !== 'LISTO'} onClick={() => void onMove(order.id, 'ENTREGADO')} className="btn-muted btn-touch disabled:cursor-not-allowed disabled:opacity-40">Entregar</button></div>{['ADMIN','CAJERO'].includes(user.rol) && <div className="mt-3 border-t border-slate-200 pt-3"><PayButtons order={order} userId={user.id} setNotice={setNotice} onPaid={onPaid} /></div>}</article>;
}

function PayButtons({ order, userId, setNotice, onPaid }: { order: OrderListItem; userId: string; setNotice: (n: Notice) => void; onPaid: () => Promise<void> }) {
  const [received, setReceived] = useState(order.total);
  async function pay(paymentMethod: PaymentMethod) {
    const r = await api.orders.pay({ orderId: order.id, userId, paymentMethod, receivedAmount: paymentMethod === 'EFECTIVO' ? received : undefined });
    if (r.ok) { setNotice({ kind: 'ok', text: `Pedido ${order.id.slice(-6)} cobrado correctamente. Vuelto: ${paymentMethod === 'EFECTIVO' ? money(Number(received) - Number(order.total)) : money(0)}` }); await onPaid(); }
    else setNotice({ kind: 'error', text: r.error });
  }
  if (order.estado !== 'ENTREGADO') return null;
  return <div className="flex flex-wrap items-center gap-2"><span>Total {money(order.total)}</span><input value={received} onChange={(e) => setReceived(e.target.value)} className="input w-24" type="number" step="0.01" min={order.total} /><button onClick={() => void pay('EFECTIVO')} className="btn-primary">Efectivo</button><button onClick={() => void pay('TARJETA')} className="btn-muted">Tarjeta</button><button onClick={() => void pay('YAPE')} className="btn-muted">Yape/Plin</button></div>;
}

function Cash({ user, setNotice }: { user: UserSession; setNotice: (n: Notice) => void }) { const [cash, setCash] = useState<CashRegisterSummary | null>(null); const load = async () => { const r = await api.cash.current(); if (r.ok) setCash(r.data); else setNotice({ kind: 'error', text: r.error }); }; useEffect(() => { void load(); }, []); async function open(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const f = new FormData(e.currentTarget); const r = await api.cash.open({ userId: user.id, initialAmount: String(f.get('initialAmount')) }); if (r.ok) { setCash(r.data); setNotice({ kind: 'ok', text: 'Caja abierta' }); } else setNotice({ kind: 'error', text: r.error }); } async function movement(e: FormEvent<HTMLFormElement>) { e.preventDefault(); if (!cash) return; const f = new FormData(e.currentTarget); const r = await api.cash.registerMovement({ cashRegisterId: cash.id, userId: user.id, tipo: String(f.get('tipo')) as any, monto: String(f.get('monto')), detalle: { nota: String(f.get('nota')) } }); if (r.ok) { setCash(r.data); setNotice({ kind: 'ok', text: 'Movimiento registrado' }); } else setNotice({ kind: 'error', text: r.error }); } async function close() { if (!cash) return; const r = await api.cash.close({ cashRegisterId: cash.id, userId: user.id }); if (r.ok) { setCash(null); setNotice({ kind: 'ok', text: 'Caja cerrada' }); } else setNotice({ kind: 'error', text: r.error }); } return <Panel title="Caja">{!cash ? <form onSubmit={open} className="flex gap-3"><input name="initialAmount" className="input" type="number" step="0.01" defaultValue="100.00" /><button className="btn-primary">Abrir caja</button></form> : <><div className="grid gap-4 md:grid-cols-3"><Metric title="Estado" value={cash.status} /><Metric title="Monto inicial" value={money(cash.initialAmount)} /><Metric title="Saldo actual" value={money(cash.balance)} /></div><form onSubmit={movement} className="mt-4 grid gap-3 rounded-xl bg-slate-800 p-4 md:grid-cols-4"><select name="tipo" className="input"><option>GASTO</option><option>RETIRO</option><option>DEPOSITO</option></select><input name="monto" className="input" type="number" step="0.01" min="0.01" /><input name="nota" className="input" placeholder="Detalle" /><button className="btn-primary">Registrar</button></form><button onClick={close} className="btn-danger mt-4">Cerrar caja</button><Table headers={['Tipo', 'Monto', 'Fecha']} rows={cash.movements.map((m) => [m.tipo, money(m.monto), new Date(m.createdAt).toLocaleString()])} /></>}</Panel>; }

function Users({ user, setNotice }: { user: UserSession; setNotice: (n: Notice) => void }) { const [users, setUsers] = useState<UserSummary[]>([]); const load = async () => { const r = await api.users.list(user.id); if (r.ok) setUsers(r.data); else setNotice({ kind: 'error', text: r.error }); }; useEffect(() => { void load(); }, []); async function create(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const f = new FormData(e.currentTarget); const r = await api.users.create({ actorId: user.id, nombre: String(f.get('nombre')), pin: String(f.get('pin')), rol: String(f.get('rol')) as UserRole }); if (r.ok) { e.currentTarget.reset(); setNotice({ kind: 'ok', text: 'Usuario creado' }); await load(); } else setNotice({ kind: 'error', text: r.error }); } async function toggle(u: UserSummary) { const r = await api.users.update({ actorId: user.id, id: u.id, activo: !u.activo }); if (r.ok) await load(); else setNotice({ kind: 'error', text: r.error }); } return <Panel title="Usuarios"><form onSubmit={create} className="grid gap-3 rounded-xl bg-slate-800 p-4 md:grid-cols-4"><input name="nombre" className="input" placeholder="Nombre" /><input name="pin" type="password" className="input" placeholder="PIN" /><select name="rol" className="input">{roles.map((r) => <option key={r}>{r}</option>)}</select><button className="btn-primary">Crear usuario</button></form><Table headers={['Nombre', 'Rol', 'Activo', '']} rows={users.map((u) => [u.nombre, u.rol, u.activo ? 'Sí' : 'No', <button onClick={() => void toggle(u)} className="btn-muted">{u.activo ? 'Desactivar' : 'Activar'}</button>])} /></Panel>; }
function Audit({ user }: { user: UserSession }) { const [logs, setLogs] = useState<AuditLogItem[]>([]); const [error, setError] = useState(''); useEffect(() => { api.audit.list(user.id).then((r) => r.ok ? setLogs(r.data) : setError(r.error)); }, [user.id]); return <Panel title="Auditoría">{error && <p className="text-red-300">{error}</p>}<Table headers={['Usuario', 'Acción', 'Fecha', 'Detalle']} rows={logs.map((l) => [l.userName, l.accion, new Date(l.createdAt).toLocaleString(), JSON.stringify(l.detalle)])} /></Panel>; }
function Settings({ db, setDb }: { db: { connected: boolean; message: string }; setDb: (d: { connected: boolean; message: string }) => void }) { const [config, setConfig] = useState<unknown>(null); useEffect(() => { api.config.getPublic().then((r) => { if (r.ok) setConfig(r.data); }); }, []); return <Panel title="Configuración"><pre className="rounded bg-slate-800 p-4">{JSON.stringify(config, null, 2)}</pre><p className={db.connected ? 'text-emerald-300' : 'text-red-300'}>{db.message}</p><button onClick={() => void checkDb(setDb)} className="btn-primary mt-3">Probar conexión</button></Panel>; }

function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-2xl bg-slate-900 p-4 shadow-xl"><h2 className="mb-4 text-xl font-bold">{title}</h2>{children}</section>; }
function Table({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) { return <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[720px] border-separate border-spacing-y-2 text-sm"><thead><tr>{headers.map((h) => <th key={h} className="px-3 py-2 text-left text-slate-400">{h}</th>)}</tr></thead><tbody>{rows.length ? rows.map((r, i) => <tr key={i} className="bg-slate-800">{r.map((c, j) => <td key={j} className="whitespace-pre-wrap px-3 py-3 first:rounded-l-lg last:rounded-r-lg">{c}</td>)}</tr>) : <tr><td colSpan={headers.length} className="rounded bg-slate-800 p-4 text-slate-400">Sin registros</td></tr>}</tbody></table></div>; }
