export const isRecord = (arg: unknown): arg is Record<string, unknown> =>
    !!arg && typeof arg === 'object' && !Array.isArray(arg);

export const isString = (arg: unknown): arg is string => typeof arg === 'string';

export const isError = (error: unknown): error is Error => error instanceof Error;
