import type { Timestamp } from "../../domain/shared/time";

export interface Clock {
  now(): Timestamp;
}
