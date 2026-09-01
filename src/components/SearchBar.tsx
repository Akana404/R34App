"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import type { AutocompleteEntry } from "@/lib/types";

async function getSuggestions(q: string): Promise<AutocompleteEntry[]> {
  const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error("autocomplete failed");
  return res.json();
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

interface SearchBarProps {
  tags: string[];
  onChange: (tags: string[]) => void;
}

export function SearchBar({ tags, onChange }: SearchBarProps) {
  const [input, setInput] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const listId = useId();
  const query = useDebounced(input.trim(), 300);
  const { data: suggestions = [], isError } = useQuery({
    queryKey: ["autocomplete", query],
    queryFn: () => getSuggestions(query),
    enabled: query.length >= 2,
    staleTime: 3_600_000,
  });

  const visible = open && input.trim().length >= 2 ? suggestions : [];
  // A failed lookup shouldn't fail silently, but typing works regardless.
  const showError =
    isError && visible.length === 0 && open && input.trim().length >= 2;
  // Derive instead of resetting via effect: clamp to the current list length.
  const highlightIndex =
    visible.length > 0 ? Math.min(highlighted, visible.length - 1) : -1;

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function addTag(tag: string) {
    const clean = tag.trim();
    if (clean && !tags.includes(clean)) onChange([...tags, clean]);
    setInput("");
    setOpen(false);
    inputRef.current?.focus();
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && visible.length > 0) {
      e.preventDefault();
      setHighlighted((highlightIndex + 1) % visible.length);
    } else if (e.key === "ArrowUp" && visible.length > 0) {
      e.preventDefault();
      setHighlighted((highlightIndex - 1 + visible.length) % visible.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightIndex >= 0 && visible[highlightIndex]) {
        addTag(visible[highlightIndex].value);
      } else if (input.trim()) {
        addTag(input);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && !input && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-3xl min-w-0">
      <div
        className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 focus-within:border-neutral-500"
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-full bg-indigo-600/30 px-3 py-1 text-sm text-indigo-200"
          >
            {tag}
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeTag(tag);
              }}
              className="-m-1 ml-0 p-1 text-indigo-300 hover:text-white"
              aria-label={`Remove ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setOpen(true);
            setHighlighted(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={tags.length === 0 ? "Search tags…" : ""}
          role="combobox"
          aria-expanded={visible.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            highlightIndex >= 0 ? `${listId}-${highlightIndex}` : undefined
          }
          className="min-w-32 flex-1 bg-transparent py-1 text-base outline-none placeholder:text-neutral-500 sm:text-sm"
        />
      </div>

      {visible.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Tag suggestions"
          className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-900 shadow-xl"
        >
          {visible.map((s, i) => (
            <li key={s.value} role="presentation">
              <button
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === highlightIndex}
                tabIndex={-1}
                className={`w-full px-4 py-2.5 text-left text-sm sm:py-2 ${
                  i === highlightIndex
                    ? "bg-indigo-600/40 text-white"
                    : "text-neutral-300 hover:bg-neutral-800"
                }`}
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => addTag(s.value)}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {showError && (
        <p
          role="status"
          className="absolute z-20 mt-2 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm text-neutral-500 shadow-xl"
        >
          Suggestions are unavailable right now — press Enter to search the
          tag as typed.
        </p>
      )}
    </div>
  );
}
