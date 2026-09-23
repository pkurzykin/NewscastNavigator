import type { ReactNode } from "react";
import { ThemeProvider } from "@mui/material/styles";
import { uiTheme } from "./theme";

export default function UiProvider({ children }: { children: ReactNode }) {
  return <ThemeProvider theme={uiTheme}>{children}</ThemeProvider>;
}
