import { bilibiliChannelsStats, bilibiliLiveHeartbeat, bilibiliVideoFeeds } from "../controller";
import { logger } from "../utils/logger";

export async function handleB2Feeds(skippedUsage: any) {
    logger.info("handleB2Feeds() executing job...");
    await bilibiliVideoFeeds(skippedUsage);
}

export async function handleB2Channel(skippedUsage: any) {
    logger.info("handleB2Channel() executing job...");
    await bilibiliChannelsStats(skippedUsage);
}

export async function handleB2Live(skippedUsage: any) {
    logger.info("handleB2Live() executing job...");
    await bilibiliLiveHeartbeat(skippedUsage);
}