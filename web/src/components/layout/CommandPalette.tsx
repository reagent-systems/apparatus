// The command palette (DESIGN.md 2): shadcn Command in a Dialog on
// Cmd/Ctrl+K. Four unlabeled groups split by a hairline: the five surfaces,
// the jobs, Control or Release, the themes. One label and a trailing Kbd
// per row; no headings, no descriptions, no placeholder. Voice has no row:
// the orb, Space and Esc carry it.

import { Check } from "lucide-react";
import { StatusGlyph } from "@/components/status/StatusGlyph";
import { useTheme, type Theme } from "@/components/theme/ThemeProvider";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { keyLabel } from "@/hooks/shortcuts";
import { isMac } from "@/hooks/use-platform";
import { glyphOf } from "@/lib/status";
import { recentJobs, runningJobs } from "@/feed/reducer";
import { useFeed } from "@/state/feed";
import { useScreenStore } from "@/state/screen";
import { useSelection, type View } from "@/state/selection";

export type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const GO: Array<{ view: View; label: string }> = [
  { view: "thread", label: "Thread" },
  { view: "jobs", label: "Jobs" },
  { view: "screen", label: "Screen" },
  { view: "audit", label: "Audit" },
  { view: "credits", label: "Credits" },
];

const THEMES: Array<{ theme: Theme; label: string }> = [
  { theme: "light", label: "Light" },
  { theme: "dark", label: "Dark" },
  { theme: "system", label: "System" },
];

const CHECK = { size: 16, strokeWidth: 1.5, "aria-hidden": true } as const;

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const mac = isMac();
  const [feed] = useFeed();
  const { setView, selectJob } = useSelection();
  const screen = useScreenStore();
  const { theme, setTheme } = useTheme();
  const jobs = [...runningJobs(feed), ...recentJobs(feed)];

  const run = (action: () => void) => () => {
    onOpenChange(false);
    action();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[20%] translate-y-0 overflow-hidden p-0 shadow-md sm:max-w-md" showCloseButton={false} aria-describedby={undefined}>
        <DialogTitle className="sr-only">Commands</DialogTitle>
        <Command>
          <CommandInput aria-label="Commands" className="focus-visible:ring-0" />
          <CommandList className="max-h-[min(420px,60vh)]">
            <CommandGroup>
              {GO.map(({ view, label }, i) => (
                <CommandItem key={view} value={`go ${label}`} onSelect={run(() => setView(view))}>
                  <span className="flex-1">{label}</span>
                  <Kbd>{keyLabel({ mod: true, key: String(i + 1) }, mac)}</Kbd>
                </CommandItem>
              ))}
            </CommandGroup>
            {jobs.length > 0 ? <CommandSeparator /> : null}
            {jobs.length > 0 ? (
              <CommandGroup>
                {jobs.map((job) => (
                  <CommandItem
                    key={job.jobId}
                    value={`job ${job.jobId} ${job.request}`}
                    onSelect={run(() => {
                      setView("thread");
                      selectJob(job.jobId);
                    })}
                  >
                    <StatusGlyph glyph={glyphOf(job, feed)} />
                    <span className="flex-1 truncate">{job.request || job.jobId}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            <CommandSeparator />
            <CommandGroup>
              {screen.controlledByMe ? (
                <CommandItem value="screen Release" onSelect={run(() => screen.releaseControl())}>
                  <span className="flex-1">Release</span>
                  <Kbd>{keyLabel({ mod: true, shift: true, key: "C" }, mac)}</Kbd>
                </CommandItem>
              ) : (
                <CommandItem value="screen Control" disabled={screen.status !== "live"} onSelect={run(() => screen.takeControl())}>
                  <span className="flex-1">Control</span>
                  <Kbd>{keyLabel({ mod: true, shift: true, key: "C" }, mac)}</Kbd>
                </CommandItem>
              )}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              {THEMES.map(({ theme: t, label }) => (
                <CommandItem key={t} value={`theme ${label}`} onSelect={run(() => setTheme(t))}>
                  <span className="flex-1">{label}</span>
                  {theme === t ? <Check {...CHECK} className="text-foreground" /> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
