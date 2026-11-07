export const SCHEMA_VERSION = 1 as const;

export type Id = string;
export type Header = {
  schemaVersion: typeof SCHEMA_VERSION;
  simulationId: Id;
};
