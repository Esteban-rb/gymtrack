import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { decodeRoutineFile } from '../routine-import.js';
import { friendlyList } from '../routine-messages.js';
import { useT } from '../i18n.js';

/** `embedded` (wizard): no card/heading; the wizard bar owns Back. */
export default function RoutineImport({ catalog, onDecoded, onCancel, embedded = false }) {
  const { t } = useT();
  const [file, setFile] = useState(null);
  const [sheetNames, setSheetNames] = useState([]);
  const [candidate, setCandidate] = useState(null);
  const [errors, setErrors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState(''); // '' | reading | ready | failed | catalogChanged
  const [retryWithCatalog, setRetryWithCatalog] = useState(false);
  const requestId = useRef(0);
  const mounted = useRef(false);
  const priorCatalog = useRef(catalog);
  const inputRef = useRef(null);
  const handedCandidate = useRef(null);
  const candidateForCatalog = candidate?.catalog === catalog ? candidate : null;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestId.current++; };
  }, []);

  useLayoutEffect(() => {
    if (priorCatalog.current === catalog) return;
    priorCatalog.current = catalog;
    requestId.current++;
    handedCandidate.current = null;
    setCandidate(null);
    setSheetNames([]);
    setErrors([]);
    setLoading(false);
    setRetryWithCatalog(!!file);
    setPhase(file ? 'catalogChanged' : '');
  }, [catalog, file]);

  const decode = async (selectedFile, sheetName) => {
    const token = ++requestId.current;
    const catalogAtStart = catalog;
    setCandidate(null);
    handedCandidate.current = null;
    setRetryWithCatalog(false);
    setErrors([]);
    if (sheetName === undefined) setSheetNames([]);
    setLoading(true);
    setPhase('reading');
    try {
      const result = await decodeRoutineFile(selectedFile, catalogAtStart, sheetName === undefined ? undefined : { sheetName });
      if (!mounted.current || token !== requestId.current) return;
      setLoading(false);
      if (Array.isArray(result.sheetNames)) {
        setCandidate(null);
        setSheetNames([...result.sheetNames]);
        setErrors(result.errors || []);
        setPhase('');
      } else if (result.valid && result.draft) {
        setCandidate({ file: selectedFile, catalog: catalogAtStart, draft: result.draft });
        setSheetNames([]);
        setErrors([]);
        setPhase('ready');
      } else {
        setCandidate(null);
        setErrors(result.errors || [{ code: 'decode-error', path: '', message: 'Could not decode this file.' }]);
        setPhase('failed');
      }
    } catch (error) {
      if (!mounted.current || token !== requestId.current) return;
      setLoading(false);
      setCandidate(null);
      setErrors([{ code: 'file-decode-error', path: '', message: error instanceof Error ? error.message : 'Could not decode file.' }]);
      setPhase('failed');
    }
  };

  const selectFile = (event) => {
    const selected = event.target.files?.[0];
    event.target.value = '';
    if (!selected) return;
    requestId.current++;
    setFile(selected);
    setCandidate(null);
    handedCandidate.current = null;
    setRetryWithCatalog(false);
    setSheetNames([]);
    setErrors([]);
    setPhase('');
    decode(selected);
  };

  const cancel = () => {
    requestId.current++;
    setFile(null);
    setCandidate(null);
    setSheetNames([]);
    setErrors([]);
    setLoading(false);
    setPhase('');
    setRetryWithCatalog(false);
    handedCandidate.current = null;
    if (inputRef.current) inputRef.current.value = '';
    onCancel?.();
  };

  const handoff = () => {
    if (!onDecoded || !candidateForCatalog || loading || handedCandidate.current === candidateForCatalog) return;
    handedCandidate.current = candidateForCatalog;
    try {
      onDecoded(candidateForCatalog.draft);
    } catch {
      handedCandidate.current = null;
      setPhase('failed');
    }
  };

  const statusText = { reading: t('import.reading'), ready: t('import.ready'), failed: t('import.failed'), catalogChanged: t('import.catalogChanged') }[phase] || '';
  const errorMessages = sheetNames.length ? [] : friendlyList(errors, t);
  const routineCount = candidateForCatalog?.draft.variants.length ?? 0;

  return (
    <section aria-label={t('import.region')} className={embedded ? undefined : 'gt-card'} style={embedded ? undefined : { padding: 16 }}>
      {embedded ? null : <h2 className="gt-h1" style={{ fontSize: 22 }}>{t('import.title')}</h2>}
      <p className="gt-sub">{t('import.hint')}</p>
      <label htmlFor="routine-import-file" className="gt-body" style={{ display: 'block', margin: '12px 0 6px', fontWeight: 700 }}>{t('import.choose')}</label>
      <input ref={inputRef} id="routine-import-file" type="file" accept=".csv,.json,.xlsx,.xls,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={selectFile} />
      {file ? <p className="gt-micro">{t('import.selected', { name: file.name })}</p> : null}
      {statusText ? <p role="status" aria-live="polite">{statusText}</p> : null}
      {errorMessages.length ? (
        <div role="alert" className="gt-card" style={{ padding: 12, margin: '10px 0' }}>
          <ul>{errorMessages.map((message) => <li key={message}>{message}</li>)}</ul>
        </div>
      ) : null}
      {sheetNames.length ? (
        <div aria-label={t('import.sheets')} role="group" style={{ margin: '12px 0' }}>
          <p className="gt-body">{t('import.sheets')}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {sheetNames.map((sheetName, index) => <button key={`${index}-${sheetName}`} type="button" className="gt-btn gt-btn-ghost" aria-label={t('import.useSheet', { name: sheetName })} disabled={loading} onClick={() => file && decode(file, sheetName)}><span style={{ whiteSpace: 'pre-wrap' }}>{sheetName}</span></button>)}
          </div>
        </div>
      ) : null}
      {candidateForCatalog ? (
        <div className="gt-card" role="group" aria-label={routineCount === 1 ? t('import.foundOne') : t('import.found', { n: routineCount })} style={{ padding: 12, margin: '12px 0' }}>
          <h3 className="gt-h2">{routineCount === 1 ? t('import.foundOne') : t('import.found', { n: routineCount })}</h3>
          {candidateForCatalog.draft.variants.map((variant, index) => (
            <article key={`${variant.order}-${variant.code}-${index}`} style={{ margin: '10px 0' }}>
              <h4 className="gt-body">{variant.name}</h4>
              <ul>{variant.exercises.map((exercise, exerciseIndex) => <li key={`${exercise.order}-${exerciseIndex}`}>{exercise.name} · {t(`unit.${exercise.unit}`)}</li>)}</ul>
            </article>
          ))}
        </div>
      ) : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        {file && retryWithCatalog && !candidateForCatalog ? <button type="button" className="gt-btn gt-btn-ghost" disabled={loading} onClick={() => decode(file)}>{t('import.retryCatalog')}</button> : null}
        {file && sheetNames.length > 0 ? <button type="button" className="gt-btn gt-btn-ghost" disabled={loading} onClick={() => decode(file)}>{t('import.retryFile')}</button> : null}
        <button type="button" className="gt-btn gt-btn-primary" disabled={!candidateForCatalog || !onDecoded || loading || handedCandidate.current === candidateForCatalog} onClick={handoff}>{t('import.use')}</button>
        {onCancel ? <button type="button" className="gt-btn gt-btn-ghost" onClick={cancel}>{t('import.cancel')}</button> : null}
      </div>
      {!onDecoded ? <p className="gt-micro" role="status">{t('import.unavailable')}</p> : null}
    </section>
  );
}
