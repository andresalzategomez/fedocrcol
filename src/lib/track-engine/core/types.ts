/**
 * Tipos del motor de reglas. El motor es puro: no usa red, interfaz ni almacenamiento.
 * Reglas: context/reglas-negocio.md
 */

export type Lane = 'left' | 'right';

export interface AthleteInfo {
  registrationId: string;
  bib: string;
  name: string;
}

export interface StageConfig {
  id: string;
  stageNumber: number;
  name: string;
  runsPerAthlete: number;
  /** null en la final. */
  qualifiersCount: number | null;
}

export interface CategoryConfig {
  id: string;
  name: string;
  stages: StageConfig[];
  athletes: AthleteInfo[];
}

/** Oleada inicial que llega desde fedocrcol (instancia 1, salida 1). */
export interface InitialHeat {
  id: string;
  stageId: string;
  runNumber: number;
  heatNumber: number;
  left: string;
  right: string | null;
}

export interface RaceConfig {
  raceId: string;
  categories: CategoryConfig[];
  initialHeats: InitialHeat[];
}

export type PairingSource = 'fedocr' | 'same_as_previous' | 'random' | 'manual' | 'seeded';

export type LaneOutcome = 'pending' | 'time' | 'did_not_run' | 'did_not_finish' | 'withdrawn';

export interface LaneState {
  registrationId: string;
  outcome: LaneOutcome;
  /** Tiempo de la salida en milisegundos, solo si outcome = 'time'. */
  elapsedMs: number | null;
  /** 1 = llegó primero. */
  arrivalOrder: number | null;
}

/**
 * pending: preparada · started: en pista · awaiting_confirmation: todos resueltos, falta confirmar ·
 * confirmed: cuenta para la clasificación.
 */
export type HeatStatus = 'pending' | 'started' | 'awaiting_confirmation' | 'confirmed';

export interface HeatNote {
  kind: 'review' | 'reopen' | 'not_finished';
  text: string;
  at: string;
}

export interface HeatState {
  id: string;
  categoryId: string;
  stageId: string;
  runNumber: number;
  heatNumber: number;
  status: HeatStatus;
  pairingSource: PairingSource;
  lanes: Record<Lane, LaneState | null>;
  /** Época Unix en ms en que se dio la salida. */
  startedAtMs: number | null;
  notes: HeatNote[];
}

/** open: se compite · pending: espera la instancia anterior · closed: clasificados fijados (fase 6). */
export type StageStatus = 'pending' | 'open' | 'closed';

export interface StageState {
  id: string;
  categoryId: string;
  stageNumber: number;
  name: string;
  runsPerAthlete: number;
  qualifiersCount: number | null;
  status: StageStatus;
  /** Atletas (registration_id) que compiten en esta instancia. */
  entries: string[];
}

export type WithdrawalReason = 'rule_violation' | 'voluntary' | 'injury' | 'other';

export interface Withdrawal {
  registrationId: string;
  stageId: string;
  heatId: string | null;
  reason: WithdrawalReason;
  note: string;
  at: string;
}

export interface RaceState {
  config: RaceConfig;
  started: boolean;
  finished: boolean;
  /** Oleada que ocupa la pista: en curso o esperando confirmación. Máximo una. */
  activeHeatId: string | null;
  stages: Record<string, StageState>;
  heats: Record<string, HeatState>;
  /** Orden de creación de las oleadas. */
  heatOrder: string[];
  withdrawals: Record<string, Withdrawal>;
  /** Problemas de la configuración recibida de fedocrcol. */
  warnings: string[];
}

export type RunResult =
  | { kind: 'time'; ms: number }
  | { kind: 'did_not_run' }
  | { kind: 'did_not_finish' }
  | { kind: 'withdrawn' }
  | { kind: 'pending' };
