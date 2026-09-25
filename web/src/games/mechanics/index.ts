// Mechanic registry. Each mechanic is a MechanicPlugin (see ../arc/plugin.ts); add new ones to
// MECHANICS in catalogue order. Rotation, the reading browser and the Play button only offer
// mechanics registered here.
import type { AnyMechanicPlugin } from '../arc/plugin';
import type { MechanicId } from '../types';
import { MECHANIC_CATALOGUE } from '../types';
import { shatter } from './shatter';
import { plugin as frameworkNavigator } from './framework-navigator';
import { plugin as attributionGrid } from './attribution-grid';
import { plugin as clozeChain } from './cloze-chain';
import { plugin as blurtBoard } from './blurt-board';
import { plugin as tableFill } from './table-fill';

const REGISTERED: AnyMechanicPlugin[] = [shatter, frameworkNavigator, attributionGrid, clozeChain, blurtBoard, tableFill];

const order = new Map(MECHANIC_CATALOGUE.map((m, i) => [m.id, i]));

/** Registered mechanics in catalogue order. */
export const MECHANICS: readonly AnyMechanicPlugin[] = [...REGISTERED].sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));

const BY_ID = new Map<MechanicId, AnyMechanicPlugin>(MECHANICS.map((m) => [m.id, m]));

export function getMechanic(id: MechanicId): AnyMechanicPlugin | undefined {
  return BY_ID.get(id);
}

export function isPlayable(id: MechanicId): boolean {
  return BY_ID.has(id);
}
