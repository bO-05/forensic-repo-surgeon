export function configureDemoReasoner(liveOpus: boolean, env: NodeJS.ProcessEnv = process.env): void {
  if (!liveOpus) {
    return;
  }

  env.SURGEON_REASONER_PROVIDER = "anthropic";
  env.SURGEON_REASONER_MODEL = env.SURGEON_REASONER_MODEL || "claude-opus-4-7";

  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required for surgeon demo --live-opus. Copy .env.example to .env.local and set the key locally.");
  }
}
