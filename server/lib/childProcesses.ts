import type { ChildProcess } from "node:child_process";

const children = new Set<ChildProcess>();
export function trackChild<T extends ChildProcess>(child: T): T {
  children.add(child);
  const forget = () => children.delete(child);
  child.once("exit", forget);
  child.once("error", forget);
  return child;
}
/** Only processes launched by this service are stopped when the desktop exits. */
export function stopChildProcesses(): void {
  for (const child of children) {
    try { child.kill("SIGTERM"); } catch { /* process already exited */ }
  }
}
