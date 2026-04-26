export type PatchState = "clean" | "patched";

export type PatchStatus = {
  state: "clean" | "patched" | "conflicting" | "missing";
  canApply: boolean;
  canReverse: boolean;
};

export type TargetAdapter = {
  id: string;
  repoPath: string;
  baseUrl: string;
  start(): Promise<string>;
  stop(): Promise<string>;
  setPatchState(state: PatchState, patchPath: string): Promise<string>;
  getPatchStatus(patchPath: string): Promise<PatchStatus>;
};
