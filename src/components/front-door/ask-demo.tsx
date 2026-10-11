"use client";

import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { ASK_NOTE, ASK_SCRIPT } from "@/lib/front-door/fixtures";

import { BrowserFrame } from "./browser-frame";

const WORD_MS = 24;

/** Scripted "Ask Allvest" demo. No network, no model: the answers are fixed text revealed word by word (instantly under reduced motion). */
export default function AskDemo() {
  const [picked, setPicked] = useState<number | null>(null);
  const [shown, setShown] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const words = picked === null ? [] : ASK_SCRIPT[picked].answer.join("\n").split(/(\s+)/);
  const total = words.length;

  useEffect(() => () => void (timer.current && clearInterval(timer.current)), []);

  const choose = (i: number) => {
    if (timer.current) clearInterval(timer.current);
    setPicked(i);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const n = ASK_SCRIPT[i].answer.join("\n").split(/(\s+)/).length;
    if (reduce) {
      setShown(n);
      return;
    }
    setShown(0);
    let k = 0;
    timer.current = setInterval(() => {
      k += 2;
      setShown(k);
      if (k >= n && timer.current) clearInterval(timer.current);
    }, WORD_MS);
  };

  const done = picked !== null && shown >= total;
  const visible = picked === null ? "" : words.slice(0, shown).join("");
  const lines = visible.split("\n");

  return (
    <div className="fd-ask">
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge>Demo</Badge>
          <span className="text-sm text-muted-foreground" title={ASK_NOTE}>Scripted answers. No live AI call.</span>
        </div>
        <div className="fd-prompts" role="group" aria-label="Pick a question">
          {ASK_SCRIPT.map((s, i) => (
            <button key={s.id} type="button" className="fd-prompt" aria-pressed={picked === i} onClick={() => choose(i)}>
              {s.prompt}
            </button>
          ))}
        </div>
      </div>
      <BrowserFrame url="customer-os / ask" tag="Scripted demo" label="Ask Allvest, scripted demo">
        <div className="fd-answer" aria-live="polite" aria-busy={picked !== null && !done}>
          {picked === null ? (
            <p className="m-0 text-sm text-muted-foreground">Pick a question on the left to see how an answer looks, with its sources.</p>
          ) : (
            <>
              <div className="fd-answer-q">{ASK_SCRIPT[picked].prompt}</div>
              <div className="fd-answer-a">
                <div className={done ? undefined : "fd-cursor"}>
                  {lines.map((l, i) => (
                    <p key={i}>{l}</p>
                  ))}
                </div>
                {done && (
                  <div className="fd-chips" aria-label="Sources">
                    {ASK_SCRIPT[picked].sources.map((s) => (
                      <Badge key={s} variant="outline">{s}</Badge>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </BrowserFrame>
    </div>
  );
}
