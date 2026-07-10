export type MenuAction =
  | "init"
  | "status"
  | "doctor"
  | "collect"
  | "dashboard"
  | "update"
  | "uninstall"
  | "exit";

export type MenuOption = {
  value: MenuAction;
  label: string;
  hint: string;
};

export const mainMenuOptions: MenuOption[] = [
  { value: "init", label: "Setup", hint: "detect agents, choose tools, apply a plan" },
  { value: "status", label: "Status", hint: "configured tools, agents, and health" },
  { value: "doctor", label: "Doctor", hint: "revalidate binaries, PATH, and integrations" },
  { value: "collect", label: "Collect metrics", hint: "import local upstream measurements" },
  { value: "dashboard", label: "Open dashboard", hint: "start the local web UI and print its URL" },
  { value: "update", label: "Check updates", hint: "compare installed tools with GitHub releases" },
  { value: "uninstall", label: "Uninstall", hint: "remove managed integrations; keep upstream tools" },
  { value: "exit", label: "Exit", hint: "leave the menu" },
];

/** True when the user ran the binary with no subcommand in an interactive terminal. */
export function shouldOpenMainMenu(
  argv: readonly string[],
  options: { stdinIsTTY: boolean; stdoutIsTTY: boolean },
): boolean {
  if (!options.stdinIsTTY || !options.stdoutIsTTY) return false;
  return argv.slice(2).length === 0;
}

export function menuHelpText(): string {
  return [
    "Don’t Waste interactive menu",
    "",
    "Run with no arguments in a terminal to open the menu, or:",
    "  dont-waste menu",
    "",
    "Direct commands still work:",
    "  dont-waste init | status | doctor | collect | dashboard | update | rollback | uninstall",
  ].join("\n");
}
