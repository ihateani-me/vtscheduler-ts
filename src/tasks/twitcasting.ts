import { twcastLiveHeartbeat, twcastChannelsStats } from "../controller";
import { FiltersConfig } from "../models";
import { logger } from "../utils/logger";

export class TwitcastingTasks {
    private isRun1: boolean
    private isRun2: boolean

    filtersUsage: FiltersConfig

    constructor(filtersUsage: FiltersConfig) {
        logger.info("TwitcastingTasks() Initializing task handler...");
        // Channels
        this.isRun1 = false;
        // Heartbeat
        this.isRun2 = false;

        this.filtersUsage = filtersUsage;
    }

    async handleTWCastChannel() {
        if (this.isRun1) {
            logger.warn("handleTWCastChannel() there's still a running task of this, cancelling this run...");
            return;
        }
        this.isRun1 = true;
        logger.info("handleTWCastChannel() executing job...");
        try {
            await twcastChannelsStats(this.filtersUsage);
        } catch (e) {
            logger.error(`handleTWCastChannel() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.isRun1 = false;
    }

    async handleTWCastLive() {
        if (this.isRun2) {
            logger.warn("handleTWCastLive() there's still a running task of this, cancelling this run...");
            return;
        }
        this.isRun2 = true;
        logger.info("handleTWCastLive() executing job...");
        try {
            await twcastLiveHeartbeat(this.filtersUsage);
        } catch (e) {
            logger.error(`handleTWCastLive() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.isRun2 = false;
    }
}