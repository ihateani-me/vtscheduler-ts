import { twcastLiveHeartbeat, twcastChannelsStats } from "../controller";
import { FiltersConfig } from "../models";
import { logger } from "../utils/logger";
import { LockKey } from "./utils";

export class TwitcastingTasks {
    private channelLock: LockKey
    private liveLock: LockKey

    filtersUsage: FiltersConfig

    constructor(filtersUsage: FiltersConfig) {
        logger.info("TwitcastingTasks() Initializing task handler...");
        // Channels
        this.channelLock = new LockKey();
        // Heartbeat
        this.liveLock = new LockKey();

        this.filtersUsage = filtersUsage;
    }

    async handleTWCastChannel() {
        const locked = this.channelLock.lock();
        if (!locked) {
            logger.warn("handleTWCastChannel() there's still a running task of this, cancelling this run...");
            return;
        }
        logger.info("handleTWCastChannel() executing job...");
        try {
            await twcastChannelsStats(this.filtersUsage);
        } catch (e) {
            this.channelLock.unlock();
            logger.error(`handleTWCastChannel() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.channelLock.unlock();
    }

    async handleTWCastLive() {
        const locked = this.liveLock.lock();
        if (!locked) {
            logger.warn("handleTWCastLive() there's still a running task of this, cancelling this run...");
            return;
        }
        logger.info("handleTWCastLive() executing job...");
        try {
            await twcastLiveHeartbeat(this.filtersUsage);
        } catch (e) {
            this.liveLock.unlock();
            logger.error(`handleTWCastLive() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.liveLock.unlock();
    }
}