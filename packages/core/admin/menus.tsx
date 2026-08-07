/**
 * Admin kit — menus & navigation (T9.2): Tabs, DropdownMenu, CommandPalette.
 * Each implements its WAI-ARIA Authoring Practices keyboard pattern:
 *   Tabs           — roving tabindex, Arrow/Home/End, aria-selected + tabpanel.
 *   DropdownMenu   — menu button, Arrow navigation, Escape, outside-click close.
 *   CommandPalette — combobox+listbox, aria-activedescendant, Arrow/Enter/Esc.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { cn } from './utils';
import { filterCommands, type CommandLike } from './logic';
import { IconSearch } from './icons';

// ─── Tabs ─────────────────────────────────────────────────────────────────────

export interface TabItem {
  id: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  className?: string;
}

export function Tabs({ tabs, value, defaultValue, onChange, className }: TabsProps) {
  const [internal, setInternal] = useState(defaultValue ?? tabs[0]?.id);
  const active = value ?? internal;
  const baseId = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const setActive = (id: string) => {
    if (value === undefined) setInternal(id);
    onChange?.(id);
  };

  const enabledIds = tabs.filter((t) => !t.disabled).map((t) => t.id);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const currentIndex = enabledIds.indexOf(active);
    let nextId: string | undefined;
    if (event.key === 'ArrowRight') nextId = enabledIds[(currentIndex + 1) % enabledIds.length];
    else if (event.key === 'ArrowLeft') nextId = enabledIds[(currentIndex - 1 + enabledIds.length) % enabledIds.length];
    else if (event.key === 'Home') nextId = enabledIds[0];
    else if (event.key === 'End') nextId = enabledIds[enabledIds.length - 1];
    if (nextId) {
      event.preventDefault();
      setActive(nextId);
      refs.current[nextId]?.focus();
    }
  };

  return (
    <div className={className}>
      <div role="tablist" aria-orientation="horizontal" className="flex gap-1 border-b border-[var(--adm-border)]">
        {tabs.map((tab) => {
          const selected = active === tab.id;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                refs.current[tab.id] = el;
              }}
              role="tab"
              type="button"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              disabled={tab.disabled}
              onClick={() => setActive(tab.id)}
              onKeyDown={onKeyDown}
              className={cn(
                'adm-focusable -mb-px border-b-2 px-3 py-2 text-[length:var(--adm-text-sm)] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                selected
                  ? 'border-[var(--adm-accent)] text-[var(--adm-text)]'
                  : 'border-transparent text-[var(--adm-text-muted)] hover:text-[var(--adm-text)]'
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${baseId}-panel-${tab.id}`}
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          hidden={active !== tab.id}
          tabIndex={0}
          className="adm-focusable pt-4"
        >
          {active === tab.id ? tab.content : null}
        </div>
      ))}
    </div>
  );
}

// ─── DropdownMenu ─────────────────────────────────────────────────────────────

export interface MenuItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  title?: string;
  tone?: 'default' | 'danger';
}

export interface DropdownMenuProps {
  trigger: (props: { open: boolean; ref: React.Ref<HTMLButtonElement>; onToggle: () => void }) => ReactNode;
  items: MenuItem[];
  align?: 'start' | 'end';
  className?: string;
}

export function DropdownMenu({ trigger, items, align = 'start', className }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const baseId = useId();

  const enabledIndexes = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);

  const close = useCallback((focusTrigger = true) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const first = enabledIndexes[0] ?? 0;
    setActiveIndex(first);
  }, [open]);

  useEffect(() => {
    if (open) itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const move = (dir: 1 | -1) => {
    const pos = enabledIndexes.indexOf(activeIndex);
    const nextPos = (pos + dir + enabledIndexes.length) % enabledIndexes.length;
    setActiveIndex(enabledIndexes[nextPos]);
  };

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(enabledIndexes[0]);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(enabledIndexes[enabledIndexes.length - 1]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  const select = (item: MenuItem) => {
    if (item.disabled) return;
    item.onSelect?.();
    close();
  };

  return (
    <div ref={rootRef} className={cn('relative inline-block', className)}>
      {trigger({
        open,
        ref: triggerRef,
        onToggle: () => setOpen((o) => !o),
      })}
      {open ? (
        <div
          role="menu"
          aria-orientation="vertical"
          id={`${baseId}-menu`}
          onKeyDown={onMenuKeyDown}
          className={cn(
            'adm-root adm-animate-in absolute z-50 mt-1 min-w-[12rem] rounded-[var(--adm-radius-md)] border border-[var(--adm-border)] bg-[var(--adm-surface-raised)] p-1 shadow-[var(--adm-shadow-md)]',
            align === 'end' ? 'right-0' : 'left-0'
          )}
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              role="menuitem"
              type="button"
              tabIndex={index === activeIndex ? 0 : -1}
              disabled={item.disabled}
              title={item.title}
              onClick={() => select(item)}
              onMouseEnter={() => !item.disabled && setActiveIndex(index)}
              className={cn(
                'adm-focusable flex w-full items-center gap-2 rounded-[var(--adm-radius-sm)] px-2.5 py-1.5 text-left text-[length:var(--adm-text-sm)] disabled:cursor-not-allowed disabled:opacity-40',
                item.tone === 'danger' ? 'text-[var(--adm-danger)]' : 'text-[var(--adm-text)]',
                index === activeIndex && !item.disabled
                  ? item.tone === 'danger'
                    ? 'bg-[var(--adm-danger-soft)]'
                    : 'bg-[var(--adm-accent-soft)]'
                  : ''
              )}
            >
              {item.icon ? <span className="shrink-0">{item.icon}</span> : null}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ─── CommandPalette ───────────────────────────────────────────────────────────

export interface CommandItem extends CommandLike {
  onSelect?: () => void;
  icon?: ReactNode;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: CommandItem[];
  placeholder?: string;
  onSelect?: (command: CommandItem) => void;
}

export function CommandPalette({
  open,
  onClose,
  commands,
  placeholder = 'Type a command…',
  onSelect,
}: CommandPaletteProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const baseId = useId();

  const results = useMemo(() => filterCommands(commands, query), [commands, query]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      setQuery('');
      setActiveIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handleClose = () => onClose();
    el.addEventListener('close', handleClose);
    return () => el.removeEventListener('close', handleClose);
  }, [onClose]);

  useEffect(() => setActiveIndex(0), [query]);

  const choose = (command: CommandItem | undefined) => {
    if (!command) return;
    command.onSelect?.();
    onSelect?.(command);
    ref.current?.close();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[activeIndex]);
    }
    // Escape is handled natively by <dialog> → 'close' → onClose.
  };

  return (
    <dialog
      ref={ref}
      className="adm-dialog adm-root adm-animate-in mx-auto mt-[12vh] w-[calc(100vw-2rem)] max-w-xl rounded-[var(--adm-radius-lg)] border border-[var(--adm-border)] bg-[var(--adm-surface-raised)] p-0 text-[var(--adm-text)] shadow-[var(--adm-shadow-lg)]"
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <div className="flex items-center gap-2 border-b border-[var(--adm-border)] px-3">
        <IconSearch size={18} className="text-[var(--adm-text-muted)]" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={true}
          aria-controls={`${baseId}-listbox`}
          aria-activedescendant={results[activeIndex] ? `${baseId}-opt-${results[activeIndex].id}` : undefined}
          aria-autocomplete="list"
          placeholder={placeholder}
          className="h-12 flex-1 bg-transparent text-[length:var(--adm-text-base)] text-[var(--adm-text)] outline-none placeholder:text-[var(--adm-text-muted)]"
        />
      </div>
      <ul id={`${baseId}-listbox`} role="listbox" className="max-h-80 overflow-auto p-1">
        {results.length === 0 ? (
          <li className="px-3 py-6 text-center text-[length:var(--adm-text-sm)] text-[var(--adm-text-muted)]">
            No matching commands
          </li>
        ) : (
          results.map((command, index) => (
            <li
              key={command.id}
              id={`${baseId}-opt-${command.id}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(command)}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-2 rounded-[var(--adm-radius-sm)] px-3 py-2 text-[length:var(--adm-text-sm)]',
                index === activeIndex ? 'bg-[var(--adm-accent-soft)] text-[var(--adm-text)]' : 'text-[var(--adm-text)]'
              )}
            >
              <span className="flex items-center gap-2">
                {command.icon ? <span className="shrink-0 text-[var(--adm-text-muted)]">{command.icon}</span> : null}
                {command.label}
              </span>
              {command.group ? (
                <span className="text-[length:var(--adm-text-xs)] text-[var(--adm-text-muted)]">{command.group}</span>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </dialog>
  );
}
