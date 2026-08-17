import type { OrderStatus, TableStatus } from '../../shared/ipc';
import { statusTokens } from './design';

type StatusValue = OrderStatus | TableStatus | 'ABIERTO' | 'CAJA_ABIERTA' | 'CAJA_CERRADA';

function statusKind(estado: StatusValue) {
  if (['DISPONIBLE', 'LISTO', 'PAGADO'].includes(estado)) return statusTokens.success;
  if (['OCUPADA', 'EN_COCINA', 'EN_PREPARACION', 'CAJA_ABIERTA'].includes(estado)) return statusTokens.progress;
  if (['CANCELADO'].includes(estado)) return statusTokens.danger;
  return statusTokens.neutral;
}

function label(estado: StatusValue) {
  return String(estado).replace(/_/g, ' ');
}

export function StatusBadge({ estado, className = '' }: { estado: StatusValue; className?: string }) {
  const t = statusKind(estado);
  return <span className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-black uppercase tracking-wide ${t.bg} ${t.text} ${t.border} ${className}`}>{label(estado)}</span>;
}
