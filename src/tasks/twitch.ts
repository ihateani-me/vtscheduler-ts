import { ttvChannelsStats, ttvLiveHeartbeat } from "../controller";
import { logger } from "../utils/logger";
import { TwitchHelix } from "../utils/twitchapi";

export async function handleTTVChannel(ttvAPI: TwitchHelix, skippedUsage: any) {
    logger.info("handleTTVChannel() executing job...");
    await ttvChannelsStats(ttvAPI, skippedUsage);
}

export async function handleTTVLive(ttvAPI: TwitchHelix, skippedUsage: any) {
    logger.info("handleTTVLive() executing job...");
    await ttvLiveHeartbeat(ttvAPI, skippedUsage);
}