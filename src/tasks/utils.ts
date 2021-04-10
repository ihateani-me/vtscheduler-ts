import { logger as MainLogger } from "../utils/logger";

const logger = MainLogger.child({cls: "LockKey"});

export class LockKey {
    private locked: boolean
    private retryCount: number
    private maxCount: number

    constructor(max = 5) {
        this.locked = false;
        this.retryCount = 0;
        this.maxCount = max
    }

    /**
     * Is it locked or not
     * @returns {Boolean} status of the lock
     */
    isLocked(): boolean {
        return this.locked;
    }

    /**
     * Lock the "lock key" so no other process can use it.
     * @returns {Boolean} is the lock successfully locked or not?
     */
    lock(): boolean {
        if (this.locked) {
            if (this.retryCount > this.maxCount) {
                logger.info("Retry count reached the maximum, will force locking a new event!");
                this.retryCount = 0;
                this.locked = true;
                return true;
            }
            this.retryCount++;
            return false;
        }
        this.locked = true;
        this.retryCount = 0;
        return true;
    }

    /**
     * Unlock the locked "lock key"
     */
    unlock() {
        this.locked = false;
    }
}