import { create } from "zustand";
import { routineTabPath, useVaultStore } from "./vaultStore";
import {
  deleteRoutine,
  listRoutines,
  runRoutineNow,
  setRoutineEnabled,
  upsertRoutine,
  type Routine,
  type RoutineRunEvent,
  type UpsertRoutineInput,
} from "../lib/routinesApi";

type RoutinesState = {
  routines: Routine[];
  runningId: string | null;
  /** Bumps when a run finishes so open routine tabs can reload their journal. */
  journalEpoch: number;
  /** 0 until the open vault's scheduler epoch has been loaded. */
  epoch: number;
  load: () => Promise<void>;
  reset: () => void;
  applyRunEvent: (event: RoutineRunEvent) => void;
  save: (input: UpsertRoutineInput) => Promise<Routine>;
  remove: (id: string) => Promise<void>;
  runNow: (id: string) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
};

let loadSeq = 0;

function sortRoutines(routines: Routine[]): Routine[] {
  return [...routines].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

export const useRoutinesStore = create<RoutinesState>((set, get) => ({
  routines: [],
  runningId: null,
  journalEpoch: 0,
  epoch: 0,

  reset: () => {
    loadSeq += 1;
    set({ routines: [], runningId: null, journalEpoch: 0, epoch: 0 });
  },

  load: async () => {
    const seq = ++loadSeq;
    const snapshot = await listRoutines();
    if (seq !== loadSeq) return;
    set((state) => {
      const eventRunning =
        state.epoch === snapshot.epoch &&
        state.runningId &&
        snapshot.routines.some((routine) => routine.id === state.runningId)
          ? state.runningId
          : null;
      const fromDisk =
        snapshot.runningId &&
        snapshot.routines.some((routine) => routine.id === snapshot.runningId)
          ? snapshot.runningId
          : null;
      return {
        routines: snapshot.routines,
        epoch: snapshot.epoch,
        runningId: eventRunning ?? fromDisk,
      };
    });
  },

  applyRunEvent: (event) => {
    const { epoch } = get();
    if (epoch === 0 || event.epoch !== epoch) return;
    if (event.phase === "started") {
      set({ runningId: event.id });
      return;
    }
    set((state) => ({
      runningId: state.runningId === event.id ? null : state.runningId,
      journalEpoch: state.journalEpoch + 1,
    }));
    void get().load();
  },

  save: async (input) => {
    const previous = input.id
      ? get().routines.find((routine) => routine.id === input.id)
      : undefined;
    const saved = await upsertRoutine(input);
    set((state) => ({
      routines: sortRoutines([
        ...state.routines.filter((routine) => routine.id !== saved.id),
        saved,
      ]),
    }));
    if (previous?.folder && saved.folder && previous.folder !== saved.folder) {
      useVaultStore.getState().remapRoutineNotePaths(previous.folder, saved.folder);
    }
    return saved;
  },

  remove: async (id) => {
    await deleteRoutine(id);
    set((state) => ({
      routines: state.routines.filter((routine) => routine.id !== id),
      runningId: state.runningId === id ? null : state.runningId,
    }));
    await useVaultStore.getState().closeTab(routineTabPath(id));
  },

  runNow: async (id) => {
    await runRoutineNow(id);
  },

  setEnabled: async (id, enabled) => {
    const previous = get().routines.find((routine) => routine.id === id)?.enabled;
    set((state) => ({
      routines: state.routines.map((routine) =>
        routine.id === id ? { ...routine, enabled } : routine,
      ),
    }));
    try {
      await setRoutineEnabled(id, enabled);
    } catch (err) {
      if (previous != null) {
        set((state) => ({
          routines: state.routines.map((routine) =>
            routine.id === id ? { ...routine, enabled: previous } : routine,
          ),
        }));
      }
      throw err;
    }
  },
}));
