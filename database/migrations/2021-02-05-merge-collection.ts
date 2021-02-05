import _ from "lodash";
import { createSchema, Type, typedModel, ExtractProps } from "ts-mongoose";

import {
    VideoProps,
    LiveStatus,
    PlatformData,
    VideosData,
    ChannelsProps,
    ChannelsData,
    ChannelStatsHistProps,
    ChannelStatsHistData
} from "../../src/models";
import { logger } from "../../src/utils/logger";

const YoutubeVideoSchema = createSchema(
    {
        id: Type.string({ required: true }),
        title: Type.string({required: true}),
        status: Type.string({required: true, enum: LiveStatus}),
        timedata: Type.object({required: true}).of({
            scheduledStartTime: Type.number(),
            startTime: Type.number(),
            endTime: Type.number(),
            lateTime: Type.number(),
            duration: Type.number(),
            publishedAt: Type.string(),
        }),
        viewers: Type.number(),
        peakViewers: Type.number(),
        averageViewers: Type.number(),
        channel_id: Type.string({required: true}),
        thumbnail: Type.string({required: true}),
        group: Type.string({required: true}),
        platform: Type.string({required: true, enum: PlatformData}),
        is_missing: Type.boolean(),
        is_premiere: Type.boolean(),
        is_member: Type.boolean(),
    }
)

const YoutubeChannelSchema = createSchema(
    {
        id: Type.string({ required: true }),
        name: Type.string({required: true}),
        en_name: Type.string(),
        description: Type.string(),
        publishedAt: Type.string({required: true}),
        subscriberCount: Type.number(),
        viewCount: Type.number(),
        videoCount: Type.number(),
        thumbnail: Type.string({required: true}),
        history: Type.array().of({
            timestamp: Type.number({required: true}),
            subscriberCount: Type.number(),
            viewCount: Type.number(),
            videoCount: Type.number()
        }),
        group: Type.string({required: true}),
        platform: Type.string({required: true, enum: PlatformData}),
    }
)

const TwitchVideoSchema = createSchema(
    {
        id: Type.string({ required: true }),
        title: Type.string({required: true}),
        status: Type.string({required: true, enum: LiveStatus}),
        timedata: Type.object({required: true}).of({
            startTime: Type.number(),
            endTime: Type.number(),
            duration: Type.number(),
            publishedAt: Type.string(),
        }),
        viewers: Type.number(),
        peakViewers: Type.number(),
        averageViewers: Type.number(),
        channel_uuid: Type.string({required: true}),
        channel_id: Type.string({required: true}),
        thumbnail: Type.string({required: true}),
        group: Type.string({required: true}),
        platform: Type.string({required: true, enum: PlatformData}),
    }
)

const TwitchChannelSchema = createSchema(
    {
        id: Type.string({ required: true }),
        user_id: Type.string({ required: true }),
        name: Type.string({required: true}),
        en_name: Type.string(),
        description: Type.string(),
        publishedAt: Type.string({required: true}),
        followerCount: Type.number(),
        viewCount: Type.number(),
        videoCount: Type.number(),
        history: Type.array().of({
            timestamp: Type.number({required: true}),
            followerCount: Type.number(),
            viewCount: Type.number(),
            videoCount: Type.number()
        }),
        thumbnail: Type.string({required: true}),
        group: Type.string({required: true}),
        platform: Type.string({required: true, enum: PlatformData}),
    }
)

const TwitcastingVideoSchema = createSchema(
    {
        id: Type.string({ required: true }),
        title: Type.string({required: true}),
        status: Type.string({required: true, enum: LiveStatus}),
        timedata: Type.object({required: true}).of({
            startTime: Type.number(),
            endTime: Type.number(),
            duration: Type.number(),
            publishedAt: Type.string(),
        }),
        viewers: Type.number(),
        peakViewers: Type.number(),
        averageViewers: Type.number(),
        channel_id: Type.string({required: true}),
        thumbnail: Type.string({required: true}),
        is_member: Type.boolean(),
        group: Type.string({required: true}),
        platform: Type.string({required: true, enum: PlatformData}),
    }
)

const TwitcastingChannelSchema = createSchema(
    {
        id: Type.string({ required: true }),
        name: Type.string({required: true}),
        en_name: Type.string(),
        description: Type.string(),
        followerCount: Type.number(),
        level: Type.number(),
        history: Type.array().of({
            timestamp: Type.number({required: true}),
            followerCount: Type.number(),
            level: Type.number(),
        }),
        thumbnail: Type.string({required: true}),
        group: Type.string({required: true}),
        platform: Type.string({required: true, enum: PlatformData}),
    }
)

