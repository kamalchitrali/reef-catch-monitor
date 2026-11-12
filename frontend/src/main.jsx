import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import AccountForm from './AccountForm.jsx';
import './styles.css';

const paths = {
  fish: <><path d="M18 7c-3-3-9-4-14 2l-2-1v8l2-1c5 6 11 5 14 2l4-5-4-5Z"/><path d="M15.5 11.5h.01M10 6l2-3 3 3M10 18l2 3 3-3"/></>,
  upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 16v4h16v-4"/></>,
  records: <><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M10 9v11M4 14h16"/></>,
  arrow: <path d="M4 12h15m-6-6 6 6-6 6"/>,
  image: <><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></>,
  ruler: <><path d="m3 16 13-13 5 5L8 21l-5-5Zm5-5 3 3m1-7 3 3m1-7 3 3"/></>,
  tag: <><path d="M3 3h8l10 10-8 8L3 11V3Z"/><circle cx="7.5" cy="7.5" r="1"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  undo: <><path d="M9 5 4 10l5 5M4 10h10a5 5 0 0 1 0 10h-2"/></>,
  chevron: <path d="m6 9 6 6 6-6"/>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></>,
  weight: <><path d="M8 8h8l4 12H4L8 8Z"/><circle cx="12" cy="5.5" r="2.5"/></>,
  search: <><circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/></>,
  target: <><circle cx="12" cy="12" r="6"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></>,
  crop: <path d="M6 3v15a1 1 0 0 0 1 1h14M3 6h14a1 1 0 0 1 1 1v14"/>,
  download: <path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>,
  chat: <><path d="M4 5h16v11H9l-5 4V5Z"/><path d="M8 9h8m-8 3h5"/></>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
};
function Icon({ name, size = 20 }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

const contextOptions = ['Landing site', 'Fish market', 'Onboard', 'Survey', 'Shore', 'Aquaculture', 'Other'];
const habitatOptions = ['Freshwater', 'Brackish', 'Marine'];
const tasks = {
  ruler: ['Mark the first ruler tick.', 'Mark the second ruler tick.'],
  fish: ['Mark the tip of the snout.', 'Mark the farthest tip of the tail.'],
  crop: ['Mark one corner around the whole fish.', 'Mark the opposite corner.'],
};
const toolLabels = { ruler: 'Reference ruler', fish: 'Fish size', crop: 'Fish crop' };
const toolIcons = { ruler: 'ruler', fish: 'fish', crop: 'crop' };
const blankFish = () => ({ species: '', ruler: [], fish: [], crop: [], rulerCm: '', coplanar: false, measuredCm: '', weightG: '', history: [] });
const hasLengthInput = fish => Boolean(fish.ruler.length || fish.fish.length || fish.rulerCm);

function Workflow({ photo, estimate, species }) {
  const steps = [
    ['Capture', photo ? 'Photo ready' : 'Add a catch photo', Boolean(photo)],
    ['Measure', estimate !== null ? 'Length estimated' : 'Mark ruler and fish', estimate !== null],
    ['Review', species.trim() ? 'Species entered' : 'Label and save', false],
  ];
  const current = !photo ? 0 : estimate === null && !species.trim() ? 1 : 2;
  return <ol className="workflow" aria-label="Catch workflow">
    {steps.map(([title, hint, complete], index) => <li key={title} className={complete ? 'complete' : current === index ? 'current' : ''}
      aria-current={current === index ? 'step' : undefined}>
      <span className="step-number">{complete ? <><Icon name="check" size={16} /><span className="sr-only">Completed</span></> : `0${index + 1}`}</span>
      <span><strong>{title}</strong><small>{hint}</small></span>
    </li>)}
  </ol>;
}
function today() {
  const date = new Date();
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map(value => String(value).padStart(2, '0')).join('-');
}
const blankDetails = () => ({ site: '', collected_on: today(), context: 'Landing site', habitat: '', water_body: '', gear: '', group: '', notes: '', demo: false });

async function request(path, options) {
  const settings = options?.method && options.method !== 'GET'
    ? { ...options, headers: { ...options.headers, 'X-Reef-Request': '1' } }
    : options;
  let response;
  try {
    response = await fetch(path, settings);
  } catch (problem) {
    if (problem.name === 'AbortError') throw problem;
    throw new Error('Cannot reach the Reef Catch server. Reload the page, confirm the app server is running, and try again.', { cause: problem });
  }
  if (!response.ok) {
    if (response.status === 401 && path.startsWith('/api/') && !path.startsWith('/api/auth/')) {
      window.dispatchEvent(new Event('reef-session-expired'));
    }
    const payload = await response.json().catch(() => null);
    const message = Array.isArray(payload?.detail) ? payload.detail.map(({ loc, msg }) => `${loc.at(-1)}: ${msg}`).join(' · ') : payload?.detail;
    const problem = new Error(message || `Request failed (${response.status}).`);
    problem.status = response.status;
    throw problem;
  }
  return response;
}

function formData(photo, metadata) {
  const body = new FormData();
  body.append('file', photo, 'catch-photo.jpg');
  if (metadata) body.append('metadata', JSON.stringify(metadata));
  return body;
}

const DRAFT_DATABASE = 'reef-catch-monitor-drafts';
function draftDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('Draft storage is unavailable.'));
    const request = window.indexedDB.open(DRAFT_DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function draftOperation(mode, userId, value) {
  const database = await draftDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('drafts', mode);
    const store = transaction.objectStore('drafts');
    const operation = value === undefined ? store.get(String(userId)) : value === null ? store.delete(String(userId)) : store.put(value, String(userId));
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error);
    transaction.oncomplete = () => database.close();
  });
}
const loadCatchDraft = userId => draftOperation('readonly', userId);
const saveCatchDraft = (userId, draft) => draftOperation('readwrite', userId, draft);
const clearCatchDraft = userId => draftOperation('readwrite', userId, null);

function previewLength(fish, size) {
  if (!size || fish.ruler.length !== 2 || fish.fish.length !== 2 || !(Number(fish.rulerCm) > 0) || !fish.coplanar) return null;
  const distance = ([[x1, y1], [x2, y2]]) => Math.hypot((x2 - x1) * size.width, (y2 - y1) * size.height);
  const rulerPx = distance(fish.ruler);
  const fishPx = distance(fish.fish);
  return Math.min(rulerPx, fishPx) < 10 ? null : (fishPx / rulerPx * Number(fish.rulerCm)).toFixed(2);
}

function PhotoCanvas({ url, fish, size, estimate, activeTool, onMark, onMoveMark, onSize }) {
  const image = useRef(null);
  const viewport = useRef(null);
  const [zoom, setZoom] = useState(1);

  function changeZoom(value) {
    const target = viewport.current;
    const canvas = image.current;
    const imageBox = canvas.getBoundingClientRect();
    const frame = target.getBoundingClientRect();
    const center = [
      (frame.left + frame.width / 2 - imageBox.left) / imageBox.width,
      (frame.top + frame.height / 2 - imageBox.top) / imageBox.height,
    ];
    setZoom(value);
    requestAnimationFrame(() => {
      if (!canvas.isConnected) return;
      const box = canvas.getBoundingClientRect();
      target.scrollLeft += box.left + box.width * center[0] - frame.left - frame.width / 2;
      target.scrollTop += box.top + box.height * center[1] - frame.top - frame.height / 2;
    });
  }
  function click(event) {
    const rect = image.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    onMark([(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height]);
  }
  function pointFromPointer(event) {
    const rect = image.current.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    ];
  }
  function startDrag(event, kind, index) {
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onMoveMark(kind, index, pointFromPointer(event), 'start');
  }
  function keyDown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onMark([Number(event.currentTarget.dataset.x) / 100, Number(event.currentTarget.dataset.y) / 100]);
  }
  const [cursor, setCursor] = useState([50, 50]);
  function navigate(event) {
    const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!steps[event.key]) return keyDown(event);
    event.preventDefault();
    const multiplier = event.shiftKey ? 5 : 1;
    setCursor(([x, y]) => steps[event.key].map((step, index) => Math.min(100, Math.max(0, [x, y][index] + step * multiplier))));
  }
  const [corner, opposite] = fish.crop;
  function segmentGeometry(points) {
    if (points.length !== 2) return null;
    const [[x1, y1], [x2, y2]] = points;
    const imageWidth = size?.width || 1; const imageHeight = size?.height || 1;
    const rawAngle = Math.atan2((y2 - y1) * imageHeight, (x2 - x1) * imageWidth) * 180 / Math.PI;
    const angle = rawAngle > 90 ? rawAngle - 180 : rawAngle < -90 ? rawAngle + 180 : rawAngle;
    return {
      x: (x1 + x2) / 2, y: (y1 + y2) / 2, angle,
      width: Math.hypot(x2 - x1, (y2 - y1) * imageHeight / imageWidth) * 100,
    };
  }
  const rulerGeometry = segmentGeometry(fish.ruler);
  const fishGeometry = segmentGeometry(fish.fish);
  const rulerCm = Number(fish.rulerCm) > 0 ? Number(fish.rulerCm) : null;
  const divisions = rulerCm && Number.isInteger(rulerCm) && rulerCm <= 30 ? rulerCm : 10;
  const ticks = Array.from({ length: divisions + 1 }, (_, index) => ({
    index,
    major: index === 0 || index === divisions || index % (divisions <= 10 ? 2 : 5) === 0,
    label: rulerCm && (index === 0 || index === divisions || index % (divisions <= 10 ? 2 : 5) === 0)
      ? (rulerCm * index / divisions).toLocaleString(undefined, { maximumFractionDigits: 1 }) : null,
  }));
  const fishLengthText = estimate !== null ? `≈ ${estimate} cm`
    : fish.fish.length === 2 && !rulerCm ? 'Enter ruler cm'
      : fish.fish.length === 2 && !fish.coplanar ? 'Confirm same plane' : '';
  const fitWidth = size ? Math.min(size.width, 510 * size.width / size.height) : null;
  return <div className="image-viewer">
    <div className="viewer-bar">
      <span><Icon name="target" size={15} /> Annotation canvas</span>
      <div className="zoom-controls" role="group" aria-label="Photo zoom">
        <button type="button" aria-label="Zoom out" disabled={zoom === 1} onClick={() => changeZoom(zoom - 0.5)}>−</button>
        <button type="button" aria-label="Fit image" onClick={() => changeZoom(1)}>{Math.round(zoom * 100)}%</button>
        <button type="button" aria-label="Zoom in" disabled={zoom === 3} onClick={() => changeZoom(zoom + 0.5)}>+</button>
      </div>
    </div>
    <div className="photo-viewport" ref={viewport}>
      <div className="photo-stage" style={{ '--zoom': zoom, '--fit-width': fitWidth ? `${fitWidth}px` : '100vw' }}>
        <div className="photo-canvas" role="button" tabIndex={0} onClick={click} onKeyDown={navigate}
            data-x={cursor[0]} data-y={cursor[1]} aria-label="Photo annotation. Use arrow keys to move and Enter to place a mark.">
            <img ref={image} src={url} alt="Catch photo ready for annotation" draggable="false"
              onLoad={({ currentTarget: element }) => onSize({ width: element.naturalWidth, height: element.naturalHeight })} />
            <svg className="marks" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {opposite && <rect className="mark-crop" x={Math.min(corner[0], opposite[0]) * 100} y={Math.min(corner[1], opposite[1]) * 100}
                width={Math.abs(corner[0] - opposite[0]) * 100} height={Math.abs(corner[1] - opposite[1]) * 100} />}
              {['fish'].map(kind => fish[kind].length === 2 && <line key={kind} className={`mark-${kind}`}
                x1={fish[kind][0][0] * 100} y1={fish[kind][0][1] * 100} x2={fish[kind][1][0] * 100} y2={fish[kind][1][1] * 100} />)}
            </svg>
            {rulerGeometry && <div className="visual-ruler" aria-hidden="true" style={{
              left: `${rulerGeometry.x * 100}%`, top: `${rulerGeometry.y * 100}%`, width: `${rulerGeometry.width}%`, '--measure-angle': `${rulerGeometry.angle}deg`,
            }}>
              {ticks.map(tick => <span key={tick.index} className={tick.major ? 'major' : ''} style={{ left: `${tick.index / divisions * 100}%` }}>
                <i />{tick.label !== null && <small>{tick.label}</small>}
              </span>)}
              <strong>{rulerCm ? `${rulerCm.toLocaleString(undefined, { maximumFractionDigits: 2 })} cm reference` : 'Enter ruler cm'}</strong>
            </div>}
            {fishGeometry && fishLengthText && <span className={`fish-length-label ${estimate !== null ? 'ready' : ''}`} style={{
              left: `${fishGeometry.x * 100}%`, top: `${fishGeometry.y * 100}%`, '--measure-angle': `${fishGeometry.angle}deg`,
            }}>{fishLengthText}</span>}
            {Object.entries(tasks).flatMap(([kind]) => fish[kind].map(([x, y], index) =>
              <button type="button" key={`${kind}-${index}`} aria-label={`Move ${toolLabels[kind]} point ${index + 1}`}
                className={`dot dot-${kind} ${activeTool === kind ? 'active' : ''}`} style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
                onClick={event => event.stopPropagation()} onPointerDown={event => startDrag(event, kind, index)}
                onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) onMoveMark(kind, index, pointFromPointer(event), 'move'); }}
                onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) { onMoveMark(kind, index, pointFromPointer(event), 'end'); event.currentTarget.releasePointerCapture(event.pointerId); } }}>
                {index + 1}
              </button>))}
            <span className="key-cursor" style={{ left: `${cursor[0]}%`, top: `${cursor[1]}%` }} aria-hidden="true">+</span>
        </div>
      </div>
    </div>
  </div>;
}

