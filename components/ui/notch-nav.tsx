"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { Home, FileSpreadsheet, ListChecks } from "lucide-react";

import type { LucideIcon } from "lucide-react";

type IconName = "home" | "tasfya" | "review";

type Item = {
  value: string;
  label: string;
  href?: string;
  icon?: IconName;
};

type NotchNavProps = {
  items: Item[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  ariaLabel?: string;
  className?: string;
};

export function NotchNav({
  items,
  value,
  defaultValue,
  onValueChange,
  ariaLabel = "Primary",
  className,
}: NotchNavProps) {
  const pathname = usePathname();
  const isControlled = value !== undefined;

  // Internal state only; when controlled, `active` is derived from `value`
  // directly so we never mirror a prop into state inside an effect.
  const [internalActive, setInternalActive] = React.useState<string>(
    defaultValue ?? items[0]?.value ?? "",
  );
  const active = isControlled ? (value as string) : internalActive;

  const [ready, setReady] = React.useState(false);
  const [reducedMotion, setReducedMotion] = React.useState(false);

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const itemRefs = React.useRef<
    Array<HTMLAnchorElement | HTMLButtonElement | null>
  >([]);
  const [notchRect, setNotchRect] = React.useState<{
    left: number;
    width: number;
  } | null>(null);

  const activeIndex = React.useMemo(
    () =>
      Math.max(
        0,
        items.findIndex((i) => i.value === active),
      ),
    [items, active],
  );

  const iconMap: Record<IconName, LucideIcon> = {
    home: Home,
    tasfya: FileSpreadsheet,
    review: ListChecks,
  };

  const updateNotch = React.useCallback(() => {
    const c = containerRef.current;
    const el = itemRefs.current[activeIndex];
    if (!c || !el) return;
    const cRect = c.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const left = eRect.left - cRect.left;
    const width = eRect.width;
    setNotchRect({ left, width });
    setReady(true);
  }, [activeIndex]);

  // Sync active item from the URL — this reacts to an external system (the
  // router), so setState here is legitimate.
  React.useEffect(() => {
    if (!isControlled && pathname) {
      const activeItem = items.find(
        (item) =>
          item.href === pathname ||
          (item.href && pathname.startsWith(item.href + "/")),
      );
      if (activeItem?.value) {
        React.startTransition(() => setInternalActive(activeItem.value));
      }
    }
  }, [pathname, items, isControlled]);

  React.useLayoutEffect(() => {
    updateNotch();
    const onResize = () => updateNotch();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [updateNotch]);

  const focusItem = (index: number) => {
    const el = itemRefs.current[Math.max(0, Math.min(items.length - 1, index))];
    el?.focus();
  };

  const commitChange = (next: string) => {
    if (!isControlled) setInternalActive(next);
    onValueChange?.(next);
  };

  React.useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(mql.matches);
    onChange();
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);

  return (
    <header className="relative flex w-full items-center justify-center p-4 h-16">
      <nav
        aria-label={ariaLabel}
        className={["w-fit", className].filter(Boolean).join(" ")}
      >
        <div
          ref={containerRef}
          className="relative rounded-lg border border-border bg-secondary text-foreground"
        >
          <ul
            role="menubar"
            className="flex items-center justify-center gap-1 p-1"
            onKeyDown={(e) => {
              const key = e.key;
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key))
                return;
              e.preventDefault();
              if (key === "ArrowRight") focusItem(activeIndex + 1);
              if (key === "ArrowLeft") focusItem(activeIndex - 1);
              if (key === "Home") focusItem(0);
              if (key === "End") focusItem(items.length - 1);
            }}
          >
            {items.map((item, idx) => {
              const isActive = item.value === active;
              const Icon = item.icon ? iconMap[item.icon] : undefined;
              const content = (
                <>
                  {Icon && <Icon className="mr-2 h-4 w-4" aria-hidden="true" />}
                  <span className="text-pretty">{item.label}</span>
                </>
              );

              return (
                <li key={item.value} role="none">
                  {item.href ? (
                    <Link
                      ref={(el) => {
                        itemRefs.current[idx] = el;
                      }}
                      href={item.href}
                      prefetch={false}
                      role="menuitem"
                      aria-current={isActive ? "page" : undefined}
                      tabIndex={isActive ? 0 : -1}
                      onClick={() => commitChange(item.value)}
                      className={[
                        "relative inline-flex items-center rounded-md px-3 py-2 text-sm font-medium outline-none transition-colors",
                        "focus-visible:ring-2 focus-visible:ring-ring",
                        isActive
                          ? "text-primary"
                          : "text-foreground/70 hover:text-foreground",
                      ].join(" ")}
                    >
                      {content}
                    </Link>
                  ) : (
                    <button
                      ref={(el) => {
                        itemRefs.current[idx] = el;
                      }}
                      role="menuitem"
                      aria-current={isActive ? "page" : undefined}
                      aria-pressed={isActive || undefined}
                      tabIndex={isActive ? 0 : -1}
                      onClick={() => commitChange(item.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          commitChange(item.value);
                        }
                      }}
                      className={[
                        "relative rounded-md px-3 py-2 text-sm font-medium outline-none transition-colors",
                        "focus-visible:ring-2 focus-visible:ring-ring",
                        isActive
                          ? "text-primary"
                          : "text-foreground/70 hover:text-foreground",
                      ].join(" ")}
                    >
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {notchRect && (
            <div
              aria-hidden="true"
              className={[
                "pointer-events-none absolute",
                "overflow-hidden rounded-sm",
                "transition-all",
                reducedMotion ? "duration-0" : "duration-300",
                "ease-[cubic-bezier(0.22,1,0.36,1)]",
                ready ? "opacity-100" : "opacity-0",
              ].join(" ")}
              style={{
                transform: `translate3d(${notchRect.left}px, 0, 0)`,
                width: notchRect.width,
                bottom: -4,
                height: 10,
                willChange: "transform, width, opacity",
              }}
            >
              <svg
                width="100%"
                height="100%"
                viewBox="0 0 100 20"
                preserveAspectRatio="none"
                className="block text-primary"
              >
                <path
                  d="
                    M 2 1
                    H 98
                    Q 99 1 99 2
                    V 10
                    H 88
                    Q 87.2 10 86.6 11.4
                    L 84.8 18
                    H 15.2
                    L 13.4 11.4
                    Q 12.8 10 12 10
                    H 2
                    Q 1 10 1 9
                    V 2
                    Q 1 1 2 1
                    Z
                  "
                  fill="currentColor"
                />
              </svg>
            </div>
          )}
        </div>
      </nav>
    </header>
  );
}
