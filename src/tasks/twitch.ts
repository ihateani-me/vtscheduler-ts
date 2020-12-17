import { ttvChannelsStats, ttvLiveHeartbeat } from "../controller";
import { logger } from "../utils/logger";
import { TwitchHelix } from "../utils/twitchapi";

export async function handleTTVChannel(activity: { attrs: { data: { ttvAPI: TwitchHelix; skipRun: any; }; }; }) {
    let ttvAPI: TwitchHelix = activity.attrs.data.ttvAPI;
    let skippedUsage = activity.attrs.data.skipRun;
    logger.info("handleTTVChannel() executing job...");
    await ttvChannelsStats(ttvAPI);
}

export async function handleTTVLive(activity: { attrs: { data: { ttvAPI: TwitchHelix; skipRun: any; }; }; }) {
    let ttvAPI: TwitchHelix = activity.attrs.data.ttvAPI;
    let skippedUsage = activity.attrs.data.skipRun;
    logger.info("handleTTVLive() executing job...");
    await ttvLiveHeartbeat(ttvAPI);
}