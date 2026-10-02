import { invoke } from "@tauri-apps/api/core";

export type RoutineTrigger = "schedule" | "manual" | "catchup";

export type RoutineAttachmentRef = {
  id: string;
  name: string;
  mediaType: string;
  kind: string;
  path: string;
};

export type Routine = {
  id: string;
  name: string;
  enabled: boolean;
  cron: string;
  folder: string;
  nextRunAt?: string | null;
  brief?: string;
  projectPath?: string;
  /** Empty means agent. */
  mode?: string;
  modelId?: string;
  /** Empty means auto. */
  reasoningMode?: string;
  specialistModelId?: string;
  specialistsUseChatModel?: boolean;
  attachments?: RoutineAttachmentRef[];
};

export type RoutineRunFile = {
  path: string;
  at: string;
  trigger: RoutineTrigger;
  status: string;
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
  /** Omit or null to keep the stored brief. */
  brief?: string | null;
  projectPath?: string | null;
  mode?: string | null;
  modelId?: string | null;
  reasoningMode?: string | null;
  specialistModelId?: string | null;
  specialistsUseChatModel?: boolean | null;
  attachments?: RoutineAttachmentRef[] | null;
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
      brief: input.brief ?? null,
      projectPath: input.projectPath ?? null,
      mode: input.mode ?? null,
      modelId: input.modelId ?? null,
      reasoningMode: input.reasoningMode ?? null,
      specialistModelId: input.specialistModelId ?? null,
      specialistsUseChatModel: input.specialistsUseChatModel ?? null,
      attachments: input.attachments ?? null,
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

export async function completeRoutineRun(input: {
  id: string;
  epoch: number;
  status: "done" | "needs you" | "failed";
  body: string;
}): Promise<void> {
  await invoke("complete_routine_run", { args: input });
}
