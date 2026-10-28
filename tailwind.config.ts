import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17211F",
        muted: "#6D7A76",
        canvas: "#F5F7F5",
        line: "#E5EAE6",
        brand: "#176B57",
        "brand-light": "#E8F4EF",
      },
      boxShadow: {
        soft: "0 8px 30px rgba(24, 46, 38, 0.04)",
      },
    },
  },
  plugins: [],
};
export default config;
