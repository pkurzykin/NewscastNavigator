export const BRAND = {
  companyName: "ООО «Транснефть медиа»",
  appName: "Newscast Navigator",
  logoPath: "/branding/transneft-logo.png",
  colors: {
    bluePrimary: "#00447c",
    blueAccent: "#005596",
    redAccent: "#ee3124",
    white: "#ffffff",
  },
  typography: {
    ui: "\"Franklin Gothic Medium\", \"ITC Franklin Gothic\", \"Arial Narrow\", Arial, sans-serif",
    body: "\"PT Sans\", \"Segoe UI\", \"Helvetica Neue\", Arial, sans-serif",
  },
} as const;

export type BrandConfig = typeof BRAND;
