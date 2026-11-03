import { clientEvents, EVENTS } from "@speeedy/contracts";

/**
 * What `/api/e` lets through: the registry's client events and nothing else. There is no
 * hand-written list to drift; the registry in `packages/contracts` is the only source.
 */
export const ALLOWLIST = clientEvents(EVENTS);