function Workspace({ model, onSaved, userId }) {
  const [photo, setPhoto] = useState(null);
  const [url, setUrl] = useState('');
  const [size, setSize] = useState(null);
  const [filename, setFilename] = useState('');
  const [isPractice, setIsPractice] = useState(false);
  const [specimens, setSpecimens] = useState([blankFish()]);
  const [selected, setSelected] = useState(0);
  const [tool, setTool] = useState('ruler');
  const [details, setDetails] = useState(blankDetails);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [prediction, setPrediction] = useState(null);
  const [quality, setQuality] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [draftMessage, setDraftMessage] = useState('');
  const fish = specimens[selected];
  const input = useRef(null);
  const errorBox = useRef(null);
  const photoHeading = useRef(null);
  const specimensHeading = useRef(null);
  const estimate = previewLength(fish, size);
  const visiblePrediction = prediction?.crop === fish.crop ? prediction.result : null;
  const speciesOptions = [...new Set([...(model?.labels ?? []), ...(model?.observed_labels ?? [])])].sort((left, right) => left.localeCompare(right));

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => { if (error) errorBox.current?.focus(); }, [error]);
  useEffect(() => {
    let cancelled = false;
    loadCatchDraft(userId).then(draft => {
      if (cancelled || !draft?.photo) return;
      if (!window.confirm('Restore your unsaved catch analysis?')) { clearCatchDraft(userId).catch(() => {}); return; }
      setPhoto(draft.photo); setUrl(URL.createObjectURL(draft.photo)); setFilename(draft.filename || 'Restored catch photo');
      setSpecimens(draft.specimens?.length ? draft.specimens : [blankFish()]); setSelected(0); setTool('ruler');
      setDetails({ ...blankDetails(), ...draft.details }); setQuality(draft.quality || null); setDraftMessage('Unsaved catch restored from this browser.');
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [userId]);
  useEffect(() => {
    if (!photo || isPractice) return undefined;
    const timer = setTimeout(() => {
      saveCatchDraft(userId, { photo, filename, specimens, details, quality, saved_at: new Date().toISOString() }).catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [photo, filename, specimens, details, quality, isPractice, userId]);
  useEffect(() => {
    if (!photo || isPractice) return undefined;
    function warnBeforeLeaving(event) { event.preventDefault(); event.returnValue = ''; }
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [photo, isPractice]);

  async function loadPhoto(file, practice = false) {
    if (working || (!practice && !file)) return;
    const hasAnnotations = specimens.some(item => hasLengthInput(item) || item.crop.length || item.species.trim() || item.measuredCm || item.weightG);
    if (photo && !isPractice && hasAnnotations && !window.confirm('Replace this photo and clear its specimen entries?')) {
      if (input.current) input.current.value = '';
      return;
    }
    setWorking('Preparing photo…');
    setError('');
    try {
      if (file?.size > 12 * 1024 * 1024) throw new Error('Photos must be 12 MB or smaller.');
      let qualityResult = null;
      let prepared;
      if (practice) {
        prepared = await (await request('/practice.jpg')).blob();
      } else {
        const response = await request('/api/photos/prepare', { method: 'POST', body: formData(file) });
        prepared = await response.blob();
        qualityResult = await request('/api/photos/quality', { method: 'POST', body: formData(prepared) })
          .then(item => item.json()).catch(() => null);
      }
      setPhoto(prepared);
      setUrl(URL.createObjectURL(prepared));
      setIsPractice(practice);
      setFilename(practice ? 'Practice illustration' : file.name);
      setSize(null);
      setSpecimens([blankFish()]);
      setSelected(0);
      setTool('ruler');
      setPrediction(null);
      setQuality(qualityResult);
    } catch (problem) {
      setError(problem.message);
    } finally {
      setWorking('');
      if (input.current) input.current.value = '';
    }
  }

  function updateFish(update) {
    setSpecimens(current => current.map((item, index) => index === selected ? { ...item, ...update } : item));
  }

  function moveMark(kind, index, point, phase) {
    if (working) return;
    if (phase === 'start') {
      setTool(kind);
      if (kind === 'crop') setPrediction(null);
      setSpecimens(current => current.map((item, itemIndex) => itemIndex === selected
        ? { ...item, history: [...item.history, { tool: kind, points: item[kind].map(value => [...value]) }] } : item));
      return;
    }
    setSpecimens(current => current.map((item, itemIndex) => {
      if (itemIndex !== selected) return item;
      const points = item[kind].map((value, pointIndex) => pointIndex === index ? point : value);
      return { ...item, [kind]: points };
    }));
  }

  function addMark([x, y]) {
    if (working || fish[tool].length === 2) return;
    const point = [x, y].map(value => Math.min(1, Math.max(0, value)));
    const existing = fish[tool];
    const next = [...existing, point];
    updateFish({ [tool]: next, history: [...fish.history, { tool, points: existing }] });
    if (tool === 'ruler' && next.length === 2 && fish.fish.length !== 2) setTool('fish');
    if (tool === 'fish' && next.length === 2 && fish.crop.length !== 2) setTool('crop');
  }

  function createCropFromFish() {
    if (fish.fish.length !== 2) return;
    const xs = fish.fish.map(point => point[0]); const ys = fish.fish.map(point => point[1]);
    const crop = [
      [Math.max(0, Math.min(...xs) - 0.06), Math.max(0, Math.min(...ys) - 0.18)],
      [Math.min(1, Math.max(...xs) + 0.06), Math.min(1, Math.max(...ys) + 0.18)],
    ];
    updateFish({ crop, history: [...fish.history, { tool: 'crop', points: fish.crop }] });
    setPrediction(null); setTool('crop');
  }

  function undoMark() {
    const previous = fish.history.at(-1);
    if (!previous) return;
    updateFish({ [previous.tool]: previous.points, history: fish.history.slice(0, -1) });
    setTool(previous.tool);
  }

  function resetMarks() {
    updateFish({ [tool]: [], history: [...fish.history, { tool, points: fish[tool] }] });
  }

  function clearLength() {
    updateFish({ ruler: [], fish: [], rulerCm: '', coplanar: false, history: fish.history.filter(item => item.tool === 'crop') });
    setTool('ruler');
  }

  function selectSpecimen(index) {
    setSelected(index);
    setTool(specimens[index].ruler.length === 2 ? 'fish' : 'ruler');
  }

  async function suggestSpecies() {
    setWorking('Checking species…');
    setError('');
    try {
      const response = await request('/api/species/suggest', {
        method: 'POST', body: formData(photo, { crop: fish.crop }),
      });
      setPrediction({ crop: fish.crop, result: await response.json() });
    } catch (problem) {
      setError(problem.message);
    } finally {
      setWorking('');
    }
  }

  async function save(event) {
    event.preventDefault();
    if (!photo || isPractice || working) return;
    setWorking('Saving catch…');
    setError('');
    try {
      const prepared = specimens.map((item, index) => {
        const hasMarks = hasLengthInput(item);
        if (hasMarks && previewLength(item, size) === null) {
          selectSpecimen(index);
          throw new Error(`Fish ${index + 1}: finish calibration and confirm the photo setup, or clear its measurement.`);
        }
        if (item.crop.length === 1) {
          setSelected(index);
          setTool('crop');
          throw new Error(`Fish ${index + 1}: finish or clear its species crop.`);
        }
        return {
          species: item.species.trim() || 'Unknown',
          measured_cm: item.measuredCm === '' ? null : Number(item.measuredCm),
          weight_g: item.weightG === '' ? null : Number(item.weightG),
          crop: item.crop.length ? item.crop : null,
          calibration: hasMarks ? { ruler: item.ruler, fish: item.fish, ruler_cm: Number(item.rulerCm), coplanar: item.coplanar } : null,
        };
      });
      const response = await request('/api/catches', {
        method: 'POST', body: formData(photo, { ...details, habitat: details.habitat || null, specimens: prepared }),
      });
      const savedRecord = await response.json();
      await clearCatchDraft(userId).catch(() => {});
      onSaved(savedRecord);
    } catch (problem) {
      setError(problem.message);
    } finally {
      setWorking('');
    }
  }

  const activeMarks = fish[tool].length;
  const pixelDistance = kind => size && fish[kind].length === 2
    ? Math.round(Math.hypot((fish[kind][1][0] - fish[kind][0][0]) * size.width, (fish[kind][1][1] - fish[kind][0][1]) * size.height)) : null;
  let estimateHint = 'Calculated from your photo marks.';
  if (estimate === null) {
    if (fish.ruler.length < 2 || fish.fish.length < 2) estimateHint = 'Place two ruler marks and two fish marks.';
    else if (!Number(fish.rulerCm)) estimateHint = 'Enter the distance between the ruler marks.';
    else if (!fish.coplanar) estimateHint = 'Confirm the overhead photo setup.';
    else estimateHint = 'Place each pair of marks farther apart.';
  }
  const dockHint = isPractice ? 'Upload your own photo to save.' : !photo ? 'Add a catch photo to begin.'
    : `${specimens.length} fish in this catch`;

  return <>
    {draftMessage && <div className="success" role="status"><Icon name="check" size={18} /><span>{draftMessage}</span><button type="button" className="text-button" onClick={() => setDraftMessage('')}>Dismiss</button></div>}
    <Workflow photo={photo} estimate={estimate} species={fish.species} />
    <form className="work-grid" onSubmit={save}>
      {error && <div ref={errorBox} tabIndex={-1} role="alert" className="alert"><Icon name="info" size={18} />{error}</div>}
      <section className="panel photo-panel" aria-labelledby="photo-title" aria-busy={working === 'Preparing photo…'}>
        <div className="panel-heading">
          <div className="heading-icon"><Icon name="image" /></div>
          <div className="heading-copy"><h2 id="photo-title" ref={photoHeading} tabIndex={-1}>Catch photo</h2><p>{url ? filename : 'Add one image for each catch.'}</p></div>
          {url && <button className="button small secondary replace" type="button" disabled={!!working} onClick={() => input.current.click()}>Replace photo</button>}
        </div>
        <input hidden ref={input} type="file" aria-label="Catch image file" accept="image/jpeg,image/png,image/webp"
          onChange={event => loadPhoto(event.target.files[0])} />
        {url ? <>
          {isPractice && <div className="notice"><Icon name="info" size={17} /><p><strong>Practice image</strong> · Each numbered ruler interval is 5 cm. Upload your own photo to save a record.</p></div>}
          {quality && <div className={`quality-report ${quality.acceptable ? 'quality-good' : ''}`}>
            <strong>{quality.acceptable ? 'Photo accepted · Capture checks passed' : `Photo accepted · ${quality.warnings.length} capture advisor${quality.warnings.length === 1 ? 'y' : 'ies'}`}</strong>
            <span>{quality.width} × {quality.height}px · brightness {quality.brightness} · contrast {quality.contrast} · sharpness {quality.sharpness}</span>
            {quality.warnings.map(item => <p key={item}>{item}</p>)}
          </div>}
          <div className="annotation-toolbar">
            <div className="annotation-intro"><strong>Mark fish {selected + 1}</strong><span>Tap two points for each step. Drag any numbered handle to correct it.</span></div>
            <div className="tool-list annotation-steps" role="group" aria-label="Annotation tool">
              {Object.keys(tasks).map((kind, index) => <button key={kind} type="button" aria-pressed={tool === kind}
                className={`tool tool-${kind} ${fish[kind].length === 2 ? 'complete' : ''}`} onClick={() => setTool(kind)}>
                <span className="tool-step">{fish[kind].length === 2 ? <Icon name="check" size={14} /> : index + 1}</span>
                <span className="tool-copy"><strong>{toolLabels[kind]}</strong><small>{kind === 'ruler' ? 'Known scale' : kind === 'fish' ? 'Snout to tail' : 'Whole-fish box'}</small></span>
              </button>)}
            </div>
            <p className="mark-guide" aria-live="polite">
              <span className={`mark-key key-${tool}`}>{activeMarks === 2 ? <Icon name="check" size={14} /> : activeMarks + 1}</span>
              {activeMarks === 2 ? `${toolLabels[tool]} complete${tool !== 'crop' && pixelDistance(tool) ? ` · ${pixelDistance(tool)} px` : ''}. Drag a handle to fine-tune.` : tasks[tool][activeMarks]}
            </p>
            {fish.fish.length === 2 && fish.crop.length !== 2 && <button type="button" className="button small crop-helper" onClick={createCropFromFish}><Icon name="crop" size={16} /> Create crop around fish</button>}
          </div>
          <PhotoCanvas key={url} url={url} fish={fish} size={size} estimate={estimate} activeTool={tool} onMark={addMark} onMoveMark={moveMark} onSize={setSize} />
          <div className="canvas-actions">
            <button type="button" className="button small secondary" disabled={!fish.history.length || !!working} onClick={undoMark}><Icon name="undo" size={16} /> Undo last change</button>
            <button type="button" className="text-button" disabled={!activeMarks || !!working} onClick={resetMarks}>Reset {toolLabels[tool].toLowerCase()} marks</button>
            {fish.ruler.length === 2 && fish.fish.length === 2 && <button type="button" className="text-button review-jump"
              onClick={() => specimensHeading.current?.focus()}>{estimate === null ? 'Enter scale and review' : 'Review specimen'} <Icon name="arrow" size={15} /></button>}
          </div>
        </> : <>
          <div className={`drop-zone ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }}
            onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
            onDrop={event => { event.preventDefault(); setDragging(false); loadPhoto(event.dataTransfer.files[0]); }}>
            <div className="drop-icon"><Icon name="upload" size={25} /></div>
            <h3>{working || 'Drop a catch photo here'}</h3>
            <p>JPEG, PNG or WebP · up to 12 MB</p>
            <button type="button" className="button primary" disabled={!!working} onClick={() => input.current.click()}>Choose photo <Icon name="arrow" size={17} /></button>
          </div>
          <div className="practice-line"><span>Want to try the tools first?</span><button type="button" className="text-button" disabled={!!working} onClick={() => loadPhoto(null, true)}>Use practice image <Icon name="arrow" size={15} /></button></div>
        </>}
        <details className="capture-tip" open={!url}>
          <summary><Icon name="info" size={18} /> Photo setup tips <Icon name="chevron" size={16} /></summary>
          <p>Photograph the fish from directly above. Keep the snout and tail visible and lay a ruler beside the fish in the same plane.</p>
        </details>
      </section>

      <div className="side-stack">
        <section className="panel" aria-labelledby="fish-title">
          <div className="panel-heading"><div className="heading-icon"><Icon name="fish" /></div>
            <div className="heading-copy"><h2 id="fish-title" ref={specimensHeading} tabIndex={-1}>Specimens</h2><p>Review one fish at a time.</p></div>
            {photo && <button type="button" className="button small secondary replace" disabled={specimens.length === 30 || !!working}
              onClick={() => {
                setSpecimens([...specimens, blankFish()]);
                setSelected(specimens.length);
                setTool('ruler');
                photoHeading.current?.focus();
              }}><Icon name="plus" size={16} /> Add fish</button>}
          </div>
          {photo ? <>
            <div className="pills specimen-tabs" role="group" aria-label="Select a fish">
              {specimens.map((_, index) => <button key={index} type="button" className="pill"
                aria-pressed={selected === index} onClick={() => selectSpecimen(index)}>Fish {index + 1}</button>)}
            </div>
            <div className="fields">
              <div className="estimate" aria-live="polite">
                <span><strong>Estimated total length</strong><small>{estimateHint}</small></span>
                <strong>{estimate === null ? '—' : <>{estimate} <small>cm</small></>}</strong>
              </div>
              <div className="field-row">
                <label>Ruler span (cm) <input type="number" min="0.01" max="1000" step="any" inputMode="decimal" placeholder="e.g. 10" value={fish.rulerCm} onChange={event => updateFish({ rulerCm: event.target.value })} /></label>
                <label>Measured length (cm) <span>optional</span><input type="number" min="0.01" max="1000" step="any" inputMode="decimal" placeholder="Physical length" value={fish.measuredCm} onChange={event => updateFish({ measuredCm: event.target.value })} /></label>
              </div>
              <div className="ruler-presets"><span>Quick ruler span</span>{[5, 10, 20, 30].map(value => <button key={value} type="button" aria-pressed={Number(fish.rulerCm) === value} onClick={() => updateFish({ rulerCm: String(value) })}>{value} cm</button>)}</div>
              <label className="checkbox"><input type="checkbox" checked={fish.coplanar} onChange={event => updateFish({ coplanar: event.target.checked })} /> Photo is overhead, with ruler and fish in the same plane.</label>
              <div className="measurement-checklist" aria-label="Measurement readiness">
                <span className={fish.ruler.length === 2 ? 'done' : ''}><Icon name={fish.ruler.length === 2 ? 'check' : 'ruler'} size={14} /> Scale endpoints</span>
                <span className={fish.fish.length === 2 ? 'done' : ''}><Icon name={fish.fish.length === 2 ? 'check' : 'fish'} size={14} /> Fish endpoints</span>
                <span className={Number(fish.rulerCm) > 0 ? 'done' : ''}><Icon name={Number(fish.rulerCm) > 0 ? 'check' : 'info'} size={14} /> Scale value</span>
                <span className={fish.coplanar ? 'done' : ''}><Icon name={fish.coplanar ? 'check' : 'info'} size={14} /> Perspective check</span>
              </div>
              {hasLengthInput(fish) && <button type="button" className="text-button subdued" disabled={!!working} onClick={clearLength}>Clear length calibration</button>}
              <div className="field-divider" />
              <label>Reviewed species <input maxLength={120} list="species-labels" placeholder="Enter species or leave as Unknown" value={fish.species}
                onChange={event => updateFish({ species: event.target.value })} /></label>
              <datalist id="species-labels">{speciesOptions.map(label => <option key={label} value={label} />)}</datalist>
              {model?.model_id && <button className="button secondary small" type="button" disabled={fish.crop.length !== 2 || !!working} onClick={suggestSpecies}>Suggest from marked crop</button>}
              {visiblePrediction && <div className="suggestion"><strong>{visiblePrediction.needs_review ? 'Unknown / Needs review' : 'Model suggestion'}</strong>
                <p>{visiblePrediction.needs_review ? 'Evidence is below the fitted threshold.' : visiblePrediction.species}</p>
                <ol className="candidate-list">{visiblePrediction.candidates?.map(item => <li key={item.species}><span>{item.species}</span><small>distance {item.distance}</small></li>)}</ol>
                {!visiblePrediction.needs_review && <button className="text-button" type="button" onClick={() => updateFish({ species: visiblePrediction.species })}>Adopt as reviewed label</button>}
                <small>Model {visiblePrediction.model_id} · prediction remains separate from review</small>
              </div>}
              <label>Measured weight (g) <span>optional</span><input type="number" min="0.01" max="30000000" step="any" inputMode="decimal"
                placeholder="e.g. 450" value={fish.weightG} onChange={event => updateFish({ weightG: event.target.value })} /></label>
              {specimens.length > 1 && <button className="text-button danger" type="button" disabled={!!working} onClick={() => {
                if ((fish.species.trim() || hasLengthInput(fish) || fish.crop.length || fish.measuredCm || fish.weightG) && !window.confirm(`Remove the entry for fish ${selected + 1}?`)) return;
                setSpecimens(specimens.filter((_, index) => index !== selected));
                setSelected(Math.max(0, selected - 1));
                setTool('ruler');
              }}>Remove fish {selected + 1}</button>}
            </div>
          </> : <div className="specimen-empty">
            <Icon name="ruler" size={22} /><div><strong>Start with a photo</strong><p>Mark the ruler, then mark the snout and tail. Add the species when you have a reviewed label.</p></div>
          </div>}
        </section>
        <section className="panel" aria-labelledby="details-title">
          <div className="panel-heading"><div className="heading-icon"><Icon name="records" /></div>
            <div className="heading-copy"><h2 id="details-title">Collection details</h2><p>Record where and when the catch was photographed.</p></div></div>
          <div className="fields">
            <label>Site name or code <input required maxLength={120} placeholder="e.g. SITE-01" value={details.site} onChange={event => setDetails({ ...details, site: event.target.value })} /></label>
            <div className="field-row">
              <label>Collection date <input type="date" required max={today()} value={details.collected_on} onChange={event => setDetails({ ...details, collected_on: event.target.value })} /></label>
              <label>Photo context <select value={details.context} onChange={event => setDetails({ ...details, context: event.target.value })}>{contextOptions.map(value => <option key={value}>{value}</option>)}</select></label>
            </div>
            <div className="field-row">
              <label>Habitat <span>optional</span><select value={details.habitat} onChange={event => setDetails({ ...details, habitat: event.target.value })}>
                <option value="">Unspecified</option>{habitatOptions.map(value => <option key={value}>{value}</option>)}
              </select></label>
              <label>Water body <span>optional</span><input maxLength={120} placeholder="e.g. lake or bay name" value={details.water_body}
                onChange={event => setDetails({ ...details, water_body: event.target.value })} /></label>
            </div>
            <label className="checkbox"><input type="checkbox" checked={details.demo} onChange={event => setDetails({ ...details, demo: event.target.checked })} /> Demonstration record (visibly excluded from research evidence).</label>
            <details className="optional-fields">
              <summary>Gear, sampling group, and notes <span>optional</span><Icon name="chevron" size={16} /></summary>
              <div className="fields">
                <label>Fishing gear <input maxLength={120} placeholder="e.g. handline" value={details.gear}
                  onChange={event => setDetails({ ...details, gear: event.target.value })} /></label>
                <label>Collection group <input maxLength={120} placeholder="e.g. trip or sampling batch ID" value={details.group} onChange={event => setDetails({ ...details, group: event.target.value })} /></label>
                <label>Notes <textarea rows="2" maxLength={1000} placeholder="e.g. sampling or photo conditions" value={details.notes} onChange={event => setDetails({ ...details, notes: event.target.value })} /></label>
              </div>
            </details>
          </div>
        </section>
      </div>

      <div className="save-dock">
        <div><strong>{isPractice ? 'Practice session' : 'Catch draft'}</strong><p role="status">{working || dockHint}</p></div>
        <button className="button primary save-button" type="submit" disabled={!photo || isPractice || !!working}><Icon name="check" size={18} /> Save catch record</button>
      </div>
    </form>
  </>;
}

function formatDate(value) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`));
}

function formatWeight(grams) {
  const kilograms = grams >= 1000;
  const value = kilograms ? grams / 1000 : grams;
  return value.toLocaleString(undefined, { maximumFractionDigits: kilograms ? 3 : 2 }) + (kilograms ? ' kg' : ' g');
}

function isReviewedFish(fish) {
  const species = fish.species?.trim() || '';
  return Boolean(species && !/unknown|needs review/i.test(species));
}

function ReviewEditor({ recordId, ordinal, fish, onReviewed }) {
  const [open, setOpen] = useState(false);
  const [species, setSpecies] = useState(fish.species === 'Unknown' ? '' : fish.species);
  const [length, setLength] = useState(fish.measured_cm ?? '');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    setWorking(true); setError('');
    try {
      const response = await request(`/api/catches/${recordId}/fish/${ordinal}/review`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ species: species.trim(), reviewed_length_cm: length === '' ? null : Number(length) }),
      });
      onReviewed(await response.json()); setOpen(false);
    } catch (problem) { setError(problem.message); } finally { setWorking(false); }
  }
  if (!open) return <button className="text-button" type="button" onClick={() => setOpen(true)}>Review or correct</button>;
  return <form className="review-form" onSubmit={submit}>
    <label>Reviewed species<input required maxLength={120} value={species} onChange={event => setSpecies(event.target.value)} placeholder="Species or Unknown / Needs review" /></label>
    <label>Physical length (cm) <span>optional</span><input type="number" min="0.01" max="1000" step="any" value={length} onChange={event => setLength(event.target.value)} /></label>
    {error && <p className="alert">{error}</p>}
    <div><button className="button primary small" disabled={working}>Save review</button> <button className="text-button" type="button" onClick={() => setOpen(false)}>Cancel</button></div>
  </form>;
}

function savedAnnotation(fish) {
  return {
    species: fish.species || '', ruler: fish.calibration?.ruler || [], fish: fish.calibration?.fish || [],
    crop: fish.crop || [], rulerCm: fish.calibration?.ruler_cm ? String(fish.calibration.ruler_cm) : '',
    coplanar: Boolean(fish.calibration?.coplanar), measuredCm: fish.measured_cm ?? '', weightG: fish.weight_g ?? '', history: [],
  };
}

function AnnotationEditor({ recordId, ordinal, fish, onUpdated }) {
  const [open, setOpen] = useState(false);
  const [annotation, setAnnotation] = useState(() => savedAnnotation(fish));
  const [tool, setTool] = useState('ruler');
  const [size, setSize] = useState(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const estimate = previewLength(annotation, size);

  function begin() { setAnnotation(savedAnnotation(fish)); setTool('ruler'); setError(''); setOpen(true); }
  function mark(point) {
    if (annotation[tool].length === 2) return;
    const next = [...annotation[tool], point];
    setAnnotation(value => ({ ...value, [tool]: next }));
    if (next.length === 2 && tool === 'ruler' && annotation.fish.length !== 2) setTool('fish');
    if (next.length === 2 && tool === 'fish' && annotation.crop.length !== 2) setTool('crop');
  }
  function move(kind, index, point) {
    setAnnotation(value => ({ ...value, [kind]: value[kind].map((current, pointIndex) => pointIndex === index ? point : current) }));
  }
  async function save(event) {
    event.preventDefault(); setError('');
    const hasCalibration = hasLengthInput(annotation);
    if (hasCalibration && estimate === null) { setError('Complete both ruler and fish endpoints, enter the ruler span, and confirm the same-plane setup—or clear the calibration.'); return; }
    if (annotation.crop.length === 1) { setError('Complete the crop rectangle or clear it.'); return; }
    setWorking(true);
    try {
      const response = await request(`/api/catches/${recordId}/fish/${ordinal}/annotation`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          calibration: hasCalibration ? { ruler: annotation.ruler, fish: annotation.fish, ruler_cm: Number(annotation.rulerCm), coplanar: annotation.coplanar } : null,
          crop: annotation.crop.length === 2 ? annotation.crop : null,
        }),
      });
      onUpdated(await response.json()); setOpen(false);
    } catch (problem) { setError(problem.message); } finally { setWorking(false); }
  }

  if (!open) return <button className="text-button" type="button" onClick={begin}>Correct photo markers</button>;
  return <form className="saved-annotation" onSubmit={save}>
    <div className="record-edit-heading"><strong>Correct photo markers</strong><button className="text-button" type="button" disabled={working} onClick={() => setOpen(false)}>Cancel</button></div>
    <p>Choose a tool, place two points, then drag the numbered handles for precision.</p>
    {error && <p className="alert" role="alert">{error}</p>}
    <div className="saved-annotation-tools" role="group" aria-label="Saved annotation tool">{Object.keys(tasks).map(kind => <button className={`tool ${annotation[kind].length === 2 ? 'complete' : ''}`} aria-pressed={tool === kind} key={kind} type="button" onClick={() => setTool(kind)}><Icon name={toolIcons[kind]} size={16} />{toolLabels[kind]}</button>)}</div>
    <PhotoCanvas url={`/api/catches/${recordId}/photo`} fish={annotation} size={size} estimate={estimate} activeTool={tool} onMark={mark} onMoveMark={move} onSize={setSize} />
    <div className="field-row"><label>Ruler span (cm)<input type="number" min="0.01" max="1000" step="any" value={annotation.rulerCm} onChange={event => setAnnotation({ ...annotation, rulerCm: event.target.value })} /></label><label className="checkbox saved-plane"><input type="checkbox" checked={annotation.coplanar} onChange={event => setAnnotation({ ...annotation, coplanar: event.target.checked })} /> Ruler and fish are in the same plane</label></div>
    <div className="saved-annotation-actions"><div><button className="text-button" type="button" onClick={() => setAnnotation({ ...annotation, [tool]: [] })}>Clear {toolLabels[tool].toLowerCase()}</button>{hasLengthInput(annotation) && <button className="text-button subdued" type="button" onClick={() => setAnnotation({ ...annotation, ruler: [], fish: [], rulerCm: '', coplanar: false })}>Clear full calibration</button>}</div><span>{estimate === null ? 'No calibrated photo length' : `Updated estimate: ${estimate} cm`}</span><button className="button primary small" disabled={working}>{working ? 'Saving…' : 'Save marker corrections'}</button></div>
  </form>;
}

