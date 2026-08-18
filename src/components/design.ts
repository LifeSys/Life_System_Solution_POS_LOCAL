export const statusTokens = {
  neutral: { bg: 'bg-pos-neutral-soft', text: 'text-pos-neutral-ink', border: 'border-pos-neutral' },
  progress: { bg: 'bg-pos-progress-soft', text: 'text-pos-progress-ink', border: 'border-pos-progress' },
  success: { bg: 'bg-pos-success-soft', text: 'text-pos-success-ink', border: 'border-pos-success' },
  danger: { bg: 'bg-pos-danger-soft', text: 'text-pos-danger-ink', border: 'border-pos-danger' },
} as const;

export const conceptIcons = {
  table: '▦',
  kitchen: '🔥',
  cash: 'S/',
  time: '⏱',
} as const;

export function money(value: string | number) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

export function minutesSince(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}
