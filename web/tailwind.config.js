/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#6366F1', 50: '#EEF2FF', 100: '#E0E7FF', 500: '#6366F1', 600: '#4F46E5', 700: '#4338CA' },
        surface: { light: '#F8FAFC', dark: '#0F172A' },
        card: { light: '#FFFFFF', dark: '#1E293B' },
      },
      fontFamily: {
        sans: ['Inter', 'Lato', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        legible: ['"Atkinson Hyperlegible"', 'Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
