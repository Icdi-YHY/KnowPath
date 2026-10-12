/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#070b16',
          900: '#0b1020',
          850: '#0f172a',
          800: '#131c31',
          700: '#1b2740',
          600: '#27354f',
          500: '#3a4a68',
          400: '#5b6c8c',
          300: '#8b9ab8',
          200: '#c3cddf',
          100: '#e8edf6',
        },
        brand: {
          500: '#5b8cff',
          400: '#7aa2ff',
          600: '#3f6dff',
        },
        accent: {
          500: '#22d3a6',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'PingFang SC',
          'Microsoft YaHei',
          'sans-serif',
        ],
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        blink: {
          '0%,100%': { opacity: '1' },
          '50%': { opacity: '0.15' },
        },
      },
      animation: {
        'fade-in': 'fade-in .18s ease-out',
        blink: 'blink 1s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
