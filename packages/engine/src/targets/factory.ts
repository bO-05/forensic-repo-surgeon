import { type CaseFile } from "../../../schemas/src/index.ts";
import { createCrwaTargetAdapter } from "./crwa.ts";
import { createExternalTargetAdapter } from "./external.ts";
import { type TargetAdapter } from "./types.ts";

export function createTargetAdapter(caseFile: CaseFile): TargetAdapter {
  if (caseFile.target.repo === "cypress-realworld-app") {
    return createCrwaTargetAdapter();
  }

  return createExternalTargetAdapter(caseFile);
}