const MildomVideoSchema = createSchema(
    {
        id: Type.string({ required: true }),
        title: Type.string({required: true}),
        status: Type.string({required: true, enum: LiveStatus}),
        timedata: Type.object({required: true}).of({
            startTime: Type.number(),
            endTime: Type.number(),
            duration: Type.number(),
            publishedAt: Type.string(),
        }),
        viewers: Type.number(),
        peakViewers: Type.number(),
        averageViewers: Type.number(),
        channel_id: Type.string({required: true}),
        thumbnail: Type.string({required: true}),
        group: Type.string({required: true}),
        platform: Type.string({required: true, enum: PlatformData}),
    }
)

const MildomChannelSchema = createSchema(
    {
        id: Type.string({ required: true }),
        name: Type.string({required: true}),
        en_name: Type.string(),
        description: Type.string(),
        followerCount: Type.number(),
        videoCount: Type.number(),
        level: Type.number(),
        history: Type.array().of({
            timestamp: Type.number({required: true}),
            followerCount: Type.number(),
            videoCount: Type.number(),
            level: Type.number(),
        }),
        thumbnail: Type.string({required: true}),
        group: Type.string({required: true}),
        platform: Type.string({required: true, enum: PlatformData}),
    }
)

const BilibiliVideoSchema = createSchema(
    {
        id: Type.string({ required: true }),
        room_id: Type.string({required: true}),
        title: Type.string({required: true}),
        timedata: Type.object({required: true}).of({
            startTime: Type.number(),
            endTime: Type.number(),
            duration: Type.number(),
            publishedAt: Type.string(),
        }),
        viewers: Type.number(),
        peakViewers: Type.number(),
        status: Type.string({required: true, enum: LiveStatus}),
        channel_id: Type.string({required: true}),
        thumbnail: Type.string({required: true}),
        group: Type.string({required: true}),
        platform: Type.string({required: true, enum: PlatformData}),
    }
)

const BilibiliChannelSchema = createSchema(
    {
        id: Type.string({ required: true }),
        room_id: Type.string({ required: true }),
        name: Type.string({required: true}),
        en_name: Type.string(),
        description: Type.string(),
        subscriberCount: Type.number(),
        viewCount: Type.number(),
        videoCount: Type.number(),
        history: Type.array().of({
            timestamp: Type.number({required: true}),
            followerCount: Type.number(),
            videoCount: Type.number(),
            level: Type.number(),
        }),
        thumbnail: Type.string({required: true}),
        group: Type.string({required: true}),
        live: Type.boolean(),
        platform: Type.string({required: true, enum: PlatformData}),
    }
)

type YTVideoProps = ExtractProps<typeof YoutubeVideoSchema>;
type YTChannelProps = ExtractProps<typeof YoutubeChannelSchema>;
type TTVVideoProps = ExtractProps<typeof TwitchVideoSchema>;
type TTVChannelProps = ExtractProps<typeof TwitchChannelSchema>;
type TWCastVideoProps = ExtractProps<typeof TwitcastingVideoSchema>;
type TWCastChannelProps = ExtractProps<typeof TwitcastingChannelSchema>;
type MildomVideoProps = ExtractProps<typeof MildomVideoSchema>;
type MildomChannelProps = ExtractProps<typeof MildomChannelSchema>;
type B2VideoProps = ExtractProps<typeof BilibiliVideoSchema>;
type B2ChannelProps = ExtractProps<typeof BilibiliChannelSchema>;

const YoutubeVideo = typedModel("YoutubeVideo", YoutubeVideoSchema);
const YoutubeChannel = typedModel("YoutubeChannel", YoutubeChannelSchema);
const TwitchVideo = typedModel("TwitchVideo", TwitchVideoSchema);
const TwitchChannel = typedModel("TwitchChannel", TwitchChannelSchema);
const TwitcastingVideo = typedModel("TwitcastingVideo", TwitcastingVideoSchema);
const TwitcastingChannel = typedModel("TwitcastingChannel", TwitcastingChannelSchema);
const MildomVideo = typedModel("MildomVideo", MildomVideoSchema);
const MildomChannel = typedModel("MildomChannel", MildomChannelSchema);
const BilibiliVideo = typedModel("BilibiliVideo", BilibiliVideoSchema);
const BilibiliChannel = typedModel("BilibiliChannel", BilibiliChannelSchema);

