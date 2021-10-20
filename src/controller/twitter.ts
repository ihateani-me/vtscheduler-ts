import _ from "lodash";
import { DateTime } from "luxon";

import { logger } from "../utils/logger";
import { isNone, NullableOr } from "../utils/swissknife";
import { TwitterAPI } from "../utils/twspaces";

import {
    FiltersConfig,
    VideosData,
    VideoProps,
    ChannelsData,
    ChannelsProps,
    ChannelStatsHistData,
    ViewersData,
    HistoryMap,
} from "../models";

function bestProfilePicture(url: string): string {
    if (isNone(url)) {
        return "";
    }
    // remove anything after the picture ID.
    // format: https://pbs.twimg.com/profile_images/xxxxxxxxxxxxx/pictureId_whatever.jpg
    const splitIdx = url.lastIndexOf("_");
    if (splitIdx < 40) {
        return url;
    }
    const extIdx = url.lastIndexOf(".");
    const firstPart = url.substring(0, splitIdx);
    const extension = url.substring(extIdx);
    return firstPart + extension;
}

export async function twitterSpacesHeartbeat(twtApi: TwitterAPI, filtersRun: FiltersConfig) {
    logger.info("twitterSpacesHeartbeat() fetching channels and videos data...");
    let video_sets = await VideosData.filteredFind(filtersRun["exclude"], filtersRun["include"], undefined, [
        { platform: { $eq: "twitter" } },
    ]);
    const allActiveVideo = video_sets.filter((res) => res.status !== "past");
    const allActiveVideoIds = allActiveVideo.map((video) => {
        return video.id;
    })
    if (allActiveVideoIds.length < 1) {
        logger.warn("twitterSpacesHeartbeat() no active videos, skipping run");
        return;
    }

    let channels = await ChannelsData.filteredFind(
        filtersRun["exclude"],
        filtersRun["include"],
        { id: 1, user_id: 1, group: 1, thumbnail: 1 },
        [{ platform: { $eq: "twitter" } }, { is_retired: { $eq: false } }]
    );
    if (channels.length < 1) {
        logger.warn("twitterSpacesHeartbeat() no registered channels");
        return;
    }

    logger.info("twitterSpacesHeartbeat() fetching to API...");
    const twSpacesResult = await twtApi.fetchSpaces(allActiveVideoIds);
    const spacesResults = twSpacesResult.spaces;
    let updatedData: VideoProps[] = [];
    for (let i = 0; i < spacesResults.length; i++) {
        const result = spacesResults[i];

        const spaceStatus = result.state;
        const publishedAt = DateTime.fromISO(result.created_at);
        const creatorId = result.creator_id;
        const channelMap = _.find(channels, { user_id: creatorId });
        if (isNone(channelMap)) {
            logger.warn(`twitterSpacesHeartbeat() channel ${creatorId} not found`);
            continue;
        }

        let startTime: NullableOr<number> = null;
        if (typeof result.started_at === "string") {
            startTime = Math.floor(DateTime.fromISO(result.started_at).toSeconds());
        }
        const oldMappings = _.find(video_sets, { id: result.id });

        const currentView = result.participant_count ?? 0;
        let peakViewers = _.get(oldMappings, "peakViewers", currentView);
        if (currentView > peakViewers) {
            peakViewers = currentView;
        }

        const timeMapping: {[key: string]: any} = {
            startTime,
            endTime: null,
            duration: null,
            publishedAt: result.created_at,
            scheduledStartTime: null,
            lateTime: null,
        }
        let startSchedule = Math.floor(publishedAt.toSeconds());
        if (typeof result.scheduled_start === "string") {
            startSchedule = Math.floor(DateTime.fromISO(result.scheduled_start).toSeconds());
        }
        timeMapping.scheduledStartTime = startSchedule;
        if (typeof startTime === "number" && typeof startSchedule === "number") {
            timeMapping.lateTime = startTime - startSchedule || NaN;
        }

        const updateData: VideoProps = {
            id: result.id,
            title: result.title || `Spaces ${result.id}`,
            // @ts-ignore
            status: spaceStatus,
            // @ts-ignore
            timedata: timeMapping,
            viewers: currentView,
            peakViewers,
            platform: "twitter",
        }
        updatedData.push(updateData);

        // checks for viewers data
        let viewersDataArrays: {
            timestamp: number;
            viewers?: number | undefined;
        }[] = [];
        if (spaceStatus === "live") {
            let currentViewersData = await ViewersData.findOne({ id: { $eq: result.id }, platform: {$eq: "twitter"} })
                .then((doc) => {
                    return doc;
                })
                .catch((err) => {
                    return undefined;
                });

            if (typeof currentViewersData !== "undefined" && !_.isNull(currentViewersData)) {
                viewersDataArrays = _.get(currentViewersData, "viewersData", []);
                viewersDataArrays.push({
                    timestamp: Math.floor(DateTime.utc().toSeconds()),
                    viewers: currentView,
                });
                let viewUpdData = {
                    id: currentViewersData["id"],
                    viewersData: viewersDataArrays,
                };
                try {
                    await ViewersData.updateOne({ _id: { $eq: currentViewersData._id } }, viewUpdData);
                } catch (e: any) {
                    logger.error(
                        `twitterSpacesHeartbeat() Failed to update viewers data for ID ${result["id"]}, ${e}`
                    );
                }
            } else {
                viewersDataArrays.push({
                    timestamp: Math.floor(DateTime.utc().toSeconds()),
                    viewers: currentView,
                });
                let viewNewData = {
                    id: result.id,
                    viewersData: viewersDataArrays,
                    group: channelMap.group,
                    platform: "twitter",
                };
                await ViewersData.insertMany([viewNewData]).catch((err) => {
                    logger.error(
                        `twitterSpacesHeartbeat() Failed to add viewers data for ID ${result["id"]}, ${err.toString()}`
                    );
                });
            }
        }
    }

    logger.info("twitterSpacesHeartbeat() checking old data for moving it to past streams...");
    const oldData: VideoProps[] = [];
    for (let i = 0; i < video_sets.length; i++) {
        const oldRes = video_sets[i];
        const updMap = _.find(updatedData, { id: oldRes.id });
        if (!isNone(updMap)) {
            continue;
        }

        const endTime = Math.floor(DateTime.utc().toSeconds());
        // @ts-ignore
        if (oldData.status !== "live") {
            continue;
        }

        // @ts-ignore
        let updOldData: VideoProps = {
            id: oldRes.id,
            status: "past",
            timedata: {
                // @ts-ignore
                startTime: oldRes.timedata.startTime,
                endTime,
                // @ts-ignore
                duration: endTime - oldRes.timedata.startTime ?? NaN,
                // @ts-ignore
                publishedAt: oldRes.timedata.publishedAt,
            }
        }

        if (_.has(oldData, "timedata.lateTime")) {
            // @ts-ignore
            updOldData.timedata.lateTime = oldData.timedata?.lateTime;
        }
        if (_.has(oldData, "timedata.scheduledStartTime")) {
            // @ts-ignore
            updOldData.timedata.scheduledStartTime = oldData?.timedata?.scheduledStartTime;
        }

        let collectViewersData = await ViewersData.findOne({
            id: { $eq: oldRes.id },
            platform: { $eq: "twitter" },
        })
            .then((doc) => {
                return doc;
            })
            .catch(() => {
                return undefined;
            });
        if (typeof collectViewersData !== "undefined" && !_.isNull(collectViewersData)) {
            let viewersStats: any[] = _.get(collectViewersData, "viewersData", []);
            if (viewersStats.length > 0) {
                let viewersNum = _.map(viewersStats, "viewers");
                viewersNum = viewersNum.filter((v) => typeof v === "number");
                let averageViewers = Math.round(_.sum(viewersNum) / viewersNum.length);
                updOldData["averageViewers"] = isNaN(averageViewers) ? 0 : averageViewers;
            }
        }
        // @ts-ignore
        oldData.push(updOldData);
    }

    updatedData = updatedData.concat(oldData);
    let dataWithAverageViewers = _.filter(updatedData, (o) => _.has(o, "averageViewers"));
    if (dataWithAverageViewers.length > 0) {
        let viewersIdsToDelete = _.map(dataWithAverageViewers, "id");
        if (viewersIdsToDelete.length > 0) {
            logger.info(`twitterSpacesHeartbeat() removing ${viewersIdsToDelete.length} viewers data...`);
            try {
                await ViewersData.deleteMany({ id: { $in: viewersIdsToDelete } });
            } catch (e: any) {
                logger.error(`twitterSpacesHeartbeat() failed to remove viewers data, ${e}`);
            }
        }
    }

    if (updatedData.length > 0) {
        logger.info("ttvLiveHeartbeat() updating existing videos...");
        const dbUpdateCommit = updatedData.map((new_update) =>
            // @ts-ignore
            VideosData.findOneAndUpdate({ id: { $eq: new_update.id } }, new_update, null, (err) => {
                if (err) {
                    // @ts-ignore
                    logger.error(`twitterSpacesHeartbeat() failed to update ${new_update.id}, ${err.toString()}`);
                    return;
                } else {
                    return;
                }
            })
        );
        await Promise.all(dbUpdateCommit).catch((err) => {
            logger.error(`twitterSpacesHeartbeat() failed to update databases, ${err.toString()}`);
        });
    }

    logger.info("twitterSpacesHeartbeat() heartbeat updated!");
}

