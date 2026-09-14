import { createContext, useContext } from "react";

export interface FieldEditAccess {
  canMutate(): boolean;
  canRequest: boolean;
  requestEdit(): Promise<boolean>;
  deactivateCandidate?(fieldId: string): void;
  storeCandidate?(fieldId: string, candidate: { text: string; doc?: unknown } | null): void;
}
export const ScenarioAccessContext = createContext<FieldEditAccess | null>(null);
export const useFieldEditAccess = () => useContext(ScenarioAccessContext);
