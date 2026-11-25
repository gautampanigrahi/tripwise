import type { ExplanationFacts } from './facts.js';
import { templateExplanation } from './template.js';
import { verifyGrounding } from './verify.js';

export type BedrockOutcome = { ok: true; text: string } | { ok: false; reason: string };

export interface ChosenExplanation {
  text: string;
  source: 'bedrock' | 'template';
}

/** Keeps Bedrock text only when the call succeeded and the text is grounded (Req 21.3, 21.4). */
export function chooseExplanation(bedrock: BedrockOutcome, f: ExplanationFacts): ChosenExplanation {
  if (bedrock.ok && verifyGrounding(bedrock.text, f).ok) return { text: bedrock.text, source: 'bedrock' };
  return { text: templateExplanation(f), source: 'template' };
}
