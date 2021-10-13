import { twitterChannelStats, twitterSpacesFeeds, twitterSpacesHeartbeat } from "../controller";
import { FiltersConfig } from "../models";
import { logger } from "../utils/logger";
import { TwitterAPI } from "../utils/twspaces";
import { LockKey } from "./utils";

export class TwitterTasks {
    private channelLock: LockKey;
    private liveLock: LockKey;
    private videosLock: LockKey;

    filtersUsage: FiltersConfig;
    twtAPI: TwitterAPI;

    constructor(twtAPI: TwitterAPI, filtersUsage: FiltersConfig) {
        logger.info("TwitchTasks() Initializing task handler...");
        // Feeds
        this.videosLock = new LockKey();
        // Heartbeat
        this.liveLock = new LockKey();
        // Channels
        this.channelLock = new LockKey();

        this.filtersUsage = filtersUsage;
        this.twtAPI = twtAPI;
    }

    async handleTwitterChannels() {
        const locked = this.channelLock.lock();
        if (!locked) {
            logger.warn("handleTwitterChannels() there's still a running task of this, cancelling this run...");
            return;
        }
        logger.info("handleTwitterChannels() executing job...");
        try {
            await twitterChannelStats(this.twtAPI, this.filtersUsage);
        } catch (e: any) {
            this.channelLock.unlock();
            logger.error(`handleTwitterChannels() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.channelLock.unlock();
    }

    async handleTwitterLive() {
        const locked = this.liveLock.lock();
        if (!locked) {
            logger.warn("handleTwitterLive() there's still a running task of this, cancelling this run...");
            return;
        }
        logger.info("handleTwitterLive() executing job...");
        try {
            await twitterSpacesHeartbeat(this.twtAPI, this.filtersUsage);
        } catch (e: any) {
            this.liveLock.unlock();
            logger.error(`handleTwitterLive() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.liveLock.unlock();
    }

    async handleTwitchFeeds() {
        const locked = this.videosLock.lock();
        if (!locked) {
            logger.warn("handleTwitchFeeds() there's still a running task of this, cancelling this run...");
            return;
        }
        logger.info("handleTwitchFeeds() executing job...");
        try {
            await twitterSpacesFeeds(this.twtAPI, this.filtersUsage);
        } catch (e: any) {
            this.videosLock.unlock();
            logger.error(`handleTwitchFeeds() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.videosLock.unlock();
    }
}
