import { useCallback, useMemo, useState } from "react";
import { usePersistedEditorScroll } from "../../hooks/usePersistedEditorScroll";
import {
  ConfirmDialog,
  CourseFieldsDialog,
  type CourseFieldsValue,
} from "../../components/AppDialog";
import { CourseDayDialog, type CourseDayRow } from "./CourseDayDialog";
import { CloseIcon, PencilIcon, PlusIcon } from "../../components/treeIcons";
import { useListReorder } from "../../hooks/useListReorder";
import {
  applyTrackDay,
  barDateRange,
  completeDaysCount,
  courseSegmentKind,
  eachIsoDay,
  formatTrackSchedule,
  isMonday,
  localIsoDate,
  parseClockTimes,
  parseMdcourse,
  scheduledDaysCount,
  serializeMdcourse,
  trackActiveOnDay,
  trackEnd,
  trackLogOnDay,
  tracksForBar,
  type MdcourseDoc,
  type MdcourseTrack,
} from "../../lib/mdcourseFormat";

type Props = {
  path: string;
  content: string;
  onChange: (next: string) => void;
};

function formatDayTitle(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatAxisLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  if (d <= 7) {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return String(d);
}

function safeParse(content: string): { doc: MdcourseDoc; error: string | null } {
  try {
    return { doc: parseMdcourse(content), error: null };
  } catch (e) {
    return {
      doc: { created: localIsoDate(), tracks: [] },
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

const BAR_COL_PX = 8;
const BAR_GAP_PX = 1;
const BAR_STRIDE_PX = BAR_COL_PX + BAR_GAP_PX;

/** Inclusive column span of the track window on the visible bar (calendar start…end, not weekdays). */
function trackSpanOnBar(
  track: MdcourseTrack,
  days: string[],
): { from: number; to: number } | null {
  const end = trackEnd(track);
  let from = -1;
  let to = -1;
  for (let i = 0; i < days.length; i += 1) {
    const iso = days[i]!;
    if (iso < track.start) continue;
    if (end != null && iso > end) break;
    if (from < 0) from = i;
    to = i;
  }
  if (from < 0) return null;
  return { from, to };
}

const EMPTY_FIELDS = (today: string): CourseFieldsValue => ({
  name: "",
  question: "",
  when: "",
  time: "",
  weekdays: [],
  color: "",
  start: today,
  days: 14,
  ongoing: false,
  times: 1,
});

export function CourseTrackerEditor({ path, content, onChange }: Props) {
  const { doc, error } = useMemo(() => safeParse(content), [content]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [trackDialog, setTrackDialog] = useState<
    { mode: "add" } | { mode: "edit"; index: number } | null
  >(null);
  const [deleteName, setDeleteName] = useState<string | null>(null);
  const [dayIso, setDayIso] = useState<string | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const today = localIsoDate();
  usePersistedEditorScroll(scrollEl, path, "live");

  const emit = useCallback(
    (next: MdcourseDoc) => {
      onChange(serializeMdcourse(next));
    },
    [onChange],
  );

  const selectedIndex =
    selectedName == null
      ? -1
      : doc.tracks.findIndex(
          (t) => t.name.toLowerCase() === selectedName.toLowerCase(),
        );
  const selectedTrack = selectedIndex >= 0 ? doc.tracks[selectedIndex] : null;
  const deleteTrack =
    deleteName == null
      ? null
      : (doc.tracks.find((t) => t.name === deleteName) ?? null);

  const bindReorder = useListReorder(doc.tracks.length, (from, to) => {
    if (from === to) return;
    const tracks = [...doc.tracks];
    const [moved] = tracks.splice(from, 1);
    if (!moved) return;
    tracks.splice(to, 0, moved);
    emit({ ...doc, tracks });
  });

  const range = useMemo(
    () => barDateRange(doc.tracks, today),
    [doc.tracks, today],
  );
  const days = useMemo(
    () => eachIsoDay(range.from, range.to),
    [range.from, range.to],
  );
  const barTracks = useMemo(() => tracksForBar(doc.tracks), [doc.tracks]);

  const dayRows: CourseDayRow[] = useMemo(() => {
    if (!dayIso) return [];
    return doc.tracks
      .filter((t) => trackActiveOnDay(t, dayIso))
      .map((track) => ({
        name: track.name,
        question: track.question,
        when: track.when,
        time: track.time.join(" "),
        color: track.color,
        times: track.times,
        count: trackLogOnDay(track, dayIso),
      }));
  }, [dayIso, doc.tracks]);

  const fieldsInitial: CourseFieldsValue = useMemo(() => {
    if (trackDialog?.mode === "edit") {
      const t = doc.tracks[trackDialog.index];
      if (t) {
        return {
          name: t.name,
          question: t.question,
          when: t.when,
          time: t.time.join(" "),
          weekdays: t.weekdays,
          color: t.color,
          start: t.start,
          days: t.days ?? 14,
          ongoing: t.ongoing,
          times: t.times,
        };
      }
    }
    return EMPTY_FIELDS(today);
  }, [doc.tracks, today, trackDialog]);

  const showAxis = (iso: string, i: number) => isMonday(iso) || i === 0;

  const colStyle = {
    gridTemplateColumns: `repeat(${Math.max(days.length, 1)}, ${BAR_COL_PX}px)`,
    gap: `${BAR_GAP_PX}px`,
  };

  return (
    <div className="habit-tracker-column">
      <div className="habit-tracker course-tracker" ref={setScrollEl}>
        {error ? (
          <div className="course-tracker-main">
            <h2>Invalid course</h2>
            <p className="habit-tracker-aside-empty">{error}</p>
          </div>
        ) : (
          <>
            <div className="course-tracker-main">
              <div className="course-bar" role="img" aria-label="Course timeline">
                <div className="course-bar-scroll">
                  <div className="course-bar-body">
                    {barTracks.map((track) => {
                      const span = track.color
                        ? trackSpanOnBar(track, days)
                        : null;
                      return (
                      <div
                        key={track.name}
                        className="course-bar-row"
                        style={colStyle}
                      >
                        {days.map((iso) => {
                          const active = trackActiveOnDay(track, iso);
                          return (
                            <button
                              key={iso}
                              type="button"
                              className={[
                                "course-bar-cell",
                                iso === today ? "is-today" : "",
                                isMonday(iso) ? "is-week" : "",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              title={`${track.name} · ${formatDayTitle(iso)}`}
                              onClick={() => setDayIso(iso)}
                            >
                              {active
                                ? Array.from({ length: track.times }, (_, seg) => {
                                    const kind = courseSegmentKind(
                                      track,
                                      iso,
                                      seg,
                                      today,
                                    );
                                    return (
                                      <span
                                        key={seg}
                                        className={`course-bar-seg is-${kind}`}
                                      />
                                    );
                                  })
                                : (
                                    <span className="course-bar-seg is-out" />
                                  )}
                            </button>
                          );
                        })}
                        {span ? (
                          <div
                            className="course-bar-frame"
                            style={{
                              borderColor: track.color,
                              left: span.from * BAR_STRIDE_PX,
                              width:
                                (span.to - span.from + 1) * BAR_STRIDE_PX -
                                BAR_GAP_PX,
                            }}
                          />
                        ) : null}
                      </div>
                      );
                    })}
                    {barTracks.length === 0 ? (
                      <p className="habit-tracker-aside-empty">No tracks yet.</p>
                    ) : null}
                    <div className="course-bar-axis" style={colStyle}>
                      {days.map((iso, i) => (
                        <span
                          key={iso}
                          className={[
                            "course-bar-tick",
                            isMonday(iso) ? "is-week" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {showAxis(iso, i) ? formatAxisLabel(iso) : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <aside className="habit-tracker-aside">
              <div className="habit-tracker-aside-header">
                <h2>Tracks</h2>
                <button
                  type="button"
                  className="habit-tracker-add-btn"
                  title="Add track"
                  aria-label="Add track"
                  onClick={() => setTrackDialog({ mode: "add" })}
                >
                  <PlusIcon />
                </button>
              </div>
              {doc.tracks.length === 0 ? (
                <p className="habit-tracker-aside-empty">No tracks yet.</p>
              ) : (
                <ul className="habit-tracker-habit-list">
                  {doc.tracks.map((track, index) => {
                    const bind = bindReorder(index);
                    const selected = selectedTrack?.name === track.name;
                    const done = completeDaysCount(track);
                    return (
                      <li key={track.name}>
                        <div
                          className={[
                            "habit-tracker-habit",
                            selected ? "is-selected" : "",
                            bind.className,
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          draggable={bind.draggable}
                          onDragStart={bind.onDragStart}
                          onDragEnd={bind.onDragEnd}
                          onDragOver={bind.onDragOver}
                          onDragLeave={bind.onDragLeave}
                          onDrop={bind.onDrop}
                          onClick={() => {
                            if (bind.shouldIgnoreClick()) return;
                            setSelectedName(track.name);
                          }}
                        >
                          <span
                            className={
                              track.color
                                ? "habit-tracker-habit-dot"
                                : "habit-tracker-habit-dot is-none"
                            }
                            style={
                              track.color
                                ? { background: track.color }
                                : undefined
                            }
                          />
                          <span className="habit-tracker-habit-name">
                            {track.name}
                            <span className="course-track-meta">
                              {track.ongoing
                                ? "Ongoing"
                                : `${done}/${scheduledDaysCount(track)} days`}
                              {formatTrackSchedule(track)
                                ? ` · ${formatTrackSchedule(track)}`
                                : ""}
                            </span>
                          </span>
                          <button
                            type="button"
                            className="habit-tracker-habit-action"
                            title="Edit track"
                            aria-label={`Edit ${track.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setTrackDialog({ mode: "edit", index });
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                          >
                            <PencilIcon size={12} />
                          </button>
                          <button
                            type="button"
                            className="habit-tracker-habit-action is-danger"
                            title={`Delete ${track.name}`}
                            aria-label={`Delete ${track.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteName(track.name);
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                          >
                            <CloseIcon size={12} />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </aside>
          </>
        )}
      </div>

      <CourseFieldsDialog
        open={trackDialog !== null}
        mode={trackDialog?.mode === "edit" ? "edit" : "add"}
        initial={fieldsInitial}
        existingNames={doc.tracks.map((t) => t.name)}
        onCancel={() => setTrackDialog(null)}
        onConfirm={(value) => {
          const tracks = [...doc.tracks];
          const next: MdcourseTrack = {
            name: value.name,
            question: value.question,
            when: value.when,
            time: parseClockTimes(value.time),
            weekdays: value.weekdays,
            color: value.color,
            start: value.start,
            days: value.ongoing ? null : value.days,
            ongoing: value.ongoing,
            times: value.times,
            log:
              trackDialog?.mode === "edit"
                ? (tracks[trackDialog.index]?.log ?? {})
                : {},
          };
          if (trackDialog?.mode === "edit") {
            tracks[trackDialog.index] = next;
            setSelectedName(value.name);
          } else {
            tracks.push(next);
          }
          emit({ ...doc, tracks });
          setTrackDialog(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTrack)}
        title="Delete track"
        description={
          deleteTrack
            ? `Delete “${deleteTrack.name}” and all of its logged days? This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        onCancel={() => setDeleteName(null)}
        onConfirm={() => {
          if (!deleteTrack) return;
          emit({
            ...doc,
            tracks: doc.tracks.filter((t) => t.name !== deleteTrack.name),
          });
          if (selectedName === deleteTrack.name) setSelectedName(null);
          setDeleteName(null);
        }}
      />

      <CourseDayDialog
        open={dayIso !== null}
        title={dayIso ? formatDayTitle(dayIso) : ""}
        rows={dayRows}
        onCancel={() => setDayIso(null)}
        onSave={(answers) => {
          if (!dayIso) return;
          emit({
            ...doc,
            tracks: applyTrackDay(doc.tracks, dayIso, answers),
          });
          setDayIso(null);
        }}
      />
    </div>
  );
}
