import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GripHorizontal, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react';
import { useLoad } from '../hooks/useLoad';
import { useToast } from '../components/Toast';
import { ConfirmDialog } from '../components/Modal';
import { Alert, Field } from '../components/ui';
import { listDepartments, resetOfficeLayout, saveOfficeLayout } from '../services/api';
import {
  CEO_SEATS, COLS, MAX_NAME, MAX_ROWS, MIN_H, MIN_W,
  addRoom, changeRoom, fromRows, isChanged, nudge, planProblems, removeRoom, setCeoSeat, setDepartment, toPayload,
} from '../lib/floorplan';

/** Width of an element, kept up to date. */
function useWidth(ref) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

const sizeText = (r) => `${r.w} × ${r.h}`;

function whoText(room, departments) {
  const names = room.department_ids.map((id) => departments.find((d) => d.id === id)?.name).filter(Boolean);
  const parts = [...names];
  if (room.ceo_seat != null) parts.push(`CEO seat ${room.ceo_seat}`);
  return parts.length ? parts.join(', ') : 'Nobody sits here';
}

/**
 * Developer only: draw the office again. Add, rename, move, resize and delete rooms and choose who sits in each.
 * Nothing is saved until "Save floor plan"; Cancel throws the changes away. The mouse drags rooms (touch screens drag by
 * the two grips), the arrow keys move the selected room (Shift + arrow resizes it), and the boxes on the right take exact numbers.
 */
