// The rail footer (DESIGN.md 2 and 7): a 36 px row with the initials avatar,
// the device name and the settings popover. Settings live here and nowhere
// else: Input, Appearance, Notifications; on the desktop the status bar
// switch, the way back after a right-click hid it. Nothing addresses a
// model or an endpoint.

import { Settings2 } from "lucide-react";
import { useTheme, type Theme } from "@/components/theme/ThemeProvider";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { InputMode } from "@/gate/gate";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { cn } from "@/lib/utils";
import { useSelection } from "@/state/selection";
import { useServer } from "@/state/server";
import { useVoice } from "@/state/voice";
import { ICON, useRail } from "./rail-context";

export const MODE_WORDS: Record<InputMode, string> = {
  [InputMode.PUSH_TO_TALK]: "Push to talk",
  [InputMode.OPEN_MIC]: "Open mic",
};

const THEME_WORDS: Record<Theme, string> = { light: "Light", dark: "Dark", system: "System" };

function initials(userId: string | null, device: string): string {
  const source = (userId ?? device).trim();
  const words = source.split(/[\s._-]+/).filter(Boolean);
  const letters = words.length >= 2 ? words[0][0] + words[1][0] : source.slice(0, 2);
  return letters.toUpperCase();
}

function SettingLabel({ children }: { children: string }) {
  return <div className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">{children}</div>;
}

function Settings() {
  const { inputMode, setInputMode } = useVoice();
  const { theme, setTheme } = useTheme();
  const { notifications, setNotifications, statusBar, setStatusBar } = useSelection();
  const breakpoint = useBreakpoint();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <SettingLabel>Input</SettingLabel>
        <Select
          value={inputMode}
          onValueChange={(v) => {
            if (v === InputMode.PUSH_TO_TALK || v === InputMode.OPEN_MIC) setInputMode(v);
          }}
        >
          <SelectTrigger className="w-full" aria-label="Input">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={InputMode.PUSH_TO_TALK}>{MODE_WORDS.push_to_talk}</SelectItem>
            <SelectItem value={InputMode.OPEN_MIC}>{MODE_WORDS.open_mic}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <SettingLabel>Appearance</SettingLabel>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          className="w-full"
          value={theme}
          onValueChange={(v) => {
            if (v === "light" || v === "dark" || v === "system") setTheme(v);
          }}
        >
          {(["light", "dark", "system"] as const).map((t) => (
            <ToggleGroupItem key={t} value={t} className="flex-1">
              {THEME_WORDS[t]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="flex items-center justify-between gap-3">
        <SettingLabel>Notifications</SettingLabel>
        <Switch checked={notifications} onCheckedChange={setNotifications} aria-label="Notifications" />
      </div>
      {breakpoint === "desktop" ? (
        <div className="flex items-center justify-between gap-3">
          <SettingLabel>Status bar</SettingLabel>
          <Switch checked={statusBar} onCheckedChange={setStatusBar} aria-label="Status bar" />
        </div>
      ) : null}
    </div>
  );
}

export function RailFooter() {
  const { ready, device } = useServer();
  const { collapsed } = useRail();
  const userId = ready?.user_id ?? null;
  return (
    <div className={cn("flex h-9 shrink-0 items-center gap-2 px-3", collapsed && "justify-center px-0")}>
      {collapsed ? null : (
        <>
          <span
            aria-hidden
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground"
          >
            {initials(userId, device)}
          </span>
          <span className="flex-1 truncate text-[13px] capitalize">{device}</span>
        </>
      )}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Settings">
            <Settings2 {...ICON} />
          </Button>
        </PopoverTrigger>
        <PopoverContent side={collapsed ? "right" : "top"} align="end" className="w-64 shadow-md">
          <Settings />
        </PopoverContent>
      </Popover>
    </div>
  );
}
