import { invoke } from "@tauri-apps/api/core";

export type RoutineTrigger = "schedule" | "manual" | "catchup";

export type Routine = {
  id: string;
  name: string;
  enabled: boolean;
  cron: string;
  folder: string;
  nextRunAt?: string | null;
};

export type RoutineRunFile = {
  path: string;
  at: string;
  trigger: RoutineTrigger;
};

export type RoutineSnapshot = {
  routines: Routine[];
  runningId: string | null;
  epoch: number;
};

export type RoutineRunEvent = {
  id: string;
  phase: "started" | "finished";
  epoch: number;
};

export type UpsertRoutineInput = {
  id?: string | null;
  name: string;
  cron: string;
};

export async function listRoutines(): Promise<RoutineSnapshot> {
  return invoke<RoutineSnapshot>("list_routines");
}

export async function upsertRoutine(input: UpsertRoutineInput): Promise<Routine> {
  return invoke<Routine>("upsert_routine", {
    args: {
      id: input.id ?? null,
      name: input.name,
      cron: input.cron,
    },
  });
}

export async function setRoutineEnabled(id: string, enabled: boolean): Promise<void> {
  await invoke("set_routine_enabled", { id, enabled });
}

export async function listRoutineRuns(id: string): Promise<RoutineRunFile[]> {
  return invoke<RoutineRunFile[]>("list_routine_runs", { id });
}

export async function deleteRoutineRun(id: string, path: string): Promise<void> {
  await invoke("delete_routine_run", { id, path });
}

export async function deleteRoutine(id: string): Promise<void> {
  await invoke("delete_routine", { id });
}

export async function runRoutineNow(id: string): Promise<void> {
  await invoke("run_routine_now", { id });
}
