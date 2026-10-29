import {
    isScannerLockHeld as isScannerLockHeldInRepository,
    tryAcquireScannerLock as tryAcquireScannerLockInRepository,
} from '../repositories/scannerLockRepository';

export function isScannerLockHeld(): Promise<boolean> {
    return isScannerLockHeldInRepository();
}

export function tryAcquireScannerLock(): Promise<boolean> {
    return tryAcquireScannerLockInRepository();
}
