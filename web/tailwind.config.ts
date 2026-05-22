import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['var(--font-heebo)', 'system-ui', 'sans-serif'] },
      colors: {
        // המותג — כחול עמוק יותר עם נגישות AAA על רקע לבן
        brand: {
          50:  '#eef4ff',
          100: '#dbe6ff',
          200: '#bccffe',
          300: '#8eadfb',
          400: '#5b82f6',
          500: '#3b5ce8',
          600: '#2d44d4',
          700: '#2536ad',
          800: '#1f2c87',
          900: '#1b266c',
        },
        // צבעים סמנטיים — לסטטוסים, badges, alerts
        success: { 50: '#ecfdf5', 100: '#d1fae5', 600: '#059669', 700: '#047857' },
        warning: { 50: '#fffbeb', 100: '#fef3c7', 600: '#d97706', 700: '#b45309' },
        danger:  { 50: '#fef2f2', 100: '#fee2e2', 600: '#dc2626', 700: '#b91c1c' },
        info:    { 50: '#eff6ff', 100: '#dbeafe', 600: '#2563eb', 700: '#1d4ed8' },
        // ניטרל מעודן (zinc) — מחליף slate חלקית למראה מודרני יותר
        ink: {
          50:  '#fafafa',
          100: '#f4f4f5',
          200: '#e4e4e7',
          300: '#d4d4d8',
          400: '#a1a1aa',
          500: '#71717a',
          600: '#52525b',
          700: '#3f3f46',
          800: '#27272a',
          900: '#18181b',
        },
      },
      boxShadow: {
        // צללים מעודנים — מבוססים על Tailwind v3 cubic falloff
        'soft': '0 1px 2px rgb(0 0 0 / 0.04), 0 1px 3px rgb(0 0 0 / 0.06)',
        'soft-md': '0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.04)',
        'soft-lg': '0 10px 15px -3px rgb(0 0 0 / 0.06), 0 4px 6px -4px rgb(0 0 0 / 0.04)',
        // אאוטליין רכה במקום border — תחושת layering ב-cards
        'ring-soft': 'inset 0 0 0 1px rgb(228 228 231 / 0.8)',
      },
      borderRadius: { 'xl': '0.875rem' },
      keyframes: {
        'fade-in': { '0%': { opacity: '0', transform: 'translateY(2px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
      },
      animation: { 'fade-in': 'fade-in 200ms ease-out' },
    },
  },
  plugins: [],
};

export default config;
