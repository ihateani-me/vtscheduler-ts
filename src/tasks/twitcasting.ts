import { twcastLiveHeartbeat, twcastChannelsStats } from "../controller";
import { logger } from "../utils/logger";

export async function handleTWCastChannel(skippedUsage: any) {
    logger.info("handleTWCastChannel() executing job...");
    await twcastChannelsStats(skippedUsage);
}

export async function handleTWCastLive(skippedUsage: any) {
    logger.info("handleTWCastLive() executing job...");
    await twcastLiveHeartbeat(skippedUsage);
}