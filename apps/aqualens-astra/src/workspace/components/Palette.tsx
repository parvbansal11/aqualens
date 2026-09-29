import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Kbd } from "./ui";

export interface PaletteItem {
  id: string;
  group: string;
  label: string;
  detail?: string;
  keywords?: string;
  icon?: ReactNode;
  shortcut?: string;
  run: () => void;
}

/** Searchable command surface. Used for ⌘K and for classifying a Contact. */
export function Palette({
  title,
  placeholder,
  items,
  onClose,
  footer,
}: {
  title: string;
  placeholder: string;
  items: PaletteItem[];
  onClose: () => void;
  footer?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => `${i.label} ${i.detail ?? ""} ${i.keywords ?? ""} ${i.group}`.toLowerCase().includes(q));
  }, [items, query]);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      results[active].run();
      onClose();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  let lastGroup = "";
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="palette__field">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.25" fill="none" strokeLinecap="round" />
          </svg>
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={results[active] ? `pi-${results[active].id}` : undefined}
          />
          <Kbd>esc</Kbd>
        </div>
        <div ref={list} id="palette-list" className="palette__list" role="listbox" aria-label={title}>
          {results.length === 0 && <p className="palette__none">Nothing matches “{query}”.</p>}
          {results.map((item, i) => {
            const head = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {head && <p className="palette__group">{head}</p>}
                <button
                  id={`pi-${item.id}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  className={`palette__item ${i === active ? "is-active" : ""}`}
                  onMouseMove={() => setActive(i)}
                  onClick={() => {
                    item.run();
                    onClose();
                  }}
                >
                  {item.icon && <span className="palette__icon">{item.icon}</span>}
                  <span className="palette__label">{item.label}</span>
                  {item.detail && <span className="palette__detail">{item.detail}</span>}
                  {item.shortcut && <Kbd>{item.shortcut}</Kbd>}
                </button>
              </div>
            );
          })}
        </div>
        {footer && <div className="palette__footer">{footer}</div>}
      </div>
    </div>
  );
}
