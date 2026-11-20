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

/** restart: oleadas creadas al reiniciar una salida por protocolo de lluvia. */
export type PairingSource = 'fedocr' | 'same_as_previous' | 'random' | 'manual' | 'seeded' | 'restart';

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
 * confirmed: cuenta para la clasificación · voided: anulada por protocolo de lluvia (no cuenta, se conserva).
 */
export type HeatStatus = 'pending' | 'started' | 'awaiting_confirmation' | 'confirmed' | 'voided';

/** regular: oleada de una salida · tiebreak: oleada de desempate (sus tiempos no cuentan para la clasificación). */
export type HeatKind = 'regular' | 'tiebreak';

export interface HeatNote {
  kind: 'review' | 'reopen' | 'not_finished' | 'voided';
  text: string;
  at: string;
}

export interface HeatState {
  id: string;
  categoryId: string;
  stageId: string;
  kind: HeatKind;
  /** Salida a la que pertenece. 0 en oleadas de desempate. */
  runNumber: number;
  heatNumber: number;
  status: HeatStatus;
  pairingSource: PairingSource;
  lanes: Record<Lane, LaneState | null>;
  /** Época Unix en ms en que se dio la salida. */
  startedAtMs: number | null;
  notes: HeatNote[];
  /** Solo en oleadas de desempate. */
  tiebreakId: string | null;
}

/** open: se compite · pending: espera la instancia anterior · closed: clasificados fijados. */
export type StageStatus = 'pending' | 'open' | 'closed';

export type WithdrawalReason = 'rule_violation' | 'voluntary' | 'injury' | 'other';

/** Decisión del juez sobre un empate en el corte. */
export interface TieDecision {
  /** Atletas empatados, en el orden que tenían en la clasificación. */
  registrationIds: string[];
  /** Orden decidido, del mejor al peor. */
  order: string[];
  resolution: 'direct' | 'runoff';
  tiebreakId: string | null;
  note: string;
  at: string;
}

/** Protocolo de lluvia aplicado a una salida. */
export interface RainAction {
  kind: 'restart' | 'void';
  runNumber: number;
  note: string;
  at: string;
}

/** Atleta que sube a la instancia por el retiro de un clasificado. */
export interface Promotion {
  promoted: string;
  replaced: string;
  at: string;
}

export interface StageState {
  id: string;
  categoryId: string;
  stageNumber: number;
  name: string;
  runsPerAthlete: number;
  qualifiersCount: number | null;
  status: StageStatus;
  /** Atletas (registration_id) que compiten en esta instancia, en orden de siembra. */
  entries: string[];
  /** Salidas anuladas por protocolo de lluvia (opción "anular tiempos de salida"). */
  voidedRuns: number[];
  rainActions: RainAction[];
  tieDecisions: TieDecision[];
  /** Al cerrar: orden final completo de la instancia. */
  finalOrder: string[] | null;
  /** Al cerrar: clasificados a la siguiente instancia, en orden. Vacío en la final. */
  qualified: string[] | null;
  /** Atletas que entraron a esta instancia por retiros de clasificados. */
  promotions: Promotion[];
}

export interface Withdrawal {
  registrationId: string;
  stageId: string;
  heatId: string | null;
  reason: WithdrawalReason;
  note: string;
  at: string;
}

export interface Tiebreak {
  id: string;
  stageId: string;
  registrationIds: string[];
  heatIds: string[];
  note: string;
  at: string;
  decided: boolean;
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
  tiebreaks: Record<string, Tiebreak>;
  /** Problemas de la configuración recibida de fedocrcol. */
  warnings: string[];
}

export type RunResult =
  | { kind: 'time'; ms: number }
  | { kind: 'did_not_run' }
  | { kind: 'did_not_finish' }
  | { kind: 'withdrawn' }
  | { kind: 'pending' }
  /** Salida anulada por protocolo de lluvia. `ms` conserva el tiempo que tenía, si lo tenía. */
  | { kind: 'voided'; ms: number | null };