function SpecimenRecord({ recordId, ordinal, fish, onReviewed }) {
  const hasEstimate = fish.estimated_cm != null;
  const hasMeasured = fish.measured_cm != null;
  const difference = hasEstimate && hasMeasured ? fish.estimated_cm - fish.measured_cm : null;
  const differencePercent = difference !== null && fish.measured_cm > 0 ? Math.abs(difference) / fish.measured_cm * 100 : null;
  const mismatch = differencePercent !== null && differencePercent > 15;
  const needsReview = !isReviewedFish(fish);
  return <li className={`specimen-record ${needsReview ? 'needs-review' : ''}`}>
    <div className="specimen-record-head">
      <div><small>Fish {String(ordinal).padStart(2, '0')}</small><strong>{fish.species || 'Unknown / Needs review'}</strong></div>
      <span className={`review-status ${needsReview ? 'pending' : ''}`}><Icon name={needsReview ? 'info' : 'check'} size={13} />{needsReview ? 'Needs review' : 'Reviewed'}</span>
    </div>
    <dl className="specimen-measurements">
      <div><dt>Photo estimate</dt><dd>{hasEstimate ? `${fish.estimated_cm} cm` : '—'}</dd></div>
      <div><dt>Physical length</dt><dd>{hasMeasured ? `${fish.measured_cm} cm` : '—'}</dd></div>
      <div className={mismatch ? 'measurement-warning' : ''}><dt>Difference</dt><dd>{difference === null ? '—' : `${difference > 0 ? '+' : ''}${difference.toFixed(2)} cm`}</dd></div>
      <div><dt>Weight</dt><dd>{fish.weight_g != null ? formatWeight(fish.weight_g) : '—'}</dd></div>
    </dl>
    {difference !== null && <p className={`comparison-note ${mismatch ? 'warning' : ''}`}><Icon name={mismatch ? 'info' : 'check'} size={15} />
      {mismatch ? `Photo and physical lengths differ by ${differencePercent.toFixed(0)}%. Check the ruler span, endpoints, perspective, or physical entry.`
        : 'Photo and physical measurements are within 15%.'}</p>}
    {fish.model_suggestion && <p className="model-note"><Icon name="target" size={14} /> Model suggestion: {fish.model_suggestion.species} · {fish.model_suggestion.model_id}</p>}
    <div className="specimen-actions"><ReviewEditor recordId={recordId} ordinal={ordinal} fish={fish} onReviewed={onReviewed} /><AnnotationEditor recordId={recordId} ordinal={ordinal} fish={fish} onUpdated={onReviewed} /></div>
  </li>;
}

