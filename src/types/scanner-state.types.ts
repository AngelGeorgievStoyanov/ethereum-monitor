import type { ScannerStatusState } from './scanner-status.types';

export interface ScannerRuntimeState extends ScannerStatusState {
    id: string;
    lastRescanFromBlock: number | null;
}
