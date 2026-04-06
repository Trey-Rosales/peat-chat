/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        pl: {
          bg:       '#0b141a',
          sidebar:  '#111b21',
          header:   '#1f2c33',
          input:    '#2a3942',
          hover:    '#202c33',
          active:   '#2a3942',
          sent:     '#005c4b',
          received: '#1b2733',
          border:   '#2a3942',
          text:     '#e9edef',
          'text-sec': '#8696a0',
          accent:   '#00a884',
          danger:   '#ea4335',
        },
      },
    },
  },
  plugins: [],
}
