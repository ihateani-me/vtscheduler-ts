import { bilibiliChannelsStats, bilibiliLiveHeartbeat, bilibiliVideoFeeds } from "../controller";
import { FiltersConfig } from "../models";
import { logger } from "../utils/logger";

export class BilibiliTasks {
    private isRun1: boolean
    private isRun2: boolean
    private isRun3: boolean
    
    filtersUsage: FiltersConfig

    constructor(filtersUsage: FiltersConfig) {
        logger.info("BilibiliTasks() Initializing task handler...");
        // Feeds
        this.isRun1 = false;
        // Heartbeat
        this.isRun2 = false;
        // Channels
        this.isRun3 = false;
        this.filtersUsage = filtersUsage;
    }

    async handleB2Feeds() {
        if (this.isRun1) {
            logger.warn("handleB2Feeds() there's still a running task of this, cancelling this run...");
            return;
        }
        this.isRun1 = true;
        logger.info("handleB2Feeds() executing job...");
        try {
            await bilibiliVideoFeeds(this.filtersUsage);
        } catch (e) {
            logger.error(`handleB2Feeds() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.isRun1 = false;
    }

    async handleB2Live() {
        if (this.isRun2) {
            logger.warn("handleB2Feeds() there's still a running task of this, cancelling this run...");
            return;
        }
        this.isRun2 = true;
        logger.info("handleB2Feeds() executing job...");
        try {
            await bilibiliLiveHeartbeat(this.filtersUsage);
        } catch (e) {
            logger.error(`handleB2Feeds() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.isRun2 = false;
    }

    async handleB2Channels() {
        if (this.isRun3) {
            logger.warn("handleB2Channels() there's still a running task of this, cancelling this run...");
            return;
        }
        this.isRun3 = true;
        logger.info("handleB2Channels() executing job...");
        try {
            await bilibiliChannelsStats(this.filtersUsage);
        } catch (e) {
            logger.error(`handleB2Channels() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.isRun3 = false;
    }
}
