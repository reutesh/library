/*
 * ScanBooksModal — add several books from one photo
 *
 * 1. The user says whether the photo shows spines or covers, then takes
 *    (or picks) the photo.
 * 2. The server asks a local vision model (Ollama) to read each book's title
 *    and author. Small models can't read sideways text, so spine photos are
 *    rotated first to make the spine text horizontal.
 * 3. The user reviews the list — fix typos, untick wrong rows, add missed
 *    books — picks a shelf, and saves. Only confirmed rows are created.
 */

import { useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import { api, type ScannedBook } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useData } from '../data/DataContext';
import { canEditRoom } from '../roles';

interface ScanBooksModalProps {
  onClose: () => void;
  onSaved: () => void;
}

interface Row {
  key: number;
  include: boolean;
  title: string;
  author: string;
  confidence: ScannedBook['confidence'] | null; // null = added by hand
  duplicate: boolean;
  status: 'idle' | 'saved' | 'error';
  error?: string;
}

type Layout = 'spines' | 'covers';

/**
 * Rotations (clockwise degrees) to try, in order. Spine text usually runs
 * top-to-bottom (-90 makes it horizontal); "scan again" tries bottom-to-top.
 */
const ROTATIONS: Record<Layout, number[]> = {
  spines: [-90, 90],
  covers: [0],
};

/** Long side of the image sent for recognition — enough to read spine text. */
const MAX_IMAGE_SIDE = 2000;

/** Downscales and rotates the photo, re-encoded as JPEG; returns base64 without the data: prefix. */
async function prepareImage(file: File, rotation: number): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const sideways = rotation % 180 !== 0;
    const canvas = document.createElement('canvas');
    canvas.width = sideways ? h : w;
    canvas.height = sideways ? w : h;
    const ctx = canvas.getContext('2d')!;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** True if a book with exactly this title (case-insensitive) is already in the library. */
async function isDuplicate(title: string): Promise<boolean> {
  const params = new URLSearchParams({ q: title, limit: '10' });
  try {
    const page = await api.books(params);
    const t = title.trim().toLowerCase();
    return page.items.some((b) => b.title.trim().toLowerCase() === t);
  } catch {
    return false;
  }
}

const confidenceLabels: Record<ScannedBook['confidence'], string> = {
  high: 'זיהוי ודאי',
  medium: 'כדאי לבדוק',
  low: 'זיהוי לא ודאי',
};

