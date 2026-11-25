export type { StayInput, ItineraryStop, EngineInput, EngineOutput } from './types.js';
export { EngineInputError, type EngineInputErrorCode } from './errors.js';
export { costCheck } from './checks/cost.js';
export { capacityCheck } from './checks/capacity.js';
export { datesCheck } from './checks/dates.js';
export { scheduleCheck } from './checks/schedule.js';
export { feasibilityScore, scoreLabel } from './score.js';
export {
  runChecks,
  normalizeInput,
  CHECK_ORDER,
  REQUIRED_CHECKS,
  OPTIONAL_CHECKS,
  type CheckContext,
  type OptionalCheck,
} from './runChecks.js';
export { selectCurrentLodging, stayFromLodging } from './lodging.js';
export { buildAlternativeInput } from './alternatives.js';
