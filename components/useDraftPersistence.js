'use client';
import { useEffect, useRef, useState } from 'react';
import { rememberDraft, writeDraft } from '../lib/draftStorage';

export default function useDraftPersistence(key, value, ready) {
  const [status, setStatus] = useState('loading');
  const revision = useRef(0);
  const serialized = JSON.stringify(value);
  useEffect(() => {
    if (!ready) return;
    const snapshot = JSON.parse(serialized);
    rememberDraft(key, snapshot);
    const id = ++revision.current;
    setStatus('saving');
    const timer = setTimeout(async () => {
      const result = await writeDraft(key, snapshot);
      if (id === revision.current) setStatus(result);
    }, 250);
    return () => { clearTimeout(timer); revision.current++; };
  }, [key, serialized, ready]);
  useEffect(() => {
    if (!['saving', 'failed'].includes(status)) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [status]);
  return status;
}
