/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#dbe7fe",
          200: "#bfd6fe",
          300: "#93bbfd",
          400: "#6099fa",
          500: "#3b78f6",
          600: "#265aeb",
          700: "#1f47d8",
          800: "#203bae",
          900: "#1f3489",
        },
      },
    },
  },
  plugins: [],
};
