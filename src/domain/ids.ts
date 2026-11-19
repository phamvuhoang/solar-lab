/** Separate ID spaces: prj-, mdl-, off-, ins-, lin-, kit-, str-, edg-. Not derivable from content. */
export const newId = (prefix: 'prj' | 'mdl' | 'off' | 'ins' | 'lin' | 'kit' | 'str' | 'edg') => `${prefix}-${crypto.randomUUID()}`;
export const nowIso = () => new Date().toISOString();
export const newRunId = () => `run-${crypto.randomUUID()}`;
