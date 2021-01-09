import { youtubeChannelsStats, youtubeLiveHeartbeat, youtubeVideoFeeds, youtubeVideoMissingCheck } from "../controller";
import { FiltersConfig } from "../models";
import { logger } from "../utils/logger";
import { YTRotatingAPIKey } from "../utils/ytkey_rotator";

export class YouTubeTasks {
    private isRun1: boolean
    private isRun2: boolean
    private isRun3: boolean

    filtersUsage: FiltersConfig
    ytKeys: YTRotatingAPIKey

    constructor(ytKeys: YTRotatingAPIKey, filtersUsage: FiltersConfig) {
        logger.info("YoutubeTasks() Initializing task handler...");
        // Feeds and Missing check
        this.isRun1 = false;
        // Heartbeat
        this.isRun2 = false;
        // Channels
        this.isRun3 = false;

        this.filtersUsage = filtersUsage;
        this.ytKeys = ytKeys;
    }

    async handleYTChannel() {
        if (this.isRun1) {
            logger.warn("handleYTChannel() there's still a running task of this, cancelling this run...");
            return;
        }
        this.isRun1 = true;
        logger.info("handleYTChannel() executing job...");
        try {
            await youtubeChannelsStats(this.ytKeys, this.filtersUsage);
        } catch (e) {
            logger.error(`handleYTChannel() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.isRun1 = false;
    }

    async handleYTFeeds() {
        if (this.isRun2) {
            logger.warn("handleYTFeeds() there's still a running task of this, cancelling this run...");
            return;
        }
        this.isRun2 = true;
        logger.info("handleYTFeeds() executing job...");
        try {
            await youtubeVideoFeeds(this.ytKeys, this.filtersUsage);
        } catch (e) {
            logger.error(`handleYTFeeds() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.isRun2 = false;
    }

    async handleYTMissing() {
        if (this.isRun2) {
            logger.warn("handleYTMissing() there's still a running task of this, cancelling this run...");
            return;
        }
        this.isRun2 = true;
        logger.info("handleYTMissing() executing job...");
        try {
            await youtubeVideoMissingCheck(this.ytKeys, this.filtersUsage);
        } catch (e) {
            logger.error(`handleYTMissing() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.isRun2 = false;
    }

    async handleYTLive() {
        if (this.isRun3) {
            logger.warn("handleYTLive() there's still a running task of this, cancelling this run...");
            return;
        }
        this.isRun3 = true;
        logger.info("handleYTLive() executing job...");
        try {
            await youtubeLiveHeartbeat(this.ytKeys, this.filtersUsage);
        } catch (e) {
            logger.error(`handleYTLive() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.isRun3 = false;
    }
}
