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
      },
      fontFamily: {
        display: ["'DidoneRoomNumbers'", "serif"],
        body: ["'Inter'", "ui-sans-serif", "system-ui"],
      },
    },
  },
  plugins: [],
};
