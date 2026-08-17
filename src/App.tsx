import { FormEvent, useEffect, useState } from 'react';
import { api, missingPreloadApiMessage } from './lib/ipc-client';
import type { StartupState } from '../shared/ipc';

export default function App() {
  if (!window.api) {
    return <PreloadDiagnostic />;
  }

  const [startup, setStartup] = useState<StartupState | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    api.config.startupState().then((r) => {
      if (r.ok) setStartup(r.data);
      else {
        setMessage(r.error);
        setStartup({ configured: true, databaseReady: false, needsAdmin: false });
      }
    }).catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : 'No se pudo consultar el estado inicial.');
      setStartup({ configured: true, databaseReady: false, needsAdmin: false });
    });
  }, []);
  if (startup === null) return <main className="p-8">Cargando...</main>;
  if (!startup.configured) return <ConfigScreen onDone={setStartup} setMessage={setMessage} message={message} />;
  if (!startup.databaseReady) return <DatabaseErrorScreen startup={startup} onRetry={setStartup} message={message} setMessage={setMessage} />;
  if (startup.needsAdmin) return <InitialAdminScreen onDone={() => setStartup({ ...startup, needsAdmin: false })} setMessage={setMessage} message={message} />;
  return <LoginScreen message={message} setMessage={setMessage} />;
}

function PreloadDiagnostic() {
  return <main className="mx-auto mt-16 max-w-2xl rounded-2xl bg-amber-950 p-8 shadow-xl">
    <h1 className="text-2xl font-bold text-amber-100">API de Electron no disponible</h1>
    <p className="mt-4 text-amber-100">{missingPreloadApiMessage}</p>
    <p className="mt-3 text-amber-200">Abre la aplicación con <code className="rounded bg-amber-900 px-2 py-1">npm run dev</code>. Si abriste <code className="rounded bg-amber-900 px-2 py-1">http://localhost:5173/</code> directamente en un navegador, IPC no está disponible por diseño.</p>
  </main>;
}

function ConfigScreen({ onDone, message, setMessage }: { onDone: (state: StartupState) => void; message: string; setMessage: (m: string) => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('Probando conexión y ejecutando migraciones...');
    const form = new FormData(event.currentTarget);
    const result = await api.config.save({ host: String(form.get('host')), port: Number(form.get('port')), user: String(form.get('user')), password: String(form.get('password')), database: String(form.get('database')) });
    if (result.ok) { setMessage(''); onDone(result.data); } else setMessage(result.error);
  }
  return <main className="mx-auto mt-16 max-w-xl rounded-2xl bg-slate-900 p-8 shadow-xl">
    <h1 className="text-2xl font-bold">Configurar PostgreSQL local</h1>
    <p className="mt-2 text-slate-300">Ingresa la conexión local. Se guardará en userData/config.json y se ejecutarán migraciones automáticamente.</p>
    <form onSubmit={submit} className="mt-6 grid gap-4">
      <input name="host" defaultValue="localhost" className="rounded bg-slate-800 p-3" placeholder="Host" />
      <input name="port" defaultValue="5432" type="number" className="rounded bg-slate-800 p-3" placeholder="Puerto" />
      <input name="user" className="rounded bg-slate-800 p-3" placeholder="Usuario" />
      <input name="password" type="password" className="rounded bg-slate-800 p-3" placeholder="Password" />
      <input name="database" className="rounded bg-slate-800 p-3" placeholder="Base de datos" />
      {message && <p className="whitespace-pre-wrap text-red-300">{message}</p>}
      <button className="rounded bg-emerald-500 p-3 font-semibold text-slate-950">Guardar y migrar</button>
    </form>
  </main>;
}

function DatabaseErrorScreen({ startup, onRetry, message, setMessage }: { startup: StartupState; onRetry: (state: StartupState) => void; message: string; setMessage: (m: string) => void }) {
  async function retry() {
    setMessage('Reintentando conexión y migraciones...');
    const result = await api.config.startupState();
    if (result.ok) { setMessage(''); onRetry(result.data); } else setMessage(result.error);
  }
  return <main className="mx-auto mt-16 max-w-2xl rounded-2xl bg-slate-900 p-8 shadow-xl">
    <h1 className="text-2xl font-bold text-red-200">No se pudo inicializar PostgreSQL</h1>
    <p className="mt-4 whitespace-pre-wrap rounded bg-slate-800 p-4 text-red-100">{startup.detail || startup.message || message}</p>
    <button onClick={retry} className="mt-6 rounded bg-blue-500 p-3 font-semibold">Reintentar</button>
  </main>;
}

function InitialAdminScreen({ onDone, message, setMessage }: { onDone: () => void; message: string; setMessage: (m: string) => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api.auth.createInitialAdmin({ nombre: String(form.get('nombre')), pin: String(form.get('pin')) });
    if (result.ok) { setMessage('ADMIN inicial creado. Ingresa con el PIN configurado.'); onDone(); } else setMessage(result.error);
  }
  return <main className="mx-auto mt-16 max-w-xl rounded-2xl bg-slate-900 p-8 shadow-xl">
    <h1 className="text-2xl font-bold">Crear ADMIN inicial</h1>
    <p className="mt-2 text-slate-300">La base no tiene usuarios. Define el primer ADMIN sin usar un PIN hardcodeado.</p>
    <form onSubmit={submit} className="mt-6 grid gap-4">
      <input name="nombre" className="rounded bg-slate-800 p-3" placeholder="Nombre del ADMIN" />
      <input name="pin" type="password" className="rounded bg-slate-800 p-3" placeholder="PIN (4 a 12 dígitos)" />
      {message && <p className="whitespace-pre-wrap text-red-300">{message}</p>}
      <button className="rounded bg-emerald-500 p-3 font-semibold text-slate-950">Crear ADMIN</button>
    </form>
  </main>;
}

function LoginScreen({ message, setMessage }: { message: string; setMessage: (m: string) => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pin = String(new FormData(event.currentTarget).get('pin'));
    const result = await api.auth.login({ pin });
    setMessage(result.ok ? `Bienvenido, ${result.data.nombre} (${result.data.rol})` : result.error);
  }
  return <main className="flex min-h-screen items-center justify-center p-8">
    <section className="w-full max-w-md rounded-2xl bg-slate-900 p-8 shadow-xl">
      <h1 className="text-3xl font-bold">Life System POS</h1>
      <p className="mt-2 text-slate-300">Login por PIN usando IPC seguro.</p>
      <form onSubmit={submit} className="mt-6 grid gap-4">
        <input name="pin" type="password" className="rounded bg-slate-800 p-3 text-center text-2xl tracking-widest" placeholder="PIN" />
        <button className="rounded bg-blue-500 p-3 font-semibold">Ingresar</button>
      </form>
      {message && <p className="mt-4 rounded bg-slate-800 p-3">{message}</p>}
    </section>
  </main>;
}
