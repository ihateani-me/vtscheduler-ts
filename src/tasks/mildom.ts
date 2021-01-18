import { mildomChannelsStats, mildomLiveHeartbeat } from "../controller";
import { FiltersConfig } from "../models";
import { logger } from "../utils/logger";
import { MildomAPI } from "../utils/mildomapi";

export class MildomTasks {
    private isRun1: boolean
    private isRun2: boolean

    private mildomAPI: MildomAPI

    filtersUsage: FiltersConfig

    constructor(filtersUsage: FiltersConfig) {
        logger.info("MildomTasks() Initializing task handler...");
        // Channels
        this.isRun1 = false;
        // Heartbeat
        this.isRun2 = false;

        this.mildomAPI = new MildomAPI();

        this.filtersUsage = filtersUsage;
    }

    async handleMildomChannel() {
        if (this.isRun1) {
            logger.warn("handleMildomChannel() there's still a running task of this, cancelling this run...");
            return;
        }
        this.isRun1 = true;
        logger.info("handleMildomChannel() executing job...");
        try {
            await mildomChannelsStats(this.mildomAPI, this.filtersUsage);
        } catch (e) {
            logger.error(`handleMildomChannel() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.isRun1 = false;
    }

    async handleMildomLive() {
        if (this.isRun2) {
            logger.warn("handleMildomLive() there's still a running task of this, cancelling this run...");
            return;
        }
        this.isRun2 = true;
        logger.info("handleMildomLive() executing job...");
        try {
            await mildomLiveHeartbeat(this.mildomAPI, this.filtersUsage);
        } catch (e) {
            logger.error(`handleMildomLive() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.isRun2 = false;
    }
}