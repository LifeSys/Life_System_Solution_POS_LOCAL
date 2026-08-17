import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: { colors: { brand: { 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c' }, pos: { neutral: { DEFAULT: '#64748b', soft: '#f1f5f9', ink: '#0f172a' }, progress: { DEFAULT: '#f59e0b', soft: '#fef3c7', ink: '#78350f' }, success: { DEFAULT: '#10b981', soft: '#dcfce7', ink: '#064e3b' }, danger: { DEFAULT: '#ef4444', soft: '#fee2e2', ink: '#7f1d1d' } } }, minHeight: { touch: '56px' } } },
  plugins: []
} satisfies Config;
