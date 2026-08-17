import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'success' | 'danger' | 'ghost';
const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-500 focus:ring-brand-300',
  secondary: 'bg-slate-800 text-white hover:bg-slate-700 focus:ring-slate-300',
  success: 'bg-pos-success text-white hover:bg-emerald-500 focus:ring-emerald-300',
  danger: 'bg-pos-danger text-white hover:bg-red-500 focus:ring-red-300',
  ghost: 'bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50 focus:ring-slate-300',
};

export function ActionButton({ children, className = '', variant = 'primary', size = 'lg', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; variant?: Variant; size?: 'md' | 'lg' }) {
  const height = size === 'lg' ? 'min-h-touch px-6 text-base' : 'min-h-12 px-4 text-sm';
  return <button {...props} className={`rounded-2xl font-black uppercase tracking-wide shadow-sm transition focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-40 ${height} ${variants[variant]} ${className}`}>{children}</button>;
}
