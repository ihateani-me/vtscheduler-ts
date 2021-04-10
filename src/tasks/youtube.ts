import { youtubeChannelsStats, youtubeLiveHeartbeat, youtubeVideoFeeds, youtubeVideoMissingCheck } from "../controller";
import { FiltersConfig } from "../models";
import { logger } from "../utils/logger";
import { YTRotatingAPIKey } from "../utils/ytkey_rotator";
import { LockKey } from "./utils";

export class YouTubeTasks {
    private channelLock: LockKey
    private liveLock: LockKey
    private videosLock: LockKey
    private missingLock: LockKey

    filtersUsage: FiltersConfig
    ytKeys: YTRotatingAPIKey

    constructor(ytKeys: YTRotatingAPIKey, filtersUsage: FiltersConfig) {
        logger.info("YoutubeTasks() Initializing task handler...");
        // Feeds
        this.videosLock = new LockKey();
        // Heartbeat
        this.liveLock = new LockKey();
        // Channels
        this.channelLock = new LockKey();
        // Missing
        this.missingLock = new LockKey();

        this.filtersUsage = filtersUsage;
        this.ytKeys = ytKeys;
    }

    async handleYTChannel() {
        const locked = this.channelLock.lock();
        if (!locked) {
            logger.warn("handleYTChannel() there's still a running task of this, cancelling this run...");
            return;
        }
        logger.info("handleYTChannel() executing job...");
        try {
            await youtubeChannelsStats(this.ytKeys, this.filtersUsage);
        } catch (e) {
            this.channelLock.unlock();
            logger.error(`handleYTChannel() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.channelLock.unlock();
    }

    async handleYTFeeds() {
        const locked = this.videosLock.lock();
        if (!locked) {
            logger.warn("handleYTFeeds() there's still a running task of this, cancelling this run...");
            return;
        }
        logger.info("handleYTFeeds() executing job...");
        try {
            await youtubeVideoFeeds(this.ytKeys, this.filtersUsage);
        } catch (e) {
            this.videosLock.unlock();
            logger.error(`handleYTFeeds() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.videosLock.unlock();
    }

    async handleYTMissing() {
        const locked = this.missingLock.lock();
        if (!locked) {
            logger.warn("handleYTMissing() there's still a running task of this, cancelling this run...");
            return;
        }
        logger.info("handleYTMissing() executing job...");
        try {
            await youtubeVideoMissingCheck(this.ytKeys, this.filtersUsage);
        } catch (e) {
            this.missingLock.unlock();
            logger.error(`handleYTMissing() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.missingLock.unlock();
    }

    async handleYTLive() {
        const locked = this.liveLock.lock();
        if (!locked) {
            logger.warn("handleYTLive() there's still a running task of this, cancelling this run...");
            return;
        }
        logger.info("handleYTLive() executing job...");
        try {
            await youtubeLiveHeartbeat(this.ytKeys, this.filtersUsage);
        } catch (e) {
            this.liveLock.unlock();
            logger.error(`handleYTLive() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.liveLock.unlock();
    }
}
