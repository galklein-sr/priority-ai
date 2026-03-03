import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#06060F",
        surface: "#0B0B18",
        "surface-2": "#10101F",
        "surface-3": "#161628",
        border: "#1C1C35",
        "border-2": "#252540",
        text: "#C4C4DC",
        muted: "#50507A",
        amber: {
          erp: "#F59E0B",
          soft: "#F59E0B1A",
        },
        emerald: {
          erp: "#10B981",
        },
        rose: {
          erp: "#F43F5E",
        },
        blue: {
          erp: "#3B82F6",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "Consolas", "monospace"],
        sans: ["Syne", "system-ui", "sans-serif"],
        display: ["Syne", "system-ui", "sans-serif"],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.4s ease forwards",
        "slide-up": "slideUp 0.3s ease forwards",
        "scan": "scan 2s linear infinite",
        "blink": "blink 1.2s step-end infinite",
      },
      keyframes: {
        fadeIn: { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        scan: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100vh)" },
        },
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
      },
      backgroundImage: {
        "grid-pattern":
          "linear-gradient(rgba(28, 28, 53, 0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(28, 28, 53, 0.4) 1px, transparent 1px)",
      },
      backgroundSize: {
        grid: "32px 32px",
      },
    },
  },
  plugins: [],
};

export default config;
