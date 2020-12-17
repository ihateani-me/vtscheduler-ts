import { youtubeChannelsStats, youtubeLiveHeartbeat, youtubeVideoFeeds } from "../controller";
import { logger } from "../utils/logger";
import { YTRotatingAPIKey } from "../utils/ytkey_rotator";

export async function handleYTChannel(activity: { attrs: { data: { ytKeys: YTRotatingAPIKey; skipRun: any; }; }; }) {
    let ytKeys: YTRotatingAPIKey = activity.attrs.data.ytKeys;
    let skippedUsage = activity.attrs.data.skipRun;
    logger.info("handleYTChannel() executing job...");
    await youtubeChannelsStats(ytKeys, skippedUsage);
}

export async function handleYTFeeds(activity: { attrs: { data: { ytKeys: YTRotatingAPIKey; skipRun: any; }; }; }) {
    let ytKeys: YTRotatingAPIKey = activity.attrs.data.ytKeys;
    let skippedUsage = activity.attrs.data.skipRun;
    logger.info("handleYTFeeds() executing job...");
    await youtubeVideoFeeds(ytKeys, skippedUsage);
}

export async function handleYTLive(activity: { attrs: { data: { ytKeys: YTRotatingAPIKey; skipRun: any; }; }; }) {
    let ytKeys: YTRotatingAPIKey = activity.attrs.data.ytKeys;
    let skippedUsage = activity.attrs.data.skipRun;
    logger.info("handleYTLive() executing job...");
    await youtubeLiveHeartbeat(ytKeys, skippedUsage);
}