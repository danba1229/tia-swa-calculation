'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ADDRESS_QUERY_MIN, ADDRESS_QUERY_MAX } from '../lib/addressQuery';

export default function AddressAutocomplete({ value, onChange }) {
  const id = useId();
  const inputRef = useRef(null);
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  const [result, setResult] = useState({ query: '', status: 'idle', items: [] });
  const query = value.trim();
  const eligible = query.length >= ADDRESS_QUERY_MIN && query.length <= ADDRESS_QUERY_MAX;
  const visible = focused && !composing && !dismissed && eligible;
  const current = result.query === query ? result : { status: 'loading', items: [] };
  const items = visible && current.status === 'ready' ? current.items : [];

  useEffect(() => {
    setActive(-1);
    if (!visible) return;
    let cancelled = false;
    const controller = new AbortController();
    setResult({ query, status: 'loading', items: [] });
    const timer = setTimeout(async () => {
      try {
        const response = await fetch('/api/address-suggestions', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }), signal: controller.signal,
        });
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok || !data.success || !Array.isArray(data.suggestions)) throw new Error('Search failed');
        setResult({ query, status: 'ready', items: data.suggestions });
      } catch {
        if (!cancelled) setResult({ query, status: 'error', items: [] });
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [query, visible]);

  useEffect(() => {
    if (active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, id]);

  function choose(item) {
    onChange(item.address);
    inputRef.current?.focus({ preventScroll: true });
    setDismissed(true);
    setActive(-1);
  }

  function onKeyDown(event) {
    if (composing || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      setDismissed(true); setActive(-1);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setDismissed(false);
      if (items.length) setActive(index => event.key === 'ArrowDown'
        ? (index + 1) % items.length : (index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length));
    } else if (event.key === 'Enter' && items[active]) {
      event.preventDefault(); choose(items[active]);
    }
  }

  const message = current.status === 'error' ? '자동완성을 불러오지 못했습니다. 주소를 직접 입력할 수 있습니다.'
    : current.status === 'loading' ? '주소 후보 검색 중…'
      : !items.length ? '검색 결과가 없습니다. 도로명·번지 또는 건물명을 더 입력해 주세요.'
        : `${items.length}개 주소 후보 · ↑↓ 선택 / Enter 입력 / Esc 닫기`;

  return <div className="full address-autocomplete" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) { setFocused(false); setActive(-1); }
  }}>
    <label htmlFor={id}>주소지</label>
    <input id={id} ref={inputRef} role="combobox" aria-autocomplete="list"
      aria-expanded={visible} aria-controls={visible ? `${id}-list` : undefined}
      aria-activedescendant={items[active] ? `${id}-option-${active}` : undefined}
      aria-describedby={`${id}-hint`} autoComplete="off" spellCheck={false}
      placeholder="예: 경기도 수원시 팔달구 효원로 241" value={value}
      onFocus={() => { setFocused(true); setDismissed(false); }}
      onChange={event => { onChange(event.target.value); setDismissed(false); setActive(-1); }}
      onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} onKeyDown={onKeyDown} />
    <span id={`${id}-hint`} className="address-input-hint">도로명·지번·건물명 2자 이상 입력하면 주소를 추천합니다.</span>
    {visible && <div className="address-suggestions">
      <p className="address-search-status" role="status">{message}</p>
      <ul id={`${id}-list`} role="listbox" aria-label="주소 후보" aria-busy={current.status === 'loading'}>
        {items.map((item, index) => <li key={item.address} role="presentation">
          <button id={`${id}-option-${index}`} role="option" aria-selected={index === active}
            type="button" tabIndex={-1} onMouseDown={event => event.preventDefault()} onClick={() => choose(item)}>
            <span className="address-suggestion-type">{item.type}</span>
            <span className="address-suggestion-text"><strong>{item.address}</strong>
              {item.name && <span>{item.name}</span>}
              {item.landAddress && item.landAddress !== item.address && <small>지번 · {item.landAddress}</small>}
            </span>
          </button>
        </li>)}
      </ul>
      <p className="address-suggestion-source">카카오 주소검색 · 선택 후 사업지 좌표를 확인합니다.</p>
    </div>}
  </div>;
}
