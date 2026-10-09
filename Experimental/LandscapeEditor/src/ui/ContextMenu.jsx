import React, { useEffect, useLayoutEffect, useRef } from 'react';
import Glyph from './Glyph.jsx';

// Items: { label, icon?, shortcut?, danger?, disabled?, onSelect } | { heading } | { separator: true }
export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    element.style.left = left + 'px';
    element.style.top = top + 'px';
  }, [x, y, items]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="menu-dismiss lx-dismiss" onPointerDown={onClose} onContextMenu={(event) => { event.preventDefault(); onClose(); }} />
      <div ref={ref} className="popup-menu lx-menu" role="menu" style={{ left: x, top: y }}>
        {items.map((item, index) => {
          if (item.heading) return <div key={'h' + index} className="lx-menu-heading">{item.heading}</div>;
          if (item.separator) return <hr key={'s' + index} className="lx-menu-sep" />;
          return (
            <button
              key={item.label + index}
              type="button"
              role="menuitem"
              className={'lx-menu-item ' + (item.danger ? 'danger' : '')}
              disabled={item.disabled}
              onClick={() => {
                onClose();
                item.onSelect?.();
              }}
            >
              {item.icon ? <Glyph name={item.icon} size={14} /> : <span className="lx-menu-spacer" />}
              <span>{item.label}</span>
              {item.shortcut && <kbd>{item.shortcut}</kbd>}
            </button>
          );
        })}
      </div>
    </>
  );
}
