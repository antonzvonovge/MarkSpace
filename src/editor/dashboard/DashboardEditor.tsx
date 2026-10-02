import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MdChevronLeft } from "react-icons/md";
import GridLayout, {
  useContainerWidth,
  verticalCompactor,
  type Layout,
} from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import {
  applyGridLayout,
  parseDashboard,
  pickDashboardColor,
  placeRoutineWidget,
  removeWidget,
  serializeDashboard,
  type DashboardDoc,
} from "../../lib/dashboardFormat";
import { useDashboardColorStore } from "../../store/dashboardColorStore";
import { useRoutinesStore } from "../../store/routinesStore";
import { RoutineColorIcon, routineIconColor } from "../../components/routineIcon";
import { PlusIcon } from "../../components/treeIcons";
import { RoutineWidget } from "./RoutineWidget";

const ROW_HEIGHT = 32;

type Props = {
  path: string;
  content: string;
  onChange: (next: string) => void;
};

function sameLayout(a: Layout | null, b: Layout): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) return false;
    if (
      left.i !== right.i ||
      left.x !== right.x ||
      left.y !== right.y ||
      left.w !== right.w ||
      left.h !== right.h
    ) {
      return false;
    }
  }
  return true;
}

function toLayout(doc: DashboardDoc): Layout {
  return doc.widgets.map((widget) => ({
    i: widget.id,
    x: widget.x,
    y: widget.y,
    w: widget.w,
    h: widget.h,
    minW: 3,
    minH: 2,
  }));
}

function newWidgetId(): string {
  return `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const AddWidgetButton = memo(function AddWidgetButton({
  doc,
  onChange,
}: {
  doc: DashboardDoc;
  onChange: (next: string) => void;
}) {
  const routines = useRoutinesStore((s) => s.routines);
  const [open, setOpen] = useState(false);
  const [routinesOpen, setRoutinesOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setRoutinesOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div className="dashboard-add" ref={rootRef}>
      <button
        type="button"
        className="dashboard-add-btn"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          setRoutinesOpen(false);
        }}
      >
        <PlusIcon />
        Add widget
      </button>
      {open ? (
        <div className="dashboard-add-menu" role="menu">
          <div
            className="dashboard-add-subwrap"
            onMouseEnter={() => setRoutinesOpen(true)}
            onMouseLeave={() => setRoutinesOpen(false)}
          >
            <button
              type="button"
              role="menuitem"
              className="dashboard-add-item"
              aria-expanded={routinesOpen}
              onClick={() => setRoutinesOpen((value) => !value)}
            >
              Routine
              <MdChevronLeft size={16} className="dashboard-add-chevron" />
            </button>
            {routinesOpen ? (
              <div className="dashboard-add-submenu" role="menu">
                {routines.length === 0 ? (
                  <p className="dashboard-add-empty">No routines yet</p>
                ) : (
                  routines.map((routine) => (
                    <button
                      key={routine.id}
                      type="button"
                      role="menuitem"
                      className="dashboard-add-item"
                      onClick={() => {
                        setOpen(false);
                        setRoutinesOpen(false);
                        const next = placeRoutineWidget(doc, routine.id, newWidgetId());
                        onChange(serializeDashboard(next));
                      }}
                    >
                      <span
                        className="dashboard-add-routine-icon"
                        style={{ color: routineIconColor(routine.id) }}
                      >
                        <RoutineColorIcon />
                      </span>
                      <span className="dashboard-add-label">{routine.name}</span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
});

const WidgetSlot = memo(function WidgetSlot({
  id,
  routineId,
  onRemove,
}: {
  id: string;
  routineId: string;
  onRemove: (id: string) => void;
}) {
  const remove = useCallback(() => onRemove(id), [onRemove, id]);
  return <RoutineWidget routineId={routineId} onRemove={remove} />;
});

const DashboardCanvas = memo(function DashboardCanvas({
  doc,
  onChange,
}: {
  doc: DashboardDoc;
  onChange: (next: string) => void;
}) {
  const { width: measured, containerRef, mounted } = useContainerWidth({
    measureBeforeMount: true,
  });
  const stableWidth = useRef(0);
  if (measured > 0) stableWidth.current = measured;
  const width = measured > 0 ? measured : stableWidth.current;
  const committed = useMemo(() => toLayout(doc), [doc]);
  const [live, setLive] = useState<Layout | null>(null);
  const interacting = useRef(false);
  const onChangeRef = useRef(onChange);
  const docRef = useRef(doc);
  onChangeRef.current = onChange;
  docRef.current = doc;

  useEffect(() => {
    setLive(null);
  }, [doc]);

  const removeWidgetById = useCallback((id: string) => {
    onChangeRef.current(serializeDashboard(removeWidget(docRef.current, id)));
  }, []);

  const commit = (next: Layout) => {
    interacting.current = false;
    setLive(next);
    const current = docRef.current;
    const serialized = serializeDashboard(applyGridLayout(current, next));
    if (serialized !== serializeDashboard(current)) onChangeRef.current(serialized);
  };

  return (
    <div className="dashboard-editor">
      <div className="dashboard-toolbar">
        <AddWidgetButton doc={doc} onChange={onChange} />
      </div>
      <div className="dashboard-grid-host" ref={containerRef}>
        {mounted && width > 0 && doc.widgets.length > 0 ? (
          <GridLayout
            className="dashboard-grid"
            width={width}
            layout={live ?? committed}
            gridConfig={{
              cols: doc.cols,
              rowHeight: ROW_HEIGHT,
              margin: [8, 8] as const,
              containerPadding: [12, 12] as const,
            }}
            dragConfig={{
              enabled: true,
              handle: ".dashboard-widget-handle",
              cancel: "button, a",
            }}
            resizeConfig={{ enabled: true, handles: ["se"] }}
            compactor={verticalCompactor}
            onDragStart={() => {
              interacting.current = true;
            }}
            onResizeStart={() => {
              interacting.current = true;
            }}
            onLayoutChange={(next) => {
              if (!interacting.current) return;
              setLive((current) => (sameLayout(current, next) ? current : next));
            }}
            onDragStop={commit}
            onResizeStop={commit}
          >
            {doc.widgets.map((widget) => (
              <div key={widget.id}>
                <WidgetSlot
                  id={widget.id}
                  routineId={widget.routineId}
                  onRemove={removeWidgetById}
                />
              </div>
            ))}
          </GridLayout>
        ) : mounted && width > 0 ? (
          <p className="dashboard-empty">Add a widget to show a routine report.</p>
        ) : null}
      </div>
    </div>
  );
});

export const DashboardEditor = memo(function DashboardEditor({
  path,
  content,
  onChange,
}: Props) {
  const parsed = useMemo(() => {
    try {
      return { doc: parseDashboard(content), error: null as string | null };
    } catch (err) {
      return {
        doc: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [content]);
  const pendingColor = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    pendingColor.current = null;
  }, [path]);

  useEffect(() => {
    const doc = parsed.doc;
    if (!doc) return;
    if (doc.color) {
      pendingColor.current = null;
      useDashboardColorStore.getState().note(path, doc.color);
      return;
    }
    if (pendingColor.current) return;
    const color =
      useDashboardColorStore.getState().byPath[path] || pickDashboardColor();
    pendingColor.current = color;
    useDashboardColorStore.getState().note(path, color);
    onChangeRef.current(serializeDashboard({ ...doc, color }));
  }, [path, parsed.doc]);

  if (!parsed.doc) {
    return <p className="dashboard-error">{parsed.error}</p>;
  }
  return <DashboardCanvas doc={parsed.doc} onChange={onChange} />;
});
