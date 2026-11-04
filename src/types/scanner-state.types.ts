import type { ScannerStatusState } from './scanner-status.types';

export interface ScannerState extends ScannerStatusState {
    id: string;
    lastRescanFromBlock: number | null;
}
