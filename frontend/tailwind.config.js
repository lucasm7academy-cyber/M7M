/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg:      "#0b0d13",
        bg2:     "#0e111a",
        card:    "#14161f",
        card2:   "#1b1f2c",
        accent:  "#5b8def",
        accent2: "#8b5cf6",
        success: "#34d399",
        danger:  "#f87171",
        warn:    "#fbbf24",
        muted:   "#7c869b",
        border:  "#262b3a",
        text:    "#e6e9f2",
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', '-apple-system', 'Roboto', 'sans-serif'],
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
      },
      boxShadow: {
        card:   '0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -12px rgba(0,0,0,0.5)',
        glow:   '0 0 0 1px rgba(91,141,239,0.35), 0 8px 30px -8px rgba(91,141,239,0.45)',
        soft:   '0 10px 30px -16px rgba(0,0,0,0.6)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #5b8def 0%, #8b5cf6 100%)',
        'accent-soft':    'radial-gradient(1200px 600px at 0% -10%, rgba(91,141,239,0.12), transparent 60%)',
      },
      keyframes: {
        'fade-in':    { '0%': { opacity: 0, transform: 'translateY(4px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
        'pulse-dot':  { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.3 } },
        'shimmer':    { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
      },
      animation: {
        'fade-in':   'fade-in 0.25s ease-out both',
        'pulse-dot': 'pulse-dot 1.5s ease-in-out infinite',
        'shimmer':   'shimmer 2.5s linear infinite',
      },
    },
  },
  plugins: [],
}
