// The feed reducer wired to the server socket and the voice transcripts.
// The voice holder shows its own Live transcripts; other devices show the
// server's relay. One store for the tree: `FeedProvider` holds it and
// `useFeed()` reads it.

import { createContext, useContext, useEffect, useReducer, type Dispatch, type ReactNode } from "react";
import { initialFeed, reduceFeed, type FeedAction, type FeedState } from "../feed/reducer.ts";
import { useServer } from "./server.tsx";
import { useVoice } from "./voice.tsx";

export type FeedValue = [FeedState, Dispatch<FeedAction>];

const FeedContext = createContext<FeedValue | null>(null);

function reduce(state: FeedState, action: FeedAction): FeedState {
  return reduceFeed(state, action, Date.now());
}

function useFeedStore(): FeedValue {
  const { subscribe } = useServer();
  const { subscribeTranscript, holdsVoiceNow } = useVoice();
  const [state, dispatch] = useReducer(reduce, undefined, initialFeed);

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

export function FeedProvider({ children }: { children: ReactNode }) {
  const value = useFeedStore();
  return <FeedContext.Provider value={value}>{children}</FeedContext.Provider>;
}

export function useFeed(): FeedValue {
  const v = useContext(FeedContext);
  if (!v) throw new Error("useFeed outside FeedProvider");
  return v;
}
