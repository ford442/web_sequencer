import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import {
  HELP_CATEGORY_LABELS,
  HELP_TOPICS,
  getHelpTopic,
  searchHelpTopics,
  type HelpTopic,
} from '../content/helpTopics';
import { helpDiscoveryStore, type HelpModalTab } from '../stores/helpDiscoveryStore';
import { SHORTCUT_SECTIONS } from './help/helpShortcuts';

interface ShortcutsHelpProps {
  onClose: () => void;
  initialTab?: HelpModalTab;
  initialTopicId?: string;
  initialSearchQuery?: string;
}

const TABS: { id: HelpModalTab; label: string }[] = [
  { id: 'search', label: 'Search' },
  { id: 'guides', label: 'Guides' },
  { id: 'shortcuts', label: 'Shortcuts' },
];

function TopicDetail({ topic, onBack }: { topic: HelpTopic; onBack?: () => void }) {
  return (
    <article className="space-y-4">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="text-[10px] text-cyan-500 hover:text-cyan-300 font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 rounded"
        >
          ← Back to results
        </button>
      )}
      <header>
        <span className="text-[9px] uppercase tracking-wider text-gray-500">
          {HELP_CATEGORY_LABELS[topic.category]}
        </span>
        <h3 className="font-orbitron text-lg text-cyan-300 tracking-wide mt-1">{topic.title}</h3>
        <p className="text-sm text-gray-300 mt-2">{topic.summary}</p>
      </header>

      {topic.steps && topic.steps.length > 0 && (
        <div className="rounded-lg border border-cyan-900/30 bg-zinc-900/50 p-3">
          <div className="flex items-center gap-2 mb-2">
            <div
              className="w-10 h-10 rounded-md bg-gradient-to-br from-cyan-900/60 to-purple-900/40 border border-cyan-800/40 flex items-center justify-center text-lg"
              aria-hidden="true"
            >
              {topic.category === 'engine' && '⚙'}
              {topic.category === 'automation' && '〰'}
              {topic.category === 'sampler' && '🎤'}
              {topic.category === 'import' && '📂'}
              {topic.category === 'song' && '🎼'}
              {topic.category === 'voice' && '🎛'}
              {topic.category === 'general' && '✦'}
            </div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              Step-by-step
            </span>
          </div>
          <ol className="list-decimal list-inside space-y-1.5 text-xs text-gray-300">
            {topic.steps.map((step, i) => (
              <li key={i} className="leading-relaxed">{step}</li>
            ))}
          </ol>
        </div>
      )}

      {topic.body.split('\n\n').map((para, i) => (
        <p key={i} className="text-xs text-gray-400 leading-relaxed">{para}</p>
      ))}

      {topic.docLink && (
        <p className="text-[10px] text-gray-500">
          More in repo docs: <code className="text-cyan-600/80">{topic.docLink}</code>
        </p>
      )}
    </article>
  );
}

