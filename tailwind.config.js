/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Cairo', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        primary: {
          DEFAULT: '#6EB7B0',
          dark:    '#4A9E97',
          light:   '#E8F5F4',
        },
        accent: {
          DEFAULT: '#E9D8BB',
          dark:    '#C9A87A',
          light:   '#FAF5EC',
        },
        navy: {
          DEFAULT: '#1B3A5C',
          light:   '#2A5080',
        },
        surface: {
          DEFAULT: '#F4F8F7',
          2:       '#EEF4F3',
        },
        border:  '#D4E8E6',
        success: '#2D9B6F',
        danger:  '#E05C5C',
        warning: '#E8A838',
      },
    },
  },
  plugins: [],
}
