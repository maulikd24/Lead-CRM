"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { MicOff } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { computeWindow, estimateTurnHeight, formatClock, type TranscriptTurn } from "@/lib/calls/transcript";

const VIRTUALISE_ABOVE = 150;
const VIEWPORT = 520;
const SPEAKER_LABEL = { rm: "RM", customer: "Customer", unknown: "Speaker" } as const;
const SPEAKER_STYLE = {
  rm: "bg-primary/15 text-foreground",
  customer: "bg-secondary text-secondary-foreground",
  unknown: "bg-muted text-muted-foreground",
} as const;

export type CallAudio = {
  now: number;
  setNow: (sec: number) => void;
  audioError: boolean;
  setAudioError: (failed: boolean) => void;
  seek: (sec: number) => void;
  activeIndex: number;
  canSeek: boolean;
};

/** One playback state shared by the player and the transcript, so the line being spoken is highlighted and a timestamp seeks. */
export function useCallAudio(turns: TranscriptTurn[], hasRecording: boolean): { audio: CallAudio; audioRef: React.RefObject<HTMLAudioElement | null> } {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [now, setNow] = useState(0);
  const [audioError, setAudioError] = useState(false);

  const activeIndex = useMemo(() => {
    let found = -1;
    for (const t of turns) if (t.startSec !== null && t.startSec <= now) found = t.index;
    return found;
  }, [turns, now]);

  const seek = useCallback((sec: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = sec;
    void el.play().catch(() => undefined); // an explicit click, never on load
  }, []);

  // The ref is returned beside the state, not inside it, so reading `audio.audioError` while rendering never touches a ref.
  return { audio: { now, setNow, audioError, setAudioError, seek, activeIndex, canSeek: hasRecording && !audioError }, audioRef };
}

/** The player itself (or the reason there is none). Nothing plays until the person presses play. */
export function RecordingPlayer({ callId, hasRecording, audio, audioRef, hint = true, className }: { callId: string; hasRecording: boolean; audio: CallAudio; audioRef: React.RefObject<HTMLAudioElement | null>; hint?: boolean; className?: string }) {
  return hasRecording && !audio.audioError ? (
    <>
      <audio
        ref={audioRef}
        controls
        preload="none"
        className={cn("w-full", className)}
        aria-label="Call recording"
        src={`/api/calls/${callId}/recording`}
        onTimeUpdate={(e) => audio.setNow(e.currentTarget.currentTime)}
        onError={() => audio.setAudioError(true)}
      />
      {hint && <p className="mt-2 text-xs text-muted-foreground">Space plays or pauses, the arrow keys skip. Nothing plays until you press play.</p>}
    </>
  ) : (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <MicOff className="size-4" aria-hidden="true" />
      {audio.audioError ? "The recording could not be loaded. It may have expired at the provider." : "No recording is stored for this call."}
    </p>
  );
}

/** The transcript, or the reason there is none. */
export function TranscriptBody({ turns, analysisNote, audio }: { turns: TranscriptTurn[]; analysisNote: string | null; audio: CallAudio }) {
  return turns.length === 0 ? (
    <p className="text-sm text-muted-foreground">{analysisNote ?? "No transcript is available for this call."}</p>
  ) : (
    <>
      <p className="mb-2 text-xs text-muted-foreground">Phone numbers, e-mail addresses and ID numbers are hidden.</p>
      <TranscriptView turns={turns} activeIndex={audio.activeIndex} canSeek={audio.canSeek} onSeek={audio.seek} />
    </>
  );
}

export function CallMedia({ callId, hasRecording, turns, analysisNote }: { callId: string; hasRecording: boolean; turns: TranscriptTurn[]; analysisNote: string | null }) {
  const { audio, audioRef } = useCallAudio(turns, hasRecording);
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Recording</CardTitle>
        </CardHeader>
        <CardContent>
          <RecordingPlayer callId={callId} hasRecording={hasRecording} audio={audio} audioRef={audioRef} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transcript</CardTitle>
        </CardHeader>
        <CardContent>
          <TranscriptBody turns={turns} analysisNote={analysisNote} audio={audio} />
        </CardContent>
      </Card>
    </div>
  );
}

function TranscriptView({ turns, activeIndex, canSeek, onSeek }: { turns: TranscriptTurn[]; activeIndex: number; canSeek: boolean; onSeek: (sec: number) => void }) {
  const virtual = turns.length > VIRTUALISE_ABOVE;
  const heights = useMemo(() => (virtual ? turns.map((t) => estimateTurnHeight(t.text.length)) : []), [turns, virtual]);
  const [scrollTop, setScrollTop] = useState(0);
  const frame = useRef(0);

  const win = virtual ? computeWindow({ heights, scrollTop, viewport: VIEWPORT, overscan: 6 }) : null;
  const visible = win ? turns.slice(win.start, win.end) : turns;

  return (
    <div
      role="region"
      aria-label={`Transcript, ${turns.length} turns`}
      tabIndex={0}
      className="max-h-[520px] overflow-y-auto rounded-lg border border-border outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      onScroll={
        virtual
          ? (e) => {
              const top = e.currentTarget.scrollTop;
              cancelAnimationFrame(frame.current);
              frame.current = requestAnimationFrame(() => setScrollTop(top));
            }
          : undefined
      }
    >
      <div style={win ? { height: win.totalHeight, position: "relative" } : undefined}>
        <ol style={win ? { position: "absolute", top: win.offsetTop, left: 0, right: 0 } : undefined} className="m-0 list-none p-0">
          {visible.map((turn) => (
            <li
              key={turn.index}
              style={virtual ? { height: estimateTurnHeight(turn.text.length) } : undefined}
              className={cn("flex flex-col gap-1 overflow-hidden border-b border-border/60 px-3 py-2 last:border-b-0", turn.index === activeIndex && "bg-primary/10")}
              aria-current={turn.index === activeIndex ? "true" : undefined}
            >
              <div className="flex items-center gap-2 text-xs">
                <span className={cn("rounded-full px-2 py-0.5 font-medium", SPEAKER_STYLE[turn.speaker])}>{turn.label && turn.speaker === "unknown" ? turn.label : SPEAKER_LABEL[turn.speaker]}</span>
                {turn.startSec !== null &&
                  (canSeek ? (
                    <button type="button" onClick={() => onSeek(turn.startSec as number)} className="rounded px-1 tabular-nums text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/60" aria-label={`Play from ${formatClock(turn.startSec)}`}>
                      {formatClock(turn.startSec)}
                    </button>
                  ) : (
                    <span className="tabular-nums text-muted-foreground">{formatClock(turn.startSec)}</span>
                  ))}
              </div>
              <p className="text-sm leading-[22px]">{turn.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