export default function FloorEditor({ saved, onCancel, onSaved }) {
  const toast = useToast();
  const deps = useLoad(listDepartments);
  const departments = useMemo(() => deps.data ?? [], [deps.data]);

  const [rooms, setRooms] = useState(() => fromRows(saved));
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [askReset, setAskReset] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);
  const [saveError, setSaveError] = useState('');

  const roomsRef = useRef(rooms);
  useEffect(() => {
    roomsRef.current = rooms;
  }, [rooms]);

  const canvasRef = useRef(null);
  const width = useWidth(canvasRef);
  const cell = width > 0 ? width / COLS : 0;
  const rowPx = Math.max(24, Math.min(46, Math.round(cell * 0.62)));
  const bottom = rooms.reduce((n, r) => Math.max(n, r.y + r.h), 0);
  const rows = Math.min(MAX_ROWS, Math.max(10, bottom + 3));

  const dirty = isChanged(saved, rooms);
  const problems = useMemo(() => planProblems(rooms), [rooms]);
  const current = rooms.find((r) => r.id === selected) ?? null;

  const apply = useCallback((result) => {
    setNotice(result.error);
    if (result.rooms !== roomsRef.current) setRooms(result.rooms);
  }, []);

  /* ---------- dragging ---------- */
  const drag = useRef(null);

  function onPointerDown(e, room) {
    setSelected(room.id);
    setNotice('');
    const grip = e.target.closest?.('[data-grip]')?.dataset.grip;
    if (e.pointerType === 'touch' && !grip) return; // a finger on the body scrolls the page; the grips move and resize
    if (e.button !== undefined && e.button !== 0) return;
    drag.current = { id: room.id, mode: grip === 'resize' ? 'resize' : 'move', px: e.clientX, py: e.clientY, x: room.x, y: room.y, w: room.w, h: room.h };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    if (e.pointerType !== 'touch') e.preventDefault();
  }

  function onPointerMove(e) {
    const d = drag.current;
    if (!d || !cell) return;
    const dx = Math.round((e.clientX - d.px) / cell);
    const dy = Math.round((e.clientY - d.py) / rowPx);
    const key = d.mode === 'move' ? ['x', 'y'] : ['w', 'h'];
    const base = { x: d.x, y: d.y, w: d.w, h: d.h };
    const want = { ...base, [key[0]]: base[key[0]] + dx, [key[1]]: base[key[1]] + dy };
    // Try the whole move first; if a neighbour is in the way, slide along it (one direction at a time).
    for (const patch of [want, { ...base, [key[0]]: want[key[0]] }, { ...base, [key[1]]: want[key[1]] }]) {
      const result = changeRoom(roomsRef.current, d.id, patch);
      if (!result.error) {
        if (result.rooms !== roomsRef.current) setRooms(result.rooms);
        return;
      }
    }
  }

  function endDrag() {
    drag.current = null;
  }

  function onKeyDown(e, room) {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!step) {
      if (e.key === 'Escape') setSelected(null);
      return;
    }
    e.preventDefault();
    const result = nudge(roomsRef.current, room.id, step[0], step[1], e.shiftKey);
    apply(result);
  }

  /* ---------- toolbar actions ---------- */
  function add() {
    const room = addRoom(rooms);
    if (!room) {
      setNotice('There is no free space left for another room. Make a room smaller or delete one first.');
      return;
    }
    setRooms([...rooms, room]);
    setSelected(room.id);
    setNotice('');
  }

  function remove(id) {
    setRooms(removeRoom(rooms, id));
    setSelected(null);
    setNotice('');
  }

  async function save() {
    setBusy(true);
    setSaveError('');
    try {
      const out = await saveOfficeLayout(toPayload(rooms));
      toast.success('Floor plan saved.');
      onSaved(out);
    } catch (err) {
      setSaveError(err.message);
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      const out = await resetOfficeLayout();
      toast.success('The original floor plan is back.');
      setAskReset(false);
      onSaved(out);
    } catch (err) {
      setAskReset(false);
      setSaveError(err.message);
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const otherRoomOf = (departmentId) => rooms.find((r) => r.id !== current?.id && r.department_ids.includes(departmentId));
  const seatOwner = (seat) => rooms.find((r) => r.id !== current?.id && r.ceo_seat === seat);

  return (
    <div className="la-fp">
      <div className="la-fp-bar">
        <div className="la-fp-bar-left">
          <button type="button" className="la-btn secondary sm" onClick={add} disabled={busy}>
            <Plus size={15} aria-hidden="true" /> Add room
          </button>
          <button type="button" className="la-btn ghost sm" onClick={() => setAskReset(true)} disabled={busy}>
            <RotateCcw size={14} aria-hidden="true" /> Restore original plan
          </button>
        </div>
        <div className="la-fp-bar-right">
          <span className="la-fp-state" role="status">{dirty ? 'Unsaved changes' : 'No changes yet'}</span>
          <button type="button" className="la-btn ghost sm" onClick={() => (dirty ? setAskDiscard(true) : onCancel())} disabled={busy}>
            <X size={14} aria-hidden="true" /> Cancel
          </button>
          <button type="button" className="la-btn primary sm" onClick={save} disabled={busy || !dirty || problems.length > 0}>
            <Save size={14} aria-hidden="true" /> {busy ? 'Saving…' : 'Save floor plan'}
          </button>
        </div>
      </div>

      {saveError && <Alert error>{saveError}</Alert>}
      {problems.length > 0 && <Alert error>{problems[0]}{problems.length > 1 ? ` (and ${problems.length - 1} more)` : ''}</Alert>}

      <div className="la-fp-main">
        <div className="la-fp-stage">
          <div
            ref={canvasRef}
            className="la-fp-canvas"
            style={{ height: rows * rowPx, '--cw': `${cell}px`, '--rh': `${rowPx}px` }}
            onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}
          >
            {cell > 0 && rooms.map((r) => (
              <div
                key={r.id}
                role="button"
                tabIndex={0}
                aria-pressed={r.id === selected}
                aria-label={`${r.name || 'Unnamed room'}. ${whoText(r, departments)}. ${r.w} columns by ${r.h} rows, at column ${r.x + 1}, row ${r.y + 1}. Arrow keys move it, Shift with arrow keys resizes it.`}
                className={`la-fp-room${r.id === selected ? ' on' : ''}${r.department_ids.length === 0 && r.ceo_seat == null ? ' plain' : ''}${r.h * rowPx < 76 ? ' compact' : ''}`}
                style={{ left: r.x * cell + 2, top: r.y * rowPx + 2, width: r.w * cell - 4, height: r.h * rowPx - 4 }}
                onPointerDown={(e) => onPointerDown(e, r)}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onKeyDown={(e) => onKeyDown(e, r)}
                onFocus={() => setSelected(r.id)}
              >
                <span className="la-fp-grab" data-grip="move" aria-hidden="true"><GripHorizontal size={14} /></span>
                <strong>{r.name || 'Unnamed room'}</strong>
                <small>{whoText(r, departments)}</small>
                <em>{sizeText(r)}</em>
                <span className="la-fp-corner" data-grip="resize" aria-hidden="true" />
              </div>
            ))}
            {rooms.length === 0 && <p className="la-fp-none">No rooms. Press “Add room”.</p>}
          </div>
          <p className="la-meta la-fp-help">
            Drag a room to move it and its bottom-right corner to resize it. On a touch screen use the grip at the top and the corner.
            With a room selected, the arrow keys move it and Shift with the arrow keys resizes it.
          </p>
          <p className="la-fp-notice" role="alert">{notice}</p>
        </div>

        <aside className="la-fp-panel" aria-label="Room settings">
          {!current ? (
            <p className="la-meta">Select a room to rename it, choose who sits there, or set its exact place and size.</p>
          ) : (
            <>
              <Field label="Room name" id="fp-name">
                <input
                  id="fp-name"
                  name="room-name"
                  autoComplete="off"
                  className="la-input"
                  value={current.name}
                  maxLength={MAX_NAME}
                  onChange={(e) => setRooms(rooms.map((r) => (r.id === current.id ? { ...r, name: e.target.value } : r)))}
                />
              </Field>

              <fieldset className="la-fp-fields">
                <legend className="la-label">Place and size (in cells)</legend>
                {[
                  ['Column', 'x', 1, COLS, current.x + 1, (v) => ({ x: v - 1 })],
                  ['Row', 'y', 1, MAX_ROWS, current.y + 1, (v) => ({ y: v - 1 })],
                  [`Width (min ${MIN_W})`, 'w', MIN_W, COLS, current.w, (v) => ({ w: v })],
                  [`Height (min ${MIN_H})`, 'h', MIN_H, MAX_ROWS, current.h, (v) => ({ h: v })],
                ].map(([label, key, min, max, value, patch]) => (
                  <label key={key} className="la-fp-num">
                    <span>{label}</span>
                    <input
                      id={`fp-${key}`}
                      name={`room-${key}`}
                      autoComplete="off"
                      className="la-input compact"
                      type="number"
                      inputMode="numeric"
                      min={min}
                      max={max}
                      value={value}
                      onChange={(e) => {
                        const v = Number.parseInt(e.target.value, 10);
                        if (Number.isFinite(v)) apply(changeRoom(roomsRef.current, current.id, patch(v)));
                      }}
                    />
                  </label>
                ))}
              </fieldset>

              <fieldset className="la-fp-fields wide">
                <legend className="la-label">Who sits here</legend>
                {deps.loading && !deps.data ? <p className="la-meta">Loading departments…</p> : null}
                {deps.error ? <p className="la-meta">{deps.error}</p> : null}
                {departments.map((d) => {
                  const elsewhere = otherRoomOf(d.id);
                  return (
                    <label key={d.id} className="la-check">
                      <input
                        type="checkbox"
                        id={`fp-dept-${d.id}`}
                        name="department"
                        checked={current.department_ids.includes(d.id)}
                        onChange={(e) => setRooms(setDepartment(rooms, current.id, d.id, e.target.checked))}
                      />
                      <span>
                        {d.name}
                        {!d.is_active && <small> (inactive)</small>}
                        {elsewhere && <small> · now in {elsewhere.name}, ticking moves it here</small>}
                      </span>
                    </label>
                  );
                })}
                <label className="la-fp-seat">
                  <span>CEO seat</span>
                  <select
                    id="fp-seat"
                    name="ceo-seat"
                    className="la-input compact"
                    value={current.ceo_seat ?? ''}
                    onChange={(e) => setRooms(setCeoSeat(rooms, current.id, e.target.value === '' ? null : Number(e.target.value)))}
                  >
                    <option value="">Nobody</option>
                    {Array.from({ length: CEO_SEATS }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        CEO {n}{seatOwner(n) ? ` (now in ${seatOwner(n).name})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="la-hint">CEO 1 is the CEO with the lowest employee number, CEO 2 the next one. A room with nobody ticked is a plain room, for example a meeting room.</p>
              </fieldset>

              <button type="button" className="la-btn danger sm" onClick={() => remove(current.id)}>
                <Trash2 size={14} aria-hidden="true" /> Delete this room
              </button>
            </>
          )}
        </aside>
      </div>

      {askReset && (
        <ConfirmDialog
          title="Restore the original plan?"
          message="This replaces the floor plan with the original six rooms (Designers, Production, Account managers, Copywriters, CEO 2, CEO 1) and saves it right away. Your changes, saved or not, are lost."
          confirmLabel="Restore original plan"
          danger
          busy={busy}
          onConfirm={reset}
          onCancel={() => setAskReset(false)}
        />
      )}
      {askDiscard && (
        <ConfirmDialog
          title="Discard your changes?"
          message="The floor plan has changes that are not saved."
          confirmLabel="Discard changes"
          danger
          onConfirm={() => {
            setAskDiscard(false);
            onCancel();
          }}
          onCancel={() => setAskDiscard(false)}
        />
      )}
    </div>
  );
}
