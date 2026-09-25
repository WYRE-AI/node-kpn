/** SIM Swap `retrieve-date` result. */
export interface SimSwapResult {
  /** RFC 3339 with time zone, or `null` when the API reports no SIM change. */
  latestSimChange: string | null;
}
