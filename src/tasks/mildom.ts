import { mildomChannelsStats, mildomLiveHeartbeat } from "../controller";
import { FiltersConfig } from "../models";
import { logger } from "../utils/logger";
import { MildomAPI } from "../utils/mildomapi";
import { LockKey } from "./utils";

export class MildomTasks {
    private channelLock: LockKey
    private liveLock: LockKey

    private mildomAPI: MildomAPI

    filtersUsage: FiltersConfig

    constructor(filtersUsage: FiltersConfig) {
        logger.info("MildomTasks() Initializing task handler...");
        // Channels
        this.channelLock = new LockKey();
        // Heartbeat
        this.liveLock = new LockKey();

        this.mildomAPI = new MildomAPI();

        this.filtersUsage = filtersUsage;
    }

    async handleMildomChannel() {
        const locked = this.channelLock.lock();
        if (!locked) {
            logger.warn("handleMildomChannel() there's still a running task of this, cancelling this run...");
            return;
        }
        logger.info("handleMildomChannel() executing job...");
        try {
            await mildomChannelsStats(this.mildomAPI, this.filtersUsage);
        } catch (e: any) {
            this.channelLock.unlock();
            logger.error(`handleMildomChannel() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.channelLock.unlock();
    }

    async handleMildomLive() {
        const locked = this.liveLock.lock();
        if (!locked) {
            logger.warn("handleMildomLive() there's still a running task of this, cancelling this run...");
            return;
        }
        logger.info("handleMildomLive() executing job...");
        try {
            await mildomLiveHeartbeat(this.mildomAPI, this.filtersUsage);
        } catch (e: any) {
            this.liveLock.unlock();
            logger.error(`handleMildomLive() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.liveLock.unlock();
    }
}