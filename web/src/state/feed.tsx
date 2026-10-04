// The feed reducer wired to the server socket and the voice transcripts.
// The voice holder shows its own Live transcripts; other devices show the
// server's relay.

import { useEffect, useReducer, type Dispatch } from "react";
import { initialFeed, reduceFeed, type FeedAction, type FeedState } from "../feed/reducer.ts";
import { useServer } from "./server.tsx";
import { useVoice } from "./voice.tsx";

export function useFeed(): [FeedState, Dispatch<FeedAction>] {
  const { subscribe } = useServer();
  const { subscribeTranscript, holdsVoiceNow } = useVoice();
  const [state, dispatch] = useReducer(reduceFeed, undefined, initialFeed);

  useEffect(
    () =>
      subscribe((msg) => {
        if (msg.type === "transcript" && holdsVoiceNow()) return;
        dispatch({ kind: "server", msg });
      }),
    [subscribe, holdsVoiceNow],
  );

  useEffect(
    () => subscribeTranscript((role, text, final) => dispatch({ kind: "transcript", role, text, final })),
    [subscribeTranscript],
  );

  return [state, dispatch];
}
