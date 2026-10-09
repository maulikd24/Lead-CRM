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

export function CallMedia({ callId, hasRecording, turns, analysisNote }: { callId: string; hasRecording: boolean; turns: TranscriptTurn[]; analysisNote: string | null }) {
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

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Recording</CardTitle>
        </CardHeader>
        <CardContent>
          {hasRecording && !audioError ? (
            <>
              <audio
                ref={audioRef}
                controls
                preload="none"
                className="w-full"
                aria-label="Call recording"
                src={`/api/calls/${callId}/recording`}
                onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
                onError={() => setAudioError(true)}
              />
              <p className="mt-2 text-xs text-muted-foreground">Space plays or pauses, the arrow keys skip. Nothing plays until you press play.</p>
            </>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <MicOff className="size-4" aria-hidden="true" />
              {audioError ? "The recording could not be loaded. It may have expired at the provider." : "No recording is stored for this call."}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transcript</CardTitle>
        </CardHeader>
        <CardContent>
          {turns.length === 0 ? (
            <p className="text-sm text-muted-foreground">{analysisNote ?? "No transcript is available for this call."}</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-muted-foreground">Phone numbers, e-mail addresses and ID numbers are hidden.</p>
              <TranscriptView turns={turns} activeIndex={activeIndex} canSeek={hasRecording && !audioError} onSeek={seek} />
            </>
          )}
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