export default function ScanBooksModal({ onClose, onSaved }: ScanBooksModalProps) {
  const { me } = useAuth();
  const { rooms, shelves } = useData();
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const nextKey = useRef(0);

  const [layout, setLayout] = useState<Layout>('spines');
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [shelfId, setShelfId] = useState('');

  const editableRooms = rooms.filter((r) => canEditRoom(me, r.id));
  const selected = rows?.filter((r) => r.include && r.status !== 'saved' && r.title.trim()) ?? [];
  const savedCount = rows?.filter((r) => r.status === 'saved').length ?? 0;

  // Free the preview's object URL when it's replaced or the modal closes
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const scan = async (file: File, rotation: number) => {
    setError('');
    setRows(null);
    setScanning(true);
    try {
      const image = await prepareImage(file, rotation);
      const { books } = await api.scanBooks(image, 'image/jpeg');
      // After a counter-clockwise turn the model lists the rightmost spine first.
      if (rotation < 0) books.reverse();
      const duplicates = await Promise.all(books.map((b) => isDuplicate(b.title)));
      setRows(
        books.map((b, i) => ({
          key: nextKey.current++,
          include: !duplicates[i],
          title: b.title,
          author: b.author ?? '',
          confidence: b.confidence,
          duplicate: duplicates[i],
          status: 'idle',
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בזיהוי התמונה');
    } finally {
      setScanning(false);
    }
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
    setAttempt(0);
    scan(file, ROTATIONS[layout][0]);
  };

  /** Switching spines ↔ covers after a photo was taken re-scans it the new way. */
  const changeLayout = (value: Layout) => {
    if (value === layout) return;
    setLayout(value);
    setAttempt(0);
    if (photo) scan(photo, ROTATIONS[value][0]);
  };

  /** Re-scan the same photo turned the other way (spines printed bottom-to-top). */
  const rescanOtherWay = () => {
    if (!photo) return;
    const rotations = ROTATIONS[layout];
    const next = (attempt + 1) % rotations.length;
    setAttempt(next);
    scan(photo, rotations[next]);
  };

  const updateRow = (key: number, changes: Partial<Row>) => {
    setRows((prev) => prev?.map((r) => (r.key === key ? { ...r, ...changes } : r)) ?? null);
  };

  const addRow = () => {
    setRows((prev) => [
      ...(prev ?? []),
      {
        key: nextKey.current++,
        include: true,
        title: '',
        author: '',
        confidence: null,
        duplicate: false,
        status: 'idle',
      },
    ]);
  };

  const saveAll = async () => {
    setSaving(true);
    setError('');
    let failed = 0;
    // One at a time keeps the results in the order the books appear in the photo.
    for (const row of selected) {
      try {
        await api.createBook({
          title: row.title.trim(),
          author: row.author.trim() || null,
          shelf_id: shelfId ? Number(shelfId) : null,
        });
        updateRow(row.key, { status: 'saved', error: undefined });
      } catch (err) {
        failed++;
        updateRow(row.key, {
          status: 'error',
          error: err instanceof Error ? err.message : 'שגיאה בשמירה',
        });
      }
    }
    setSaving(false);
    if (failed === 0) {
      onSaved();
    } else {
      setError(`${failed} ספרים לא נשמרו — אפשר לתקן ולנסות שוב`);
    }
  };

  const close = () => {
    // Books may already have been created even if some failed.
    if (savedCount > 0) onSaved();
    else onClose();
  };

  return (
    <Modal title="הוספת ספרים מתמונה" onClose={close} wide>
      <div className="scan-body">
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <input
          ref={galleryInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />

        <div className="scan-pick">
          <div className="scan-layout" role="radiogroup" aria-label="מה רואים בתמונה">
              {([
                ['spines', '📚 שדרות על מדף'],
                ['covers', '📕 כריכות'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={layout === value}
                  className={layout === value ? 'scan-layout-opt active' : 'scan-layout-opt'}
                  disabled={scanning || saving}
                  onClick={() => changeLayout(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          {preview && <img className="scan-preview" src={preview} alt="התמונה שנבחרה" />}
          <div className="scan-pick-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => cameraInput.current?.click()}
              disabled={scanning || saving}
            >
              📷 {preview ? 'צלם שוב' : 'צלם ספרים'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => galleryInput.current?.click()}
              disabled={scanning || saving}
            >
              🖼️ בחר תמונה
            </button>
          </div>
          {!preview && (
            <p className="field-hint">
              {layout === 'spines'
                ? 'צלמו את המדף כך שהספרים עומדים זקופים בתמונה. '
                : 'הניחו כמה ספרים זה לצד זה, כשהכריכות פונות למצלמה. '}
              הכותרת והמחבר יזוהו אוטומטית, ותוכלו לאשר ולתקן לפני השמירה.
            </p>
          )}
        </div>

        {scanning && (
          <div className="loading-state">
            <div className="spinner" />
            מזהה ספרים בתמונה... (עשוי לקחת עד דקה)
          </div>
        )}

        {rows !== null && (
          <>
            {rows.length === 0 ? (
              <p className="field-hint scan-empty">לא זוהו ספרים בתמונה. נסו תמונה קרובה וחדה יותר, או הוסיפו ידנית.</p>
            ) : (
              <p className="field-hint">
                זוהו {rows.filter((r) => r.confidence).length} ספרים. בדקו כל שורה, תקנו במידת הצורך, ובטלו את הסימון של ספרים שאין להוסיף.
              </p>
            )}
            {layout === 'spines' && (
              <button type="button" className="btn btn-secondary btn-small scan-retry" onClick={rescanOtherWay} disabled={saving}>
                🔄 לא זוהה טוב? סרוק שוב בכיוון ההפוך
              </button>
            )}

            <ul className="scan-list">
              {rows.map((row, i) => (
                <li
                  key={row.key}
                  className={[
                    'scan-row',
                    !row.include && 'scan-row-off',
                    row.status === 'saved' && 'scan-row-saved',
                    row.status === 'error' && 'scan-row-error',
                  ].filter(Boolean).join(' ')}
                >
                  <input
                    type="checkbox"
                    aria-label={`הוסף את ספר ${i + 1}`}
                    checked={row.include}
                    disabled={row.status === 'saved' || saving}
                    onChange={(e) => updateRow(row.key, { include: e.target.checked })}
                  />
                  <div className="scan-fields">
                    <input
                      placeholder="כותרת *"
                      aria-label="כותרת"
                      value={row.title}
                      disabled={row.status === 'saved' || saving}
                      onChange={(e) => updateRow(row.key, { title: e.target.value, include: true })}
                    />
                    <input
                      placeholder="מחבר/ת"
                      aria-label="מחבר/ת"
                      value={row.author}
                      disabled={row.status === 'saved' || saving}
                      onChange={(e) => updateRow(row.key, { author: e.target.value })}
                    />
                    <div className="scan-tags">
                      {row.status === 'saved' && <span className="scan-tag scan-tag-ok">✓ נשמר</span>}
                      {row.status !== 'saved' && row.confidence && row.confidence !== 'high' && (
                        <span className={`scan-tag scan-tag-${row.confidence}`}>
                          {confidenceLabels[row.confidence]}
                        </span>
                      )}
                      {row.status !== 'saved' && row.duplicate && (
                        <span className="scan-tag scan-tag-dup">כבר קיים בספרייה</span>
                      )}
                      {row.status === 'error' && <span className="scan-tag scan-tag-low">{row.error}</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="modal-close scan-remove"
                    aria-label="הסר שורה"
                    disabled={row.status === 'saved' || saving}
                    onClick={() => setRows((prev) => prev?.filter((r) => r.key !== row.key) ?? null)}
                  >
                    &times;
                  </button>
                </li>
              ))}
            </ul>

            <button type="button" className="btn btn-secondary btn-small" onClick={addRow} disabled={saving}>
              + הוסף ספר שלא זוהה
            </button>

            <div className="form-group scan-shelf">
              <label htmlFor="scan-shelf">מיקום לכל הספרים</label>
              <select id="scan-shelf" value={shelfId} onChange={(e) => setShelfId(e.target.value)} disabled={saving}>
                <option value="">לא מוקצה</option>
                {editableRooms.map((room) => (
                  <optgroup key={room.id} label={room.name}>
                    {shelves
                      .filter((s) => s.roomId === room.id)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </>
        )}

        {error && <div className="login-error">{error}</div>}

        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={close}>
            {savedCount > 0 ? 'סגירה' : 'ביטול'}
          </button>
          {rows !== null && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={saveAll}
              disabled={saving || selected.length === 0}
            >
              {saving ? 'שומר...' : `הוסף ${selected.length} ספרים`}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
