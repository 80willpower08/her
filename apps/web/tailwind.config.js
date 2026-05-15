import animate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Curator's crimson family — available as utilities for hero areas
        crimson: {
          DEFAULT: '#ff0033',
          hi: '#ff3333',
          shine: '#ff4d4d',
          dark: '#8a0020',
          deep: '#4a0008',
        },
        ink: {
          DEFAULT: '#a68c8c',
          soft: '#8e7878',
          muted: '#6e5a5a',
          faint: '#543939',
        },
        surface: {
          DEFAULT: '#0f1012',
          raised: '#131112',
          hi: '#1a1718',
        },
      },
      fontFamily: {
        display: ['Fraunces Variable', 'Iowan Old Style', 'Palatino', 'serif'],
        body: ['Commissioner Variable', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        glow: '0 0 18px rgba(255, 0, 51, 0.55)',
        'glow-soft': '0 0 32px rgba(255, 0, 51, 0.2)',
        cabinet: '0 10px 28px rgba(0, 0, 0, 0.7), 0 4px 8px rgba(0, 0, 0, 0.5)',
      },
    },
  },
  plugins: [animate],
};
