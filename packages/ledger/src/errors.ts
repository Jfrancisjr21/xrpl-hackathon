export class LedgerNotReadyError extends Error {
    constructor(message: string, public opensAt: string | null) { super(message);}
}