function RecordEditor({ record, onUpdated, onDeleted }) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState(() => ({
    site: record.site, collected_on: record.collected_on, context: record.context,
    habitat: record.habitat || '', water_body: record.water_body || '', gear: record.gear || '',
    group: record.group || '', notes: record.notes || '', demo: Boolean(record.demo),
  }));
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const photoInput = useRef(null);

  async function save(event) {
    event.preventDefault(); setWorking('Saving…'); setError('');
    try {
      const response = await request(`/api/catches/${record.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, habitat: values.habitat || null }),
      });
      onUpdated(await response.json()); setEditing(false);
    } catch (problem) { setError(problem.message); } finally { setWorking(''); }
  }

  async function remove() {
    if (!window.confirm(`Permanently delete the catch from ${record.site}? This removes its photo, specimens, measurements, and reviews.`)) return;
    setWorking('Deleting…'); setError('');
    try { await request(`/api/catches/${record.id}`, { method: 'DELETE' }); onDeleted(record.id); }
    catch (problem) { setError(problem.message); setWorking(''); }
  }

  async function replacePhoto(file) {
    if (!file) return;
    if (!window.confirm('Replace the saved photo? Existing ruler, fish, and crop markers—and any photo estimate or model suggestion—will be cleared. Reviewed species and physical measurements will remain.')) { photoInput.current.value = ''; return; }
    setWorking('Replacing photo…'); setError('');
    try {
      const response = await request(`/api/catches/${record.id}/photo`, { method: 'PUT', body: formData(file) });
      onUpdated(await response.json());
    } catch (problem) { setError(problem.message); } finally { setWorking(''); if (photoInput.current) photoInput.current.value = ''; }
  }

  if (!editing) return <div className="record-manage"><input ref={photoInput} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={event => replacePhoto(event.target.files[0])} /><button className="button secondary small" type="button" disabled={!!working} onClick={() => setEditing(true)}>Edit catch details</button><button className="button secondary small" type="button" disabled={!!working} onClick={() => photoInput.current?.click()}>Replace photo</button><button className="text-button danger" type="button" onClick={remove} disabled={!!working}>{working || 'Delete catch'}</button>{error && <p className="alert">{error}</p>}</div>;
  return <form className="record-edit-form fields" onSubmit={save}>
    <div className="record-edit-heading"><strong>Edit catch details</strong><button className="text-button" type="button" onClick={() => setEditing(false)} disabled={!!working}>Cancel</button></div>
    {error && <p className="alert" role="alert">{error}</p>}
    <div className="field-row"><label>Site<input required maxLength={120} value={values.site} onChange={event => setValues({ ...values, site: event.target.value })} /></label><label>Date<input required type="date" max={today()} value={values.collected_on} onChange={event => setValues({ ...values, collected_on: event.target.value })} /></label></div>
    <div className="field-row"><label>Photo context<select value={values.context} onChange={event => setValues({ ...values, context: event.target.value })}>{contextOptions.map(value => <option key={value}>{value}</option>)}</select></label><label>Habitat<select value={values.habitat} onChange={event => setValues({ ...values, habitat: event.target.value })}><option value="">Not recorded</option>{habitatOptions.map(value => <option key={value}>{value}</option>)}</select></label></div>
    <div className="field-row"><label>Water body<input maxLength={120} value={values.water_body} onChange={event => setValues({ ...values, water_body: event.target.value })} /></label><label>Fishing gear<input maxLength={120} value={values.gear} onChange={event => setValues({ ...values, gear: event.target.value })} /></label></div>
    <label>Collection group<input maxLength={120} value={values.group} onChange={event => setValues({ ...values, group: event.target.value })} /></label>
    <label>Notes<textarea rows="2" maxLength={1000} value={values.notes} onChange={event => setValues({ ...values, notes: event.target.value })} /></label>
    <label className="checkbox"><input type="checkbox" checked={values.demo} onChange={event => setValues({ ...values, demo: event.target.checked })} /> Demonstration record—exclude from research evidence.</label>
    <button className="button primary small" disabled={!!working}>{working || 'Save catch details'}</button>
  </form>;
}

function Records({ latest, onNewCatch }) {
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(latest?.id ?? null);
  const [query, setQuery] = useState('');
  const [context, setContext] = useState('');
  const [habitat, setHabitat] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(0);
  const [loadingPage, setLoadingPage] = useState(false);
  const pageSize = 20;
  const filters = new URLSearchParams();
  if (query.trim()) filters.set('q', query.trim());
  if (context) filters.set('context', context);
  if (habitat) filters.set('habitat', habitat);
  const filterKey = filters.toString();
  const suffix = filterKey ? '?' + filterKey : '';
  const queryKey = `${filterKey}|${sort}`;

  useEffect(() => { setPage(0); }, [queryKey]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setError(''); setLoadingPage(true);
      try {
        const params = new URLSearchParams(filters);
        params.set('sort', sort); params.set('limit', String(pageSize)); params.set('offset', String(page * pageSize));
        const response = await request('/api/catches?' + params, { signal: controller.signal });
        const nextRecords = await response.json();
        const total = Number(response.headers.get('X-Total-Count')) || 0;
        if (!controller.signal.aborted) setResults(current => ({
          key: queryKey, total,
          records: page > 0 && current?.key === queryKey ? [...current.records, ...nextRecords] : nextRecords,
        }));
      } catch (problem) {
        if (!controller.signal.aborted) setError(problem.message);
      } finally { if (!controller.signal.aborted) setLoadingPage(false); }
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [queryKey, page, attempt]);

  const records = results?.key === queryKey ? results.records : null;
  const totalRecords = records ? results.total : null;
  const specimens = records?.flatMap(record => record.specimens) ?? [];
  const weighed = specimens.filter(item => item.weight_g != null);
  const recordedWeight = weighed.reduce((total, item) => total + item.weight_g, 0);

  function replaceReviewed(updated) {
    setResults(current => ({ ...current, records: current.records.map(item => item.id === updated.id ? { ...item, ...updated } : item) }));
  }
  function deleteRecord(recordId) {
    setResults(current => ({ ...current, total: Math.max(0, current.total - 1), records: current.records.filter(item => item.id !== recordId) }));
    setExpanded(null);
  }
  function clearFilters() { setQuery(''); setContext(''); setHabitat(''); }

  return <>
    {latest && <div className="success" role="status"><Icon name="check" size={18} /><span>Catch saved at <strong>{latest.site}</strong> · {latest.specimens.length} {latest.specimens.length === 1 ? 'specimen' : 'specimens'}.</span></div>}
    {records && <dl className="record-metrics">
      <div><dt><Icon name="records" size={18} /> {filterKey ? 'Matching catches' : 'Saved catches'}</dt><dd>{totalRecords}</dd></div>
      <div><dt><Icon name="fish" size={18} /> Loaded specimens</dt><dd>{specimens.length}</dd></div>
      <div><dt><Icon name="check" size={18} /> Reviewed fish</dt><dd>{specimens.filter(isReviewedFish).length}</dd><small>{specimens.filter(item => !isReviewedFish(item)).length} need review</small></div>
      <div><dt><Icon name="weight" size={18} /> Recorded weight</dt>
        <dd className="weight-total">{weighed.length ? formatWeight(recordedWeight) : '—'}</dd>
        <small>{weighed.length} of {specimens.length} fish weighed</small>
      </div>
    </dl>}
    <section className="panel records-panel" aria-labelledby="records-title">
      <div className="panel-heading"><div className="heading-icon"><Icon name="records" /></div>
        <div className="heading-copy"><h2 id="records-title">Saved catches</h2><p>Search, compare measurements, and review specimen labels.</p></div>
        <div className="records-heading-actions"><button type="button" className="button primary small" onClick={onNewCatch}><Icon name="plus" size={16} /> New catch</button>
          <a className="button secondary small" href={'/api/export.csv' + suffix}><Icon name="download" size={16} /> {filterKey ? 'Export filtered' : 'Export CSV'}</a></div>
      </div>
      {error && <div className="alert" role="alert">
        <Icon name="info" size={18} /><span>{error}</span>
        <button className="text-button" type="button" onClick={() => { setError(''); setAttempt(attempt + 1); }}>Try again</button>
      </div>}
      {records?.length === 0 && !filterKey && <div className="records-empty">
        <span className="drop-icon"><Icon name="records" size={24} /></span>
        <h3>No catches recorded yet</h3><p>Upload a catch photo to create your first record.</p>
        <button type="button" className="button primary" onClick={onNewCatch}><Icon name="plus" size={17} /> Open photo workspace</button>
      </div>}
      {records && <>
        <div className="record-filters">
          <label className="search-field"><span className="sr-only">Search site, species, gear, water body, or group</span><Icon name="search" size={18} />
            <input type="search" maxLength={120} placeholder="Search site, species, gear, water body, or group" value={query} onChange={event => setQuery(event.target.value)} /></label>
          <label><span className="sr-only">Filter by photo context</span>
            <select value={context} onChange={event => setContext(event.target.value)}>
              <option value="">All photo contexts</option>{contextOptions.map(value => <option key={value}>{value}</option>)}
            </select></label>
          <label><span className="sr-only">Filter by habitat</span>
            <select value={habitat} onChange={event => setHabitat(event.target.value)}>
              <option value="">All habitats</option>{habitatOptions.map(value => <option key={value}>{value}</option>)}
            </select></label>
          <label><span className="sr-only">Sort catches</span><select value={sort} onChange={event => setSort(event.target.value)}>
            <option value="newest">Newest collection</option><option value="oldest">Oldest collection</option><option value="site">Site A–Z</option>
          </select></label>
        </div>
        <div className="results-toolbar"><p className="results-count" role="status">Showing <strong>{records.length}</strong> of {totalRecords} {filterKey ? 'matching ' : ''}{totalRecords === 1 ? 'catch' : 'catches'}</p>
          {filterKey && <div className="active-filters" aria-label="Active filters">{query.trim() && <span>Search: “{query.trim()}”</span>}{context && <span>{context}</span>}{habitat && <span>{habitat}</span>}
            <button type="button" onClick={clearFilters}>Clear all</button></div>}</div>
        {records?.length === 0 && filterKey && <div className="records-empty"><h3>No matching catches</h3>
          <button className="text-button" type="button" onClick={clearFilters}>Clear filters</button></div>}
      </>}
      {!records && !error && <p className="results-count" role="status">{results ? 'Updating results…' : 'Loading records…'}</p>}
      {records?.map(record => <article className="record" key={record.id}>
        <button className="record-toggle" type="button" aria-expanded={expanded === record.id} aria-controls={`catch-${record.id}`}
          onClick={() => setExpanded(expanded === record.id ? null : record.id)}>
          <span className="record-title"><strong>{record.site} {record.demo && <em className="demo-badge">DEMO</em>}</strong>
            <span className="record-tags"><small>{formatDate(record.collected_on)}</small><small>{record.context}</small>{record.habitat && <small>{record.habitat}</small>}{record.group && <small>Group {record.group}</small>}</span></span>
          <span className="record-count">{record.specimens.length} fish <Icon name="chevron" size={17} /></span>
        </button>
        <div id={`catch-${record.id}`} hidden={expanded !== record.id} className="record-detail">
          {expanded === record.id && <>
            <figure className="record-photo"><img src={`/api/catches/${record.id}/photo?v=${encodeURIComponent(record.photo_updated_at || record.created_at || '')}`} alt={`Catch photo from ${record.site}`} />
              <figcaption><span><Icon name="image" size={15} /> Original catch photograph</span><a className="text-button" href={`/api/catches/${record.id}/photo`} target="_blank" rel="noreferrer">Open full photo <Icon name="arrow" size={14} /></a></figcaption>
            </figure>
            <div className="record-review">
              <RecordEditor record={record} onUpdated={replaceReviewed} onDeleted={deleteRecord} />
              {(record.water_body || record.gear || record.group) && <dl className="record-facts">
                {record.water_body && <div><dt>Water body</dt><dd>{record.water_body}</dd></div>}
                {record.gear && <div><dt>Fishing gear</dt><dd>{record.gear}</dd></div>}
                {record.group && <div><dt>Collection group</dt><dd>{record.group}</dd></div>}
              </dl>}
              <ul>{record.specimens.map((item, index) => <SpecimenRecord key={index} recordId={record.id} ordinal={index + 1} fish={item} onReviewed={replaceReviewed} />)}</ul>
              {record.notes && <p className="record-notes"><strong>Field notes</strong><br />{record.notes}</p>}
            </div>
          </>}
        </div>
      </article>)}
      {records && records.length < totalRecords && <div className="load-more"><button className="button secondary" type="button" disabled={loadingPage} onClick={() => setPage(value => value + 1)}>{loadingPage ? 'Loading more…' : `Load more catches (${totalRecords - records.length} remaining)`}</button></div>}
    </section>
  </>;
}

const suggestedQuestions = [
  'How can catch data support conservation?',
  'How should I monitor reef fish over time?',
  'How should protected species be documented?',
  'How many fish have I recorded?',
];

function fishChatWelcome(user) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = user.name.trim().split(/\s+/)[0];
  return { role: 'assistant', text: `${greeting}, ${firstName}! I’m Reef. Ask me naturally about your catches, measurements, fieldwork, or conservation monitoring.` };
}

function FishChat({ user }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(() => [fishChatWelcome(user)]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [thinking, setThinking] = useState('');
  const [followUps, setFollowUps] = useState(suggestedQuestions.slice(0, 3));
  const [error, setError] = useState('');
  const input = useRef(null);
  const log = useRef(null);

  useEffect(() => {
    if (open) requestAnimationFrame(() => input.current?.focus());
  }, [open]);
  useEffect(() => {
    if (open && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages, sending, thinking, open]);
  useEffect(() => {
    function escape(event) { if (event.key === 'Escape') setOpen(false); }
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);

  async function ask(question) {
    const text = question.trim();
    if (!text || sending) return;
    const started = Date.now();
    const conversationHistory = messages.slice(-10).map(item => ({ role: item.role, content: item.text, intent: item.intent || null }));
    setMessages(items => [...items, { role: 'user', text }]);
    setDraft(''); setError(''); setSending(true); setThinking('Understanding your question…'); setFollowUps([]);
    try {
      const response = await request('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, history: conversationHistory }),
      });
      const payload = await response.json();
      setThinking(payload.activity || 'Reviewing the available evidence…');
      const remaining = Math.max(500, 1100 - (Date.now() - started));
      await new Promise(resolve => setTimeout(resolve, remaining));
      setMessages(items => [...items, { role: 'assistant', text: payload.answer, evidence: payload.evidence, intent: payload.intent }]);
      setFollowUps(payload.follow_ups || []);
    } catch (problem) { setError(problem.message); } finally { setSending(false); setThinking(''); }
  }

  return <div className={`fish-chat ${open ? 'is-open' : ''}`}>
    {open && <section className="fish-chat-window" role="dialog" aria-modal="false" aria-labelledby="fish-chat-title">
      <header className="fish-chat-header">
        <span className="fish-chat-avatar"><Icon name="fish" size={23} /></span>
        <div><strong id="fish-chat-title">Reef Assistant</strong><small><span /> Conversation + private catch records</small></div>
        <button type="button" onClick={() => { setMessages([fishChatWelcome(user)]); setFollowUps(suggestedQuestions.slice(0, 3)); setError(''); }} aria-label="Start a new chat" title="New chat"><Icon name="plus" size={19} /></button>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close chat"><Icon name="close" size={20} /></button>
      </header>
      <div className="fish-chat-log" ref={log} aria-live="polite">
        {messages.map((message, index) => <div key={index} className={`fish-chat-message ${message.role}`}>
          {message.role === 'assistant' && <span className="fish-chat-mini"><Icon name="fish" size={15} /></span>}
          <div><p>{message.text}</p>{message.evidence && <small>Based on {message.evidence.catch_records} saved catch record{message.evidence.catch_records === 1 ? '' : 's'} and {message.evidence.specimens} specimen{message.evidence.specimens === 1 ? '' : 's'}.</small>}</div>
        </div>)}
        {sending && <div className="fish-chat-message assistant thinking-message"><span className="fish-chat-mini"><Icon name="fish" size={15} /></span><div><p>{thinking}</p><span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span><span className="sr-only">Assistant is reviewing your request</span></div></div>}
      </div>
      {!sending && followUps.length > 0 && <div className="fish-chat-prompts">
        {followUps.map(question => <button key={question} type="button" onClick={() => ask(question)}>{question}</button>)}
      </div>}
      {error && <p className="fish-chat-error" role="alert">{error}</p>}
      <form className="fish-chat-composer" onSubmit={event => { event.preventDefault(); ask(draft); }}>
        <label><span className="sr-only">Message the Reef Catch assistant</span><textarea ref={input} rows="1" maxLength="500" value={draft}
          onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); ask(draft); } }}
          placeholder="Ask about conservation or catch records…" /></label>
        <button type="submit" disabled={sending || !draft.trim()} aria-label="Send message"><Icon name="arrow" size={19} /></button>
      </form>
      <p className="fish-chat-note">General guidance is not a substitute for current local regulations or species assessments.</p>
    </section>}
    <button className="fish-chat-launcher" type="button" aria-expanded={open} aria-label={open ? 'Close Reef Catch assistant' : 'Open Reef Catch assistant'} onClick={() => setOpen(value => !value)}>
      <Icon name={open ? 'close' : 'fish'} size={27} /><span>{open ? 'Close' : 'Ask Reef'}</span>
    </button>
  </div>;
}

function Assistant({ model }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Ask me about your saved catches or how to use and train Reef Catch Monitor.' },
  ]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  async function ask(question) {
    const text = question.trim();
    if (!text || sending) return;
    const conversationHistory = messages.slice(-10).map(item => ({ role: item.role, content: item.text, intent: item.intent || null }));
    setMessages(items => [...items, { role: 'user', text }]);
    setDraft('');
    setError('');
    setSending(true);
    try {
      const response = await request('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, history: conversationHistory }),
      });
      const payload = await response.json();
      setMessages(items => [...items, { role: 'assistant', text: payload.answer, intent: payload.intent }]);
    } catch (problem) {
      setError(problem.status === 404
        ? 'The chatbot API is not running. Restart the FastAPI backend, then try again.'
        : problem.message);
    } finally {
      setSending(false);
    }
  }

  function submit(event) {
    event.preventDefault();
    ask(draft);
  }

  return <div className="assistant-layout">
    <section className="panel chat-panel" aria-labelledby="assistant-title">
      <div className="panel-heading"><div className="heading-icon"><Icon name="chat" /></div>
        <div className="heading-copy"><h2 id="assistant-title">Catch assistant</h2><p>Answers from your private catch records and the app guide.</p></div></div>
      <div className="chat-log" aria-live="polite">
        {messages.map((message, index) => <div key={index} className={`chat-message ${message.role}`}>
          <strong>{message.role === 'assistant' ? 'Assistant' : 'You'}</strong><p>{message.text}</p>
        </div>)}
        {sending && <div className="chat-message assistant"><strong>Assistant</strong><p>Checking your records…</p></div>}
      </div>
      {error && <p className="alert" role="alert"><Icon name="info" size={17} />{error}</p>}
      <div className="question-chips" aria-label="Suggested questions">
        {suggestedQuestions.map(question => <button type="button" key={question} onClick={() => ask(question)} disabled={sending}>{question}</button>)}
      </div>
      <form className="chat-form" onSubmit={submit}>
        <label><span className="sr-only">Message</span><input maxLength={500} value={draft} onChange={event => setDraft(event.target.value)}
          placeholder="Ask about catches, species, sites, or training…" /></label>
        <button className="button primary" type="submit" disabled={sending || !draft.trim()}>Ask</button>
      </form>
    </section>
    <section className="panel training-panel" aria-labelledby="training-title">
      <div className="panel-heading"><div className="heading-icon"><Icon name="target" /></div>
        <div className="heading-copy"><h2 id="training-title">Species model</h2><p>Train photo suggestions with reviewed local examples.</p></div></div>
      <div className={`model-state ${model?.model_id ? 'ready' : ''}`}>
        <strong>{model?.model_id ? 'Model ready' : 'Dataset needed'}</strong>
        <span>{model?.model_id ? `Model ${model.model_id} recognizes ${model.labels.length} species.` : 'No trained model is installed yet.'}</span>
      </div>
      {model?.labels?.length > 0 && <div className="model-labels">{model.labels.map(label => <span key={label}>{label}</span>)}</div>}
      <ol className="training-steps">
        <li><strong>Collect reviewed crops</strong><span>Use clear, tightly framed fish photos with consistent species names.</span></li>
        <li><strong>Create a manifest</strong><span>Add image, species, group, and split columns. Keep collection groups separate between train and test.</span></li>
        <li><strong>Train and evaluate</strong><code>python -m backend.train path/to/manifest.csv</code></li>
      </ol>
      <a className="button secondary training-download" href="/api/training/manifest.csv"><Icon name="download" size={17} /> Download manifest template</a>
      <p className="training-note"><Icon name="info" size={17} /> Start with several independent groups per species. The command reports held-out accuracy and recall before installing the model.</p>
    </section>
  </div>;
}

function ReefDiagram() {
  return <svg className="reef-diagram" viewBox="0 0 470 235" fill="none" aria-hidden="true">
    <defs>
      <pattern id="diagram-grid" width="22" height="22" patternUnits="userSpaceOnUse">
        <path d="M22 0H0V22" stroke="#79c8c3" strokeOpacity=".19" />
      </pattern>
      <linearGradient id="fish-fill" x1="130" y1="54" x2="319" y2="169" gradientUnits="userSpaceOnUse">
        <stop stopColor="#57cec1" stopOpacity=".27" /><stop offset="1" stopColor="#57cec1" stopOpacity=".02" />
      </linearGradient>
    </defs>
    <rect x="7" y="16" width="450" height="199" rx="18" fill="url(#diagram-grid)" />
    <path d="M79 107c25-29 69-52 129-51 59 1 101 26 128 42l49-34-8 45 8 47-49-33c-34 19-77 44-134 43-57 0-96-19-123-47l-11-7 11-5Z" fill="url(#fish-fill)" stroke="#76d9ce" strokeWidth="1.75" />
    <path d="m151 63 42-32 53 27m-81 99 41 22 38-17m-86-81c13 18 15 40 0 58m18-21 34-13-24 28m30-43c35-1 76 9 103 22-26 15-66 25-102 25" stroke="#76d9ce" strokeOpacity=".76" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="117" cy="100" r="5" fill="#76d9ce" />
    <path d="M68 112v87m317-89v89" stroke="#bce8de" strokeDasharray="4 5" strokeOpacity=".65" />
    <path d="M68 112h317" stroke="#91e0d5" strokeOpacity=".35" strokeDasharray="5 6" />
    <circle cx="68" cy="112" r="5" fill="#f7c283" /><circle cx="385" cy="110" r="5" fill="#f7c283" />
    <path d="M68 193h317m-317-6v13m32-13v6m31-6v6m32-6v6m32-6v6m31-6v13m32-13v6m32-6v6m32-6v6m31-6v6m32-6v13" stroke="#f7c283" strokeOpacity=".85" strokeLinecap="round" />
    <text x="68" y="218" fill="#a7d0ce" fontFamily="monospace" fontSize="10" letterSpacing="1.5">SNOUT</text>
    <text x="385" y="218" textAnchor="end" fill="#a7d0ce" fontFamily="monospace" fontSize="10" letterSpacing="1.5">TAIL</text>
  </svg>;
}

function useCatchSummary() {
  const [state, setState] = useState({ records: null, error: '' });
  useEffect(() => {
    const controller = new AbortController();
    async function loadAll() {
      const records = []; let offset = 0; let total = 0;
      do {
        const response = await request(`/api/catches?limit=200&offset=${offset}`, { signal: controller.signal });
        const page = await response.json();
        records.push(...page); offset += page.length; total = Number(response.headers.get('X-Total-Count')) || records.length;
        if (!page.length) break;
      } while (!controller.signal.aborted && offset < total);
      if (!controller.signal.aborted) setState({ records, error: '' });
    }
    loadAll().catch(problem => { if (!controller.signal.aborted) setState({ records: null, error: problem.message }); });
    return () => controller.abort();
  }, []);
  return state;
}

function Dashboard({ onNavigate }) {
  const { records, error } = useCatchSummary();
  const researchRecords = records?.filter(record => !record.demo) ?? [];
  const fish = researchRecords.flatMap(record => record.specimens);
  const reviewed = fish.filter(isReviewedFish);
  const measured = fish.filter(item => item.estimated_cm != null);
  const sites = new Set(researchRecords.map(item => item.site));
  const demoCount = records ? records.length - researchRecords.length : 0;
  return <>
    {error && <p className="alert">{error}</p>}
    <dl className="record-metrics dashboard-metrics">
      <div><dt>Catches</dt><dd>{records ? researchRecords.length : '—'}</dd><small>{demoCount ? `${demoCount} demo excluded` : 'research records'}</small></div>
      <div><dt>Fish</dt><dd>{records ? fish.length : '—'}</dd><small>{reviewed.length} reviewed research labels</small></div>
      <div><dt>Calibrated</dt><dd>{records ? measured.length : '—'}</dd><small>photo lengths</small></div>
      <div><dt>Sites</dt><dd>{records ? sites.size : '—'}</dd><small>monitoring locations</small></div>
    </dl>
    <div className="dashboard-grid">
      <section className="panel"><div className="panel-heading"><div className="heading-icon"><Icon name="plus" /></div><div className="heading-copy"><h2>Continue fieldwork</h2><p>Create a calibrated, reviewable observation.</p></div></div>
        <button className="button primary" onClick={() => onNavigate('workspace')}>New analysis</button>
      </section>
      <section className="panel"><div className="panel-heading"><div className="heading-icon"><Icon name="records" /></div><div className="heading-copy"><h2>Research readiness</h2><p>What the current evidence supports.</p></div></div>
        <ul className="check-list"><li>Saved records persist locally</li><li>Predictions and reviews are separated</li><li>{measured.length} calibrated measurements available</li><li>No field accuracy claim without held-out data</li></ul>
      </section>
    </div>
  </>;
}

function SpeciesCatalog({ model, onNewCatch }) {
  const { records, error } = useCatchSummary();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const modelLabels = model?.labels ?? [];
  const supported = new Set(modelLabels.map(label => label.trim().toLocaleLowerCase()));
  const specimens = records?.flatMap(record => record.specimens.map(fish => ({ fish, record }))) ?? [];
  const species = new Map();

  specimens.forEach(({ fish, record }) => {
    const label = fish.species?.trim() || 'Unknown / Needs review';
    const key = label.toLocaleLowerCase();
    const pending = !isReviewedFish(fish);
    const length = fish.measured_cm ?? fish.estimated_cm;
    const entry = species.get(key) ?? {
      label, count: 0, reviewed: 0, demo: 0, lengths: [], sites: new Set(), habitats: new Set(), latest: '', modelSupported: supported.has(key),
    };
    entry.count += 1;
    if (!pending) entry.reviewed += 1;
    if (record.demo) entry.demo += 1;
    if (Number.isFinite(length)) entry.lengths.push(length);
    if (record.site) entry.sites.add(record.site);
    if (record.habitat) entry.habitats.add(record.habitat);
    if (record.collected_on > entry.latest) entry.latest = record.collected_on;
    species.set(key, entry);
  });

  modelLabels.forEach(label => {
    const key = label.trim().toLocaleLowerCase();
    if (!species.has(key)) species.set(key, {
      label, count: 0, reviewed: 0, demo: 0, lengths: [], sites: new Set(), habitats: new Set(), latest: '', modelSupported: true,
    });
  });

  const allSpecies = [...species.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  const visibleSpecies = allSpecies.filter(item => {
    const matchesQuery = item.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    const matchesFilter = filter === 'all'
      || (filter === 'reviewed' && item.reviewed > 0)
      || (filter === 'model' && item.modelSupported)
      || (filter === 'pending' && item.reviewed < item.count && item.count > 0);
    return matchesQuery && matchesFilter;
  });
  const observedSpecies = allSpecies.filter(item => item.count > 0).length;
  const reviewedSpecimens = allSpecies.reduce((total, item) => total + item.reviewed, 0);

  return <>
    {error && <div className="alert" role="alert"><Icon name="info" size={18} /> <span>{error}</span></div>}
    <dl className="record-metrics species-metrics">
      <div><dt><Icon name="fish" size={18} /> Observed labels</dt><dd>{records ? observedSpecies : '—'}</dd><small>in saved catches</small></div>
      <div><dt><Icon name="records" size={18} /> Specimens</dt><dd>{records ? specimens.length : '—'}</dd><small>recorded fish</small></div>
      <div><dt><Icon name="check" size={18} /> Reviewed</dt><dd>{records ? reviewedSpecimens : '—'}</dd><small>researcher-confirmed</small></div>
      <div><dt><Icon name="target" size={18} /> Model labels</dt><dd>{model ? modelLabels.length : '—'}</dd><small>automatic suggestions</small></div>
    </dl>
    <div className="dashboard-grid species-layout">
      <section className="panel" aria-labelledby="species-list-title">
        <div className="panel-heading"><div className="heading-icon"><Icon name="fish" /></div><div className="heading-copy"><h2 id="species-list-title">Species in your records</h2><p>Browse observed labels and see which evidence still needs researcher review.</p></div></div>
        {records && allSpecies.length > 0 && <>
          <div className="species-toolbar">
            <label className="search-field"><span className="sr-only">Search species labels</span><Icon name="search" size={18} /><input type="search" maxLength={120} placeholder="Search species labels" value={query} onChange={event => setQuery(event.target.value)} /></label>
            <label><span className="sr-only">Filter species</span><select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All labels</option><option value="reviewed">Reviewed</option><option value="model">Model supported</option><option value="pending">Needs review</option></select></label>
          </div>
          <p className="species-result-count" role="status">Showing <strong>{visibleSpecies.length}</strong> of {allSpecies.length} labels</p>
          {visibleSpecies.length > 0 ? <div className="species-grid">{visibleSpecies.map(item => {
            const average = item.lengths.length ? item.lengths.reduce((total, value) => total + value, 0) / item.lengths.length : null;
            const pending = item.count > item.reviewed;
            return <article className="species-card" key={item.label}>
              <div className="species-card-head"><div><small>{item.count ? `${item.count} observed specimen${item.count === 1 ? '' : 's'}` : 'Model only'}</small><strong>{item.label}</strong></div>
                <span className={`review-status ${pending || !item.count ? 'pending' : ''}`}><Icon name={pending || !item.count ? 'info' : 'check'} size={13} />{!item.count ? 'Not observed' : pending ? 'Review needed' : 'Reviewed'}</span></div>
              <dl className="species-facts"><div><dt>Sites</dt><dd>{item.sites.size || '—'}</dd></div><div><dt>Average length</dt><dd>{average === null ? '—' : `${average.toFixed(1)} cm`}</dd></div><div><dt>Latest</dt><dd>{item.latest ? formatDate(item.latest) : '—'}</dd></div></dl>
              <div className="species-badges">{item.modelSupported && <span><Icon name="target" size={13} /> Model supported</span>}{item.habitats.size > 0 && <span>{[...item.habitats].join(' · ')}</span>}{item.demo > 0 && <span>{item.demo} demo</span>}</div>
            </article>;
          })}</div> : <div className="records-empty compact"><h3>No matching species</h3><p>Try another search or filter.</p><button className="text-button" type="button" onClick={() => { setQuery(''); setFilter('all'); }}>Clear filters</button></div>}
        </>}
        {records && allSpecies.length === 0 && <div className="records-empty"><span className="drop-icon"><Icon name="fish" size={24} /></span><h3>No species observations yet</h3><p>Save a catch with a species label, then it will appear here for review and comparison.</p><button className="button primary" type="button" onClick={onNewCatch}><Icon name="plus" size={17} /> Add first catch</button></div>}
        {!records && !error && <p className="results-count" role="status">Loading species records…</p>}
      </section>
      <aside className="panel species-coverage"><div className="panel-heading"><div className="heading-icon"><Icon name="target" /></div><div className="heading-copy"><h2>Identification coverage</h2><p>Automatic suggestions are limited to trained labels.</p></div></div>
        <div className={`model-state ${model?.model_id ? 'ready' : ''}`}><strong>{model?.model_id ? `${modelLabels.length} model-supported label${modelLabels.length === 1 ? '' : 's'}` : 'No trained model installed'}</strong><span>{model?.model_id ? `Using model ${model.model_id}. Unfamiliar fish can still be returned for review.` : 'Saved manual labels remain visible and usable. Train a model when enough reviewed local images are available.'}</span></div>
        {modelLabels.length > 0 && <div className="model-labels">{modelLabels.map(label => <span key={label}>{label}</span>)}</div>}
        <h3>Evidence note</h3><p className="prose">An observed label describes what is stored in your records; it does not by itself verify taxonomy. Use scientific names consistently and retain voucher-quality evidence where possible.</p>
      </aside>
    </div>
  </>;
}

function Performance({ model }) {
  const metrics = model?.metrics;
  const evaluated = metrics?.improved_with_abstention;
  const perSpecies = evaluated?.per_species ? Object.entries(evaluated.per_species) : [];
  const confusion = evaluated?.confusion_actual_by_predicted ?? {};
  const confusionColumns = [...new Set(Object.values(confusion).flatMap(row => Object.keys(row)))];
  return <div className="dashboard-grid">
    <section className="panel"><div className="panel-heading"><div className="heading-icon"><Icon name="target" /></div><div className="heading-copy"><h2>Model performance</h2><p>Only held-out evaluation results belong here.</p></div></div>
      <div className={`model-state ${model?.model_id ? 'ready' : ''}`}><strong>{model?.model_id ? `Installed model ${model.model_id}` : 'Not evaluated'}</strong><span>{model?.metrics ? 'Metrics were stored with this model.' : 'No labeled held-out dataset or published accuracy result is installed.'}</span></div>
      {evaluated && <>
        <dl className="performance-metrics"><div><dt>Accuracy</dt><dd>{(evaluated.accuracy * 100).toFixed(1)}%</dd></div><div><dt>Macro F1</dt><dd>{(evaluated.macro_f1 * 100).toFixed(1)}%</dd></div><div><dt>Macro recall</dt><dd>{(evaluated.macro_recall * 100).toFixed(1)}%</dd></div><div><dt>Abstention</dt><dd>{((metrics.abstention_rate || 0) * 100).toFixed(1)}%</dd></div></dl>
        <p className="evaluation-counts">{metrics.held_out_images} held-out images · {metrics.held_out_groups} independent test groups · {metrics.training_images} training images</p>
        {perSpecies.length > 0 && <div className="performance-table-wrap"><table className="performance-table"><caption>Held-out results by species</caption><thead><tr><th>Species</th><th>Precision</th><th>Recall</th><th>F1</th><th>Samples</th></tr></thead><tbody>{perSpecies.map(([label, result]) => <tr key={label}><th>{label}</th><td>{(result.precision * 100).toFixed(1)}%</td><td>{(result.recall * 100).toFixed(1)}%</td><td>{(result.f1 * 100).toFixed(1)}%</td><td>{result.support}</td></tr>)}</tbody></table></div>}
        {confusionColumns.length > 0 && <details className="confusion-details"><summary>View confusion matrix</summary><div className="performance-table-wrap"><table className="performance-table confusion-table"><caption>Rows are reviewed species; columns are model outputs</caption><thead><tr><th>Actual ↓ / Predicted →</th>{confusionColumns.map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{Object.entries(confusion).map(([actual, row]) => <tr key={actual}><th>{actual}</th>{confusionColumns.map(predicted => <td key={predicted}>{row[predicted] ?? 0}</td>)}</tr>)}</tbody></table></div></details>}
      </>}
      <p className="prose">The training command reports macro F1, macro precision/recall, per-species metrics, a confusion matrix, abstention rate, and a forced-choice baseline on the same test groups.</p>
      <code className="command">python -m backend.train path/to/manifest.csv</code>
    </section>
    <section className="panel"><h2>Supported conditions & limitations</h2><ul className="check-list warning-list"><li>One side-profile fish per marked crop</li><li>Training and deployment conditions should match</li><li>Occlusion, glare, blur, unusual life stages, and unseen species can fail</li><li>Length requires a visible reference in the fish plane</li><li>Perspective and curved fish remain researcher-review concerns</li></ul></section>
  </div>;
}

function HelpPage() {
  return <div className="dashboard-grid help-grid">
    <section className="panel"><h2>Photograph for measurement</h2><ol className="guide-list"><li>Lay the fish flat without bending the body.</li><li>Place a ruler or scale bar in the same plane and near the fish.</li><li>Photograph directly overhead; keep the full snout and farthest tail tip visible.</li><li>Use diffuse light, avoid glare, and capture enough resolution for landmarks.</li></ol></section>
    <section className="panel"><h2>Review protocol</h2><ol className="guide-list"><li>Mark every fish as a separate specimen.</li><li>Use a tight whole-fish crop for species suggestions.</li><li>Treat ranked candidates as assistance, not truth.</li><li>Save the researcher label and physical measurement separately.</li></ol></section>
    <section className="panel"><h2>When no calibration exists</h2><p className="prose">Leave the photo estimate empty. Record a physical measurement if one is available. The application will never infer centimeters from pixels alone.</p></section>
    <section className="panel"><h2>Backups</h2><p className="prose">Stop writes, then copy the entire data directory. It contains the SQLite database, photos, and installed model. Keep original research photographs in a separate backed-up archive.</p></section>
  </div>;
}

function UserAvatar({ user, large = false }) {
  const initials = user.name.split(/\s+/).filter(Boolean).slice(0, 2).map(item => item[0]).join('').toUpperCase();
  return <span className={`user-avatar ${large ? 'large' : ''}`}>{user.has_avatar
    ? <img src={`/api/auth/avatar?v=${encodeURIComponent(user.avatar_version || '')}`} alt={`${user.name} profile`} />
    : <span aria-hidden="true">{initials || 'R'}</span>}</span>;
}

function AccountSettings({ user, onUpdated, onAccountDeleted }) {
  const [name, setName] = useState(user.name); const [working, setWorking] = useState(false);
  const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const [currentPassword, setCurrentPassword] = useState(''); const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState(''); const [passwordWorking, setPasswordWorking] = useState(false);
  const [deletePassword, setDeletePassword] = useState(''); const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const avatarInput = useRef(null);
  async function save(event) { event.preventDefault(); setWorking(true); setError(''); setMessage('');
    try { const response = await request('/api/auth/account', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); const result = await response.json(); onUpdated(result.user); setMessage('Account settings saved.'); }
    catch (problem) { setError(problem.message); } finally { setWorking(false); }
  }
  async function uploadAvatar(file) {
    if (!file) return; setWorking(true); setError(''); setMessage('');
    try { if (file.size > 3 * 1024 * 1024) throw new Error('Profile images must be 3 MB or smaller.');
      const body = new FormData(); body.append('file', file);
      const response = await request('/api/auth/avatar', { method: 'POST', body }); const result = await response.json(); onUpdated(result.user); setMessage('Profile image updated.');
    } catch (problem) { setError(problem.message); } finally { setWorking(false); if (avatarInput.current) avatarInput.current.value = ''; }
  }
  async function removeAvatar() { setWorking(true); setError(''); setMessage('');
    try { const response = await request('/api/auth/avatar', { method: 'DELETE' }); const result = await response.json(); onUpdated(result.user); setMessage('Profile image removed.'); }
    catch (problem) { setError(problem.message); } finally { setWorking(false); }
  }
  async function changePassword(event) { event.preventDefault(); setError(''); setMessage('');
    if (newPassword !== confirmPassword) { setError('The new passwords must match.'); return; }
    setPasswordWorking(true);
    try { const response = await request('/api/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) }); const result = await response.json(); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setMessage(result.message); }
    catch (problem) { setError(problem.message); } finally { setPasswordWorking(false); }
  }
  async function deleteAccount(event) {
    event.preventDefault(); setError(''); setMessage('');
    if (deleteConfirmation.trim().toUpperCase() !== 'DELETE') { setError('Type DELETE to confirm account deletion.'); return; }
    if (!window.confirm('Delete your account and every catch, photo, measurement, and review permanently? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await request('/api/auth/account', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current_password: deletePassword, confirmation: deleteConfirmation }) });
      await clearCatchDraft(user.id).catch(() => {});
      onAccountDeleted();
    } catch (problem) { setError(problem.message); setDeleting(false); }
  }
  return <div className="profile-settings">
    {message && <p className="success">{message}</p>}{error && <p className="alert">{error}</p>}
    <section className="panel"><div className="panel-heading"><div className="heading-icon"><Icon name="check" /></div><div className="heading-copy"><h2>Researcher profile</h2><p>Update your public display inside this workspace.</p></div></div>
      <div className="avatar-editor"><UserAvatar user={user} large /><div><strong>Profile image</strong><p>Square JPEG, PNG, or WebP · maximum 3 MB</p><div className="avatar-actions"><input ref={avatarInput} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={event => uploadAvatar(event.target.files[0])} /><button className="button secondary small" type="button" disabled={working} onClick={() => avatarInput.current?.click()}>{user.has_avatar ? 'Replace image' : 'Upload image'}</button>{user.has_avatar && <button className="text-button danger" type="button" disabled={working} onClick={removeAvatar}>Remove</button>}</div></div></div>
      <form className="fields profile-form" onSubmit={save}><label>Name<input required autoComplete="name" maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label><label>Email address<input value={user.email} disabled /></label><button className="button primary" disabled={working}>{working ? 'Saving…' : 'Save profile'}</button></form>
    </section>
    <section className="panel"><div className="panel-heading"><div className="heading-icon"><Icon name="info" /></div><div className="heading-copy"><h2>Security</h2><p>Change your password and sign out other sessions.</p></div></div>
      <form className="fields" onSubmit={changePassword}><label>Current password<input required type="password" autoComplete="current-password" maxLength={128} value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></label><label>New password<input required type="password" autoComplete="new-password" minLength={15} maxLength={128} value={newPassword} onChange={event => setNewPassword(event.target.value)} /></label><label>Confirm new password<input required type="password" autoComplete="new-password" minLength={15} maxLength={128} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} /></label><p className="password-help">Use at least 15 characters. Updating it signs out every other session.</p><button className="button primary" disabled={passwordWorking}>{passwordWorking ? 'Updating…' : 'Update password'}</button></form>
    </section>
    <section className="panel account-data-panel"><div className="panel-heading"><div className="heading-icon"><Icon name="download" /></div><div className="heading-copy"><h2>Your data</h2><p>Export your observations or permanently remove the account.</p></div></div>
      <a className="button secondary" href="/api/export.csv"><Icon name="download" size={17} /> Export all catches</a>
      <details className="danger-zone"><summary>Delete account and data</summary><form className="fields" onSubmit={deleteAccount}><p>This permanently deletes your profile, catches, stored photos, measurements, predictions, and reviews.</p><label>Current password<input required type="password" autoComplete="current-password" maxLength={128} value={deletePassword} onChange={event => setDeletePassword(event.target.value)} /></label><label>Type DELETE to confirm<input required maxLength={20} value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} /></label><button className="button danger-button" disabled={deleting}>{deleting ? 'Deleting account…' : 'Permanently delete account'}</button></form></details>
    </section>
  </div>;
}

function CatchApp({ user, onUserUpdated, onAccountDeleted, onSignOut, signingOut, signOutError }) {
  const [page, setPage] = useState('dashboard');
  const [model, setModel] = useState(null);
  const [statusError, setStatusError] = useState('');
  const [latest, setLatest] = useState(null);
  const [session, setSession] = useState(0);
  const heading = useRef(null);
  const navigated = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    request('/api/status', { signal: controller.signal }).then(response => response.json()).then(setModel)
      .catch(problem => { if (!controller.signal.aborted) setStatusError(problem.message); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (navigated.current) heading.current?.focus();
  }, [page]);

  function navigate(next) {
    if (next === page) return;
    navigated.current = true;
    setPage(next);
    window.scrollTo(0, 0);
  }

  function saved(record) {
    setLatest(record);
    setSession(value => value + 1);
    navigate('records');
  }

  return <>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="site-header"><div className="shell header-inner">
      <Brand />
      <nav aria-label="Main navigation">
        {[['dashboard', 'target', 'Dashboard'], ['workspace', 'image', 'New analysis'], ['records', 'records', 'History'], ['species', 'fish', 'Species'], ['performance', 'target', 'Performance'], ['assistant', 'chat', 'Model & assistant'], ['help', 'info', 'Help']].map(([id, icon, label]) =>
          <button key={id} type="button" aria-current={page === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon name={icon} size={16} /> {label}</button>)}
      </nav>
      <div className="account-controls">
        <UserAvatar user={user} />
        <span title={user.email}><small>Signed in as</small><strong>{user.name}</strong></span>
          <button className="account-link" type="button" onClick={() => navigate('account')}>Settings</button>
          <button className="button secondary small" type="button" onClick={onSignOut} disabled={signingOut}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </div></header>
    <main className="shell" id="main-content">
      {signOutError && <p className="alert" role="alert">{signOutError}</p>}
      <section className={`hero ${page !== 'workspace' ? 'hero-records' : ''}`}>
        <div className="hero-copy"><p className="eyebrow"><span /> FISHERIES MONITORING</p>
          <h1 ref={heading} tabIndex={-1}>{{ dashboard: 'Research dashboard', workspace: 'New catch analysis', records: 'Catch history', species: 'Species catalog', performance: 'Model performance', help: 'Fieldwork guide', account: 'Account settings', assistant: 'Catch assistant' }[page]}</h1>
          <p>{{ dashboard: 'A transparent overview of saved observations and research readiness.', workspace: 'Measure fish from photos and record species across marine, brackish, and freshwater habitats.', records: 'Search, review, correct, and export your saved catch observations.', species: 'Browse species observed in saved catches and compare them with model identification coverage.', performance: 'Separate measured evidence from assumptions and document limitations.', help: 'Capture consistent photographs and defensible measurements.', account: 'Manage your researcher profile.', assistant: 'Explore records and prepare a species model.' }[page]}</p>
          {page === 'workspace' ? <p className="mode" role="status"><span />{statusError ? 'Model status unavailable' : !model ? 'Checking model…' : model.model_id ? 'Species model available' : 'Manual species review'}</p>
            : <button type="button" className="button hero-action" onClick={() => navigate('workspace')}><Icon name="image" size={17} /> Open workspace</button>}
        </div>
        {page === 'workspace' && <ReefDiagram />}
      </section>
      {statusError && page === 'workspace' && <div className="notice" role="status"><Icon name="info" size={17} />{statusError}</div>}
      {page === 'dashboard' && <Dashboard onNavigate={navigate} />}
      <div hidden={page !== 'workspace'}><Workspace key={session} model={model} userId={user.id} onSaved={saved} /></div>
      {page === 'records' && <Records latest={latest} onNewCatch={() => navigate('workspace')} />}
      {page === 'species' && <SpeciesCatalog model={model} onNewCatch={() => navigate('workspace')} />}
      {page === 'performance' && <Performance model={model} />}
      {page === 'help' && <HelpPage />}
      {page === 'account' && <AccountSettings user={user} onUpdated={onUserUpdated} onAccountDeleted={onAccountDeleted} />}
      {page === 'assistant' && <Assistant model={model} />}
      <footer><span>REEF CATCH MONITOR</span><span>Photo-based fisheries observations</span></footer>
    </main>
    <FishChat user={user} />
  </>;
}

function Brand() {
  return <div className="brand"><span className="brand-icon"><Icon name="fish" size={24} /></span>
    <div><strong>Reef Catch Monitor</strong><span>FISH CATCH RECORDS</span></div>
  </div>;
}

function App() {
  const [resetTokenFromLink, setResetTokenFromLink] = useState(() => new URLSearchParams(window.location.search).get('reset_token') || '');
  const [showRecovery, setShowRecovery] = useState(() => {
    const query = new URLSearchParams(window.location.search);
    return query.has('reset_token') || query.has('forgot-password');
  });
  const [user, setUser] = useState(undefined);
  const [sessionError, setSessionError] = useState('');
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    request('/api/auth/session', { signal: controller.signal }).then(response => response.json())
      .then(session => { if (!controller.signal.aborted) setUser(session.user); })
      .catch(problem => { if (!controller.signal.aborted) setSessionError(problem.message); });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    function expire() {
      setUser(null);
      setMessage('Your session ended. Sign in again to continue.');
    }
    window.addEventListener('reef-session-expired', expire);
    return () => window.removeEventListener('reef-session-expired', expire);
  }, []);

  async function authenticate(mode, values) {
    const response = await request('/api/auth/' + mode, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
    });
    const session = await response.json();
    setMessage('');
    setSignOutError('');
    setUser(session.user);
    window.scrollTo(0, 0);
  }

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError('');
    try {
      await request('/api/auth/logout', { method: 'POST' });
      setUser(null);
      setMessage('You signed out.');
      window.scrollTo(0, 0);
    } catch (problem) {
      setSignOutError(problem.message);
    } finally {
      setSigningOut(false);
    }
  }

  if (user && !showRecovery) return <CatchApp key={user.id} user={user} onUserUpdated={setUser} onAccountDeleted={() => { setUser(null); setMessage('Your account and its stored data were deleted.'); }} onSignOut={signOut}
    signingOut={signingOut} signOutError={signOutError} />;

  return <>
    <header className="site-header"><div className="shell header-inner"><Brand /></div></header>
    <main className="shell account-layout">
      <section className="account-intro" aria-labelledby="intro-title">
        <p className="eyebrow"><span /> FISHERIES MONITORING</p>
        <h1 id="intro-title">Your fish catch workspace</h1>
        <p>Measure fish from photos, record species and habitats, and keep your catch records in one place.</p>
        <ReefDiagram />
      </section>
      <div>
        {message && <p className="success" role="status">{message}</p>}
        {sessionError ? <section className="panel">
          <p className="alert" role="alert">{sessionError}</p>
          <button className="button secondary" type="button" onClick={() => {
            setSessionError(''); setAttempt(value => value + 1);
          }}>Try again</button>
        </section> : user === undefined ? <p className="panel" role="status">Checking your session…</p>
          : <AccountForm onAuthenticate={authenticate} initialResetToken={resetTokenFromLink}
            onExitRecovery={() => setShowRecovery(false)} onResetComplete={result => {
              setResetTokenFromLink(''); setShowRecovery(false); setUser(null); setMessage(result);
            }} />}
      </div>
    </main>
  </>;
}

createRoot(document.getElementById('root')).render(<App />);
