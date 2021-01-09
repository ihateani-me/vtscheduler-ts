import { ttvChannelsStats, ttvLiveHeartbeat } from "../controller";
import { FiltersConfig } from "../models";
import { logger } from "../utils/logger";
import { TwitchHelix } from "../utils/twitchapi";

export class TwitchTasks {
    private isRun1: boolean
    private isRun2: boolean

    filtersUsage: FiltersConfig
    ttvAPI: TwitchHelix

    constructor(ttvAPI: TwitchHelix, filtersUsage: FiltersConfig) {
        logger.info("TwitchTasks() Initializing task handler...");
        // Channels
        this.isRun1 = false;
        // Heartbeat
        this.isRun2 = false;

        this.filtersUsage = filtersUsage;
        this.ttvAPI = ttvAPI;
    }

    async handleTTVChannel() {
        if (this.isRun1) {
            logger.warn("handleTTVChannel() there's still a running task of this, cancelling this run...");
            return;
        }
        this.isRun1 = true;
        logger.info("handleTTVChannel() executing job...");
        try {
            await ttvChannelsStats(this.ttvAPI, this.filtersUsage);
        } catch (e) {
            logger.error(`handleTTVChannel() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.isRun1 = false;
    }

    async handleTTVLive() {
        if (this.isRun2) {
            logger.warn("handleTTVLive() there's still a running task of this, cancelling this run...");
            return;
        }
        this.isRun2 = true;
        logger.info("handleTTVLive() executing job...");
        try {
            await ttvLiveHeartbeat(this.ttvAPI, this.filtersUsage);
        } catch (e) {
            logger.error(`handleTTVLive() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.isRun2 = false;
    }
}