import { bilibiliChannelsStats, bilibiliLiveHeartbeat, bilibiliVideoFeeds } from "../controller";
import { FiltersConfig } from "../models";
import { logger } from "../utils/logger";
import { LockKey } from "./utils";

export class BilibiliTasks {
    private channelLock: LockKey
    private liveLock: LockKey
    private videosLock: LockKey
    
    filtersUsage: FiltersConfig

    constructor(filtersUsage: FiltersConfig) {
        logger.info("BilibiliTasks() Initializing task handler...");
        // Feeds
        this.videosLock = new LockKey();
        // Heartbeat
        this.liveLock = new LockKey();
        // Channels
        this.channelLock = new LockKey();
        this.filtersUsage = filtersUsage;
    }

    async handleB2Feeds() {
        const locked = this.videosLock.lock();
        if (!locked) {
            logger.warn("handleB2Feeds() there's still a running task of this, cancelling this run...");
            return;
        }
        logger.info("handleB2Feeds() executing job...");
        try {
            await bilibiliVideoFeeds(this.filtersUsage);
        } catch (e: any) {
            this.videosLock.unlock();
            logger.error(`handleB2Feeds() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.videosLock.unlock();
    }

    async handleB2Live() {
        const locked = this.liveLock.lock();
        if (!locked) {
            logger.warn("handleB2Feeds() there's still a running task of this, cancelling this run...");
            return;
        }
        logger.info("handleB2Feeds() executing job...");
        try {
            await bilibiliLiveHeartbeat(this.filtersUsage);
        } catch (e: any) {
            this.liveLock.unlock();
            logger.error(`handleB2Feeds() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.liveLock.unlock();
    }

    async handleB2Channels() {
        const locked = this.channelLock.lock();
        if (!locked) {
            logger.warn("handleB2Channels() there's still a running task of this, cancelling this run...");
            return;
        }
        logger.info("handleB2Channels() executing job...");
        try {
            await bilibiliChannelsStats(this.filtersUsage);
        } catch (e: any) {
            this.channelLock.unlock();
            logger.error(`handleB2Channels() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.channelLock.unlock();
    }
}
