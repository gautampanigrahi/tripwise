import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { buildPrompt, chooseExplanation, toFacts, type BedrockOutcome, type ChosenExplanation } from '@tripwise/grounding';
import { log, metrics, MetricUnit } from '../lib/logging.js';
import { createDynamoRepos } from '../repos/dynamo/index.js';
import type { CheckRef, Repos } from '../repos/interfaces.js';

/**
 * explain-fn (Req 21). Invoked directly by checks-fn with the saved Check_Result's key:
 * `{ tripId, runAt, checkId }`. Returns the stored `{ text, source }`.
 */
export type ExplainEvent = CheckRef;

// The Lambda timeout is 10 s, so stop waiting for Bedrock at 8 s and still store the template.
const BEDROCK_TIMEOUT_MS = 8_000;

const bedrock = new BedrockRuntimeClient({});
let repos: Repos | undefined;

async function callBedrock(system: string, user: string): Promise<BedrockOutcome> {
  try {
    const res = await bedrock.send(
      new ConverseCommand({
        modelId: process.env.MODEL_ID,
        system: [{ text: system }],
        messages: [{ role: 'user', content: [{ text: user }] }],
        inferenceConfig: { maxTokens: 300, temperature: 0 },
      }),
      { abortSignal: AbortSignal.timeout(BEDROCK_TIMEOUT_MS) },
    );
    const text = res.output?.message?.content?.map((c) => c.text ?? '').join('') ?? '';
    return text ? { ok: true, text } : { ok: false, reason: 'EMPTY_RESPONSE' };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.name : 'BEDROCK_ERROR' };
  }
}

export const handler = async (event: ExplainEvent): Promise<ChosenExplanation> => {
  repos ??= createDynamoRepos();
  const result = await repos.checkResults.get(event);
  if (!result) throw new Error('Check_Result not found');

  const facts = toFacts(result);
  const { system, user } = buildPrompt(facts);
  const outcome = await callBedrock(system, user);
  const chosen = chooseExplanation(outcome, facts);

  if (chosen.source === 'template') {
    log.warn('explanation', { event: 'EXPLANATION_FALLBACK', reason: outcome.ok ? 'UNGROUNDED' : outcome.reason });
    metrics.addMetric('TemplateFallbackCount', MetricUnit.Count, 1);
    metrics.publishStoredMetrics();
  }

  await repos.checkResults.setExplanation(event, chosen.text, chosen.source);
  return chosen;
};
