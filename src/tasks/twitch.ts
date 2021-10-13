import { ttvChannelsStats, ttvLiveHeartbeat, ttvLiveSchedules } from "../controller";
import { FiltersConfig } from "../models";
import { logger } from "../utils/logger";
import { TwitchGQL, TwitchHelix } from "../utils/twitchapi";
import { LockKey } from "./utils";

export class TwitchTasks {
    private channelLock: LockKey;
    private liveLock: LockKey;
    private videosLock: LockKey;

    filtersUsage: FiltersConfig;
    ttvAPI: TwitchHelix;
    ttvGQL: TwitchGQL;

    constructor(ttvAPI: TwitchHelix, filtersUsage: FiltersConfig) {
        logger.info("TwitchTasks() Initializing task handler...");
        // Feeds
        this.videosLock = new LockKey();
        // Heartbeat
        this.liveLock = new LockKey();
        // Channels
        this.channelLock = new LockKey();

        this.filtersUsage = filtersUsage;
        this.ttvAPI = ttvAPI;
        this.ttvGQL = new TwitchGQL();
    }

    async handleTTVChannel() {
        const locked = this.channelLock.lock();
        if (!locked) {
            logger.warn("handleTTVChannel() there's still a running task of this, cancelling this run...");
            return;
        }
        logger.info("handleTTVChannel() executing job...");
        try {
            await ttvChannelsStats(this.ttvAPI, this.filtersUsage);
        } catch (e: any) {
            this.channelLock.unlock();
            logger.error(`handleTTVChannel() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.channelLock.unlock();
    }

    async handleTTVLive() {
        const locked = this.liveLock.lock();
        if (!locked) {
            logger.warn("handleTTVLive() there's still a running task of this, cancelling this run...");
            return;
        }
        logger.info("handleTTVLive() executing job...");
        try {
            await ttvLiveHeartbeat(this.ttvAPI, this.filtersUsage);
        } catch (e: any) {
            this.liveLock.unlock();
            logger.error(`handleTTVLive() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.liveLock.unlock();
    }

    async handleTTVSchedules() {
        const locked = this.videosLock.lock();
        if (!locked) {
            logger.warn("handleTTVSchedules() there's still a running task of this, cancelling this run...");
            return;
        }
        logger.info("handleTTVSchedules() executing job...");
        try {
            await ttvLiveSchedules(this.ttvAPI, this.filtersUsage);
        } catch (e: any) {
            this.videosLock.unlock();
            logger.error(`handleTTVSchedules() an error occured while processing the task: ${e.toString()}`);
            console.error(e);
        }
        this.videosLock.unlock();
    }
}