export async function migrate_MergeCollection_20200205() {
    logger.info("migrate_MergeCollection_20200205() starting migration...");
    let finalizedVideos: VideoProps[] = [];
    logger.info("migrate_MergeCollection_20200205() collecting youtube videos...");
    const ytVideos: YTVideoProps[] = await YoutubeVideo.find({});
    logger.info("migrate_MergeCollection_20200205() collecting twitch videos...");
    const ttvVideos: TTVVideoProps[] = await TwitchVideo.find({});    
    logger.info("migrate_MergeCollection_20200205() collecting twitcasting videos...");
    const twcastVideos: TWCastVideoProps[] = await TwitcastingVideo.find({});
    logger.info("migrate_MergeCollection_20200205() collecting bilibili videos...");
    const biliVideos: B2VideoProps[] = await BilibiliVideo.find({});
    logger.info("migrate_MergeCollection_20200205() collecting mildom videos...");
    const mildomVideos: MildomVideoProps[] = await MildomVideo.find({});
    finalizedVideos = _.concat(finalizedVideos, ytVideos);
    finalizedVideos = _.concat(finalizedVideos, ttvVideos);
    finalizedVideos = _.concat(finalizedVideos, twcastVideos);
    finalizedVideos = _.concat(finalizedVideos, biliVideos);
    finalizedVideos = _.concat(finalizedVideos, mildomVideos);

    logger.info("migrate_MergeCollection_20200205() committing data to new VideosData collection...");
    await VideosData.insertMany(finalizedVideos, (err) => {
        if (err) {
            logger.error(`migrate_MergeCollection_20200205() Failed to commit data to VideosData, ${err.toString()}`);
            console.error(err);
        }
        return;
    });

    let finalizedChannels: ChannelsProps[] = [];
    logger.info("migrate_MergeCollection_20200205() collecting youtube channels...");
    const ytChannels: YTChannelProps[] = await YoutubeChannel.find({});
    logger.info("migrate_MergeCollection_20200205() collecting twitch channels...");
    const ttvChannels: TTVChannelProps[] = await TwitchChannel.find({});    
    logger.info("migrate_MergeCollection_20200205() collecting twitcasting channels...");
    const twcastChannels: TWCastChannelProps[] = await TwitcastingChannel.find({});
    logger.info("migrate_MergeCollection_20200205() collecting bilibili channels...");
    const biliChannels: B2ChannelProps[] = await BilibiliChannel.find({});
    logger.info("migrate_MergeCollection_20200205() collecting mildom channels...");
    const mildomChannels: MildomChannelProps[] = await MildomChannel.find({});
    finalizedChannels = _.concat(finalizedChannels, ytChannels);
    finalizedChannels = _.concat(finalizedChannels, ttvChannels);
    finalizedChannels = _.concat(finalizedChannels, twcastChannels);
    finalizedChannels = _.concat(finalizedChannels, biliChannels);
    finalizedChannels = _.concat(finalizedChannels, mildomChannels);

    logger.info("migrate_MergeCollection_20200205() remapping history to separate collection...");
    let finalizedHistoryChannels: ChannelStatsHistProps[] = finalizedChannels.map((res) => {
        // @ts-ignore
        let remapTo: ChannelStatsHistProps = {
            id: res["id"],
            // @ts-ignore
            history: res["history"],
            group: res["group"],
            platform: res["platform"],
        }
        return remapTo;
    })

    logger.info("migrate_MergeCollection_20200205() omitting history from finalized ChannelsData collection...");
    finalizedChannels = _.map(finalizedChannels, (o) => _.omit(o, "history"));

    logger.info("migrate_MergeCollection_20200205() committing data to new ChannelsData collection...");
    await ChannelsData.insertMany(finalizedChannels, (err) => {
        if (err) {
            logger.error(`migrate_MergeCollection_20200205() Failed to commit data to ChannelsData, ${err.toString()}`);
            console.error(err);
        }
        return;
    });
    logger.info("migrate_MergeCollection_20200205() committing data to new ChannelStatsHistData collection...");
    await ChannelStatsHistData.insertMany(finalizedHistoryChannels, (err) => {
        if (err) {
            logger.error(`migrate_MergeCollection_20200205() Failed to commit data to ChannelStatsHistData, ${err.toString()}`);
            console.error(err);
        }
        return;
    });

    logger.info("migrate_MergeCollection_20200205() Migration finished!");
}