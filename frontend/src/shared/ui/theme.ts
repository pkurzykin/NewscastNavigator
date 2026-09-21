import { createTheme } from "@mui/material/styles";
import tokenStyles from "../../styles/tokens.css?inline";

// CSS variables remain the source used by both existing feature styles and MUI.
function token(name: string): string {
  const value = tokenStyles.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`))?.[1]?.trim();
  if (!value) throw new Error(`Не задан токен интерфейса: ${name}`);
  return value;
}

export const uiTheme = createTheme({
  palette: {
    primary: { main: token("color-action"), dark: token("color-action-strong") },
    error: { main: token("color-danger") },
    warning: { main: token("color-warning") },
    success: { main: token("color-success") },
    background: { default: token("color-canvas"), paper: token("color-paper") },
    text: { primary: token("color-ink"), secondary: token("color-ink-muted") },
    divider: token("color-line-soft"),
  },
  typography: {
    fontFamily: token("font-ui"),
    fontSize: 13,
    button: { textTransform: "none", fontWeight: 600, letterSpacing: 0 },
    h6: { fontSize: 18, fontWeight: 650 },
  },
  shape: { borderRadius: 6 },
  spacing: 4,
  components: {
    MuiButton: {
      defaultProps: { size: "small", disableElevation: true },
      styleOverrides: {
        root: { minHeight: 32, padding: "5px 12px", lineHeight: 1.4 },
        outlined: { borderColor: token("color-line-soft"), backgroundColor: token("color-paper") },
        contained: { boxShadow: token("shadow-action") },
      },
    },
    MuiButtonBase: { styleOverrides: { root: { "&.Mui-focusVisible": { outline: `2px solid ${token("color-focus")}`, outlineOffset: 3 } } } },
    MuiIconButton: {
      defaultProps: { size: "small" },
      styleOverrides: {
        root: {
          width: 32,
          height: 32,
          borderRadius: token("radius-small"),
          color: token("color-action-strong"),
        },
      },
    },
    MuiTextField: { defaultProps: { size: "small", fullWidth: true } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          minHeight: 40,
          borderRadius: token("radius-small"),
          backgroundColor: token("color-paper"),
          boxShadow: token("shadow-control"),
          "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: token("color-action") },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: token("color-focus"), borderWidth: 2 },
        },
        input: { padding: "9px 12px" },
      },
    },
    MuiInputLabel: { styleOverrides: { root: { fontSize: 13, fontWeight: 550 } } },
    MuiFormLabel: { styleOverrides: { root: { color: token("color-ink"), fontSize: 13, fontWeight: 600 } } },
    MuiFormControlLabel: {
      styleOverrides: {
        root: { marginLeft: -6, marginRight: 0 },
        label: { color: token("color-ink"), fontSize: 13, fontWeight: 500 },
      },
    },
    MuiCheckbox: { defaultProps: { size: "small" }, styleOverrides: { root: { padding: 6 } } },
    MuiSwitch: { defaultProps: { size: "small" } },
    MuiSelect: { defaultProps: { size: "small" } },
    MuiAutocomplete: { defaultProps: { size: "small", noOptionsText: "Ничего не найдено", clearText: "Очистить", openText: "Открыть", closeText: "Закрыть" } },
    MuiDialog: { defaultProps: { fullWidth: true, maxWidth: "sm" }, styleOverrides: { paper: { borderRadius: 8, border: `1px solid ${token("color-line-soft")}`, boxShadow: token("shadow-floating") } } },
    MuiDialogTitle: { styleOverrides: { root: { padding: "20px 24px 12px", fontSize: 18, fontWeight: 650 } } },
    MuiDialogContent: { styleOverrides: { root: { padding: "12px 24px 20px" } } },
    MuiDialogActions: { styleOverrides: { root: { padding: "12px 24px 20px", gap: 8 } } },
    MuiMenu: { styleOverrides: { paper: { border: `1px solid ${token("color-line-soft")}`, borderRadius: 8, boxShadow: token("shadow-floating") } } },
    MuiMenuItem: { styleOverrides: { root: { minHeight: 36, fontSize: 13 } } },
    MuiPopover: { styleOverrides: { paper: { border: `1px solid ${token("color-line-soft")}`, borderRadius: 8, boxShadow: token("shadow-floating") } } },
    MuiAlert: { styleOverrides: { root: { fontSize: 13, borderRadius: 6 } } },
    MuiChip: { defaultProps: { size: "small" }, styleOverrides: { root: { borderRadius: token("radius-small"), fontWeight: 600 } } },
    MuiTooltip: { defaultProps: { arrow: true } },
  },
});
