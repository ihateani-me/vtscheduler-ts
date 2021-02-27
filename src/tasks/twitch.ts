import { ttvChannelsStats, ttvLiveHeartbeat, ttvLiveSchedules } from "../controller";
import { FiltersConfig } from "../models";
import { logger } from "../utils/logger";
import { TwitchGQL, TwitchHelix } from "../utils/twitchapi";

export class TwitchTasks {
    private isRun1: boolean
    private isRun2: boolean
    private isRun3: boolean

    filtersUsage: FiltersConfig
    ttvAPI: TwitchHelix
    ttvGQL: TwitchGQL

    constructor(ttvAPI: TwitchHelix, filtersUsage: FiltersConfig) {
        logger.info("TwitchTasks() Initializing task handler...");
        // Channels
        this.isRun1 = false;
        // Heartbeat
        this.isRun2 = false;
        // Feeds/Schedules
        this.isRun3 = false;

        this.filtersUsage = filtersUsage;
        this.ttvAPI = ttvAPI;
        this.ttvGQL = new TwitchGQL();
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

    async handleTTVSchedules() {
        if (this.isRun3) {
            logger.warn("handleTTVSchedules() there's still a running task of this, cancelling this run...");
            return;
        }
        this.isRun3 = true;
        logger.info("handleTTVSchedules() executing job...");
        try {
            await ttvLiveSchedules(this.ttvGQL, this.filtersUsage);
        } catch (e) {
            logger.error(`handleTTVSchedules() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.isRun3 = false;
    }
}