export async function twitterSpacesFeeds(twtApi: TwitterAPI, filtersRun: FiltersConfig) {
    logger.info("twitterSpacesFeeds() fetching channels and videos data...");
    let video_sets = await VideosData.filteredFind(
        filtersRun["exclude"], filtersRun["include"],
        { id: 1, status: 1 },
        [
            { platform: { $eq: "twitter" } },
        ]
    );
    let channels = await ChannelsData.filteredFind(
        filtersRun["exclude"],
        filtersRun["include"],
        { id: 1, user_id: 1, group: 1, thumbnail: 1 },
        [{ platform: { $eq: "twitter" } }, { is_retired: { $eq: false } }]
    );
    if (channels.length < 1) {
        logger.warn("twitterSpacesFeeds() no registered channels");
        return;
    }

    const alreadyPropagated = video_sets.map((v) => v.id);
    const channelsIds = channels.map((ch) => ch.user_id) as string[];

    logger.info("twitterSpacesFeeds() fetching to API...");
    const twSpacesResult = await twtApi.fetchUserSpaces(channelsIds);
    const spacesResults = twSpacesResult.spaces;
    let insertNewData: VideoProps[] = [];
    for (let i = 0; i < spacesResults.length; i++) {
        const result = spacesResults[i];

        if (alreadyPropagated.includes(result.id)) {
            continue;
        }

        const spaceStatus = result.state;
        const publishedAt = DateTime.fromISO(result.created_at);
        const creatorId = result.creator_id;
        const channelMap = _.find(channels, { user_id: creatorId });
        if (isNone(channelMap)) {
            logger.warn(`twitterSpacesFeeds() channel ${creatorId} not found`);
            continue;
        }

        let startTime: NullableOr<number> = null;
        if (typeof result.started_at === "string") {
            startTime = Math.floor(DateTime.fromISO(result.started_at).toSeconds());
        }

        const currentView = result.participant_count ?? 0;
        const peakViewers = currentView;
        const forceTicket = result.is_ticketed ?? false;

        const timeMapping: {[key: string]: any} = {
            startTime,
            endTime: null,
            duration: null,
            publishedAt: result.created_at,
            scheduledStartTime: null,
            lateTime: null,
        }
        let startSchedule = Math.floor(publishedAt.toSeconds());
        if (typeof result.scheduled_start === "string") {
            startSchedule = Math.floor(DateTime.fromISO(result.scheduled_start).toSeconds());
        }
        timeMapping.scheduledStartTime = startSchedule;
        if (typeof startTime === "number" && typeof startSchedule === "number") {
            timeMapping.lateTime = startTime - startSchedule || NaN;
        }

        const insertData: VideoProps = {
            id: result.id,
            title: result.title || `Spaces ${result.id}`,
            // @ts-ignore
            status: spaceStatus,
            // @ts-ignore
            timedata: timeMapping,
            viewers: currentView,
            peakViewers,
            channel_id: channelMap.id,
            channel_uuid: channelMap.user_id,
            mentioned: [],
            thumbnail: channelMap.thumbnail,
            group: channelMap.group,
            platform: "twitter",
            is_missing: false,
            is_premiere: false,
            is_member: forceTicket,
        }
        insertNewData.push(insertData);

        if (spaceStatus === "live") {
            let viewNewData = {
                id: result.id,
                viewersData: [
                    {
                        timestamp: Math.floor(DateTime.utc().toSeconds()),
                        viewers: currentView,
                    },
                ],
                group: channelMap.group,
                platform: "twitter",
            };
            await ViewersData.insertMany([viewNewData]).catch((err) => {
                logger.error(
                    `twitterSpacesFeeds() failed to create viewers data for ID ${result.id}, ${err.toString()}`
                );
            });
        }
    }

    if (insertNewData.length > 0) {
        logger.info("twitterSpacesFeeds() inserting new videos...");
        await VideosData.insertMany(insertNewData).catch((err) => {
            logger.error(`twitterSpacesFeeds() failed to insert new video to database.\n${err.toString()}`);
        });
    }

    logger.info("twitterSpacesFeeds() heartbeat updated!");
}

