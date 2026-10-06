import type { CliRenderer } from "@opentui/core";
import { render } from "@opentui/solid";
import { Shell, type ShellProps } from "./shell/shell";

/** Mounts the cockpit into a renderer the caller owns; the caller also destroys it. */
export function openShell(renderer: CliRenderer, props: ShellProps): Promise<void> {
  return render(() => <Shell {...props} />, renderer);
}
