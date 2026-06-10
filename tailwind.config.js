/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // OBDient brand palette
        brand: {
          bg: '#0A0A0A',
          surface: '#141414',
          card: '#1A1A1A',
          border: '#2A2A2A',
          teal: '#1D9E75',
          'teal-light': '#25C490',
          'teal-dark': '#157A59',
          red: '#E53E3E',
          amber: '#F6AD55',
          green: '#48BB78',
          text: '#F5F5F5',
          muted: '#888888',
        },
      },
      fontFamily: {
        mono: ['SpaceMono', 'monospace'],
      },
    },
  },
  plugins: [],
};
