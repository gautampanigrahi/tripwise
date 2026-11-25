export type EngineInputErrorCode = 'UNKNOWN_ACTIVITY';

/** Raised for engine inputs that reference data the Catalog lacks. The handler maps it to HTTP 422. */
export class EngineInputError extends Error {
  readonly code: EngineInputErrorCode;
  readonly ref: string;

  constructor(code: EngineInputErrorCode, ref: string) {
    super(`${code}: ${ref}`);
    this.name = 'EngineInputError';
    this.code = code;
    this.ref = ref;
  }
}
