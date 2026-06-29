/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        sand: "#f5f1e8",
        accent: "#f97316",
        accent2: "#0ea5e9",
        navy: {
          950: "#050e1f",
          900: "#0a1628",
          800: "#0f1e3d",
          700: "#162447",
          600: "#1e3060",
          500: "#264080",
        },
        chblue: {
          700: "#1a4fcc",
          600: "#2563eb",
          500: "#3b82f6",
          400: "#60a5fa",
          300: "#93c5fd",
        },
        gold: {
          900: "#78490a",
          700: "#a16207",
          600: "#ca8a04",
          500: "#d4af37",
          400: "#eab308",
          300: "#fcd34d",
          200: "#fde68a",
          100: "#fef9c3",
        },
      },
      fontFamily: {
        display: ["'DidoneRoomNumbers'", "serif"],
        body: ["'Inter'", "ui-sans-serif", "system-ui"],
      },
      boxShadow: {
        "gold-glow": "0 0 12px rgba(212,175,55,0.5), 0 0 24px rgba(212,175,55,0.2)",
        "blue-glow": "0 0 12px rgba(59,130,246,0.5), 0 0 24px rgba(59,130,246,0.2)",
      },
    },
  },
  plugins: [],
};
