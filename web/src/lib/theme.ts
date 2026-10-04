// Dark mode: the "dark" class on <html> follows prefers-color-scheme.
// Tailwind's dark variant and thinking-orbs both read it.

export function installTheme(): () => void {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = (): void => {
    document.documentElement.classList.toggle("dark", query.matches);
  };
  apply();
  query.addEventListener("change", apply);
  return () => query.removeEventListener("change", apply);
}
