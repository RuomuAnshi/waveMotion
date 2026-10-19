import React from 'react';

const TABS = [
  {id: 'appearance', label: '外观'},
  {id: 'rhythm', label: '节奏'},
  {id: 'export', label: '导出'},
] as const;
export type InspectorTab = typeof TABS[number]['id'];

export function InspectorTabs({value, onChange, rendering}: {
  value: InspectorTab;
  onChange: (tab: InspectorTab) => void;
  rendering: boolean;
}) {
  return (
    <div className="inspector-tabs" role="tablist" aria-label="检查器面板">
      {TABS.map(({id, label}, index) => (
        <button
          key={id}
          id={`tab-${id}`}
          role="tab"
          aria-selected={value === id}
          aria-controls={`panel-${id}`}
          tabIndex={value === id ? 0 : -1}
          onClick={() => onChange(id)}
          onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length
              : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : -1;
            if (next < 0) return;
            event.preventDefault();
            onChange(TABS[next].id);
            document.getElementById(`tab-${TABS[next].id}`)?.focus();
          }}
        >
          {label}
          {id === 'export' && rendering && <span className="tab-dot" />}
        </button>
      ))}
    </div>
  );
}
