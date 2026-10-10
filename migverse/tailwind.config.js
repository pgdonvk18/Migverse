/** Colors come from CSS variables in src/index.css so dark/light themes and rebranding are one-file edits. */
const c = (name) => `rgb(var(--${name}) / <alpha-value>)`
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: c('bg'), surface: c('surface'), surface2: c('surface2'), line: c('line'),
        ink: c('text'), muted: c('muted'), brand: c('brand'), gold: c('gold'),
        danger: c('danger'), ok: c('ok'),
      },
      fontFamily: { sans: ['"Plus Jakarta Sans"', '"Noto Sans Devanagari"', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
}
