"use client";

import { useEffect, useRef, useState } from "react";

// Animated "WaSfY" wordmark: a moving cyan→purple→emerald gradient with a
// periodic letter-scramble and a blurred glow behind it. Ported from the
// nawakes project but rebuilt with CSS animations (no framer-motion dependency).

const CYCLES_PER_LETTER = 3;
const SHUFFLE_TIME = 30; // ms per scramble tick
const CHARS = "!@#$%^&*():{};|,.<>/?ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function scrambledAt(target: string, pos: number) {
  return target
    .split("")
    .map((char, index) =>
      pos / CYCLES_PER_LETTER > index
        ? char
        : CHARS[Math.floor(Math.random() * CHARS.length)],
    )
    .join("");
}

function useScrambledText(initial: string) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [text, setText] = useState(initial);

  const stop = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    setText(initial);
  };

  const scramble = () => {
    let pos = 0;
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setText(scrambledAt(initial, pos));
      pos++;
      if (pos >= initial.length * CYCLES_PER_LETTER) stop();
    }, SHUFFLE_TIME);
  };

  // clean up on unmount
  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return { text, scramble };
}

const gradient =
  "text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-purple-400 to-emerald-400";

export function BrandLogo({
  text = "WaSfY",
  className,
}: {
  text?: string;
  className?: string;
}) {
  const { text: displayText, scramble } = useScrambledText(text);

  // re-scramble on mount and every 4s
  useEffect(() => {
    scramble();
    const id = setInterval(scramble, 4000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <span className={"relative inline-block select-none " + (className ?? "")}>
      <span
        className={`font-mono text-lg font-bold tracking-widest sm:text-xl ${gradient}`}
        style={{
          backgroundSize: "200% 200%",
          animation: "brand-gradient-move 4s ease-in-out infinite",
        }}
      >
        {displayText}
      </span>

      {/* blurred glow duplicate behind it */}
      <span
        aria-hidden="true"
        className={`absolute inset-0 font-mono text-lg font-bold tracking-widest blur-md sm:text-xl ${gradient}`}
        style={{
          backgroundSize: "200% 200%",
          animation: "brand-glow-pulse 4s ease-in-out infinite",
        }}
      >
        {displayText}
      </span>
    </span>
  );
}
