/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg:      "#0f1117",
        card:    "#1a1d27",
        card2:   "#22263a",
        accent:  "#4f8ef7",
        accent2: "#7c3aed",
        success: "#22c55e",
        danger:  "#ef4444",
        warn:    "#f59e0b",
        muted:   "#64748b",
        border:  "#2d3148",
      },
    },
  },
  plugins: [],
}

