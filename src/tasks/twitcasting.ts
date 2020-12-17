import { twcastLiveHeartbeat, twcastChannelsStats } from "../controller";
import { logger } from "../utils/logger";

export async function handleTWCastChannel(activity: { attrs: { data: { skipRun: any; }; }; }) {
    let skippedUsage = activity.attrs.data.skipRun;
    logger.info("handleTWCastChannel() executing job...");
    await twcastChannelsStats();
}

export async function handleTWCastLive(activity: { attrs: { data: { skipRun: any; }; }; }) {
    let skippedUsage = activity.attrs.data.skipRun;
    logger.info("handleTWCastLive() executing job...");
    await twcastLiveHeartbeat();
}