export const ShortcutsHelp: React.FC<ShortcutsHelpProps> = memo(({
  onClose,
  initialTab = 'search',
  initialTopicId,
  initialSearchQuery = '',
}) => {
  const modalRef = useFocusTrap(true, onClose);
  const searchRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<HelpModalTab>(initialTab);
  const [query, setQuery] = useState(initialSearchQuery);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(initialTopicId ?? null);

  useEffect(() => {
    const req = helpDiscoveryStore.consumeOpenRequest();
    if (req) {
      setTab(req.tab);
      if (req.searchQuery) setQuery(req.searchQuery);
      if (req.topicId) {
        setSelectedTopicId(req.topicId);
        if (req.tab !== 'shortcuts') setTab('guides');
      }
    }
  }, []);

  useEffect(() => {
    if (tab === 'search') searchRef.current?.focus();
  }, [tab]);

  const results = useMemo(() => searchHelpTopics(query), [query]);
  const selectedTopic = selectedTopicId ? getHelpTopic(selectedTopicId) : null;

  const pickTopic = useCallback((id: string) => {
    setSelectedTopicId(id);
    setTab('guides');
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="absolute inset-0 z-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={modalRef}
        className="w-full max-w-3xl z-10 bg-[#0f1215] border border-cyan-900/50 rounded-xl shadow-[0_0_50px_rgba(6,182,212,0.2)] overflow-hidden flex flex-col max-h-[85vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        aria-describedby="help-desc"
        tabIndex={-1}
      >
        <div className="flex justify-between items-center p-4 border-b border-gray-800 bg-gray-900/50 gap-3">
          <div>
            <h2 id="help-title" className="text-xl font-orbitron font-bold text-cyan-400 tracking-widest">
              HELP
            </h2>
            <p id="help-desc" className="text-[10px] text-gray-500 mt-0.5">
              Search workflows · Guides · Shortcuts
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 rounded p-1"
            aria-label="Close Help"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <div className="flex border-b border-gray-800 bg-zinc-950/50" role="tablist" aria-label="Help sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => {
                setTab(t.id);
                if (t.id === 'search') setSelectedTopicId(null);
              }}
              className={`flex-1 py-2.5 text-[10px] sm:text-xs font-orbitron font-bold tracking-wider transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-500 ${
                tab === t.id
                  ? 'text-cyan-400 border-b-2 border-cyan-500 bg-cyan-950/20'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {t.label.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-6">
          {tab === 'search' && (
            <div role="tabpanel" className="space-y-4">
              <label className="block">
                <span className="sr-only">Search help</span>
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder='Try "automate filter", "jc303", "tts"...'
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                  aria-label="Search help topics"
                />
              </label>
              <ul className="space-y-2" role="list">
                {results.map((topic) => (
                  <li key={topic.id}>
                    <button
                      type="button"
                      onClick={() => pickTopic(topic.id)}
                      className="w-full text-left p-3 rounded-lg border border-gray-800 hover:border-cyan-800/50 hover:bg-cyan-950/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                    >
                      <span className="text-[9px] uppercase text-gray-500">
                        {HELP_CATEGORY_LABELS[topic.category]}
                      </span>
                      <span className="block text-sm font-bold text-gray-200 mt-0.5">{topic.title}</span>
                      <span className="block text-xs text-gray-500 mt-1">{topic.summary}</span>
                    </button>
                  </li>
                ))}
                {results.length === 0 && (
                  <li className="text-sm text-gray-500 text-center py-8">No topics match your search.</li>
                )}
              </ul>
            </div>
          )}

          {tab === 'guides' && (
            <div role="tabpanel">
              {selectedTopic ? (
                <TopicDetail topic={selectedTopic} onBack={() => setSelectedTopicId(null)} />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {HELP_TOPICS.map((topic) => (
                    <button
                      key={topic.id}
                      type="button"
                      onClick={() => setSelectedTopicId(topic.id)}
                      className="text-left p-3 rounded-lg bg-gray-800/20 border border-gray-800 hover:border-cyan-800/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                    >
                      <span className="text-[9px] text-gray-500 uppercase">
                        {HELP_CATEGORY_LABELS[topic.category]}
                      </span>
                      <span className="block text-sm font-bold text-gray-200 mt-1">{topic.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'shortcuts' && (
            <div role="tabpanel" className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {SHORTCUT_SECTIONS.map((section) => (
                <div key={section.title} className="bg-gray-800/20 rounded-lg p-4 border border-gray-800">
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 border-b border-gray-700 pb-2">
                    {section.title}
                  </h3>
                  <ul className="space-y-2">
                    {section.items.map((item) => (
                      <li key={item.key} className="flex justify-between items-center text-sm gap-2">
                        <span className="text-gray-300">{item.desc}</span>
                        <kbd className="bg-gray-900 border border-gray-700 px-2 py-1 rounded text-xs font-mono text-cyan-500 font-bold shrink-0 text-center shadow-sm">
                          {item.key}
                        </kbd>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-800 bg-gray-900/50 flex justify-between items-center gap-2">
          <span className="text-[9px] text-gray-600 hidden sm:inline">
            Docs: README · docs/audio-engine/jc303-prophecy.md · docs/automation.md
          </span>
          <button
            type="button"
            onClick={onClose}
            className="bg-cyan-900/30 text-cyan-400 border border-cyan-800/50 hover:bg-cyan-900/50 px-6 py-2 rounded font-orbitron text-xs font-bold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ml-auto"
          >
            GOT IT
          </button>
        </div>
      </div>
    </div>
  );
});

ShortcutsHelp.displayName = 'ShortcutsHelp';
