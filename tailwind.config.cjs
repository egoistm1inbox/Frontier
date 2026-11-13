/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx,html}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        studio: {
          950: '#0d0e11',
          900: '#14161b',
          850: '#191b22',
          800: '#20232b',
          750: '#262a34',
          700: '#2f3440',
          600: '#414757',
          500: '#5a6277',
          400: '#858fa3',
          300: '#b1b9c9',
          200: '#d8dde6',
          100: '#eef1f6',
        },
        clay: {
          amber: '#f59e0b',
          gold: '#fbbf24',
          yellow: '#fde047',
          orange: '#f97316',
          blue: '#0284c7',
          cyan: '#38bdf8',
          sky: '#7dd3fc',
          charcoal: '#1e2025',
          slate: '#2b2d35',
          silver: '#e2e8f0',
          emerald: '#10b981',
          rose: '#f43f5e',
          violet: '#8b5cf6',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      boxShadow: {
        'clay-sm': '0 4px 6px -1px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.15)',
        'clay': '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.2)',
        'clay-lg': '0 20px 35px -10px rgba(0, 0, 0, 0.6), inset 0 2px 4px rgba(255, 255, 255, 0.25)',
        'clay-glow-gold': '0 12px 30px -4px rgba(245, 158, 11, 0.35), inset 0 2px 3px rgba(255, 255, 255, 0.3)',
        'clay-glow-cyan': '0 12px 30px -4px rgba(56, 189, 248, 0.35), inset 0 2px 3px rgba(255, 255, 255, 0.3)',
      }
    },
  },
  plugins: [],
}
