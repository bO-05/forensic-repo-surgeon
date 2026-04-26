import { z } from "zod";

export const ViewportSchema = z.object({
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  isMobile: z.boolean().default(false),
});

export const AuthSchema = z.object({
  mode: z.enum(["none", "storageState", "ui"]),
  storageStatePath: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  notes: z.string().optional(),
});

export const TargetLifecycleSchema = z.object({
  cwd: z.string().optional(),
  setupCommand: z.array(z.string()).min(1).optional(),
  startCommand: z.array(z.string()).min(1).optional(),
  stopCommand: z.array(z.string()).min(1).optional(),
  applyPatchCommand: z.array(z.string()).min(1).optional(),
  reversePatchCommand: z.array(z.string()).min(1).optional(),
  readyUrl: z.string().url().optional(),
  readyTimeoutMs: z.number().int().positive().optional(),
}).optional();

export const TargetSchema = z.object({
  repo: z.string(),
  stack: z.string(),
  baseUrl: z.string().url(),
  lifecycle: TargetLifecycleSchema,
});

export const InputSchema = z.object({
  screenshotPath: z.string(),
  note: z.string(),
});

export const ReproSchema = z.object({
  steps: z.array(z.string()).min(1),
});

export const ArtifactsSchema = z.object({
  directory: z.string(),
});

export const VerificationSchema = z.object({
  mustPass: z.array(z.string()).min(1),
  assertions: z.array(z.discriminatedUnion("type", [
    z.object({
      type: z.literal("visible"),
      name: z.string(),
      selector: z.string(),
    }),
    z.object({
      type: z.literal("insideViewport"),
      name: z.string(),
      selector: z.string(),
    }),
    z.object({
      type: z.literal("topWithin"),
      name: z.string(),
      selector: z.string(),
      maxY: z.number().nonnegative(),
    }),
    z.object({
      type: z.literal("widthAtLeast"),
      name: z.string(),
      selector: z.string(),
      minWidth: z.number().nonnegative(),
    }),
    z.object({
      type: z.literal("noOverlap"),
      name: z.string(),
      targetSelector: z.string(),
      blockerSelector: z.string(),
    }),
    z.object({
      type: z.literal("noHorizontalOverflow"),
      name: z.string(),
    }),
    z.object({
      type: z.literal("noConsoleRegression"),
      name: z.string(),
    }),
  ])).optional(),
  negativeControl: z.object({
    artifact: z.string().default("before-verify.json"),
    expectedFailures: z.array(z.string()).min(1),
  }).optional(),
});

export const CaseFileSchema = z.object({
  id: z.string(),
  title: z.string(),
  target: TargetSchema,
  workflow: z.enum(["open-route", "custom-script", "crwa-mobile-date-range-drawer", "crwa-mobile-onboarding-dialog"]).default("open-route"),
  workflowScript: z.string().optional(),
  route: z.string(),
  viewport: ViewportSchema,
  auth: AuthSchema,
  input: InputSchema,
  repro: ReproSchema,
  artifacts: ArtifactsSchema,
  verification: VerificationSchema,
});

export const ArtifactManifestSchema = z.object({
  caseId: z.string(),
  status: z.enum(["planned", "captured", "failing", "passing"]),
  files: z.record(z.string(), z.string()),
});

export const VerificationAssertionSchema = z.object({
  name: z.string(),
  pass: z.boolean(),
  expected: z.string(),
  actual: z.unknown(),
});

export const VerificationResultSchema = z.object({
  caseId: z.string(),
  status: z.enum(["passing", "failing"]),
  checkedAt: z.string(),
  screenshot: z.string().optional(),
  assertions: z.array(VerificationAssertionSchema),
  negativeControl: z.object({
    status: z.enum(["passing", "failing"]),
    expectedFailures: z.array(z.string()),
    actualFailures: z.array(z.string()),
    matchedExpectedFailures: z.array(z.string()),
    missingExpectedFailures: z.array(z.string()),
    additionalFailures: z.array(z.string()),
  }).optional(),
  error: z.string().optional(),
}).passthrough();

export const ProofScorecardSchema = z.object({
  caseId: z.string(),
  generatedAt: z.string(),
  status: z.enum(["passing", "failing"]),
  score: z.number(),
  metrics: z.object({
    artifactCompletenessRatio: z.number().optional(),
    verificationPassRate: z.number().optional(),
    patchTouchesTopCandidate: z.boolean().optional(),
    negativeControlPassed: z.boolean().optional(),
    reasonerProvider: z.string().optional(),
    doctorStatus: z.string().optional(),
    runStatus: z.string().optional(),
    cleanupSucceeded: z.boolean().optional(),
  }).passthrough(),
  gates: z.record(z.boolean()),
}).passthrough();

export const EvaluationAcceptanceBarSchema = z.object({
  id: z.string(),
  description: z.string(),
  minimumArtifactProofCases: z.number().int().nonnegative(),
  minimumTargets: z.number().int().nonnegative(),
  minimumBugClasses: z.number().int().nonnegative(),
  requireNegativeControls: z.boolean(),
});

export const EvaluationCaseSchema = z.object({
  id: z.string(),
  casePath: z.string(),
  target: z.string(),
  bugClass: z.string(),
  minimumAssertions: z.number().int().nonnegative(),
  requiredAssertions: z.array(z.string()),
  negativeControlArtifact: z.string().optional(),
});

export const EvaluationManifestSchema = z.object({
  id: z.string(),
  version: z.string(),
  mission: z.string(),
  acceptanceBars: z.array(EvaluationAcceptanceBarSchema).min(1),
  requiredArtifacts: z.array(z.string()).min(1),
  cases: z.array(EvaluationCaseSchema).min(1),
  knownGaps: z.array(z.string()).optional(),
});

export type CaseFile = z.infer<typeof CaseFileSchema>;
export type ArtifactManifest = z.infer<typeof ArtifactManifestSchema>;
export type VerificationAssertionContract = NonNullable<z.infer<typeof VerificationSchema>["assertions"]>[number];
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
export type ProofScorecard = z.infer<typeof ProofScorecardSchema>;
export type EvaluationManifest = z.infer<typeof EvaluationManifestSchema>;
export type EvaluationCase = z.infer<typeof EvaluationCaseSchema>;
export type EvaluationAcceptanceBar = z.infer<typeof EvaluationAcceptanceBarSchema>;
