"use client";

import { useEffect, useId, useRef, useState } from "react";

export interface FilterOption {
  id: string | null;
  label: string;
  /** Live count, shown on the right of the row and on the trigger. */
  count?: number;
  /** Status dot, when the option has a colour in the system. */
  accent?: string;
  hint?: string;
  disabled?: boolean;
}

/**
 * A filter dropdown: one trigger that names the current selection, and a
 * menu of options with live counts.
 *
 * This exists to replace rows of chips. A chip row is fine for three or four
 * options and stops working at six: it wraps onto its own line, every option
 * competes for attention at equal weight whether or not it is selected, and
 * the toolbar grows a line every time a new facet is added. A trigger that
 * reads "Status: In progress" answers "what am I looking at?" in one glance
 * and costs one line no matter how many options sit behind it.
 *
 * Keyboard behaviour is the standard menu contract — arrows move, Enter and
 * Space choose, Escape closes and returns focus to the trigger, Tab closes —
 * so it is operable without a mouse and screen readers announce it as a menu
 * rather than as a pile of toggle buttons.
 */
export function FilterMenu({
  label,
  options,
  value,
  onChange,
  align = "start",
}: {
  /** The facet name, e.g. "Board". Shown on the trigger before the value. */
  label: string;
  options: FilterOption[];
  value: string | null;
  onChange: (next: string | null) => void;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.id === value),
  );
  const selected = options[selectedIndex];
  const isDefault = value === null;

  useEffect(() => {
    if (!open) return;
    setActive(selectedIndex);

    // preventScroll matters here: the menu opens inside a sticky toolbar, and
    // the default focus behaviour scrolls it into view — which yanks the page
    // upward the instant you click a filter. Also done in an effect rather
    // than an inline ref callback, which would re-fire on every keystroke.
    menuRef.current?.focus({ preventScroll: true });

    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, selectedIndex]);

  function choose(option: FilterOption) {
    if (option.disabled) return;
    onChange(option.id);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape" || e.key === "Tab") {
      setOpen(false);
      if (e.key === "Escape") {
        e.preventDefault();
        triggerRef.current?.focus();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => {
        // Skip disabled rows rather than letting the cursor land on one.
        let next = i;
        for (let n = 0; n < options.length; n++) {
          next = (next + step + options.length) % options.length;
          if (!options[next].disabled) return next;
        }
        return i;
      });
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : options.length - 1);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const option = options[active];
      if (option) choose(option);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className="chip h-9 gap-1.5 px-3"
        // A filter that is doing something looks like it is doing something.
        // The default state stays quiet so the toolbar does not read as
        // "three things are filtered" when nothing is.
        style={
          isDefault
            ? undefined
            : {
                borderColor: "var(--brand)",
                color: "var(--link)",
                background: "var(--brand-tint)",
              }
        }
      >
        {selected?.accent && (
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: selected.accent }}
          />
        )}
        <span className="text-ink-2" style={isDefault ? undefined : { color: "inherit" }}>
          {label}
        </span>
        <span className="font-semibold" style={{ color: isDefault ? "var(--ink)" : "inherit" }}>
          {selected?.label ?? "Any"}
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden
          className="transition-transform duration-200"
          style={{ transform: open ? "rotate(180deg)" : undefined }}
        >
          <path
            d="M3 4.5 6 7.5 9 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          tabIndex={-1}
          ref={menuRef}
          onKeyDown={onMenuKeyDown}
          className="popup animate-pop thin-scroll absolute z-50 mt-1.5 max-h-[320px] w-[230px] overflow-y-auto p-1.5 outline-none"
          style={align === "end" ? { right: 0 } : { left: 0 }}
        >
          {options.map((option, i) => {
            const isSelected = option.id === value;
            return (
              <button
                key={option.id ?? "__any"}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                disabled={option.disabled}
                title={option.hint}
                onMouseMove={() => setActive(i)}
                onClick={() => choose(option)}
                className="flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[13.5px] transition-colors disabled:cursor-default disabled:opacity-40"
                style={
                  active === i && !option.disabled
                    ? { background: "var(--surface-hover)" }
                    : undefined
                }
              >
                {option.accent ? (
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: option.accent }}
                  />
                ) : (
                  <span aria-hidden className="h-1.5 w-1.5 shrink-0" />
                )}
                <span
                  className="min-w-0 flex-1 truncate"
                  style={{
                    color: isSelected ? "var(--ink)" : "var(--ink-2)",
                    fontWeight: isSelected ? 600 : 500,
                  }}
                >
                  {option.label}
                </span>
                {option.count !== undefined && (
                  <span className="numeric text-[12px] text-ink-3">
                    {option.count}
                  </span>
                )}
                {isSelected && (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden
                    style={{ color: "var(--link)" }}
                  >
                    <path
                      d="m3.5 8.5 3 3 6-7"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
