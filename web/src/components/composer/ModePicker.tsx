// The only picker: Push to talk or Open mic.

import { Mic, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputMode } from "@/gate/gate";
import { useVoice } from "@/state/voice";

export function ModePicker() {
  const { inputMode, setInputMode } = useVoice();
  const pushToTalk = inputMode === InputMode.PUSH_TO_TALK;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" data-mode={inputMode} className="text-muted-foreground">
          {pushToTalk ? <Mic strokeWidth={1.5} /> : <Radio strokeWidth={1.5} />}
          {pushToTalk ? "Push to talk" : "Open mic"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top">
        <DropdownMenuItem onSelect={() => setInputMode(InputMode.PUSH_TO_TALK)}>
          <Mic strokeWidth={1.5} />
          Push to talk
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setInputMode(InputMode.OPEN_MIC)}>
          <Radio strokeWidth={1.5} />
          Open mic
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
