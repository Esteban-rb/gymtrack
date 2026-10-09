import React, { useState } from 'react';

const fold = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('und');
export const optionLabel = (item) => item.muscle ? `${item.name} · ${item.muscle}` : item.name;

/** Searchable select over the exercise catalog, ending with a "create a new exercise" option. */
export default function ExercisePicker({ id, t, catalog, selectedLabel, onPickCatalog, onCreate, invalid, describedBy }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const needle = fold(query).trim();
  const matches = catalog.filter((item) => !needle || fold(`${item.name} ${item.muscle || ''}`).includes(needle));
  const options = [...matches.map((item) => ({ key: item.id, label: optionLabel(item), item })), { key: '__new__', label: t('exercise.create'), item: null }];
  const listId = `${id}-list`;

  const close = () => { setOpen(false); setQuery(''); setActive(0); };
  const choose = (option) => {
    if (option.item) onPickCatalog(option.item); else onCreate();
    close();
  };
  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (current + step + options.length) % options.length);
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      choose(options[Math.min(active, options.length - 1)]);
    } else if (event.key === 'Escape' && open) {
      event.stopPropagation();
      close();
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <input
        id={id} type="text" role="combobox" autoComplete="off" className="gt-input"
        aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={open ? `${id}-opt-${Math.min(active, options.length - 1)}` : undefined}
        aria-invalid={invalid ? 'true' : undefined} aria-describedby={describedBy}
        placeholder={t('exercise.placeholder')}
        value={open ? query : selectedLabel}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onBlur={close} onKeyDown={onKeyDown}
        onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }}
      />
      {open ? (
        <ul id={listId} role="listbox" aria-label={t('exercise.picker')} className="gt-card"
          style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, margin: '4px 0 0', padding: 4, listStyle: 'none', maxHeight: 240, overflowY: 'auto', background: 'var(--surface-solid)' }}>
          {matches.length === 0 ? <li className="gt-micro" style={{ padding: '8px 10px' }}>{t('exercise.noMatches')}</li> : null}
          {options.map((option, index) => (
            <li key={option.key} id={`${id}-opt-${index}`} role="option" aria-selected={index === Math.min(active, options.length - 1)}
              onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(option)}
              style={{ padding: '10px', borderRadius: 8, cursor: 'pointer', fontWeight: option.item ? 400 : 700, background: index === Math.min(active, options.length - 1) ? 'var(--surface-2)' : 'transparent' }}>
              {option.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
