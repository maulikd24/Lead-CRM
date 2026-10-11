"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { STORY_STEPS, type StoryView } from "@/lib/front-door/fixtures";

import { BrowserFrame } from "./browser-frame";
import { useNear } from "./use-near";

const StoryPreview = dynamic(() => import("./story-preview"), { ssr: false, loading: () => <PreviewSkeleton /> });

function PreviewSkeleton() {
  return (
    <BrowserFrame url="customer-os / customers / rahul-m" label="Product preview loading">
      <div style={{ minHeight: 300 }} aria-hidden="true" />
    </BrowserFrame>
  );
}

/**
 * The scroll story: six steps on one side, a sticky live preview on the other. The active step is whichever one crosses
 * the middle of the viewport (one IntersectionObserver, no scroll listener). The preview code loads only when the
 * section is about to scroll into view. Under reduced motion nothing animates; the preview simply changes.
 */
export function Story() {
  const [wrap, near] = useNear<HTMLDivElement>("600px 0px");
  const [active, setActive] = useState(0);
  const stepRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.index));
        }
      },
      { rootMargin: "-42% 0px -42% 0px", threshold: 0 },
    );
    stepRefs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  const view: StoryView = STORY_STEPS[active].id;
  return (
    <div ref={wrap} className="fd-story">
      <div className="fd-story-stage">
        {near ? <StoryPreview view={view} /> : <PreviewSkeleton />}
        <div className="fd-story-progress" role="presentation" aria-hidden="true">
          {STORY_STEPS.map((s, i) => (
            <i key={s.id} data-on={i === active} />
          ))}
        </div>
      </div>
      <ol className="fd-story-steps m-0 list-none p-0" aria-label="The story, step by step">
        {STORY_STEPS.map((s, i) => (
          <li
            key={s.id}
            ref={(el) => {
              stepRefs.current[i] = el;
            }}
            data-index={i}
            data-active={i === active}
            className="fd-step"
            aria-current={i === active ? "step" : undefined}
          >
            <span className="fd-step-kicker">{s.kicker}</span>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
