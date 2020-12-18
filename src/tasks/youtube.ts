import { youtubeChannelsStats, youtubeLiveHeartbeat, youtubeVideoFeeds } from "../controller";
import { logger } from "../utils/logger";
import { YTRotatingAPIKey } from "../utils/ytkey_rotator";

export async function handleYTChannel(ytKeys: YTRotatingAPIKey, skippedUsage: any) {
    logger.info("handleYTChannel() executing job...");
    await youtubeChannelsStats(ytKeys, skippedUsage);
}

export async function handleYTFeeds(ytKeys: YTRotatingAPIKey, skippedUsage: any) {
    logger.info("handleYTFeeds() executing job...");
    await youtubeVideoFeeds(ytKeys, skippedUsage);
}

export async function handleYTLive(ytKeys: YTRotatingAPIKey, skippedUsage: any) {
    logger.info("handleYTLive() executing job...");
    await youtubeLiveHeartbeat(ytKeys, skippedUsage);
}