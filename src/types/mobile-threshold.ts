export type ThresholdType =
  | 'DATA_NATIONAL_MB'
  | 'DATA_ROAMING_MB'
  | 'VOICE_NATIONAL_MIN'
  | 'VOICE_ROAMING_EUR';

/** MSM `Threshold`: a daily usage cap/alert (from `GET /contract/thresholds`). */
export interface Threshold {
  id?: number;
  name?: string;
  type?: ThresholdType;
  dailyValue?: number;
}