export async function twitterChannelStats(twtAPI: TwitterAPI, filtersRun: FiltersConfig) {
    logger.info("twitterChannelStats() fetching channels data...");
    let channels = await ChannelsData.filteredFind(filtersRun["exclude"], filtersRun["include"], {
        id: 1,
        user_id: 1,
        group: 1,
    }, [
        { platform: { $eq: "twitter" } },
        { is_retired: { $eq: false } },
    ]);
    if (channels.length < 1) {
        logger.warn("twitterChannelStats() no registered channels");
        return;
    }
    logger.info("twitterChannelStats() fetching history data...");
    let channels_history_data = await ChannelStatsHistData.filteredFind(
        filtersRun["exclude"],
        filtersRun["include"],
        {
            id: 1,
            platform: 1,
        },
        [{ platform: { $eq: "twitter" } }]
    );

    let channelIds = channels.map((res) => res.user_id) as string[];
    logger.info("twitterChannelStats() fetching to API...");
    const twitterResutls = await twtAPI.fetchStatistics(channelIds);
    logger.info("twitterChannelStats() parsing API results...");

    const updateData = [];
    const historySet: HistoryMap[] = [];
    const currentTimestamp = Math.floor(DateTime.utc().toSeconds());
    for (let i = 0; i < twitterResutls.length; i++) {
        const result = twitterResutls[i];

        const followersData = _.get(result, "public_metrics.followers_count", 0);
        const oldChannelData = _.find(channels, {user_id: result.id});
        let group = "unknown";
        if (typeof oldChannelData !== "undefined") {
            group = oldChannelData.group;
        }

        const oldHistoryData = _.find(channels_history_data, {id: result.id});
        if (typeof oldHistoryData === "undefined") {
            historySet.push({
                id: result.id,
                history: {
                    timestamp: currentTimestamp,
                    followerCount: followersData,
                },
                mod: "insert",
                group,
            });
        } else {
            historySet.push({
                id: result.id,
                history: {
                    timestamp: currentTimestamp,
                    followerCount: followersData,
                },
                mod: "update",
                group,
            });
        }

        // @ts-ignore
        const mappedUpdate: ChannelsProps = {
            id: result.username,
            user_id: result.id,
            description: result.description,
            thumbnail: bestProfilePicture(result.profile_image_url),
            followerCount: followersData,
        }
        updateData.push(mappedUpdate);
    }

    if (updateData.length > 0) {
        logger.info("twitterChannelStats() updating channels...");
        const dbUpdateCommit = updateData.map((new_update) =>
            // @ts-ignore
            ChannelsData.findOneAndUpdate({ user_id: { $eq: new_update.user_id } }, new_update, null, (err) => {
                if (err) {
                    // @ts-ignore
                    logger.error(`twitterChannelStats() failed to update ${new_update.user_id}, ${err.toString()}`);
                    return;
                } else {
                    return;
                }
            })
        );
        await Promise.all(dbUpdateCommit).catch((err) => {
            logger.error(`twitterChannelStats() failed to update databases, ${err.toString()}`);
        });
    }

    // Update history data
    logger.info("twitterChannelStats() updating/inserting channel stats!");
    let histDBUpdate = historySet
        .filter((o) => o.mod === "update")
        .map((new_upd) => {
            ChannelStatsHistData.updateOne(
                { id: { $eq: new_upd.id }, platform: { $eq: "twitter" } },
                { $addToSet: { history: new_upd["history"] } },
                // @ts-ignore
                (err: any) => {
                    if (err) {
                        logger.error(
                            `twitterChannelStats() failed to update history ${new_upd.id}, ${err.toString()}`
                        );
                    } else {
                        return;
                    }
                }
            );
        });
    let insertDBUpdateList = historySet
        .filter((o) => o.mod === "insert")
        .map((peta) => {
            return {
                id: peta["id"],
                history: [peta["history"]],
                group: peta["group"],
                platform: "twitter",
            };
        });

    if (insertDBUpdateList.length > 0) {
        await ChannelStatsHistData.insertMany(insertDBUpdateList).catch((err) => {
            logger.error(`twitterChannelStats() failed to insert new history to databases, ${err.toString()}`);
        });
    }
    if (histDBUpdate.length > 0) {
        await Promise.all(histDBUpdate).catch((err) => {
            logger.error(`twitterChannelStats() failed to update history databases, ${err.toString()}`);
        });
    }

    logger.info("twitterChannelStats() channels stats updated!");
}